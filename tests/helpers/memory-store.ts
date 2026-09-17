import type {
  AlertRecord,
  CheckRunInput,
  CheckerStore,
  GroupTask,
  HeartbeatInput,
  NotificationLogInput,
  Notifier,
  NotifyOutcome,
  SeatEventInput,
  SeatFoundEvent,
  SeatStateUpdate,
  SnapshotInput,
} from '@/server/monitor/store';
import { snapshotKey } from '@/server/monitor/store';
import type { SeatState } from '@/server/monitor/transition';
import type { SeatStatus } from '@/server/providers/types';

/** 테스트용 인메모리 CheckerStore. DB 없이 엔진 전체를 검증한다. */
export class InMemoryCheckerStore implements CheckerStore {
  readonly groups = new Map<string, GroupTask & { nextCheckAt: Date; active: boolean }>();
  readonly alerts = new Map<string, AlertRecord & { enabled: boolean; expiresAt: Date }>();
  readonly seatStates = new Map<string, Map<string, SeatState>>();
  readonly snapshots = new Map<string, Map<string, { status: SeatStatus; remainingSeats: number | null }>>();
  readonly seatEvents: (SeatEventInput & { groupId: string })[] = [];
  readonly checkRuns: CheckRunInput[] = [];
  readonly notificationLogs: NotificationLogInput[] = [];
  readonly heartbeats: HeartbeatInput[] = [];

  addGroup(group: GroupTask): void {
    this.groups.set(group.id, { ...group, nextCheckAt: new Date(0), active: true });
  }

  addAlert(alert: AlertRecord, options: { expiresAt?: Date } = {}): void {
    this.alerts.set(alert.id, {
      ...alert,
      enabled: true,
      expiresAt: options.expiresAt ?? new Date('2999-12-31T00:00:00Z'),
    });
  }

  async expireAlerts(now: Date): Promise<number> {
    let count = 0;
    for (const alert of this.alerts.values()) {
      if (alert.enabled && alert.expiresAt.getTime() <= now.getTime()) {
        alert.enabled = false;
        count += 1;
      }
    }
    return count;
  }

  async claimDueGroups(params: { now: Date; limit: number; provider: string }): Promise<GroupTask[]> {
    const due: GroupTask[] = [];
    for (const group of this.groups.values()) {
      if (!group.active) continue;
      if (group.provider !== params.provider) continue;
      if (group.nextCheckAt.getTime() > params.now.getTime()) continue;
      due.push({
        id: group.id,
        provider: group.provider,
        departureStationCode: group.departureStationCode,
        arrivalStationCode: group.arrivalStationCode,
        travelDate: group.travelDate,
        consecutiveFailures: group.consecutiveFailures,
      });
      if (due.length >= params.limit) break;
    }
    return due;
  }

  async finishGroup(params: {
    groupId: string;
    nextCheckAt: Date;
    success: boolean;
  }): Promise<void> {
    const group = this.groups.get(params.groupId);
    if (!group) return;
    group.nextCheckAt = params.nextCheckAt;
    group.consecutiveFailures = params.success ? 0 : group.consecutiveFailures + 1;
  }

  async listActiveAlerts(groupId: string, now: Date): Promise<AlertRecord[]> {
    return [...this.alerts.values()]
      .filter(
        (alert) => alert.groupId === groupId && alert.enabled && alert.expiresAt.getTime() > now.getTime(),
      )
      .map(({ enabled: _enabled, expiresAt: _expiresAt, ...alert }) => alert);
  }

  async getGroupSnapshots(
    groupId: string,
  ): Promise<Map<string, { status: SeatStatus; remainingSeats: number | null }>> {
    return new Map(this.snapshots.get(groupId) ?? []);
  }

  async saveSnapshots(groupId: string, snapshots: SnapshotInput[]): Promise<void> {
    const map = this.snapshots.get(groupId) ?? new Map();
    for (const snapshot of snapshots) {
      map.set(snapshotKey(snapshot.trainNo, snapshot.seatClass), {
        status: snapshot.status,
        remainingSeats: snapshot.remainingSeats,
      });
    }
    this.snapshots.set(groupId, map);
  }

  async saveSeatEvents(groupId: string, events: SeatEventInput[]): Promise<void> {
    this.seatEvents.push(...events.map((event) => ({ ...event, groupId })));
  }

  async getSeatStates(alertId: string): Promise<Map<string, SeatState>> {
    return new Map(this.seatStates.get(alertId) ?? []);
  }

  async saveSeatStates(updates: SeatStateUpdate[]): Promise<void> {
    for (const update of updates) {
      const map = this.seatStates.get(update.alertId) ?? new Map<string, SeatState>();
      map.set(snapshotKey(update.trainNo, update.seatClass), { ...update.state });
      this.seatStates.set(update.alertId, map);
    }
  }

  async recordCheckRun(input: CheckRunInput): Promise<void> {
    this.checkRuns.push(input);
  }

  async recordNotifications(logs: NotificationLogInput[]): Promise<void> {
    this.notificationLogs.push(...logs);
  }

  async bumpAlertNotification(alertId: string, count: number): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (alert) alert.notificationCount += count;
  }

  async heartbeat(input: HeartbeatInput): Promise<void> {
    this.heartbeats.push(input);
  }
}

/** 발송 내역만 기록하는 테스트용 Notifier */
export class RecordingNotifier implements Notifier {
  readonly events: SeatFoundEvent[] = [];

  async notify(event: SeatFoundEvent): Promise<NotifyOutcome[]> {
    this.events.push(event);
    return [
      {
        channel: 'WEB_PUSH',
        status: 'SENT',
        title: '🚄 KTX 좌석이 생겼습니다!',
        body: `${event.train.trainName} ${event.seatClass}`,
      },
    ];
  }
}

export const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() {
    return this;
  },
};
