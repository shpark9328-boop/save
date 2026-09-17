import type { PrismaClient } from '@prisma/client';
import { utcToTravelDate } from '@/lib/time';
import { describeProvider } from '@/server/alerts/service';
import type {
  AdminStats,
  RecentCheckDto,
  RecentErrorDto,
  RecentEventDto,
  RecentNotificationDto,
  WorkerStatusDto,
} from '@/types/api';
import type { SeatClass, SeatStatus } from '@/server/providers/types';

const WORKER_ALIVE_WINDOW_MS = 2 * 60 * 1000;

/** 관리자 대시보드용 집계 */
export async function collectAdminStats(prisma: PrismaClient): Promise<AdminStats> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    alertsTotal,
    alertsEnabled,
    alertsExpired,
    groupsTotal,
    groupsActive,
    groupsLocked,
    usersTotal,
    usersWithPush,
    usersWithEmail,
    notifications24h,
    notificationsFailed24h,
    workers,
    recentChecks,
    recentNotifications,
    recentErrors,
    recentEvents,
  ] = await Promise.all([
    prisma.alert.count(),
    prisma.alert.count({ where: { enabled: true } }),
    prisma.alert.count({ where: { expiresAt: { lte: now } } }),
    prisma.watchGroup.count(),
    prisma.watchGroup.count({ where: { active: true } }),
    prisma.watchGroup.count({ where: { lockedUntil: { gt: now } } }),
    prisma.user.count(),
    prisma.user.count({ where: { pushSubscriptions: { some: { disabledAt: null } } } }),
    prisma.user.count({ where: { email: { not: null } } }),
    prisma.notificationLog.count({ where: { sentAt: { gte: since24h } } }),
    prisma.notificationLog.count({ where: { sentAt: { gte: since24h }, status: 'FAILED' } }),
    prisma.workerHeartbeat.findMany({ orderBy: { lastBeatAt: 'desc' }, take: 10 }),
    prisma.checkRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { group: true },
    }),
    prisma.notificationLog.findMany({ orderBy: { sentAt: 'desc' }, take: 20 }),
    prisma.checkRun.findMany({
      where: { status: 'ERROR' },
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { group: true },
    }),
    prisma.seatEvent.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 20,
      include: { group: true },
    }),
  ]);

  const routeOf = (
    group: { departureStationCode: string; arrivalStationCode: string } | null,
  ): string => (group ? `${group.departureStationCode} → ${group.arrivalStationCode}` : '(삭제됨)');

  return {
    alerts: { total: alertsTotal, enabled: alertsEnabled, expired: alertsExpired },
    groups: { total: groupsTotal, active: groupsActive, locked: groupsLocked },
    users: { total: usersTotal, withPush: usersWithPush, withEmail: usersWithEmail },
    notifications: { last24h: notifications24h, failed24h: notificationsFailed24h },
    worker: workers.map(
      (worker): WorkerStatusDto => ({
        id: worker.id,
        provider: worker.provider,
        startedAt: worker.startedAt.toISOString(),
        lastBeatAt: worker.lastBeatAt.toISOString(),
        cyclesCompleted: worker.cyclesCompleted,
        groupsChecked: worker.groupsChecked,
        lastError: worker.lastError,
        lastErrorAt: worker.lastErrorAt?.toISOString() ?? null,
        alive: now.getTime() - worker.lastBeatAt.getTime() < WORKER_ALIVE_WINDOW_MS,
      }),
    ),
    recentChecks: recentChecks.map(
      (run): RecentCheckDto => ({
        id: run.id,
        route: routeOf(run.group),
        travelDate: run.group ? utcToTravelDate(run.group.travelDate) : null,
        provider: run.provider,
        status: run.status,
        trainsFound: run.trainsFound,
        durationMs: run.durationMs,
        errorMessage: run.errorMessage,
        startedAt: run.startedAt.toISOString(),
      }),
    ),
    recentNotifications: recentNotifications.map(
      (log): RecentNotificationDto => ({
        id: log.id,
        trainNo: log.trainNo,
        seatClass: log.seatClass as SeatClass,
        channel: log.channel,
        status: log.status,
        title: log.title,
        body: log.body,
        error: log.error,
        sentAt: log.sentAt.toISOString(),
      }),
    ),
    recentErrors: recentErrors.map(
      (run): RecentErrorDto => ({
        id: run.id,
        provider: run.provider,
        route: routeOf(run.group),
        errorMessage: run.errorMessage ?? '(메시지 없음)',
        startedAt: run.startedAt.toISOString(),
      }),
    ),
    recentEvents: recentEvents.map(
      (event): RecentEventDto => ({
        id: event.id,
        route: routeOf(event.group),
        trainNo: event.trainNo,
        seatClass: event.seatClass as SeatClass,
        fromStatus: event.fromStatus as SeatStatus,
        toStatus: event.toStatus as SeatStatus,
        occurredAt: event.occurredAt.toISOString(),
      }),
    ),
    provider: describeProvider(),
  };
}
