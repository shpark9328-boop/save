import { PrismaClient } from '@prisma/client';

/**
 * Prisma 클라이언트 싱글턴.
 * Next.js dev 서버의 HMR 로 커넥션이 누수되지 않도록 globalThis 에 캐시한다.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
