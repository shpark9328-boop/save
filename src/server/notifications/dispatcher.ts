import type { PrismaClient } from '@prisma/client';
import { getEnv } from '@/server/env';
import { logger } from '@/server/logger';
import type { Notifier, NotifyOutcome, SeatFoundEvent } from '@/server/monitor/store';
import { buildSeatAlertMessage } from './message';
import { isEmailConfigured, sendEmail } from './email';
import { isPushConfigured, sendPush } from './push';

/**
 * 실제 알림 발송기.
 *  - 웹 푸시: 사용자의 모든 활성 구독으로 발송. 만료된 구독(404/410)은 자동 정리.
 *  - 이메일: 사용자가 이메일을 등록하고 SMTP 가 설정된 경우에만.
 *  - DRY_RUN_NOTIFICATIONS=true 이면 실제 발송 없이 SKIPPED 로 기록한다(로컬 테스트용).
 */
export class NotificationDispatcher implements Notifier {
  constructor(private readonly prisma: PrismaClient) {}

  async notify(event: SeatFoundEvent): Promise<NotifyOutcome[]> {
    const env = getEnv();
    const message = buildSeatAlertMessage({
      alertId: event.alert.id,
      departureStationName: event.alert.departureStationName,
      arrivalStationName: event.alert.arrivalStationName,
      train: event.train,
      seatClass: event.seatClass,
      remainingSeats: event.remainingSeats,
      url: event.reservationUrl ?? env.RESERVATION_FALLBACK_URL,
    });

    const outcomes: NotifyOutcome[] = [];
    const base = { title: message.title, body: message.body };

    if (env.DRY_RUN_NOTIFICATIONS) {
      logger.info('[DRY RUN] 알림 발송 생략', { alertId: event.alert.id, title: message.title });
      return event.alert.channels.map((channel) => ({
        channel,
        status: 'SKIPPED' as const,
        ...base,
        error: 'DRY_RUN_NOTIFICATIONS=true',
      }));
    }

    if (event.alert.channels.includes('WEB_PUSH')) {
      outcomes.push(...(await this.sendWebPush(event, message, base)));
    }

    if (event.alert.channels.includes('EMAIL')) {
      outcomes.push(await this.sendEmailNotification(event, message, base));
    }

    return outcomes;
  }

  private async sendWebPush(
    event: SeatFoundEvent,
    message: ReturnType<typeof buildSeatAlertMessage>,
    base: { title: string; body: string },
  ): Promise<NotifyOutcome[]> {
    if (!isPushConfigured()) {
      return [{ channel: 'WEB_PUSH', status: 'SKIPPED', ...base, error: 'VAPID 키 미설정' }];
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: event.alert.userId, disabledAt: null },
    });
    if (subscriptions.length === 0) {
      return [{ channel: 'WEB_PUSH', status: 'SKIPPED', ...base, error: '등록된 푸시 구독 없음' }];
    }

    const outcomes: NotifyOutcome[] = [];
    for (const subscription of subscriptions) {
      const result = await sendPush(
        {
          id: subscription.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        message,
      );

      if (result.ok) {
        await this.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { lastUsedAt: new Date(), failureCount: 0 },
        });
        outcomes.push({ channel: 'WEB_PUSH', status: 'SENT', ...base });
        continue;
      }

      // 만료된 구독은 즉시 비활성화, 그 외에는 실패 누적 후 5회에서 비활성화.
      await this.prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: result.gone
          ? { disabledAt: new Date() }
          : {
              failureCount: { increment: 1 },
              ...(subscription.failureCount + 1 >= 5 ? { disabledAt: new Date() } : {}),
            },
      });
      outcomes.push({ channel: 'WEB_PUSH', status: 'FAILED', ...base, error: result.error });
    }
    return outcomes;
  }

  private async sendEmailNotification(
    event: SeatFoundEvent,
    message: ReturnType<typeof buildSeatAlertMessage>,
    base: { title: string; body: string },
  ): Promise<NotifyOutcome> {
    if (!isEmailConfigured()) {
      return { channel: 'EMAIL', status: 'SKIPPED', ...base, error: 'SMTP 미설정' };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: event.alert.userId },
      select: { email: true },
    });
    if (!user?.email) {
      return { channel: 'EMAIL', status: 'SKIPPED', ...base, error: '등록된 이메일 없음' };
    }
    const result = await sendEmail(user.email, message);
    return result.ok
      ? { channel: 'EMAIL', status: 'SENT', ...base }
      : { channel: 'EMAIL', status: 'FAILED', ...base, error: result.error };
  }
}
