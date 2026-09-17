import type { SeatClass, SeatStatus, Train, TrainType } from '@/server/providers/types';
import type { SeatState } from './transition';

/**
 * 모니터링 엔진이 필요로 하는 저장소 포트(port).
 * 엔진은 Prisma 를 직접 알지 못하며, 테스트에서는 인메모리 구현으로 교체한다.
 */

export interface GroupTask {
  id: string;
  provider: string;
  departureStationCode: string;
  arrivalStationCode: string;
  /** "YYYY-MM-DD" (KST) */
  travelDate: string;
  consecutiveFailures: number;
}

export interface AlertRecord {
  id: string;
  userId: string;
  groupId: string;
  departureStationName: string;
  arrivalStationName: string;
  travelDate: string;
  startTime: string;
  endTime: string;
  passengerCount: number;
  trainTypes: TrainType[];
  seatClasses: SeatClass[];
  channels: ('WEB_PUSH' | 'EMAIL')[];
  maxNotifications: number;
  notificationCount: number;
}

export interface SeatStateKey {
  alertId: string;
  trainNo: string;
  seatClass: SeatClass;
}

export interface SeatStateUpdate extends SeatStateKey {
  state: SeatState;
  notified: boolean;
  at: Date;
}

export interface SnapshotInput {
  trainNo: string;
  trainType: TrainType;
  trainName: string;
  departureAt: Date;
  arrivalAt: Date;
  seatClass: SeatClass;
  status: SeatStatus;
  remainingSeats: number | null;
  reservationUrl?: string;
}

export interface SeatEventInput {
  trainNo: string;
  seatClass: SeatClass;
  fromStatus: SeatStatus;
  toStatus: SeatStatus;
  remainingSeats: number | null;
  occurredAt: Date;
}

export interface CheckRunInput {
  groupId: string;
  provider: string;
  status: 'OK' | 'ERROR';
  trainsFound: number;
  durationMs: number;
  errorMessage?: string;
  startedAt: Date;
  finishedAt: Date;
}

export interface NotificationLogInput {
  alertId: string;
  trainNo: string;
  seatClass: SeatClass;
  channel: 'WEB_PUSH' | 'EMAIL';
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  title: string;
  body: string;
  error?: string;
  sentAt: Date;
}

export interface HeartbeatInput {
  workerId: string;
  provider: string;
  cyclesCompleted: number;
  groupsChecked: number;
  lastError?: string;
}

export interface CheckerStore {
  /** 만료된 알림 비활성화 + 활성 알림이 없는 그룹 비활성화. 반환: 정리된 알림 수 */
  expireAlerts(now: Date): Promise<number>;
  /** 조회 대상 그룹을 원자적으로 잠그고 가져온다(워커 다중 실행 대비). */
  claimDueGroups(params: {
    now: Date;
    limit: number;
    workerId: string;
    lockMs: number;
    provider: string;
  }): Promise<GroupTask[]>;
  /** 그룹의 잠금을 풀고 다음 조회 시각을 설정한다. */
  finishGroup(params: {
    groupId: string;
    nextCheckAt: Date;
    success: boolean;
    error?: string;
    checkedAt: Date;
  }): Promise<void>;
  listActiveAlerts(groupId: string, now: Date): Promise<AlertRecord[]>;
  /** 이전 스냅샷(상태 전이 기록용). key: `${trainNo}:${seatClass}` */
  getGroupSnapshots(groupId: string): Promise<Map<string, { status: SeatStatus; remainingSeats: number | null }>>;
  saveSnapshots(groupId: string, snapshots: SnapshotInput[], checkedAt: Date): Promise<void>;
  saveSeatEvents(groupId: string, events: SeatEventInput[]): Promise<void>;
  /** key: `${trainNo}:${seatClass}` */
  getSeatStates(alertId: string): Promise<Map<string, SeatState>>;
  saveSeatStates(updates: SeatStateUpdate[]): Promise<void>;
  recordCheckRun(input: CheckRunInput): Promise<void>;
  recordNotifications(logs: NotificationLogInput[]): Promise<void>;
  bumpAlertNotification(alertId: string, count: number, at: Date): Promise<void>;
  heartbeat(input: HeartbeatInput): Promise<void>;
}

/** 알림 발송기 포트 */
export interface SeatFoundEvent {
  alert: AlertRecord;
  train: Train;
  seatClass: SeatClass;
  remainingSeats: number | null;
  reservationUrl?: string;
}

export interface NotifyOutcome {
  channel: 'WEB_PUSH' | 'EMAIL';
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  title: string;
  body: string;
  error?: string;
}

export interface Notifier {
  notify(event: SeatFoundEvent): Promise<NotifyOutcome[]>;
}

export function snapshotKey(trainNo: string, seatClass: SeatClass): string {
  return `${trainNo}:${seatClass}`;
}
