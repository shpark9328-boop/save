import type { SeatClass, SeatStatus, TrainType } from '@/server/providers/types';

/** 클라이언트/서버가 공유하는 API 응답 타입 */

export interface AlertDto {
  id: string;
  departureStationCode: string;
  departureStationName: string;
  arrivalStationCode: string;
  arrivalStationName: string;
  travelDate: string;
  startTime: string;
  endTime: string;
  passengerCount: number;
  trainTypes: TrainType[];
  seatClasses: SeatClass[];
  channels: ('WEB_PUSH' | 'EMAIL')[];
  enabled: boolean;
  memo: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  notificationCount: number;
  lastNotifiedAt: string | null;
  /** 이 알림이 속한 조회 그룹의 최근 조회 시각 */
  lastCheckedAt: string | null;
  /** 최근 조회에서 조건을 충족 중인 열차 수 */
  availableNow: number;
}

export interface AlertListResponse {
  alerts: AlertDto[];
  /** 서버가 사용하는 provider 이름과 능력치 */
  provider: ProviderInfo;
}

export interface ProviderInfo {
  name: string;
  seatAvailability: boolean;
  remainingSeatCount: boolean;
  /** 사용자에게 보여줄 경고 문구 (좌석 정보를 제공하지 않는 provider 등) */
  notice: string | null;
}

export interface StationDto {
  code: string;
  name: string;
}

export interface AdminStats {
  alerts: { total: number; enabled: number; expired: number };
  groups: { total: number; active: number; locked: number };
  users: { total: number; withPush: number; withEmail: number };
  notifications: { last24h: number; failed24h: number };
  worker: WorkerStatusDto[];
  recentChecks: RecentCheckDto[];
  recentNotifications: RecentNotificationDto[];
  recentErrors: RecentErrorDto[];
  recentEvents: RecentEventDto[];
  provider: ProviderInfo;
}

export interface WorkerStatusDto {
  id: string;
  provider: string;
  startedAt: string;
  lastBeatAt: string;
  cyclesCompleted: number;
  groupsChecked: number;
  lastError: string | null;
  lastErrorAt: string | null;
  /** 마지막 하트비트가 2분 이상 지났으면 false */
  alive: boolean;
}

export interface RecentCheckDto {
  id: string;
  route: string;
  travelDate: string | null;
  provider: string;
  status: 'OK' | 'ERROR';
  trainsFound: number;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
}

export interface RecentNotificationDto {
  id: string;
  trainNo: string;
  seatClass: SeatClass;
  channel: 'WEB_PUSH' | 'EMAIL';
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  title: string;
  body: string;
  error: string | null;
  sentAt: string;
}

export interface RecentErrorDto {
  id: string;
  provider: string;
  route: string;
  errorMessage: string;
  startedAt: string;
}

export interface RecentEventDto {
  id: string;
  route: string;
  trainNo: string;
  seatClass: SeatClass;
  fromStatus: SeatStatus;
  toStatus: SeatStatus;
  occurredAt: string;
}
