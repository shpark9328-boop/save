import { NextResponse } from 'next/server';
import { updateAlertSchema } from '@/lib/validation';
import { deleteAlert, setAlertEnabled } from '@/server/alerts/service';
import { prisma } from '@/server/db';
import {
  assertSameOrigin,
  clientKey,
  rateLimit,
  requireWatchToken,
  withErrorHandling,
} from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** 일시정지 / 재시작 */
export const PATCH = withErrorHandling(async (request: Request, context: RouteContext) => {
  assertSameOrigin(request);
  const token = requireWatchToken(request);
  rateLimit(clientKey(request, 'alerts:patch'), 60, 60_000);

  const { id } = await context.params;
  const body: unknown = await request.json();
  const { enabled } = updateAlertSchema.parse(body);
  const alert = await setAlertEnabled(prisma, token, id, enabled);
  return NextResponse.json({ alert });
});

/** 삭제 */
export const DELETE = withErrorHandling(async (request: Request, context: RouteContext) => {
  assertSameOrigin(request);
  const token = requireWatchToken(request);
  rateLimit(clientKey(request, 'alerts:delete'), 60, 60_000);

  const { id } = await context.params;
  await deleteAlert(prisma, token, id);
  return NextResponse.json({ ok: true });
});
