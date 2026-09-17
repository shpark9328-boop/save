import { describe, expect, it } from 'vitest';
import { kstDateTimeToUtc } from '@/lib/time';
import { runCheckCycle } from '@/server/monitor/engine';
import { RateLimiter } from '@/server/monitor/rate-limiter';
import type { AlertRecord } from '@/server/monitor/store';
import type {
  SeatStatus,
  SearchParams,
  Train,
  TrainDataProvider,
} from '@/server/providers/types';
import { InMemoryCheckerStore, RecordingNotifier, silentLogger } from './helpers/memory-store';

/**
 * 엔진 통합 테스트.
 * DB 없이 (스토어 + provider + notifier) 를 모두 주입해 end-to-end 흐름을 검증한다.
 */

const TRAVEL_DATE = '2026-09-20';

/** 시나리오대로 좌석 상태를 바꿔주는 provider */
class ScriptedProvider implements TrainDataProvider {
  readonly name = 'scripted';
  readonly capabilities = {
    seatAvailability: true,
    remainingSeatCount: true,
    seatClassBreakdown: true,
    reservationDeepLink: false,
  };
  readonly minIntervalMs = 0;
  callCount = 0;
  readonly calls: SearchParams[] = [];

  constructor(private readonly script: SeatStatus[]) {}

  async searchTrains(params: SearchParams): Promise<Train[]> {
    const status = this.script[Math.min(this.callCount, this.script.length - 1)] as SeatStatus;
    this.callCount += 1;
    this.calls.push(params);

    return [
      {
        trainNo: '101',
        trainType: 'KTX',
        trainName: 'KTX 101',
        departureStationCode: 'SEOUL',
        departureStationName: '서울',
        arrivalStationCode: 'BUSAN',
        arrivalStationName: '부산',
        departureAt: kstDateTimeToUtc(TRAVEL_DATE, '19:10'),
        arrivalAt: kstDateTimeToUtc(TRAVEL_DATE, '21:52'),
        seats: [
          {
            seatClass: 'GENERAL',
            status,
            remainingSeats: status === 'AVAILABLE' ? 2 : 0,
          },
        ],
      },
    ];
  }
}

function makeAlert(id: string, over: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id,
    userId: `user-${id}`,
    groupId: 'group-1',
    departureStationName: '서울',
    arrivalStationName: '부산',
    travelDate: TRAVEL_DATE,
    startTime: '17:00',
    endTime: '22:00',
    passengerCount: 1,
    trainTypes: ['KTX'],
    seatClasses: ['GENERAL'],
    channels: ['WEB_PUSH'],
    maxNotifications: 20,
    notificationCount: 0,
    ...over,
  };
}

function makeDeps(provider: TrainDataProvider, store: InMemoryCheckerStore, notifier: RecordingNotifier) {
  return {
    store,
    provider,
    notifier,
    logger: silentLogger,
    rateLimiter: new RateLimiter({ minGapMs: 0, maxPerMinute: 1000 }),
    config: {
      groupIntervalSeconds: 0,
      maxGroupsPerTick: 10,
      failureBackoffBaseSeconds: 60,
      lockMs: 60_000,
      workerId: 'test-worker',
    },
  };
}

function setup(script: SeatStatus[], alerts: AlertRecord[] = [makeAlert('alert-1')]) {
  const store = new InMemoryCheckerStore();
  store.addGroup({
    id: 'group-1',
    provider: 'scripted',
    departureStationCode: 'SEOUL',
    arrivalStationCode: 'BUSAN',
    travelDate: TRAVEL_DATE,
    consecutiveFailures: 0,
  });
  for (const alert of alerts) store.addAlert(alert);

  const provider = new ScriptedProvider(script);
  const notifier = new RecordingNotifier();
  return { store, provider, notifier, deps: makeDeps(provider, store, notifier) };
}

