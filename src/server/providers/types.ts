/**
 * 열차 데이터 provider 추상화.
 *
 * 애플리케이션(모니터링/알림 로직)은 이 인터페이스에만 의존한다.
 * 실제 데이터 소스를 교체할 때 이 파일 아래의 구현체만 갈아끼우면 된다.
 */

export type TrainType =
  | 'KTX'
  | 'KTX_SANCHEON'
  | 'KTX_EUM'
  | 'KTX_CHEONGRYONG'
  | 'ITX_SAEMAEUL';

export type SeatClass = 'GENERAL' | 'FIRST';

export type SeatStatus = 'AVAILABLE' | 'SOLD_OUT' | 'WAITLIST' | 'UNKNOWN';

export const TRAIN_TYPE_LABELS: Record<TrainType, string> = {
  KTX: 'KTX',
  KTX_SANCHEON: 'KTX-산천',
  KTX_EUM: 'KTX-이음',
  KTX_CHEONGRYONG: 'KTX-청룡',
  ITX_SAEMAEUL: 'ITX-새마을',
};

export const SEAT_CLASS_LABELS: Record<SeatClass, string> = {
  GENERAL: '일반실',
  FIRST: '특실',
};

export const SEAT_STATUS_LABELS: Record<SeatStatus, string> = {
  AVAILABLE: '예약 가능',
  SOLD_OUT: '매진',
  WAITLIST: '예약대기',
  UNKNOWN: '정보 없음',
};

export interface SearchParams {
  /** 서비스 내부 역 코드 */
  departureStationCode: string;
  arrivalStationCode: string;
  /** KST 기준 "YYYY-MM-DD" */
  travelDate: string;
  /** KST 기준 "HH:mm". 생략 시 하루 전체 */
  departAfter?: string;
  departBefore?: string;
  /** 필요한 좌석 수. provider 가 지원하면 조회 조건으로 전달한다. */
  passengerCount?: number;
  /** 필요한 열차 종별. 비우면 전체 */
  trainTypes?: readonly TrainType[];
  /** 호출 취소용 */
  signal?: AbortSignal;
}

export interface SeatAvailability {
  seatClass: SeatClass;
  status: SeatStatus;
  /**
   * 잔여 좌석 수. 제공처가 좌석 수를 주지 않으면 null.
   * null 이면 "status === AVAILABLE" 만으로 판단하고 승객 수 조건은 통과시킨다.
   */
  remainingSeats: number | null;
}

export interface Train {
  /** 열차 번호 (예: "101") */
  trainNo: string;
  trainType: TrainType;
  /** 표기용 이름 (예: "KTX 101") */
  trainName: string;
  departureStationCode: string;
  departureStationName: string;
  arrivalStationCode: string;
  arrivalStationName: string;
  /** 절대 시각(UTC Date). 표기는 KST 로 변환한다. */
  departureAt: Date;
  arrivalAt: Date;
  seats: SeatAvailability[];
  /** 예매 페이지 딥링크(가능한 경우) */
  reservationUrl?: string;
}

export interface ProviderCapabilities {
  /** 실시간 좌석 가용 여부를 제공하는가 */
  seatAvailability: boolean;
  /** 잔여 좌석 "수"까지 제공하는가 */
  remainingSeatCount: boolean;
  /** 특실/일반실 구분을 제공하는가 */
  seatClassBreakdown: boolean;
  /** 예매 딥링크를 제공하는가 */
  reservationDeepLink: boolean;
}

export interface TrainDataProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /**
   * 조회 최소 간격(ms). 워커는 이 값 이상으로 간격을 벌려 호출한다.
   * 제공처에 과도한 부하를 주지 않기 위한 provider 자기 선언값.
   */
  readonly minIntervalMs: number;
  searchTrains(params: SearchParams): Promise<Train[]>;
  /** 선택: 기동 시 설정 검증 */
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}

/** provider 단계에서 발생한 오류를 애플리케이션 오류와 구분한다. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      provider: string;
      /** 재시도로 해결될 수 있는 오류인지 */
      retryable?: boolean;
      cause?: unknown;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** 지원하지 않는 노선/조건 */
export class UnsupportedRouteError extends ProviderError {
  constructor(provider: string, message: string) {
    super(message, { provider, retryable: false });
    this.name = 'UnsupportedRouteError';
  }
}
