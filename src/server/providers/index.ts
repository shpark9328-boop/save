import { getEnv } from '@/server/env';
import { logger } from '@/server/logger';
import { HttpSeatProvider } from './http';
import { MockTrainProvider } from './mock';
import { TagoTrainProvider } from './tago';
import type { TrainDataProvider } from './types';

export * from './types';
export { MockTrainProvider } from './mock';
export { TagoTrainProvider } from './tago';
export { HttpSeatProvider } from './http';

let cached: TrainDataProvider | undefined;

/**
 * 환경변수 TRAIN_PROVIDER 에 따라 provider 를 생성한다.
 * 애플리케이션 코드는 이 함수 하나만 사용한다.
 */
export function createProvider(): TrainDataProvider {
  const env = getEnv();

  switch (env.TRAIN_PROVIDER) {
    case 'tago': {
      if (!env.TAGO_SERVICE_KEY) {
        throw new Error('TRAIN_PROVIDER=tago 인데 TAGO_SERVICE_KEY 가 없습니다.');
      }
      logger.warn(
        'TAGO provider 는 시간표만 제공하며 실시간 좌석 정보를 제공하지 않습니다. 좌석 알림은 동작하지 않습니다.',
      );
      return new TagoTrainProvider({
        serviceKey: env.TAGO_SERVICE_KEY,
        baseUrl: env.TAGO_BASE_URL,
        stationMapPath: env.PROVIDER_STATION_MAP_PATH,
        timeoutMs: env.PROVIDER_TIMEOUT_MS,
      });
    }
    case 'http': {
      if (!env.SEAT_PROVIDER_URL) {
        throw new Error('TRAIN_PROVIDER=http 인데 SEAT_PROVIDER_URL 이 없습니다.');
      }
      return new HttpSeatProvider({
        url: env.SEAT_PROVIDER_URL,
        token: env.SEAT_PROVIDER_TOKEN,
        timeoutMs: env.PROVIDER_TIMEOUT_MS,
      });
    }
    case 'mock':
    default:
      return new MockTrainProvider({
        availabilityRate: env.MOCK_AVAILABILITY_RATE,
        flipIntervalMs: env.MOCK_FLIP_INTERVAL_SECONDS * 1000,
        latencyMs: env.MOCK_LATENCY_MS,
        errorRate: env.MOCK_ERROR_RATE,
      });
  }
}

export function getProvider(): TrainDataProvider {
  cached ??= createProvider();
  return cached;
}

export function resetProviderCache(): void {
  cached = undefined;
}
