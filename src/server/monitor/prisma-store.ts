import type { PrismaClient } from '@prisma/client';
import { travelDateToUtc, utcToTravelDate } from '@/lib/time';
import type { SeatClass, SeatStatus, TrainType } from '@/server/providers/types';
import {
  snapshotKey,
  type AlertRecord,
  type CheckRunInput,
  type CheckerStore,
  type GroupTask,
  type HeartbeatInput,
  type NotificationLogInput,
  type SeatEventInput,
  type SeatStateUpdate,
  type SnapshotInput,
} from './store';
import type { SeatState } from './transition';

/**
 * CheckerStore 의 PostgreSQL(Prisma) 구현.
 *
 * 동시성 주의점
 *  - claimDueGroups 는 updateMany 의 조건부 갱신을 이용한 낙관적 잠금이다.
 *    같은 그룹을 두 워커가 동시에 집으려 하면 한쪽의 count 가 0 이 되어 탈락한다.
 *  - 한 그룹은 한 워커만 처리하므로, 그 그룹에 속한 알림의 상태 갱신은 직렬화된다.
 */
export class PrismaCheckerStore implements CheckerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async expireAlerts(now: Date): Promise<number> {
    const { count } = await this.prisma.alert.updateMany({
      where: { enabled: true, expiresAt: { lte: now } },
      data: { enabled: false },
    });

