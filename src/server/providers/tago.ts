import { getStationName } from '@/lib/stations';
import { kstDateTimeToUtc } from '@/lib/time';
import { loadStationMap, type ProviderStationMap } from './station-map';
import {
  ProviderError,
  UnsupportedRouteError,
  type SearchParams,
  type Train,
  type TrainDataProvider,
  type TrainType,
} from './types';

/**
 * 공공데이터포털(국토교통부 TAGO) 열차정보 서비스 provider.
 *
 * ⚠️ 매우 중요한 한계
 *  이 API 는 "열차 운행 시간표 / 열차 등급 / 운임" 을 제공하며,
 *  실시간 잔여 좌석(매진 여부)은 제공하지 않는다.
 *  따라서 이 provider 만으로는 "좌석이 풀렸다" 를 감지할 수 없고,
 *  모든 좌석 상태는 UNKNOWN 으로 반환된다. (알림 엔진은 UNKNOWN 을 알림 대상에서 제외한다.)
 *
 *  그럼에도 이 provider 를 포함하는 이유:
 *   - 실제 열차번호/출발·도착시각을 합법적으로 가져올 수 있고,
 *   - 좌석 정보를 제공하는 경로가 확보되면 seats 채우는 부분만 바꾸면 되기 때문이다.
 *
 * 사용 전 확인 사항
 *  - 공공데이터포털에서 "열차정보" 활용 신청 후 serviceKey 를 발급받아야 한다.
 *  - depPlaceId/arrPlaceId 는 해당 서비스의 역 코드(NAT 코드)이며
 *    PROVIDER_STATION_MAP_PATH 파일로 주입한다.
 *  - 응답 필드명/엔드포인트는 포털의 최신 문서로 반드시 검증할 것.
 *    (본 구현은 문서 기준 필드명을 사용하되, 값이 없으면 안전하게 건너뛴다.)
 */

export interface TagoProviderOptions {
  serviceKey: string;
  baseUrl?: string;
  stationMapPath?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** TAGO 열차 등급명 -> 서비스 내부 종별 */
function mapTrainType(gradeName: string | undefined): TrainType | undefined {
  if (!gradeName) return undefined;
  const name = gradeName.replace(/\s/g, '');
  if (name.includes('KTX-산천') || name.includes('KTX산천')) return 'KTX_SANCHEON';
  if (name.includes('KTX-이음') || name.includes('KTX이음')) return 'KTX_EUM';
  if (name.includes('KTX-청룡') || name.includes('KTX청룡')) return 'KTX_CHEONGRYONG';
  if (name.includes('KTX')) return 'KTX';
  if (name.includes('ITX-새마을') || name.includes('ITX새마을')) return 'ITX_SAEMAEUL';
  return undefined;
}

/** TAGO 시각 표기 "yyyyMMddHHmm" 파싱 (KST 기준) */
function parseTagoDateTime(value: unknown): Date | undefined {
  const text = String(value ?? '');
  if (!/^\d{12}$/.test(text)) return undefined;
  const date = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const time = `${text.slice(8, 10)}:${text.slice(10, 12)}`;
  return kstDateTimeToUtc(date, time);
}

interface TagoItem {
  trainno?: string | number;
  traingradename?: string;
  depplandtime?: string | number;
  arrplandtime?: string | number;
  depplacename?: string;
  arrplacename?: string;
}

export class TagoTrainProvider implements TrainDataProvider {
  readonly name = 'tago';
  readonly capabilities = {
    seatAvailability: false,
    remainingSeatCount: false,
    seatClassBreakdown: false,
    reservationDeepLink: false,
  } as const;
  readonly minIntervalMs = 1_000;

