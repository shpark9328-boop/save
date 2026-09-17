import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db';
import { getEnv } from '@/server/env';
import { createLogger } from '@/server/logger';
import { runCheckCycle, type CycleSummary } from '@/server/monitor/engine';
import { PrismaCheckerStore } from '@/server/monitor/prisma-store';
import { RateLimiter } from '@/server/monitor/rate-limiter';
import { NotificationDispatcher } from '@/server/notifications/dispatcher';
import { getProvider } from '@/server/providers';

/**
 * 좌석 확인 워커.
 *
 * 실행: npm run worker
 *
 * 동작
 *  - WORKER_TICK_SECONDS 마다 한 사이클을 돈다.
 *  - 한 사이클에서 조회 시각이 된 그룹을 최대 WORKER_MAX_GROUPS_PER_TICK 개 처리한다.
 *  - 외부 요청은 RateLimiter 를 통과해야 나간다(최소 간격 + 분당 상한).
 *  - 여러 인스턴스를 띄워도 그룹 잠금 덕분에 중복 조회가 발생하지 않는다.
 */

async function main(): Promise<void> {
  const env = getEnv();
  const workerId = env.WORKER_ID || `worker-${randomUUID().slice(0, 8)}`;
  const logger = createLogger({ service: 'ktx-checker', workerId });

  const provider = getProvider();
  const store = new PrismaCheckerStore(prisma);
  const notifier = new NotificationDispatcher(prisma);
  const rateLimiter = new RateLimiter({
    minGapMs: Math.max(env.PROVIDER_MIN_GAP_MS, provider.minIntervalMs),
    maxPerMinute: env.PROVIDER_MAX_RPM,
  });

  const health = await provider.healthCheck?.();
  logger.info('워커 시작', {
    provider: provider.name,
    seatAvailability: provider.capabilities.seatAvailability,
    tickSeconds: env.WORKER_TICK_SECONDS,
    groupIntervalSeconds: env.GROUP_MIN_INTERVAL_SECONDS,
    maxRpm: env.PROVIDER_MAX_RPM,
    providerHealth: health,
  });

  if (!provider.capabilities.seatAvailability) {
    logger.warn(
      '이 provider 는 좌석 가용 정보를 제공하지 않습니다. 상태는 UNKNOWN 으로 기록되며 알림은 발송되지 않습니다.',
    );
  }

  let running = true;
  let cycles = 0;
  let groupsChecked = 0;
  let sleepTimer: NodeJS.Timeout | undefined;
  let wake: (() => void) | undefined;

  const shutdown = (signal: string): void => {
    if (!running) return;
    running = false;
    logger.info('종료 신호 수신', { signal });
    if (sleepTimer) clearTimeout(sleepTimer);
    wake?.();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      wake = resolve;
      sleepTimer = setTimeout(resolve, ms);
    });

  while (running) {
    const startedAt = Date.now();
    let lastError: string | undefined;

    try {
      const summary: CycleSummary = await runCheckCycle({
        store,
        provider,
        notifier,
        logger,
        rateLimiter,
        config: {
          groupIntervalSeconds: env.GROUP_MIN_INTERVAL_SECONDS,
          maxGroupsPerTick: env.WORKER_MAX_GROUPS_PER_TICK,
          failureBackoffBaseSeconds: env.GROUP_FAILURE_BACKOFF_BASE_SECONDS,
          // 잠금은 한 사이클을 넉넉히 덮을 만큼만 유지한다.
          lockMs: Math.max(60_000, env.WORKER_TICK_SECONDS * 4 * 1000),
          workerId,
        },
      });

      cycles += 1;
      groupsChecked += summary.groupsSucceeded;
      if (summary.errors.length > 0) lastError = summary.errors[0];

      if (summary.groupsClaimed > 0 || summary.notificationsSent > 0) {
        logger.info('사이클 완료', {
          ...summary,
          durationMs: Date.now() - startedAt,
          quotaLeft: rateLimiter.remainingQuota(),
        });
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.error('사이클 실패', error);
    }

    try {
      await store.heartbeat({
        workerId,
        provider: provider.name,
        cyclesCompleted: cycles,
        groupsChecked,
        ...(lastError ? { lastError } : {}),
      });
    } catch (error) {
      logger.error('하트비트 기록 실패', error);
    }

    if (!running) break;
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(1_000, env.WORKER_TICK_SECONDS * 1000 - elapsed));
  }

  await prisma.$disconnect();
  logger.info('워커 종료');
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`워커 기동 실패: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