    // 활성 알림이 하나도 없는 그룹은 조회 대상에서 제외한다.
    const idleGroups = await this.prisma.watchGroup.findMany({
      where: { active: true, alerts: { none: { enabled: true } } },
      select: { id: true },
      take: 500,
    });
    if (idleGroups.length > 0) {
      await this.prisma.watchGroup.updateMany({
        where: { id: { in: idleGroups.map((g) => g.id) } },
        data: { active: false, lockedUntil: null, lockedBy: null },
      });
    }
    return count;
  }

  async claimDueGroups(params: {
    now: Date;
    limit: number;
    workerId: string;
    lockMs: number;
    provider: string;
  }): Promise<GroupTask[]> {
    const candidates = await this.prisma.watchGroup.findMany({
      where: {
        active: true,
        provider: params.provider,
        nextCheckAt: { lte: params.now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: params.now } }],
      },
      orderBy: { nextCheckAt: 'asc' },
      take: params.limit,
    });

    const lockedUntil = new Date(params.now.getTime() + params.lockMs);
    const claimed: GroupTask[] = [];

    for (const candidate of candidates) {
      // 조건부 UPDATE: 다른 워커가 먼저 집었다면 count === 0 이 되어 건너뛴다.
      const { count } = await this.prisma.watchGroup.updateMany({
        where: {
          id: candidate.id,
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: params.now } }],
        },
        data: { lockedUntil, lockedBy: params.workerId },
      });
      if (count !== 1) continue;

      claimed.push({
        id: candidate.id,
        provider: candidate.provider,
        departureStationCode: candidate.departureStationCode,
        arrivalStationCode: candidate.arrivalStationCode,
        travelDate: utcToTravelDate(candidate.travelDate),
        consecutiveFailures: candidate.consecutiveFailures,
      });
    }
    return claimed;
  }

  async finishGroup(params: {
    groupId: string;
    nextCheckAt: Date;
    success: boolean;
    error?: string;
    checkedAt: Date;
  }): Promise<void> {
    await this.prisma.watchGroup.update({
      where: { id: params.groupId },
      data: {
        lockedUntil: null,
        lockedBy: null,
        lastCheckedAt: params.checkedAt,
        nextCheckAt: params.nextCheckAt,
        consecutiveFailures: params.success ? 0 : { increment: 1 },
        lastError: params.success ? null : (params.error ?? '알 수 없는 오류'),
      },
    });
  }

  async listActiveAlerts(groupId: string, now: Date): Promise<AlertRecord[]> {
    const alerts = await this.prisma.alert.findMany({
      where: { groupId, enabled: true, expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
    });

    return alerts.map((alert) => ({
      id: alert.id,
      userId: alert.userId,
      groupId: alert.groupId,
      departureStationName: alert.departureStationName,
      arrivalStationName: alert.arrivalStationName,
      travelDate: utcToTravelDate(alert.travelDate),
      startTime: alert.startTime,
      endTime: alert.endTime,
      passengerCount: alert.passengerCount,
      trainTypes: alert.trainTypes as TrainType[],
      seatClasses: alert.seatClasses as SeatClass[],
      channels: alert.channels as ('WEB_PUSH' | 'EMAIL')[],
      maxNotifications: alert.maxNotifications,
      notificationCount: alert.notificationCount,
    }));
  }

  async getGroupSnapshots(
    groupId: string,
  ): Promise<Map<string, { status: SeatStatus; remainingSeats: number | null }>> {
    const rows = await this.prisma.trainSnapshot.findMany({
      where: { groupId },
      select: { trainNo: true, seatClass: true, status: true, remainingSeats: true },
    });
    return new Map(
      rows.map((row) => [
        snapshotKey(row.trainNo, row.seatClass as SeatClass),
        { status: row.status as SeatStatus, remainingSeats: row.remainingSeats },
      ]),
    );
  }

  async saveSnapshots(
    groupId: string,
    snapshots: SnapshotInput[],
    checkedAt: Date,
  ): Promise<void> {
    if (snapshots.length === 0) return;
    // upsert 는 개별 쿼리가 되므로 청크 단위 트랜잭션으로 묶는다.
    for (const chunk of chunked(snapshots, 50)) {
      await this.prisma.$transaction(
        chunk.map((snapshot) =>
          this.prisma.trainSnapshot.upsert({
            where: {
              groupId_trainNo_seatClass: {
                groupId,
                trainNo: snapshot.trainNo,
                seatClass: snapshot.seatClass,
              },
            },
            create: {
              groupId,
              trainNo: snapshot.trainNo,
              trainType: snapshot.trainType,
              trainName: snapshot.trainName,
              departureAt: snapshot.departureAt,
              arrivalAt: snapshot.arrivalAt,
              seatClass: snapshot.seatClass,
              status: snapshot.status,
              remainingSeats: snapshot.remainingSeats,
              reservationUrl: snapshot.reservationUrl ?? null,
              checkedAt,
            },
            update: {
              trainType: snapshot.trainType,
              trainName: snapshot.trainName,
              departureAt: snapshot.departureAt,
              arrivalAt: snapshot.arrivalAt,
              status: snapshot.status,
              remainingSeats: snapshot.remainingSeats,
              reservationUrl: snapshot.reservationUrl ?? null,
              checkedAt,
            },
          }),
        ),
      );
    }
  }

  async saveSeatEvents(groupId: string, events: SeatEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await this.prisma.seatEvent.createMany({
      data: events.map((event) => ({
        groupId,
        trainNo: event.trainNo,
        seatClass: event.seatClass,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        remainingSeats: event.remainingSeats,
        occurredAt: event.occurredAt,
      })),
    });
  }

  async getSeatStates(alertId: string): Promise<Map<string, SeatState>> {
    const rows = await this.prisma.alertSeatState.findMany({ where: { alertId } });
    return new Map(
      rows.map((row) => [
        snapshotKey(row.trainNo, row.seatClass as SeatClass),
        {
          satisfied: row.satisfied,
          lastStatus: row.lastStatus as SeatStatus,
          remainingSeats: row.remainingSeats,
          notifyCount: row.notifyCount,
        },
      ]),
    );
  }

  async saveSeatStates(updates: SeatStateUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    for (const chunk of chunked(updates, 50)) {
      await this.prisma.$transaction(
        chunk.map((update) =>
          this.prisma.alertSeatState.upsert({
            where: {
              alertId_trainNo_seatClass: {
                alertId: update.alertId,
                trainNo: update.trainNo,
                seatClass: update.seatClass,
              },
            },
            create: {
              alertId: update.alertId,
              trainNo: update.trainNo,
              seatClass: update.seatClass,
              satisfied: update.state.satisfied,
              lastStatus: update.state.lastStatus,
              remainingSeats: update.state.remainingSeats,
              notifyCount: update.state.notifyCount,
              lastChangedAt: update.at,
              lastNotifiedAt: update.notified ? update.at : null,
            },
            update: {
              satisfied: update.state.satisfied,
              lastStatus: update.state.lastStatus,
              remainingSeats: update.state.remainingSeats,
              notifyCount: update.state.notifyCount,
              lastChangedAt: update.at,
              ...(update.notified ? { lastNotifiedAt: update.at } : {}),
            },
          }),
        ),
      );
    }
  }

  async recordCheckRun(input: CheckRunInput): Promise<void> {
    await this.prisma.checkRun.create({
      data: {
        groupId: input.groupId,
        provider: input.provider,
        status: input.status,
        trainsFound: input.trainsFound,
        durationMs: input.durationMs,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
    });
  }

  async recordNotifications(logs: NotificationLogInput[]): Promise<void> {
    if (logs.length === 0) return;
    await this.prisma.notificationLog.createMany({
      data: logs.map((log) => ({
        alertId: log.alertId,
        trainNo: log.trainNo,
        seatClass: log.seatClass,
        channel: log.channel,
        status: log.status,
        title: log.title,
        body: log.body,
        error: log.error ?? null,
        sentAt: log.sentAt,
      })),
    });
  }

  async bumpAlertNotification(alertId: string, count: number, at: Date): Promise<void> {
    await this.prisma.alert.update({
      where: { id: alertId },
      data: { notificationCount: { increment: count }, lastNotifiedAt: at },
    });
  }

  async heartbeat(input: HeartbeatInput): Promise<void> {
    const now = new Date();
    await this.prisma.workerHeartbeat.upsert({
      where: { id: input.workerId },
      create: {
        id: input.workerId,
        provider: input.provider,
        startedAt: now,
        lastBeatAt: now,
        cyclesCompleted: input.cyclesCompleted,
        groupsChecked: input.groupsChecked,
        lastError: input.lastError ?? null,
        lastErrorAt: input.lastError ? now : null,
      },
      update: {
        provider: input.provider,
        lastBeatAt: now,
        cyclesCompleted: input.cyclesCompleted,
        groupsChecked: input.groupsChecked,
        ...(input.lastError ? { lastError: input.lastError, lastErrorAt: now } : {}),
      },
    });
  }
}

function* chunked<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/** 알림 등록 시 그룹을 찾거나 만든다(경쟁 조건 고려). */
export async function ensureWatchGroup(
  prisma: PrismaClient,
  params: {
    provider: string;
    departureStationCode: string;
    arrivalStationCode: string;
    travelDate: string;
  },
): Promise<string> {
  const travelDate = travelDateToUtc(params.travelDate);
  const key = {
    provider: params.provider,
    departureStationCode: params.departureStationCode,
    arrivalStationCode: params.arrivalStationCode,
    travelDate,
  };

  // upsert 는 유니크 제약 위반 시에도 안전하게 동작한다.
  const group = await prisma.watchGroup.upsert({
    where: {
      provider_departureStationCode_arrivalStationCode_travelDate: key,
    },
    create: { ...key, active: true, nextCheckAt: new Date() },
    // 비활성화되어 있던 그룹이라면 다시 활성화한다.
    update: { active: true, nextCheckAt: new Date(), consecutiveFailures: 0, lastError: null },
    select: { id: true },
  });
  return group.id;
}
