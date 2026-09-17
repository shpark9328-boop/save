'use client';

import type { AlertDto, AlertListResponse, StationDto } from '@/types/api';
import { getWatchToken } from './token';

/** 브라우저에서 사용하는 API 클라이언트 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-watch-token': getWatchToken(),
      ...init.headers,
    },
  });

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const body = payload as { error?: string; details?: Record<string, string> };
    throw new ApiError(body.error ?? '요청에 실패했습니다.', response.status, body.details);
  }
  return payload as T;
}

export interface ConfigResponse {
  provider: { name: string; seatAvailability: boolean; remainingSeatCount: boolean; notice: string | null };
  pushPublicKey: string | null;
  pushEnabled: boolean;
  emailEnabled: boolean;
  maxDaysAhead: number;
  maxAlertsPerUser: number;
}

export const api = {
  getConfig: () => request<ConfigResponse>('/api/config'),
  getStations: () => request<{ stations: StationDto[] }>('/api/stations'),
  listAlerts: () => request<AlertListResponse>('/api/alerts'),
  createAlert: (input: unknown) =>
    request<{ alert: AlertDto }>('/api/alerts', { method: 'POST', body: JSON.stringify(input) }),
  setAlertEnabled: (id: string, enabled: boolean) =>
    request<{ alert: AlertDto }>(`/api/alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  deleteAlert: (id: string) => request<{ ok: true }>(`/api/alerts/${id}`, { method: 'DELETE' }),
  subscribePush: (subscription: PushSubscriptionJSON & { userAgent?: string }) =>
    request<{ ok: true }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
};
