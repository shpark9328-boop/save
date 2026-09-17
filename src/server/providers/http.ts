import { z } from 'zod';
import { getStationName } from '@/lib/stations';
import {
  ProviderError,
  type SearchParams,
  type Train,
  type TrainDataProvider,
} from './types';

/**
 * 좌석 정보를 제공하는 "외부 어댑터" provider.
 *
 * 이 서비스는 코레일 웹/앱을 직접 스크래핑하지 않는다(이용약관·자동화 제한 준수).
 * 대신, 좌석 데이터를 적법하게 취득할 수 있는 주체(예: 제휴 API 보유자,
 * 본인 계정 범위 안에서 허용된 접근 수단을 가진 운영자)가
 * 아래 계약(contract)을 만족하는 HTTP 엔드포인트를 제공하면 그대로 연동된다.
 *
 * 요청:  POST {SEAT_PROVIDER_URL}
 *        Authorization: Bearer {SEAT_PROVIDER_TOKEN}
 *        { departureStationCode, arrivalStationCode, travelDate,
 *          departAfter?, departBefore?, passengerCount?, trainTypes? }
 *
 * 응답:  { "trains": [ {
 *            "trainNo": "101",
 *            "trainType": "KTX",
 *            "trainName": "KTX 101",
 *            "departureAt": "2026-09-20T10:00:00+09:00",
 *            "arrivalAt": "2026-09-20T12:42:00+09:00",
 *            "seats": [ { "seatClass": "GENERAL", "status": "SOLD_OUT", "remainingSeats": 0 } ],
 *            "reservationUrl": "https://..."
 *         } ] }
 */

const seatSchema = z.object({
  seatClass: z.enum(['GENERAL', 'FIRST']),
  status: z.enum(['AVAILABLE', 'SOLD_OUT', 'WAITLIST', 'UNKNOWN']),
  remainingSeats: z.number().int().min(0).nullable().default(null),
});

const trainSchema = z.object({
  trainNo: z.string().min(1),
  trainType: z.enum(['KTX', 'KTX_SANCHEON', 'KTX_EUM', 'KTX_CHEONGRYONG', 'ITX_SAEMAEUL']),
  trainName: z.string().optional(),
  departureStationCode: z.string().optional(),
  departureStationName: z.string().optional(),
  arrivalStationCode: z.string().optional(),
  arrivalStationName: z.string().optional(),
  departureAt: z.string(),
  arrivalAt: z.string(),
  seats: z.array(seatSchema).min(1),
  reservationUrl: z.string().url().optional(),
});

const responseSchema = z.object({ trains: z.array(trainSchema) });

export interface HttpProviderOptions {
  url: string;
  token?: string;
  timeoutMs?: number;
  /** 제공처가 선언하는 최소 호출 간격 */
  minIntervalMs?: number;
  capabilities?: Partial<TrainDataProvider['capabilities']>;
  fetchImpl?: typeof fetch;
}

export class HttpSeatProvider implements TrainDataProvider {
  readonly name = 'http';
  readonly capabilities: TrainDataProvider['capabilities'];
  readonly minIntervalMs: number;

  private readonly url: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpProviderOptions) {
    this.url = options.url;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.minIntervalMs = options.minIntervalMs ?? 2_000;
    this.capabilities = {
      seatAvailability: true,
      remainingSeatCount: true,
      seatClassBreakdown: true,
      reservationDeepLink: true,
      ...options.capabilities,
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchTrains(params: SearchParams): Promise<Train[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    params.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          departureStationCode: params.departureStationCode,
          arrivalStationCode: params.arrivalStationCode,
          travelDate: params.travelDate,
          departAfter: params.departAfter,
          departBefore: params.departBefore,
          passengerCount: params.passengerCount,
          trainTypes: params.trainTypes,
        }),
      });

      if (!response.ok) {
        throw new ProviderError(`좌석 제공처 응답 오류: HTTP ${response.status}`, {
          provider: this.name,
          statusCode: response.status,
          retryable: response.status >= 500 || response.status === 429,
        });
      }

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ProviderError('좌석 제공처 응답 형식이 계약과 다릅니다.', {
          provider: this.name,
          retryable: false,
          cause: parsed.error,
        });
      }

      return parsed.data.trains.map((train) => {
        const departureAt = new Date(train.departureAt);
        const arrivalAt = new Date(train.arrivalAt);
        if (Number.isNaN(departureAt.getTime()) || Number.isNaN(arrivalAt.getTime())) {
          throw new ProviderError(`시각 파싱 실패: 열차 ${train.trainNo}`, {
            provider: this.name,
            retryable: false,
          });
        }
        const departureStationCode = train.departureStationCode ?? params.departureStationCode;
        const arrivalStationCode = train.arrivalStationCode ?? params.arrivalStationCode;
        return {
          trainNo: train.trainNo,
          trainType: train.trainType,
          trainName: train.trainName ?? `${train.trainType} ${train.trainNo}`,
          departureStationCode,
          departureStationName:
            train.departureStationName ?? getStationName(departureStationCode),
          arrivalStationCode,
          arrivalStationName: train.arrivalStationName ?? getStationName(arrivalStationCode),
          departureAt,
          arrivalAt,
          seats: train.seats,
          ...(train.reservationUrl ? { reservationUrl: train.reservationUrl } : {}),
        } satisfies Train;
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('좌석 제공처 호출 실패', {
        provider: this.name,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: Boolean(this.url), detail: `endpoint=${this.url}` };
  }
}
