import { findRoute, getStationName, isKnownStation } from '@/lib/stations';
import { kstDateTimeToUtc, minutesToTime, timeToMinutes, toKstMinutes } from '@/lib/time';
import {
  ProviderError,
  UnsupportedRouteError,
  type SearchParams,
  type SeatAvailability,
  type SeatClass,
  type Train,
  type TrainDataProvider,
  type TrainType,
} from './types';

/**
 * 개발/테스트용 가상 열차 데이터 provider.
 *
 * 설계 원칙
 *  1. 시간표는 (노선, 날짜) 에 대해 결정적(deterministic)이다. 새로고침해도 같은 열차가 나온다.
 *  2. 좌석 상태는 "시간 버킷" 단위로만 바뀐다. 즉 flipIntervalMs 동안은 같은 답을 주고,
 *     버킷이 바뀌면 일부 열차의 좌석이 풀리거나 다시 매진된다.
 *     -> SOLD_OUT → AVAILABLE → SOLD_OUT 전이를 실제로 재현할 수 있다.
 *  3. 시계(now)를 주입할 수 있어 테스트에서 시간을 제어할 수 있다.
 */

export interface MockProviderOptions {
  /** 좌석이 풀릴 확률 (0~1). 기본 0.12 */
  availabilityRate?: number;
  /** 좌석 상태가 다시 추첨되는 주기(ms). 기본 60초 */
  flipIntervalMs?: number;
  /** 시드 문자열. 바꾸면 전혀 다른 시간표가 나온다. */
  seed?: string;
  now?: () => Date;
  /** 인위적 지연(ms) — 실제 네트워크 호출 흉내 */
  latencyMs?: number;
  /** 강제로 오류를 발생시킬 확률 (0~1). 워커 오류 처리 테스트용. */
  errorRate?: number;
}

/** 문자열 -> 32bit 해시 (FNV-1a). 결정적 난수의 시드로 사용. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 해시값을 0~1 실수로 */
function unitRandom(...parts: (string | number)[]): number {
  return hashString(parts.join('|')) / 0xffffffff;
}

const ALL_TRAIN_TYPES: readonly TrainType[] = [
  'KTX',
  'KTX_SANCHEON',
  'KTX_EUM',
  'KTX_CHEONGRYONG',
  'ITX_SAEMAEUL',
];

/** 노선별로 실제 운행하는 열차 종별을 흉내 낸다. */
const LINE_TRAIN_TYPES: Record<string, readonly TrainType[]> = {
  GYEONGBU: ['KTX', 'KTX_SANCHEON', 'KTX_CHEONGRYONG', 'ITX_SAEMAEUL'],
  HONAM: ['KTX', 'KTX_SANCHEON', 'KTX_CHEONGRYONG'],
  JEOLLA: ['KTX', 'KTX_SANCHEON'],
  GYEONGJEON: ['KTX', 'KTX_SANCHEON'],
  DONGHAE: ['KTX', 'KTX_SANCHEON'],
  GANGNEUNG: ['KTX_EUM', 'KTX_SANCHEON'],
  JUNGANG: ['KTX_EUM', 'ITX_SAEMAEUL'],
};

/** 종별 평균 표정속도(km/h) */
const AVERAGE_SPEED: Record<TrainType, number> = {
  KTX: 180,
  KTX_SANCHEON: 175,
  KTX_EUM: 130,
  KTX_CHEONGRYONG: 190,
  ITX_SAEMAEUL: 95,
};

/** 특실이 있는 종별 */
const HAS_FIRST_CLASS: Record<TrainType, boolean> = {
  KTX: true,
  KTX_SANCHEON: true,
  KTX_EUM: false,
  KTX_CHEONGRYONG: true,
  ITX_SAEMAEUL: false,
};

const FIRST_DEPARTURE_MINUTES = 5 * 60 + 10; // 05:10
const LAST_DEPARTURE_MINUTES = 22 * 60 + 50; // 22:50

