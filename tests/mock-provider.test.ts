import { describe, expect, it } from 'vitest';
import { MockTrainProvider } from '@/server/providers/mock';
import { UnsupportedRouteError } from '@/server/providers/types';

const TRAVEL_DATE = '2026-09-20';
const NOW = new Date('2026-09-20T00:00:00+09:00');

function provider(options: Partial<ConstructorParameters<typeof MockTrainProvider>[0]> = {}) {
  return new MockTrainProvider({ now: () => NOW, latencyMs: 0, ...options });
}

describe('MockTrainProvider', () => {
  it('같은 조건이면 같은 시간표를 만든다(결정적)', async () => {
    const a = await provider().searchTrains({
      departureStationCode: 'SEOUL',
      arrivalStationCode: 'BUSAN',
      travelDate: TRAVEL_DATE,
    });
    const b = await provider().searchTrains({
      departureStationCode: 'SEOUL',
      arrivalStationCode: 'BUSAN',
      travelDate: TRAVEL_DATE,
    });

    expect(a.length).toBeGreaterThan(0);
    expect(a.map((t) => t.trainNo)).toEqual(b.map((t) => t.trainNo));
    expect(a.map((t) => t.departureAt.toISOString())).toEqual(
      b.map((t) => t.departureAt.toISOString()),
    );
  });

  it('도착 시각이 출발 시각보다 뒤다', async () => {
    const trains = await provider().searchTrains({
      departureStationCode: 'SEOUL',
      arrivalStationCode: 'BUSAN',
      travelDate: TRAVEL_DATE,
    });
    for (const train of trains) {
      expect(train.arrivalAt.getTime()).toBeGreaterThan(train.departureAt.getTime());
    }
  });

  it('직통 노선이 없으면 UnsupportedRouteError 를 던진다', async () => {
    await expect(
      provider().searchTrains({
        departureStationCode: 'GANGNEUNG',
        arrivalStationCode: 'MOKPO',
        travelDate: TRAVEL_DATE,
      }),
    ).rejects.toBeInstanceOf(UnsupportedRouteError);
  });

  it('요청한 열차 종별만 돌려준다', async () => {
    const trains = await provider().searchTrains({
      departureStationCode: 'SEOUL',
      arrivalStationCode: 'BUSAN',
      travelDate: TRAVEL_DATE,
      trainTypes: ['KTX'],
    });
    expect(trains.every((train) => train.trainType === 'KTX')).toBe(true);
  });

  it('시간 버킷이 바뀌면 좌석 상태가 다시 추첨된다', async () => {
    const statuses = new Set<string>();
    for (let bucket = 0; bucket < 40; bucket += 1) {
      const clock = new Date(NOW.getTime() + bucket * 60_000);
      const trains = await new MockTrainProvider({
        now: () => clock,
        latencyMs: 0,
        availabilityRate: 0.5,
      }).searchTrains({
        departureStationCode: 'SEOUL',
        arrivalStationCode: 'BUSAN',
        travelDate: TRAVEL_DATE,
      });
      const first = trains[0];
      if (first?.seats[0]) statuses.add(first.seats[0].status);
    }
    // 40번의 버킷 동안 최소한 두 가지 이상의 상태가 관측되어야 한다.
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('errorRate 를 주면 조회 오류를 재현한다', async () => {
    await expect(
      provider({ errorRate: 1 }).searchTrains({
        departureStationCode: 'SEOUL',
        arrivalStationCode: 'BUSAN',
        travelDate: TRAVEL_DATE,
      }),
    ).rejects.toThrow();
  });

  it('이미 출발한 열차는 제외한다', async () => {
    const noon = new Date('2026-09-20T12:00:00+09:00');
    const trains = await new MockTrainProvider({ now: () => noon, latencyMs: 0 }).searchTrains({
      departureStationCode: 'SEOUL',
      arrivalStationCode: 'BUSAN',
      travelDate: TRAVEL_DATE,
    });
    expect(trains.every((train) => train.departureAt.getTime() > noon.getTime())).toBe(true);
  });
});
