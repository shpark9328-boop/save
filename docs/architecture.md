# 시스템 구조

## 1. 전체 그림

```
[브라우저]
   │  (1) 알림 조건 등록 / 푸시 구독
   ▼
[Next.js App Router]  ── API Routes ──┐
   │  RSC 페이지                       │
   │                                   ▼
   │                            [PostgreSQL]  ◀────┐
   │                                   ▲            │
   │                                   │            │
   └───── 푸시 알림 수신 ◀── [Service Worker]        │
                                                    │
[Checker Worker (별도 프로세스)] ───────────────────┘
   │  (2) 조회 시각이 된 WatchGroup 을 잠그고 가져옴
   ▼
[TrainDataProvider]  ← mock | tago | http
   │  (3) 노선+날짜 단위로 1회 조회
   ▼
[상태 전이 판정]  (4) 알림별 satisfied 전이 계산
   │
   ▼
[NotificationDispatcher] ── Web Push / Email
```

큐(Redis/BullMQ) 대신 **PostgreSQL 기반 스케줄링 + 조건부 UPDATE 잠금**을 썼다. 이유:

- 작업 단위가 "다음 조회 시각이 된 그룹"뿐이라 큐의 재시도/우선순위 기능이 필요 없다.
- 컴포넌트를 하나 줄이면 배포·운영이 단순해진다(웹 + 워커 + DB 3개면 끝).
- 워커를 여러 개 띄워도 `UPDATE ... WHERE lockedUntil IS NULL OR lockedUntil < now()` 의
  행 단위 원자성 덕분에 중복 조회가 발생하지 않는다.
- 규모가 커져 팬아웃이 필요해지면 `CheckerStore` 포트 구현만 큐 기반으로 바꾸면 된다.

## 2. 데이터 모델

| 모델 | 역할 |
| --- | --- |
| `User` | 브라우저 토큰(SHA-256 해시)으로 식별. 이메일은 이메일 알림을 선택한 경우에만 저장 |
| `PushSubscription` | 웹 푸시 구독. 만료(404/410)되면 자동 비활성화 |
| `WatchGroup` | **조회 단위** = (provider, 출발역, 도착역, 날짜). 여러 사용자가 공유 |
| `Alert` | 사용자 알림 조건(시간대, 승객 수, 종별, 좌석 등급, 채널, 만료 시각) |
| `AlertSeatState` | **(알림 × 열차 × 좌석등급)** 의 직전 충족 여부. 중복 알림 방지의 핵심 |
| `TrainSnapshot` | 그룹 단위 최신 좌석 상태 (열차 × 좌석등급) |
| `SeatEvent` | 좌석 상태 변화 이력 (관리자 화면/디버깅) |
| `CheckRun` | 외부 조회 1건의 결과·소요시간·오류 |
| `NotificationLog` | 알림 발송 기록(성공/실패/생략) |
| `WorkerHeartbeat` | 워커 생존 확인 |

`TrainSnapshot`(그룹 단위)과 `AlertSeatState`(알림 단위)를 나눈 이유:
좌석 상태는 모두에게 같지만 **"조건 충족"은 알림마다 다르다.** 승객 2명 알림에게 잔여 1석은
충족이 아니고, 07:00~09:00 알림에게 19:10 열차는 대상조차 아니다. 알림을 보낼지는
알림별 상태로 판단해야 정확하다.

## 3. 상태 전이 규칙

`src/server/monitor/transition.ts` (순수 함수, 테스트 대상)

| 직전 → 현재 | 알림 |
| --- | --- |
| 미충족 → 충족 | ✅ 발송 |
| 충족 → 충족 | ❌ 중복 방지 |
| 충족 → 미충족 | ❌ (상태만 재무장) |
| 충족 → 미충족 → 충족 | ✅ 두 번째에 다시 발송 |
| 무엇이든 → `UNKNOWN` | ❌ **직전 상태 유지** |

`UNKNOWN` 에서 상태를 초기화하지 않는 이유: 일시적 조회 실패 뒤에 같은 좌석으로 중복 알림이
가는 것을 막기 위해서다.

알림 폭주 방지를 위해 `Alert.maxNotifications`(기본 20)에 도달하면 상태만 갱신하고 발송은 멈춘다.

## 4. 워커 한 사이클

