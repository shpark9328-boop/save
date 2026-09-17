import { NextResponse } from 'next/server';
import { collectAdminStats } from '@/server/admin/stats';
import { prisma } from '@/server/db';
import { clientKey, rateLimit, requireAdmin, withErrorHandling } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 관리자 통계. ADMIN_TOKEN 이 있어야 접근할 수 있다. */
export const GET = withErrorHandling(async (request: Request) => {
  rateLimit(clientKey(request, 'admin:stats'), 60, 60_000);
  requireAdmin(request);
  const stats = await collectAdminStats(prisma);
  return NextResponse.json(stats);
});
