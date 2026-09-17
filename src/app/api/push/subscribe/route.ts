import { NextResponse } from 'next/server';
import { pushSubscriptionSchema } from '@/lib/validation';
import { getOrCreateUser, requireUser } from '@/server/alerts/service';
import { prisma } from '@/server/db';
import {
  assertSameOrigin,
  clientKey,
  rateLimit,
  requireWatchToken,
  withErrorHandling,
} from '@/server/http';
import { logger } from '@/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 웹 푸시 구독 등록.
 * 구독 객체(endpoint/keys)는 사실상 "알림을 보낼 수 있는 자격"이므로
 * 서버에만 저장하고 다시 클라이언트로 돌려주지 않는다.
 */
export const POST = withErrorHandling(async (request: Request) => {
  assertSameOrigin(request);
  const token = requireWatchToken(request);
  rateLimit(clientKey(request, 'push:post'), 30, 60_000);

  const payload: unknown = await request.json();
  const subscription = pushSubscriptionSchema.parse(payload);
  const user = await getOrCreateUser(prisma, token);

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: subscription.userAgent ?? null,
    },
    update: {
      userId: user.id,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: subscription.userAgent ?? null,
      disabledAt: null,
      failureCount: 0,
    },
  });

  logger.info('푸시 구독 등록', { userId: user.id });
  return NextResponse.json({ ok: true }, { status: 201 });
});

/** 구독 해지 */
export const DELETE = withErrorHandling(async (request: Request) => {
  assertSameOrigin(request);
  const token = requireWatchToken(request);
  const user = await requireUser(prisma, token);
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint');

  await prisma.pushSubscription.deleteMany({
    where: { userId: user.id, ...(endpoint ? { endpoint } : {}) },
  });
  return NextResponse.json({ ok: true });
});
