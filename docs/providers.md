# 데이터 provider 붙이기

애플리케이션은 `TrainDataProvider` 인터페이스에만 의존한다 (`src/server/providers/types.ts`).

```ts
interface TrainDataProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  readonly minIntervalMs: number;
  searchTrains(params: SearchParams): Promise<Train[]>;
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}
```

## 1. 환경변수로 고르기

| `TRAIN_PROVIDER` | 구현체 | 좌석 정보 | 용도 |
| --- | --- | --- | --- |
| `mock` (기본) | `MockTrainProvider` | ✅ (가상) | 개발·데모·테스트 |
| `tago` | `TagoTrainProvider` | ❌ (UNKNOWN) | 공공데이터 시간표 연동 |
| `http` | `HttpSeatProvider` | ✅ | 외부 어댑터 연동 |

## 2. `http` provider 계약

좌석 데이터를 적법하게 보유/취득할 수 있는 주체가 아래 엔드포인트를 제공하면 된다.

**요청**

```http
POST {SEAT_PROVIDER_URL}
Authorization: Bearer {SEAT_PROVIDER_TOKEN}
Content-Type: application/json

{
  "departureStationCode": "SEOUL",
  "arrivalStationCode": "BUSAN",
  "travelDate": "2026-09-20",
  "departAfter": "17:00",
  "departBefore": "22:00",
  "passengerCount": 2,
  "trainTypes": ["KTX", "KTX_SANCHEON"]
}
```

**응답**

```json
{
  "trains": [
    {
      "trainNo": "101",
      "trainType": "KTX",
      "trainName": "KTX 101",
      "departureAt": "2026-09-20T19:10:00+09:00",
      "arrivalAt": "2026-09-20T21:52:00+09:00",
      "seats": [
        { "seatClass": "GENERAL", "status": "SOLD_OUT", "remainingSeats": 0 },
        { "seatClass": "FIRST", "status": "AVAILABLE", "remainingSeats": 2 }
      ],
      "reservationUrl": "https://example.com/booking/101"
    }
  ]
}
```

- `trainType`: `KTX | KTX_SANCHEON | KTX_EUM | KTX_CHEONGRYONG | ITX_SAEMAEUL`
- `seatClass`: `GENERAL | FIRST`
- `status`: `AVAILABLE | SOLD_OUT | WAITLIST | UNKNOWN`
- `remainingSeats`: 좌석 수를 모르면 `null`. 이 경우 승객 수 조건은 통과 처리된다.
- 응답은 zod 스키마로 검증되며, 계약을 위반하면 재시도하지 않는 오류로 기록된다.

## 3. 새 provider 를 직접 구현할 때

1. `src/server/providers/my-provider.ts` 에 `TrainDataProvider` 를 구현한다.
2. 실패는 `ProviderError`(재시도 가능 여부 포함), 미지원 구간은 `UnsupportedRouteError` 로 던진다.
   엔진이 이를 구분해 백오프 길이를 정한다.
3. `capabilities.seatAvailability` 를 정직하게 선언한다. `false` 이면 UI/관리자 화면에 경고가 뜨고,
   좌석 상태는 `UNKNOWN` 으로 처리되어 알림이 발송되지 않는다.
4. `src/server/providers/index.ts` 의 `createProvider()` 에 분기를 추가한다.
5. 역 코드가 다르면 `PROVIDER_STATION_MAP_PATH` JSON 으로 매핑한다.
   (외부 역 코드값을 소스코드에 추측해서 넣지 않는다.)

## 4. 지켜야 할 선

- 캡차/로그인/보안장치 우회 금지
- 사용자 계정 자격증명 대리 보관·사용 금지
- 자동 예매·자동 결제 금지 (이 서비스는 "알림"까지만 한다)
- 제공처가 정한 요청 허용량 준수 — `minIntervalMs` 로 선언하면 워커가 이를 지킨다
