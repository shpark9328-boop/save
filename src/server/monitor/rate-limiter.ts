/**
 * 외부 제공처 보호용 레이트 리미터.
 *  - 요청 사이 최소 간격(minGapMs)
 *  - 분당 최대 요청 수(maxPerMinute)
 * 두 조건을 모두 만족할 때까지 대기한다.
 */
export class RateLimiter {
  /** 아직 한 번도 호출하지 않았으면 null — 첫 요청은 대기 없이 통과시킨다. */
  private lastRequestAt: number | null = null;
  private readonly timestamps: number[] = [];

  constructor(
    private readonly options: {
      minGapMs: number;
      maxPerMinute: number;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    if (this.options.sleep) return this.options.sleep(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 호출 가능해질 때까지 대기한 뒤 사용 기록을 남긴다. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      // 1분 윈도우 밖의 기록 제거
      while (this.timestamps.length > 0 && now - (this.timestamps[0] as number) >= 60_000) {
        this.timestamps.shift();
      }

      const gapWait =
        this.lastRequestAt === null
          ? 0
          : Math.max(0, this.lastRequestAt + this.options.minGapMs - now);
      const quotaWait =
        this.timestamps.length >= this.options.maxPerMinute
          ? Math.max(0, (this.timestamps[0] as number) + 60_000 - now)
          : 0;
      const wait = Math.max(gapWait, quotaWait);

      if (wait <= 0) {
        this.lastRequestAt = now;
        this.timestamps.push(now);
        return;
      }
      await this.sleep(wait);
    }
  }

  /** 남은 분당 쿼터 */
  remainingQuota(): number {
    const now = this.now();
    const recent = this.timestamps.filter((ts) => now - ts < 60_000).length;
    return Math.max(0, this.options.maxPerMinute - recent);
  }
}
