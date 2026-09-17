import type { Prisma, PrismaClient } from '@prisma/client';
import { getStationName } from '@/lib/stations';
import { defaultExpiryFor, travelDateToUtc, utcToTravelDate } from '@/lib/time';
import type { CreateAlertInput } from '@/lib/validation';
import { getEnv } from '@/server/env';
import { HttpError, hashWatchToken } from '@/server/http';
import { logger } from '@/server/logger';
import { ensureWatchGroup } from '@/server/monitor/prisma-store';
import { getProvider } from '@/server/providers';
import type { SeatClass, TrainType } from '@/server/providers/types';
import type { AlertDto, ProviderInfo } from '@/types/api';

/** 알림 등록/조회/수정/삭제 비즈니스 로직 (UI 와 완전히 분리) */

export async function getOrCreateUser(
  prisma: PrismaClient,
  watchToken: string,
  email?: string,
): Promise<{ id: string }> {
  const watchTokenHash = hashWatchToken(watchToken);
  const user = await prisma.user.upsert({
    where: { watchTokenHash },
    create: { watchTokenHash, email: email ?? null },
    update: email ? { email } : {},
    select: { id: true },
  });
  return user;
}

export async function requireUser(
  prisma: PrismaClient,
  watchToken: string,
): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({
    where: { watchTokenHash: hashWatchToken(watchToken) },
    select: { id: true },
  });
  if (!user) throw new HttpError(404, '등록된 알림이 없습니다.');
  return user;
}

export async function createAlert(
  prisma: PrismaClient,
  watchToken: string,
  input: CreateAlertInput,
): Promise<AlertDto> {
  const env = getEnv();
  const provider = getProvider();

  // 이메일은 이메일 알림을 선택한 경우에만 저장한다(개인정보 최소 수집).
  const email = input.channels.includes('EMAIL') ? input.email : undefined;
  const user = await getOrCreateUser(prisma, watchToken, email);

  const activeCount = await prisma.alert.count({ where: { userId: user.id, enabled: true } });
  if (activeCount >= env.ALERT_MAX_PER_TOKEN) {
    throw new HttpError(
      429,
      `등록 가능한 알림 개수를 초과했습니다. (최대 ${env.ALERT_MAX_PER_TOKEN}개)`,
    );
  }

  const groupId = await ensureWatchGroup(prisma, {
    provider: provider.name,
    departureStationCode: input.departureStationCode,
    arrivalStationCode: input.arrivalStationCode,
    travelDate: input.travelDate,
  });

  const alert = await prisma.alert.create({
    data: {
      userId: user.id,
      groupId,
      departureStationCode: input.departureStationCode,
      departureStationName: getStationName(input.departureStationCode),
      arrivalStationCode: input.arrivalStationCode,
      arrivalStationName: getStationName(input.arrivalStationCode),
      travelDate: travelDateToUtc(input.travelDate),
      startTime: input.startTime,
      endTime: input.endTime,
      passengerCount: input.passengerCount,
      trainTypes: input.trainTypes,
      seatClasses: input.seatClasses,
      channels: input.channels,
      memo: input.memo ?? null,
      expiresAt: defaultExpiryFor(input.travelDate),
    },
    include: { group: true },
  });

  logger.info('알림 등록', {
    alertId: alert.id,
    route: `${input.departureStationCode}->${input.arrivalStationCode}`,
    travelDate: input.travelDate,
    groupId,
  });

  return toAlertDto(alert, 0);
}

type AlertWithGroup = Prisma.AlertGetPayload<{ include: { group: true } }>;

