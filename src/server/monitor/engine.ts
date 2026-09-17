import { toKstTimeString, utcToTravelDate } from '@/lib/time';
import type { Logger } from '@/server/logger';
import {
  ProviderError,
  UnsupportedRouteError,
  type SeatStatus,
  type Train,
  type TrainDataProvider,
} from '@/server/providers/types';
import { evaluateTrains, type AlertCriteria } from './matcher';
import type { RateLimiter } from './rate-limiter';
import {
  snapshotKey,
  type AlertRecord,
  type CheckerStore,
  type GroupTask,
  type NotificationLogInput,
  type Notifier,
  type SeatEventInput,
  type SeatStateUpdate,
  type SnapshotInput,
} from './store';
import { evaluateTransition } from './transition';

/**
 * 좌석 모니터링 엔진.
 *
 * 특징
 *  - 저장소/provider/알림 발송기를 주입받는다 → DB 없이 테스트 가능.
 *  - 조회는 "그룹(노선+날짜)" 단위로 1회만 수행하고, 그 결과를 해당 그룹의
 *    모든 알림이 공유한다. (제공처 요청 수를 사용자 수와 무관하게 유지)
 *  - 그룹은 워커가 원자적으로 잠근 뒤 처리한다 → 다중 워커에서도 중복 조회 없음.
 */

export interface EngineConfig {
  /** 그룹 재조회 최소 간격(초) */
  groupIntervalSeconds: number;
  /** 한 사이클에 처리할 최대 그룹 수 */
  maxGroupsPerTick: number;
  /** 실패 시 백오프 기준(초). 지수적으로 증가한다. */
  failureBackoffBaseSeconds: number;
  /** 그룹 잠금 유지 시간(ms) */
  lockMs: number;
  workerId: string;
}

export interface EngineDeps {
  store: CheckerStore;
  provider: TrainDataProvider;
  notifier: Notifier;
  logger: Logger;
  rateLimiter: RateLimiter;
  config: EngineConfig;
  now?: () => Date;
}

export interface CycleSummary {
  groupsClaimed: number;
  groupsSucceeded: number;
  groupsFailed: number;
  trainsSeen: number;
  notificationsSent: number;
  expiredAlerts: number;
  errors: string[];
}

