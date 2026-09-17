import { NextResponse } from 'next/server';
import { createAlertSchema } from '@/lib/validation';
import { createAlert, describeProvider, listAlerts } from '@/server/alerts/service';
import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import {
  assertSameOrigin,
  clientKey,
  rateLimit,
  requireWatchToken,
  withErrorHandling,
} from '@/server/http';
import type { AlertListResponse } from '@/types/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 내 알림 목록 */
export const GET = withErrorHandling(async (request: Request) => {
  const token = requireWatchToken(request);
  rateLimit(clientKey(request, 'alerts:get'), 120, 60_000);
  const alerts = await listAlerts(prisma, token);
  const body: AlertListResponse = { alerts, provider: describeProvider() };
  return NextResponse.json(body);
});

/** 알림 등록 */
export const POST = withErrorHandling(async (request: Request) => {
  assertSameOrigin(request);
  const token = requireWatchToken(request);
  rateLimit(clientKey(request, 'alerts:post'), 20, 60_000);

  const env = getEnv();
  const payload: unknown = await request.json();
  const input = createAlertSchema({ maxDaysAhead: env.ALERT_MAX_DAYS_AHEAD }).parse(payload);
  const alert = await createAlert(prisma, token, input);

  return NextResponse.json({ alert }, { status: 201 });
});