  private readonly serviceKey: string;
  private readonly baseUrl: string;
  private readonly stationMap: ProviderStationMap;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TagoProviderOptions) {
    if (!options.serviceKey) {
      throw new Error('TAGO_SERVICE_KEY 가 필요합니다.');
    }
    this.serviceKey = options.serviceKey;
    this.baseUrl = (options.baseUrl ?? 'https://apis.data.go.kr/1613000/TrainInfoService').replace(
      /\/$/,
      '',
    );
    this.stationMap = loadStationMap(options.stationMapPath);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchTrains(params: SearchParams): Promise<Train[]> {
    const depPlaceId = this.stationMap[params.departureStationCode];
    const arrPlaceId = this.stationMap[params.arrivalStationCode];
    if (!depPlaceId || !arrPlaceId) {
      throw new UnsupportedRouteError(
        this.name,
        `역 코드 매핑이 없습니다: ${params.departureStationCode} / ${params.arrivalStationCode}. PROVIDER_STATION_MAP_PATH 파일을 확인하세요.`,
      );
    }

    const url = new URL(`${this.baseUrl}/getStrtpntAlocFndTrainInfo`);
    url.searchParams.set('serviceKey', this.serviceKey);
    url.searchParams.set('_type', 'json');
    url.searchParams.set('numOfRows', '200');
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('depPlaceId', depPlaceId);
    url.searchParams.set('arrPlaceId', arrPlaceId);
    url.searchParams.set('depPlandTime', params.travelDate.replace(/-/g, ''));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    params.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let payload: unknown;
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new ProviderError(`TAGO 응답 오류: HTTP ${response.status}`, {
          provider: this.name,
          statusCode: response.status,
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('TAGO 호출 실패', {
        provider: this.name,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    return this.parse(payload, params);
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const mapped = Object.keys(this.stationMap).length;
    return {
      ok: mapped > 0,
      detail:
        mapped > 0
          ? `역 코드 ${mapped}건 매핑됨. 단, 이 provider 는 좌석 정보를 제공하지 않습니다.`
          : '역 코드 매핑 파일이 비어 있습니다.',
    };
  }

  private parse(payload: unknown, params: SearchParams): Train[] {
    const items = extractItems(payload);
    const allowed = new Set(params.trainTypes ?? []);
    const trains: Train[] = [];

    for (const item of items) {
      const trainType = mapTrainType(item.traingradename);
      if (!trainType) continue;
      if (allowed.size > 0 && !allowed.has(trainType)) continue;

      const departureAt = parseTagoDateTime(item.depplandtime);
      const arrivalAt = parseTagoDateTime(item.arrplandtime);
      const trainNo = item.trainno === undefined ? undefined : String(item.trainno);
      if (!departureAt || !arrivalAt || !trainNo) continue;

      trains.push({
        trainNo,
        trainType,
        trainName: `${item.traingradename ?? trainType} ${trainNo}`,
        departureStationCode: params.departureStationCode,
        departureStationName:
          item.depplacename ?? getStationName(params.departureStationCode),
        arrivalStationCode: params.arrivalStationCode,
        arrivalStationName: item.arrplacename ?? getStationName(params.arrivalStationCode),
        departureAt,
        arrivalAt,
        // 좌석 정보를 제공하지 않으므로 UNKNOWN 으로 명시한다.
        seats: [
          { seatClass: 'GENERAL', status: 'UNKNOWN', remainingSeats: null },
          { seatClass: 'FIRST', status: 'UNKNOWN', remainingSeats: null },
        ],
      });
    }
    return trains;
  }
}

/** 공공데이터포털 공통 응답 구조에서 items 배열을 안전하게 꺼낸다. */
function extractItems(payload: unknown): TagoItem[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const response = (payload as Record<string, unknown>).response;
  if (typeof response !== 'object' || response === null) return [];
  const body = (response as Record<string, unknown>).body;
  if (typeof body !== 'object' || body === null) return [];
  const items = (body as Record<string, unknown>).items;
  if (typeof items !== 'object' || items === null) return [];
  const item = (items as Record<string, unknown>).item;
  if (Array.isArray(item)) return item as TagoItem[];
  if (typeof item === 'object' && item !== null) return [item as TagoItem];
  return [];
}