export async function listAlerts(
  prisma: PrismaClient,
  watchToken: string,
): Promise<AlertDto[]> {
  const user = await prisma.user.findUnique({
    where: { watchTokenHash: hashWatchToken(watchToken) },
    select: { id: true },
  });
  if (!user) return [];

  const alerts = await prisma.alert.findMany({
    where: { userId: user.id },
    include: { group: true },
    orderBy: [{ enabled: 'desc' }, { travelDate: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  });

  // 현재 조건을 충족 중인 좌석 수 (AlertSeatState.satisfied)
  const satisfiedCounts = await prisma.alertSeatState.groupBy({
    by: ['alertId'],
    where: { alertId: { in: alerts.map((a) => a.id) }, satisfied: true },
    _count: { _all: true },
  });
  const countByAlert = new Map(satisfiedCounts.map((row) => [row.alertId, row._count._all]));

  return alerts.map((alert) => toAlertDto(alert, countByAlert.get(alert.id) ?? 0));
}

export async function setAlertEnabled(
  prisma: PrismaClient,
  watchToken: string,
  alertId: string,
  enabled: boolean,
): Promise<AlertDto> {
  const user = await requireUser(prisma, watchToken);
  const existing = await prisma.alert.findFirst({
    where: { id: alertId, userId: user.id },
    select: { id: true, expiresAt: true },
  });
  if (!existing) throw new HttpError(404, '알림을 찾을 수 없습니다.');
  if (enabled && existing.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, '이미 만료된 알림은 다시 켤 수 없습니다.');
  }

  const alert = await prisma.alert.update({
    where: { id: alertId },
    data: {
      enabled,
      // 다시 켤 때는 상태를 초기화해 "현재 좌석 있음"도 새 이벤트로 감지되게 한다.
      ...(enabled ? { states: { deleteMany: {} } } : {}),
    },
    include: { group: true },
  });

  if (enabled) {
    await prisma.watchGroup.update({
      where: { id: alert.groupId },
      data: { active: true, nextCheckAt: new Date() },
    });
  }

  return toAlertDto(alert, 0);
}

export async function deleteAlert(
  prisma: PrismaClient,
  watchToken: string,
  alertId: string,
): Promise<void> {
  const user = await requireUser(prisma, watchToken);
  const { count } = await prisma.alert.deleteMany({ where: { id: alertId, userId: user.id } });
  if (count === 0) throw new HttpError(404, '알림을 찾을 수 없습니다.');
  logger.info('알림 삭제', { alertId });
}

export function toAlertDto(alert: AlertWithGroup, availableNow: number): AlertDto {
  return {
    id: alert.id,
    departureStationCode: alert.departureStationCode,
    departureStationName: alert.departureStationName,
    arrivalStationCode: alert.arrivalStationCode,
    arrivalStationName: alert.arrivalStationName,
    travelDate: utcToTravelDate(alert.travelDate),
    startTime: alert.startTime,
    endTime: alert.endTime,
    passengerCount: alert.passengerCount,
    trainTypes: alert.trainTypes as TrainType[],
    seatClasses: alert.seatClasses as SeatClass[],
    channels: alert.channels as ('WEB_PUSH' | 'EMAIL')[],
    enabled: alert.enabled,
    memo: alert.memo,
    createdAt: alert.createdAt.toISOString(),
    expiresAt: alert.expiresAt.toISOString(),
    expired: alert.expiresAt.getTime() <= Date.now(),
    notificationCount: alert.notificationCount,
    lastNotifiedAt: alert.lastNotifiedAt?.toISOString() ?? null,
    lastCheckedAt: alert.group.lastCheckedAt?.toISOString() ?? null,
    availableNow,
  };
}

export function describeProvider(): ProviderInfo {
  const provider = getProvider();
  let notice: string | null = null;
  if (provider.name === 'mock') {
    notice =
      '현재 모의(mock) 데이터로 동작 중입니다. 실제 코레일 좌석 정보가 아니며, 데모/개발용입니다.';
  } else if (!provider.capabilities.seatAvailability) {
    notice =
      '연결된 데이터 제공처가 실시간 좌석 정보를 제공하지 않습니다. 시간표만 조회되며 좌석 알림은 발송되지 않습니다.';
  }
  return {
    name: provider.name,
    seatAvailability: provider.capabilities.seatAvailability,
    remainingSeatCount: provider.capabilities.remainingSeatCount,
    notice,
  };
}
