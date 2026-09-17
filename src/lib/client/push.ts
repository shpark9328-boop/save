'use client';

import { api } from './api';

/** 브라우저 웹 푸시 등록 흐름 */

export type PushSetupResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'not-configured' | 'error'; message: string };

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * 서비스 워커 등록 → 알림 권한 요청 → 푸시 구독 → 서버 저장.
 * 사용자가 "알림 등록" 버튼을 눌렀을 때(사용자 제스처 안에서) 호출해야 한다.
 */
export async function setupPush(publicKey: string | null): Promise<PushSetupResult> {
  if (!isPushSupported()) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '이 브라우저는 웹 푸시를 지원하지 않습니다. (iOS 는 홈 화면에 추가 후 사용 가능)',
    };
  }
  if (!publicKey) {
    return {
      ok: false,
      reason: 'not-configured',
      message: '서버에 VAPID 키가 설정되지 않아 푸시를 사용할 수 없습니다.',
    };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'denied', message: '알림 권한이 거부되었습니다.' };
    }

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      return { ok: false, reason: 'error', message: '푸시 구독 정보를 만들 수 없습니다.' };
    }

    await api.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 200),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      message: error instanceof Error ? error.message : '푸시 등록 중 오류가 발생했습니다.',
    };
  }
}

/** 테스트 알림 (권한 확인용, 서버를 거치지 않는 로컬 알림) */
export async function showLocalTestNotification(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('🚄 알림이 정상 동작합니다', {
    body: '좌석이 발생하면 이런 알림을 받게 됩니다.',
    tag: 'ktx-alert-test',
    icon: '/icon.svg',
  });
}
