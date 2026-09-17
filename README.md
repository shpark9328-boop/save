# 🚄 KTX 좌석 알림

매진된 KTX 열차에 **취소표가 나오는 순간**을 감지해 웹 푸시/이메일로 알려주는 서비스입니다.
좌석이 생겼다는 **사실만** 알려주며, 예매나 결제를 대신하지 않습니다.

```
알림 등록 → 서버가 조건 저장 → 워커가 주기적으로 좌석 확인
   → 매진 상태 유지 시 무시 → 좌석 발생 감지 → 상태 변화 확인
   → 웹 푸시 발송 → 사용자가 예매 페이지로 이동
```

---

## ⚠️ 먼저 읽어야 할 것: 실제 KTX 좌석 데이터

**실시간 좌석(매진/잔여) 정보를 제공하는 공개 API 는 존재하지 않습니다.**

- 공공데이터포털의 [TAGO 열차정보](https://www.data.go.kr/data/15098552/openapi.do),
  [한국철도공사 열차운행정보](https://www.data.go.kr/data/15125762/openapi.do) 는
  **시간표·운임까지만** 제공하고 좌석 재고는 제공하지 않습니다.
- 좌석 재고를 아는 것은 코레일 예매 시스템뿐이며, 그 인터페이스는 공개 API 가 아니고
  로그인·자동화 제한의 대상입니다. 이 저장소는 **스크래핑/로그인 우회/캡차 우회 코드를 포함하지 않습니다.**

그래서 데이터 소스는 인터페이스 뒤로 분리되어 있고, 기본값은 mock 입니다.

| `TRAIN_PROVIDER` | 좌석 정보 | 설명 |
| --- | --- | --- |
| `mock` (기본) | ✅ 가상 | 결정적 시간표 + 주기적으로 바뀌는 좌석 상태. 전체 파이프라인 검증 가능 |
| `tago` | ❌ | 공공데이터 시간표만. 좌석은 `UNKNOWN` → **알림이 발송되지 않음** (의도된 동작) |
| `http` | ✅ | 좌석 데이터를 적법하게 보유한 주체의 엔드포인트를 연결 ([계약](docs/providers.md)) |

자세한 조사 내용: **[docs/data-sources.md](docs/data-sources.md)**
시스템 설계: **[docs/architecture.md](docs/architecture.md)**
provider 연동: **[docs/providers.md](docs/providers.md)**

---

## 기능

- 출발/도착역, 날짜, 출발 시간대, 승객 수, 열차 종별, 좌석 등급으로 알림 등록
- 노선+날짜가 같은 알림은 **하나의 조회로 합쳐** 제공처 부하를 사용자 수와 분리
- **상태 변화(매진 → 좌석 발생)에서만** 알림. 같은 상태가 이어지면 재알림 없음.
  다시 매진됐다가 풀리면 새 이벤트로 재알림
- 웹 푸시(VAPID) + 이메일(SMTP, 선택), 알림 클릭 시 예매 페이지로 이동
- 알림 일시정지/삭제, 여행일 이후 자동 만료
- 관리자 대시보드: 알림 수, 그룹 상태, 워커 생존, 최근 조회/상태변화/발송/오류 기록
- 레이트 리밋, 지수 백오프, 다중 워커 안전(조건부 UPDATE 잠금)

## 기술 스택

Next.js 16 (App Router) · TypeScript(strict) · Tailwind CSS v4 · PostgreSQL · Prisma ·
web-push · nodemailer · Vitest

> 큐(Redis/BullMQ) 대신 PostgreSQL 스케줄링을 택한 이유는
> [docs/architecture.md](docs/architecture.md#1-전체-그림) 참고. `CheckerStore` 포트만 바꾸면 큐 기반으로 교체 가능합니다.

---

## 1. 설치

```bash
git clone <repo-url>
cd <repo>
npm install
```

요구 사항: Node.js 20.9+ (22 권장), PostgreSQL 14+

## 2. 환경변수 설정

```bash
cp .env.example .env
```

최소한 다음 값만 채우면 mock 으로 전체 기능이 동작합니다.

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ktx_alert?schema=public"
APP_BASE_URL="http://localhost:3000"
TRAIN_PROVIDER="mock"
ADMIN_TOKEN="아무 긴 랜덤 문자열"
```

주요 환경변수:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `TRAIN_PROVIDER` | `mock` | `mock` / `tago` / `http` |
| `GROUP_MIN_INTERVAL_SECONDS` | `60` | 같은 노선·날짜 재조회 최소 간격 |
| `PROVIDER_MIN_GAP_MS` | `1500` | 외부 요청 사이 최소 간격 |
| `PROVIDER_MAX_RPM` | `30` | 분당 최대 외부 요청 수 |
| `WORKER_TICK_SECONDS` | `15` | 워커 루프 주기 |
| `MOCK_AVAILABILITY_RATE` | `0.12` | mock 좌석 발생 확률 (데모 시 `0.6` 권장) |
| `ALERT_MAX_PER_TOKEN` | `10` | 브라우저당 최대 활성 알림 수 |
| `DRY_RUN_NOTIFICATIONS` | `false` | `true` 면 실제 발송 없이 기록만 |

전체 목록은 [`.env.example`](.env.example) 참고.

## 3. DB 준비

```bash
# 로컬에 PostgreSQL 이 없다면 Docker 로:
docker run -d --name ktx-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ktx_alert postgres:16-alpine
```

## 4. Prisma 마이그레이션

```bash
npm run db:generate      # 클라이언트 생성
npm run db:migrate       # 개발: 마이그레이션 생성 + 적용
# 운영에서는
npm run db:deploy        # prisma migrate deploy

npm run db:seed          # (선택) 데모 알림 2건 생성
npm run db:studio        # (선택) DB 브라우저
```

## 5. 개발 서버 실행

```bash
npm run dev              # http://localhost:3000
```

## 6. 워커 실행 (별도 터미널)

```bash
npm run worker
# 데모: 좌석이 자주 풀리게 하려면
MOCK_AVAILABILITY_RATE=0.6 MOCK_FLIP_INTERVAL_SECONDS=20 npm run worker
```

워커 로그 예시:

```json
{"level":"info","msg":"사이클 완료","groupsClaimed":2,"trainsSeen":62,"notificationsSent":1}
{"level":"info","msg":"좌석 발생 알림","trainNo":"137","seatClass":"GENERAL","departure":"19:10"}
```

워커는 여러 개 띄워도 안전합니다(그룹 단위 잠금). 각각 `WORKER_ID` 를 다르게 주세요.

## 7. 웹 푸시 설정

```bash
npm run push:keys
```

출력된 값을 `.env` 에 붙여넣습니다.

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

- 웹 푸시는 **HTTPS(또는 localhost)** 에서만 동작합니다.
- iOS Safari 는 홈 화면에 추가(PWA)한 뒤에만 푸시를 받을 수 있습니다.
- 브라우저에서 "🔔 좌석 알림 시작"을 누르면 권한 요청 → 구독 등록 → 테스트 알림이 뜹니다.
- 이메일 알림을 쓰려면 `SMTP_URL` 을 설정하세요. (예: `smtp://user:pass@smtp.example.com:587`)

## 8. 테스트

```bash
npm test          # vitest (59 tests)
npm run typecheck # tsc --noEmit
```

DB 없이 엔진 전체가 검증됩니다(인메모리 저장소 주입). 다루는 시나리오:

- `SOLD_OUT → AVAILABLE` → 알림 발송
- `AVAILABLE → AVAILABLE` → 중복 알림 없음
- `AVAILABLE → SOLD_OUT → AVAILABLE` → 두 번째에 다시 알림
- `UNKNOWN` → 직전 상태 유지, 알림 없음
- 시간대 밖 열차 / 종별 불일치 / 승객 수 부족 → 알림 없음
- 같은 노선·날짜 알림 3건 → 외부 조회는 1회, 알림은 3명 모두에게
- 잘못된 역 조합·지난 날짜·시간 역전 등 입력 검증
- provider 오류 시 사이클 지속 + 실패 카운트 증가
- 레이트 리미터의 최소 간격/분당 상한

## 9. 운영 배포

### 방법 A. Docker Compose (웹 + 워커 + DB)

```bash
cp .env.example .env     # 값 채우기 (DATABASE_URL 은 compose 가 덮어씀)
docker compose up -d --build
docker compose logs -f worker
```

`web`(3000), `worker`, `db`, 그리고 마이그레이션을 1회 수행하는 `migrate` 서비스가 뜹니다.

### 방법 B. Vercel(웹) + 별도 워커

1. **웹**: Vercel 에 배포. 환경변수 설정 후 Build Command 는 기본값(`npm run build` → `prisma generate` 포함).
   서버리스에서는 커넥션 풀러(예: PgBouncer, Neon/Supabase pooler) 사용을 권장합니다.
2. **DB**: 관리형 PostgreSQL (Neon, Supabase, RDS 등).
3. **워커**: Vercel 에서는 상시 프로세스를 돌릴 수 없으므로 **반드시 별도**로 실행합니다.
   - Railway/Render/Fly.io/EC2 등에서 `npm run worker` 를 상시 실행, 또는
   - 위 Docker 이미지로 `command: npm run worker` 만 띄우기
4. 배포 후 `npm run db:deploy` 로 마이그레이션을 적용합니다.

### 운영 체크리스트

- [ ] `ADMIN_TOKEN` 을 충분히 긴 랜덤 값으로 설정 (미설정 시 관리자 API 는 503)
- [ ] `APP_BASE_URL` 을 실제 도메인으로 설정 (CSRF Origin 검사에 사용)
- [ ] VAPID 키를 생성하고 **비밀키를 노출하지 않기**
- [ ] `PROVIDER_MAX_RPM` / `GROUP_MIN_INTERVAL_SECONDS` 를 제공처 허용량에 맞게 조정
- [ ] `/api/health` 로 헬스체크 구성
- [ ] 워커를 여러 개 띄운다면 `WORKER_ID` 를 서로 다르게
- [ ] 관리자 화면(`/admin`)에서 워커 생존과 오류 기록을 주기적으로 확인

## 10. 사용 방법

1. `/` 에서 조건을 입력하고 **🔔 좌석 알림 시작**
2. 알림 권한을 허용하면 테스트 알림이 한 번 표시됩니다
3. `/alerts` 에서 모니터링 상태 확인, 일시정지/삭제
4. 좌석이 생기면 알림 도착 → 클릭하면 예매 페이지로 이동
5. `/admin` 에서 `ADMIN_TOKEN` 으로 로그인해 운영 상태 확인

알림 예시:

```
🚄 KTX 좌석이 생겼습니다!

서울 → 부산
2026년 9월 20일 (일)
19:10 출발 · 21:52 도착
KTX 101 · 일반실
잔여 2석 · 예약 가능
```

> 알림 목록은 브라우저에 저장된 토큰으로 식별합니다(계정 없음).
> 브라우저 데이터를 지우면 목록에 접근할 수 없습니다.

## 11. 하지 않는 것

- 캡차/로그인/보안장치 우회
- 사용자 계정 자격증명 보관·대리 사용
- 자동 예매·자동 결제
- 제공처에 대한 과도한 자동 요청

이 서비스의 목적은 **좌석이 생겼다는 사실을 알려주는 것**까지입니다.

## 라이선스

MIT