export async function runCheckCycle(deps: EngineDeps): Promise<CycleSummary> {
  const now = deps.now ?? (() => new Date());
  const summary: CycleSummary = {
    groupsClaimed: 0,
    groupsSucceeded: 0,
    groupsFailed: 0,
    trainsSeen: 0,
    notificationsSent: 0,
    expiredAlerts: 0,
    errors: [],
  };

  summary.expiredAlerts = await deps.store.expireAlerts(now());

  const groups = await deps.store.claimDueGroups({
    now: now(),
    limit: deps.config.maxGroupsPerTick,
    workerId: deps.config.workerId,
    lockMs: deps.config.lockMs,
    provider: deps.provider.name,
  });
  summary.groupsClaimed = groups.length;

  for (const group of groups) {
    try {
      const result = await processGroup(group, deps, now);
      summary.groupsSucceeded += 1;
      summary.trainsSeen += result.trainsFound;
      summary.notificationsSent += result.notificationsSent;
    } catch (error) {
      summary.groupsFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${group.id}: ${message}`);
      deps.logger.error('그룹 처리 실패', error, { groupId: group.id });
    }
  }

  return summary;
}

interface GroupResult {
  trainsFound: number;
  notificationsSent: number;
}

async function processGroup(
  group: GroupTask,
  deps: EngineDeps,
  now: () => Date,
): Promise<GroupResult> {
  const log = deps.logger.child({ groupId: group.id, route: `${group.departureStationCode}-${group.arrivalStationCode}`, travelDate: group.travelDate });
  const startedAt = now();

  await deps.rateLimiter.acquire();

  let trains: Train[];
  try {
    trains = await deps.provider.searchTrains({
      departureStationCode: group.departureStationCode,
      arrivalStationCode: group.arrivalStationCode,
      travelDate: group.travelDate,
    });
  } catch (error) {
    const finishedAt = now();
    const retryable = error instanceof ProviderError ? error.options.retryable !== false : true;
    const message = error instanceof Error ? error.message : String(error);

    await deps.store.recordCheckRun({
      groupId: group.id,
      provider: deps.provider.name,
      status: 'ERROR',
      trainsFound: 0,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage: message,
      startedAt,
      finishedAt,
    });

    // 재시도 불가능한 오류(잘못된 노선 등)는 길게 쉰다.
    const backoffSeconds = retryable
      ? Math.min(
          deps.config.failureBackoffBaseSeconds * 2 ** Math.min(group.consecutiveFailures, 5),
          3600,
        )
      : 6 * 3600;

    await deps.store.finishGroup({
      groupId: group.id,
      nextCheckAt: new Date(finishedAt.getTime() + backoffSeconds * 1000),
      success: false,
      error: message,
      checkedAt: finishedAt,
    });

    if (error instanceof UnsupportedRouteError) {
      log.warn('지원하지 않는 구간 — 장시간 백오프', { message });
      return { trainsFound: 0, notificationsSent: 0 };
    }
    throw error;
  }

  const checkedAt = now();
  const alerts = await deps.store.listActiveAlerts(group.id, checkedAt);

  // ── 1. 그룹 단위 스냅샷/이벤트 기록 ──────────────────────────────
  const previousSnapshots = await deps.store.getGroupSnapshots(group.id);
  const snapshots: SnapshotInput[] = [];
  const seatEvents: SeatEventInput[] = [];

  for (const train of trains) {
    for (const seat of train.seats) {
      snapshots.push({
        trainNo: train.trainNo,
        trainType: train.trainType,
        trainName: train.trainName,
        departureAt: train.departureAt,
        arrivalAt: train.arrivalAt,
        seatClass: seat.seatClass,
        status: seat.status,
        remainingSeats: seat.remainingSeats,
        ...(train.reservationUrl ? { reservationUrl: train.reservationUrl } : {}),
      });

      const previous = previousSnapshots.get(snapshotKey(train.trainNo, seat.seatClass));
      const fromStatus: SeatStatus = previous?.status ?? 'UNKNOWN';
      if (previous && fromStatus !== seat.status) {
        seatEvents.push({
          trainNo: train.trainNo,
          seatClass: seat.seatClass,
          fromStatus,
          toStatus: seat.status,
          remainingSeats: seat.remainingSeats,
          occurredAt: checkedAt,
        });
      }
    }
  }

  await deps.store.saveSnapshots(group.id, snapshots, checkedAt);
  if (seatEvents.length > 0) {
    await deps.store.saveSeatEvents(group.id, seatEvents);
  }

  // ── 2. 알림별 상태 전이 판정 및 발송 ─────────────────────────────
  let notificationsSent = 0;
  for (const alert of alerts) {
    notificationsSent += await processAlert(alert, trains, deps, checkedAt);
  }

  const finishedAt = now();
  await deps.store.recordCheckRun({
    groupId: group.id,
    provider: deps.provider.name,
    status: 'OK',
    trainsFound: trains.length,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    startedAt,
    finishedAt,
  });
  await deps.store.finishGroup({
    groupId: group.id,
    nextCheckAt: new Date(finishedAt.getTime() + deps.config.groupIntervalSeconds * 1000),
    success: true,
    checkedAt: finishedAt,
  });

  log.debug('그룹 조회 완료', {
    trains: trains.length,
    alerts: alerts.length,
    notificationsSent,
    events: seatEvents.length,
  });

  return { trainsFound: trains.length, notificationsSent };
}

async function processAlert(
  alert: AlertRecord,
  trains: readonly Train[],
  deps: EngineDeps,
  checkedAt: Date,
): Promise<number> {
  const criteria: AlertCriteria = {
    startTime: alert.startTime,
    endTime: alert.endTime,
    passengerCount: alert.passengerCount,
    trainTypes: alert.trainTypes,
    seatClasses: alert.seatClasses,
  };

  const matches = evaluateTrains(trains, criteria);
  if (matches.length === 0) return 0;

  const states = await deps.store.getSeatStates(alert.id);
  const updates: SeatStateUpdate[] = [];
  const logs: NotificationLogInput[] = [];
  let notified = 0;
  let notificationCount = alert.notificationCount;

  for (const match of matches) {
    const key = snapshotKey(match.train.trainNo, match.seat.seatClass);
    const transition = evaluateTransition({
      previous: states.get(key) ?? null,
      satisfied: match.satisfied,
      status: match.seat.status,
      remainingSeats: match.seat.remainingSeats,
      notificationCount,
      maxNotifications: alert.maxNotifications,
    });

    updates.push({
      alertId: alert.id,
      trainNo: match.train.trainNo,
      seatClass: match.seat.seatClass,
      state: transition.next,
      notified: transition.shouldNotify,
      at: checkedAt,
    });

    if (!transition.shouldNotify) continue;

    notificationCount += 1;
    const outcomes = await deps.notifier.notify({
      alert,
      train: match.train,
      seatClass: match.seat.seatClass,
      remainingSeats: match.seat.remainingSeats,
      ...(match.train.reservationUrl ? { reservationUrl: match.train.reservationUrl } : {}),
    });

    for (const outcome of outcomes) {
      logs.push({
        alertId: alert.id,
        trainNo: match.train.trainNo,
        seatClass: match.seat.seatClass,
        channel: outcome.channel,
        status: outcome.status,
        title: outcome.title,
        body: outcome.body,
        ...(outcome.error ? { error: outcome.error } : {}),
        sentAt: checkedAt,
      });
    }
    if (outcomes.some((o) => o.status === 'SENT')) notified += 1;

    deps.logger.info('좌석 발생 알림', {
      alertId: alert.id,
      trainNo: match.train.trainNo,
      seatClass: match.seat.seatClass,
      departure: toKstTimeString(match.train.departureAt),
      remainingSeats: match.seat.remainingSeats,
    });
  }

  await deps.store.saveSeatStates(updates);
  if (logs.length > 0) await deps.store.recordNotifications(logs);
  if (notificationCount > alert.notificationCount) {
    await deps.store.bumpAlertNotification(
      alert.id,
      notificationCount - alert.notificationCount,
      checkedAt,
    );
  }

  return notified;
}

/** DB Date -> 엔진이 쓰는 "YYYY-MM-DD" */
export function toTravelDateString(date: Date): string {
  return utcToTravelDate(date);
}
