import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 헬스체크: DB 연결 확인 */
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'up' });
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'down', error: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
}
