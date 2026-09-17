import { NextResponse } from 'next/server';
import { describeProvider } from '@/server/alerts/service';
import { getEnv } from '@/server/env';
import { withErrorHandling } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 클라이언트가 필요로 하는 공개 설정.
 * VAPID "공개" 키만 내려보내며, 비밀키/서비스키는 절대 노출하지 않는다.
 */
export const GET = withErrorHandling(async () => {
  const env = getEnv();
  return NextResponse.json({
    provider: describeProvider(),
    pushPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    pushEnabled: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    emailEnabled: Boolean(env.SMTP_URL),
    maxDaysAhead: env.ALERT_MAX_DAYS_AHEAD,
    maxAlertsPerUser: env.ALERT_MAX_PER_TOKEN,
  });
});