export class MockTrainProvider implements TrainDataProvider {
  readonly name = 'mock';
  readonly capabilities = {
    seatAvailability: true,
    remainingSeatCount: true,
    seatClassBreakdown: true,
    reservationDeepLink: false,
  } as const;
  readonly minIntervalMs = 0;

  private readonly availabilityRate: number;
  private readonly flipIntervalMs: number;
  private readonly seed: string;
  private readonly now: () => Date;
  private readonly latencyMs: number;
  private readonly errorRate: number;

  constructor(options: MockProviderOptions = {}) {
    this.availabilityRate = options.availabilityRate ?? 0.12;
    this.flipIntervalMs = options.flipIntervalMs ?? 60_000;
    this.seed = options.seed ?? 'ktx-seat-alert';
    this.now = options.now ?? (() => new Date());
    this.latencyMs = options.latencyMs ?? 0;
    this.errorRate = options.errorRate ?? 0;
  }

  async searchTrains(params: SearchParams): Promise<Train[]> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (params.signal?.aborted) {
      throw new ProviderError('조회가 취소되었습니다.', { provider: this.name, retryable: true });
    }

    if (!isKnownStation(params.departureStationCode)) {
      throw new UnsupportedRouteError(this.name, `알 수 없는 출발역: ${params.departureStationCode}`);
    }
    if (!isKnownStation(params.arrivalStationCode)) {
      throw new UnsupportedRouteError(this.name, `알 수 없는 도착역: ${params.arrivalStationCode}`);
    }

    const route = findRoute(params.departureStationCode, params.arrivalStationCode);
    if (!route) {
      throw new UnsupportedRouteError(
        this.name,
        `직통 열차가 없는 구간입니다: ${getStationName(params.departureStationCode)} → ${getStationName(params.arrivalStationCode)}`,
      );
    }

    if (this.errorRate > 0) {
      const roll = unitRandom(this.seed, 'error', Math.floor(this.now().getTime() / this.flipIntervalMs));
      if (roll < this.errorRate) {
        throw new ProviderError('모의 조회 오류 (errorRate)', {
          provider: this.name,
          retryable: true,
          statusCode: 503,
        });
      }
    }

    const allowedTypes = new Set<TrainType>(
      params.trainTypes && params.trainTypes.length > 0 ? params.trainTypes : ALL_TRAIN_TYPES,
    );
    const lineTypes = LINE_TRAIN_TYPES[route.line] ?? ['KTX'];

    const afterMinutes = params.departAfter ? timeToMinutes(params.departAfter) : 0;
    const beforeMinutes = params.departBefore ? timeToMinutes(params.departBefore) : 24 * 60 - 1;

    const bucket = Math.floor(this.now().getTime() / this.flipIntervalMs);
    const trains: Train[] = [];