```
expireAlerts()                     만료 알림 비활성화 + 빈 그룹 비활성화
claimDueGroups()                   nextCheckAt <= now 인 그룹을 조건부 UPDATE 로 잠금
for each group:
    rateLimiter.acquire()          최소 간격 + 분당 상한 대기
    provider.searchTrains()        노선+날짜 1회 조회
    saveSnapshots / saveSeatEvents 그룹 단위 상태·변화 기록
    for each alert in group:
        evaluateTrains()           시간대/종별/등급/승객 수 필터
        evaluateTransition()       알림 여부 판정
        notifier.notify()          웹 푸시 / 이메일
    finishGroup(nextCheckAt)       잠금 해제 + 다음 조회 시각
heartbeat()
```

오류 시: `CheckRun(status=ERROR)` 기록 → 연속 실패 횟수에 따른 지수 백오프
(`60s × 2^n`, 최대 1시간). 미지원 구간은 6시간.

## 5. 경쟁 조건 처리

| 상황 | 대응 |
| --- | --- |
| 워커 2개가 같은 그룹을 집음 | `updateMany` 조건부 잠금 — 한쪽만 `count === 1` |
| 같은 알림에 동시 알림 발송 | 한 그룹은 한 워커만 처리 → 그룹 내 알림 처리는 직렬화 |
| 동시에 같은 노선 알림 등록 | `WatchGroup` 유니크 제약 + `upsert` |
| 워커가 잠근 채로 죽음 | `lockedUntil` 이 지나면 다른 워커가 회수 |
| 사용자가 알림을 껐다 켬 | `AlertSeatState` 삭제 → 현재 좌석도 새 이벤트로 재감지 |

## 6. API

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/stations` | - | 역 목록 |
| GET | `/api/config` | - | provider 정보, VAPID **공개** 키, 제한값 |
| GET | `/api/alerts` | `x-watch-token` | 내 알림 목록 |
| POST | `/api/alerts` | `x-watch-token` | 알림 등록 |
| PATCH | `/api/alerts/:id` | `x-watch-token` | 일시정지/재시작 |
| DELETE | `/api/alerts/:id` | `x-watch-token` | 삭제 |
| POST | `/api/push/subscribe` | `x-watch-token` | 푸시 구독 등록 |
| DELETE | `/api/push/subscribe` | `x-watch-token` | 푸시 구독 해지 |
| GET | `/api/admin/stats` | `x-admin-token` | 관리자 통계 |
| GET | `/api/health` | - | DB 헬스체크 |

## 7. 보안

- **비밀값 분리**: VAPID 비밀키·서비스키·SMTP 자격증명은 서버 환경변수. 클라이언트에는 공개키만.
- **입력 검증**: 모든 입력은 zod 스키마 통과 후 사용. 역 코드/날짜/시간/구간 유효성까지 확인.
- **SQL 인젝션**: Prisma 파라미터 바인딩만 사용(문자열 연결 쿼리 없음).
- **XSS**: React 자동 이스케이프. `dangerouslySetInnerHTML` 미사용.
- **CSRF**: 인증이 쿠키가 아니라 커스텀 헤더(`x-watch-token`)라 교차 출처에서 위조 불가.
  추가로 변경 요청은 `Origin` 헤더를 `APP_BASE_URL` 과 대조한다.
- **토큰 저장**: watch token 은 SHA-256 해시만 DB 에 저장. 관리자 토큰은 상수 시간 비교.
- **개인정보 최소화**: 이메일은 이메일 알림 선택 시에만 저장. 계정/비밀번호/결제정보 없음.
- **요청 제한**: API 별 인메모리 레이트 리밋(다중 인스턴스에서는 Redis 기반으로 교체 권장).
- **보안 헤더**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` (`next.config.ts`).

## 8. 디렉터리

```
src/
  app/                 페이지 + API 라우트
  components/          UI (클라이언트 컴포넌트)
  lib/                 도메인 공용 (시간, 역, 검증) — 서버/클라이언트 공용
  lib/client/          브라우저 전용 (토큰, API 클라이언트, 푸시)
  server/
    providers/         데이터 provider 추상화 + 구현체
    monitor/           매칭 · 상태 전이 · 엔진 · 저장소 포트 · 레이트 리밋
    notifications/     메시지 생성 · 웹 푸시 · 이메일 · 디스패처
    alerts/            알림 비즈니스 로직
    admin/             관리자 집계
  workers/             워커 엔트리포인트
  types/               API DTO
prisma/                스키마 · 마이그레이션 · 시드
tests/                 vitest (DB 없이 엔진 전체 검증)
```
