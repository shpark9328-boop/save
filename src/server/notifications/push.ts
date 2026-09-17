import webpush, { WebPushError } from 'web-push';
import { getEnv } from '@/server/env';
import { logger } from '@/server/logger';
import type { SeatAlertMessage } from './message';

/** Web Push 발송기. VAPID 키가 없으면 비활성 상태로 동작한다. */

let configured = false;

export function isPushConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

function configure(): void {
  if (configured) return;
  const env = getEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID 키가 설정되지 않았습니다. `npm run push:keys` 로 생성하세요.');
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendResult =
  | { ok: true }
  | { ok: false; error: string; /** 구독이 만료/해지되어 삭제해야 하는 경우 */ gone: boolean };

export async function sendPush(
  target: PushTarget,
  message: SeatAlertMessage,
): Promise<PushSendResult> {
  configure();
  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
    data: message.data,
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      payload,
      { TTL: 60 * 30, urgency: 'high' },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof WebPushError) {
      const gone = error.statusCode === 404 || error.statusCode === 410;
      logger.warn('푸시 발송 실패', {
        endpoint: target.endpoint.slice(0, 40),
        statusCode: error.statusCode,
        gone,
      });
      return { ok: false, error: `HTTP ${error.statusCode}: ${error.body ?? ''}`.trim(), gone };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      gone: false,
    };
  }
}
