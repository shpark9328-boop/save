'use client';

const STORAGE_KEY = 'ktx-alert.watch-token';

/**
 * 계정/비밀번호 없이 "내 알림"을 식별하기 위한 브라우저 토큰.
 * - 서버에는 SHA-256 해시만 저장된다.
 * - 이 토큰을 잃어버리면 해당 브라우저의 알림 목록에 접근할 수 없다(설계상 의도).
 */
export function getWatchToken(): string {
  if (typeof window === 'undefined') {
    throw new Error('watch token 은 브라우저에서만 사용할 수 있습니다.');
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing && /^[A-Za-z0-9_-]{32,128}$/.test(existing)) return existing;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  window.localStorage.setItem(STORAGE_KEY, token);
  return token;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
