import { describe, expect, it } from 'vitest';
import { kstDateTimeToUtc } from '@/lib/time';
import { evaluateTrains, isWithinTimeWindow, seatSatisfies } from '@/server/monitor/matcher';
import type { AlertCriteria } from '@/server/monitor/matcher';
import type { Train } from '@/server/providers/types';

const DATE = '2026-09-20';

function makeTrain(over: Partial<Train> & { departTime: string }): Train {
  return {
    trainNo: over.trainNo ?? '101',
    trainType: over.trainType ?? 'KTX',
    trainName: over.trainName ?? 'KTX 101',
    departureStationCode: 'SEOUL',
    departureStationName: '서울',
    arrivalStationCode: 'BUSAN',
    arrivalStationName: '부산',
    departureAt: kstDateTimeToUtc(DATE, over.departTime),
    arrivalAt: kstDateTimeToUtc(DATE, over.departTime),
    seats: over.seats ?? [{ seatClass: 'GENERAL', status: 'SOLD_OUT', remainingSeats: 0 }],
  };
}

const baseCriteria: AlertCriteria = {
  startTime: '17:00',
  endTime: '22:00',
  passengerCount: 1,
  trainTypes: ['KTX', 'KTX_SANCHEON'],
  seatClasses: ['GENERAL'],
};

describe('시간대 조건', () => {
  it('시간 범위 안의 열차만 통과시킨다', () => {
    expect(isWithinTimeWindow(makeTrain({ departTime: '19:10' }), baseCriteria)).toBe(true);
    expect(isWithinTimeWindow(makeTrain({ departTime: '16:59' }), baseCriteria)).toBe(false);
    expect(isWithinTimeWindow(makeTrain({ departTime: '22:01' }), baseCriteria)).toBe(false);
  });

  it('경계값(시작/종료 시각)은 포함한다', () => {
    expect(isWithinTimeWindow(makeTrain({ departTime: '17:00' }), baseCriteria)).toBe(true);
    expect(isWithinTimeWindow(makeTrain({ departTime: '22:00' }), baseCriteria)).toBe(true);
  });

  it('시간 범위 밖의 열차는 좌석이 있어도 알림 대상이 아니다', () => {
    const trains = [
      makeTrain({
        departTime: '09:00',
        seats: [{ seatClass: 'GENERAL', status: 'AVAILABLE', remainingSeats: 5 }],
      }),
    ];
    expect(evaluateTrains(trains, baseCriteria)).toHaveLength(0);
  });
});

describe('열차 종별 조건', () => {
  it('선택하지 않은 종별은 제외한다', () => {
    const trains = [
      makeTrain({
        departTime: '18:00',
        trainType: 'ITX_SAEMAEUL',
        seats: [{ seatClass: 'GENERAL', status: 'AVAILABLE', remainingSeats: 5 }],
      }),
    ];
    expect(evaluateTrains(trains, baseCriteria)).toHaveLength(0);
  });
});

describe('좌석 조건', () => {
  it('선택한 등급만 평가한다', () => {
    expect(
      seatSatisfies({ seatClass: 'FIRST', status: 'AVAILABLE', remainingSeats: 3 }, baseCriteria),
    ).toBe(false);
  });

  it('승객 수보다 잔여석이 적으면 충족하지 않는다', () => {
    const criteria = { ...baseCriteria, passengerCount: 3 };
    expect(
      seatSatisfies({ seatClass: 'GENERAL', status: 'AVAILABLE', remainingSeats: 2 }, criteria),
    ).toBe(false);
    expect(
      seatSatisfies({ seatClass: 'GENERAL', status: 'AVAILABLE', remainingSeats: 3 }, criteria),
    ).toBe(true);
  });

  it('잔여석 정보를 제공하지 않으면(null) 좌석 수 조건은 통과시킨다', () => {
    const criteria = { ...baseCriteria, passengerCount: 4 };
    expect(
      seatSatisfies({ seatClass: 'GENERAL', status: 'AVAILABLE', remainingSeats: null }, criteria),
    ).toBe(true);
  });

  it('매진/예약대기/정보없음은 충족하지 않는다', () => {
    for (const status of ['SOLD_OUT', 'WAITLIST', 'UNKNOWN'] as const) {
      expect(
        seatSatisfies({ seatClass: 'GENERAL', status, remainingSeats: 0 }, baseCriteria),
      ).toBe(false);
    }
  });
});

describe('evaluateTrains', () => {
  it('매진 좌석도 결과에 포함해 상태 추적이 가능하게 한다', () => {
    const trains = [makeTrain({ departTime: '18:00' })];
    const matches = evaluateTrains(trains, baseCriteria);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.satisfied).toBe(false);
  });

  it('여러 좌석 등급을 각각 평가한다', () => {
    const trains = [
      makeTrain({
        departTime: '18:00',
        seats: [
          { seatClass: 'GENERAL', status: 'SOLD_OUT', remainingSeats: 0 },
          { seatClass: 'FIRST', status: 'AVAILABLE', remainingSeats: 2 },
        ],
      }),
    ];
    const matches = evaluateTrains(trains, { ...baseCriteria, seatClasses: ['GENERAL', 'FIRST'] });
    expect(matches).toHaveLength(2);
    expect(matches.filter((m) => m.satisfied)).toHaveLength(1);
  });
});