describe('모니터링 엔진', () => {
  it('매진 → 좌석 발생에서 한 번만 알린다', async () => {
    const { deps, notifier } = setup(['SOLD_OUT', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);

    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(0);

    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(1);

    await runCheckCycle(deps);
    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(1);
  });

  it('매진 → 발생 → 매진 → 발생 이면 두 번 알린다', async () => {
    const { deps, notifier } = setup(['SOLD_OUT', 'AVAILABLE', 'SOLD_OUT', 'AVAILABLE']);

    for (let i = 0; i < 4; i += 1) await runCheckCycle(deps);

    expect(notifier.events).toHaveLength(2);
  });

  it('처음부터 좌석이 있으면 첫 사이클에 알린다', async () => {
    const { deps, notifier } = setup(['AVAILABLE']);
    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(1);
  });

  it('같은 노선/날짜 알림이 여러 개여도 외부 조회는 1회만 한다', async () => {
    const { deps, provider, notifier } = setup(
      ['SOLD_OUT', 'AVAILABLE'],
      [makeAlert('alert-1'), makeAlert('alert-2'), makeAlert('alert-3')],
    );

    await runCheckCycle(deps);
    await runCheckCycle(deps);

    expect(provider.callCount).toBe(2); // 사이클당 1회
    expect(notifier.events).toHaveLength(3); // 사용자 3명 모두에게 알림
  });

  it('시간대 밖의 열차는 알리지 않는다', async () => {
    const { deps, notifier } = setup(['AVAILABLE'], [
      makeAlert('alert-1', { startTime: '06:00', endTime: '09:00' }),
    ]);
    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(0);
  });

  it('승객 수 조건을 충족하지 못하면 알리지 않는다', async () => {
    const { deps, notifier } = setup(['AVAILABLE'], [
      makeAlert('alert-1', { passengerCount: 5 }), // 잔여 2석
    ]);
    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(0);
  });

  it('비활성(일시정지) 알림에는 보내지 않는다', async () => {
    const { deps, store, notifier } = setup(['AVAILABLE']);
    const alert = store.alerts.get('alert-1');
    if (alert) alert.enabled = false;

    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(0);
  });

  it('만료된 알림은 비활성화되고 알림도 가지 않는다', async () => {
    const { deps, store, notifier } = setup(['AVAILABLE']);
    const alert = store.alerts.get('alert-1');
    if (alert) alert.expiresAt = new Date('2020-01-01T00:00:00Z');

    const summary = await runCheckCycle(deps);
    expect(summary.expiredAlerts).toBe(1);
    expect(notifier.events).toHaveLength(0);
  });

  it('좌석 상태 변화를 SeatEvent 로 기록한다', async () => {
    const { deps, store } = setup(['SOLD_OUT', 'AVAILABLE']);
    await runCheckCycle(deps);
    await runCheckCycle(deps);

    expect(store.seatEvents).toHaveLength(1);
    expect(store.seatEvents[0]).toMatchObject({
      trainNo: '101',
      fromStatus: 'SOLD_OUT',
      toStatus: 'AVAILABLE',
    });
  });

  it('조회 결과와 알림 발송을 기록으로 남긴다', async () => {
    const { deps, store } = setup(['AVAILABLE']);
    await runCheckCycle(deps);

    expect(store.checkRuns).toHaveLength(1);
    expect(store.checkRuns[0]?.status).toBe('OK');
    expect(store.notificationLogs).toHaveLength(1);
    expect(store.notificationLogs[0]?.status).toBe('SENT');
  });

  it('provider 오류는 사이클을 중단시키지 않고 기록된다', async () => {
    const store = new InMemoryCheckerStore();
    store.addGroup({
      id: 'group-1',
      provider: 'failing',
      departureStationCode: 'SEOUL',
      arrivalStationCode: 'BUSAN',
      travelDate: TRAVEL_DATE,
      consecutiveFailures: 0,
    });
    store.addAlert(makeAlert('alert-1'));

    const failing: TrainDataProvider = {
      name: 'failing',
      capabilities: {
        seatAvailability: true,
        remainingSeatCount: true,
        seatClassBreakdown: true,
        reservationDeepLink: false,
      },
      minIntervalMs: 0,
      searchTrains: async () => {
        throw new Error('제공처 장애');
      },
    };

    const notifier = new RecordingNotifier();
    const summary = await runCheckCycle(makeDeps(failing, store, notifier));

    expect(summary.groupsFailed).toBe(1);
    expect(store.checkRuns[0]?.status).toBe('ERROR');
    expect(store.groups.get('group-1')?.consecutiveFailures).toBe(1);
  });

  it('UNKNOWN 만 주는 provider 로는 알림이 발송되지 않는다', async () => {
    const { deps, notifier } = setup(['UNKNOWN', 'UNKNOWN']);
    await runCheckCycle(deps);
    await runCheckCycle(deps);
    expect(notifier.events).toHaveLength(0);
  });
});
