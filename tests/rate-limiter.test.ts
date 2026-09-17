import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@/server/monitor/rate-limiter';

/** 가상 시계로 대기 동작을 검증한다. */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get value() {
      return now;
    },
  };
}

describe('RateLimiter', () => {
  it('요청 사이 최소 간격을 지킨다', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minGapMs: 1000, maxPerMinute: 1000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    expect(clock.value).toBe(0);
    await limiter.acquire();
    expect(clock.value).toBe(1000);
    await limiter.acquire();
    expect(clock.value).toBe(2000);
  });

  it('분당 상한을 초과하면 윈도우가 열릴 때까지 기다린다', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minGapMs: 0, maxPerMinute: 3, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.value).toBe(0);

    await limiter.acquire();
    expect(clock.value).toBe(60_000);
  });

  it('남은 쿼터를 보고할 수 있다', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ minGapMs: 0, maxPerMinute: 5, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.remainingQuota()).toBe(3);
  });
});