    // 하루 시간표를 25분 간격 슬롯으로 생성하고, 슬롯별로 운행 여부를 결정적으로 뽑는다.
    for (let minute = FIRST_DEPARTURE_MINUTES; minute <= LAST_DEPARTURE_MINUTES; minute += 25) {
      const slotKey = [this.seed, route.line, params.travelDate, minute].join(':');
      if (unitRandom(slotKey, 'exists') > 0.72) continue;

      const typeIndex = Math.floor(unitRandom(slotKey, 'type') * lineTypes.length);
      const trainType = lineTypes[Math.min(typeIndex, lineTypes.length - 1)] as TrainType;
      if (!allowedTypes.has(trainType)) continue;

      // 실제 출발 시각은 슬롯에서 ±7분 흔들어 준다.
      const jitter = Math.round(unitRandom(slotKey, 'jitter') * 14) - 7;
      const departMinute = minute + jitter;
      if (departMinute < afterMinutes || departMinute > beforeMinutes) continue;
      if (departMinute < 0 || departMinute >= 24 * 60) continue;

      const speed = AVERAGE_SPEED[trainType];
      const stopPenalty = Math.round(unitRandom(slotKey, 'stops') * 18);
      const durationMinutes = Math.max(
        18,
        Math.round((route.distanceKm / speed) * 60) + stopPenalty,
      );

      const departureAt = kstDateTimeToUtc(params.travelDate, minutesToTime(departMinute));
      const arrivalAt = new Date(departureAt.getTime() + durationMinutes * 60_000);
      const trainNo = this.trainNumberFor(route.line, route.downward, minute, trainType);

      const seats: SeatAvailability[] = [
        this.seatFor(trainNo, params.travelDate, 'GENERAL', bucket, departMinute),
      ];
      if (HAS_FIRST_CLASS[trainType]) {
        seats.push(this.seatFor(trainNo, params.travelDate, 'FIRST', bucket, departMinute));
      }

      trains.push({
        trainNo,
        trainType,
        trainName: `${trainTypeName(trainType)} ${trainNo}`,
        departureStationCode: params.departureStationCode,
        departureStationName: getStationName(params.departureStationCode),
        arrivalStationCode: params.arrivalStationCode,
        arrivalStationName: getStationName(params.arrivalStationCode),
        departureAt,
        arrivalAt,
        seats,
      });
    }

    // 이미 출발한 열차는 제외한다.
    const nowDate = this.now();
    return trains.filter((train) => train.departureAt.getTime() > nowDate.getTime());
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'mock provider 는 항상 사용 가능합니다.' };
  }

  private trainNumberFor(
    line: string,
    downward: boolean,
    minute: number,
    trainType: TrainType,
  ): string {
    const base: Record<string, number> = {
      GYEONGBU: 100,
      HONAM: 400,
      JEOLLA: 700,
      GYEONGJEON: 200,
      DONGHAE: 300,
      GANGNEUNG: 800,
      JUNGANG: 780,
    };
    const offset = Math.round((minute - FIRST_DEPARTURE_MINUTES) / 25) * 2;
    const typeBump = trainType === 'KTX_SANCHEON' ? 1 : 0;
    return String((base[line] ?? 100) + offset + typeBump + (downward ? 0 : 1));
  }

  /**
   * 좌석 상태 추첨.
   * - 인기 시간대(07~09, 17~20)는 매진 확률이 높다.
   * - bucket 이 바뀌면 다시 추첨된다 (= 취소표 발생/소멸 재현).
   */
  private seatFor(
    trainNo: string,
    travelDate: string,
    seatClass: SeatClass,
    bucket: number,
    departMinute: number,
  ): SeatAvailability {
    const hour = Math.floor(departMinute / 60);
    const peak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20);
    const classBonus = seatClass === 'FIRST' ? 1.6 : 1;
    const rate = Math.min(0.95, this.availabilityRate * (peak ? 0.45 : 1) * classBonus);

    const roll = unitRandom(this.seed, travelDate, trainNo, seatClass, bucket);
    if (roll >= rate) {
      // 매진. 일부는 예약대기 가능 상태로 표시.
      const waitlist = unitRandom(this.seed, travelDate, trainNo, seatClass, bucket, 'wl') < 0.25;
      return { seatClass, status: waitlist ? 'WAITLIST' : 'SOLD_OUT', remainingSeats: 0 };
    }

    // 취소표는 보통 1~4석 수준
    const remaining =
      1 + Math.floor(unitRandom(this.seed, travelDate, trainNo, seatClass, bucket, 'cnt') * 4);
    return { seatClass, status: 'AVAILABLE', remainingSeats: remaining };
  }
}

function trainTypeName(trainType: TrainType): string {
  switch (trainType) {
    case 'KTX_SANCHEON':
      return 'KTX-산천';
    case 'KTX_EUM':
      return 'KTX-이음';
    case 'KTX_CHEONGRYONG':
      return 'KTX-청룡';
    case 'ITX_SAEMAEUL':
      return 'ITX-새마을';
    default:
      return 'KTX';
  }
}
