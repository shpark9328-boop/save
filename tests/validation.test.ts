import { describe, expect, it } from 'vitest';
import { createAlertSchema } from '@/lib/validation';

const TODAY = '2026-09-17';

const valid = {
  departureStationCode: 'SEOUL',
  arrivalStationCode: 'BUSAN',
  travelDate: '2026-09-20',
  startTime: '17:00',
  endTime: '22:00',
  passengerCount: 1,
  trainTypes: ['KTX'],
  seatClasses: ['GENERAL'],
  channels: ['WEB_PUSH'],
};

function parse(input: Record<string, unknown>) {
  return createAlertSchema({ today: TODAY, maxDaysAhead: 60 }).safeParse({ ...valid, ...input });
}

describe('알림 등록 입력 검증', () => {
  it('정상 입력을 통과시킨다', () => {
    expect(parse({}).success).toBe(true);
  });

  it('출발역과 도착역이 같으면 거부한다', () => {
    const result = parse({ arrivalStationCode: 'SEOUL' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('같습니다');
  });

  it('알 수 없는 역 코드를 거부한다', () => {
    expect(parse({ departureStationCode: 'ATLANTIS' }).success).toBe(false);
  });

  it('직통 열차가 없는 조합을 거부한다', () => {
    // 강릉(강릉선) ↔ 목포(호남선) 은 같은 노선에 없다.
    const result = parse({ departureStationCode: 'GANGNEUNG', arrivalStationCode: 'MOKPO' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('직통');
  });

  it('지난 날짜를 거부한다', () => {
    expect(parse({ travelDate: '2026-09-16' }).success).toBe(false);
  });

  it('오늘 날짜는 허용한다', () => {
    expect(parse({ travelDate: TODAY }).success).toBe(true);
  });

  it('예매 가능 범위를 넘는 날짜를 거부한다', () => {
    expect(parse({ travelDate: '2027-01-01' }).success).toBe(false);
  });

  it('종료 시간이 시작 시간보다 빠르면 거부한다', () => {
    expect(parse({ startTime: '22:00', endTime: '17:00' }).success).toBe(false);
  });

  it('잘못된 시간 형식을 거부한다', () => {
    expect(parse({ startTime: '25:00' }).success).toBe(false);
    expect(parse({ endTime: '9시' }).success).toBe(false);
  });

  it('승객 수 범위를 검사한다', () => {
    expect(parse({ passengerCount: 0 }).success).toBe(false);
    expect(parse({ passengerCount: 10 }).success).toBe(false);
    expect(parse({ passengerCount: 9 }).success).toBe(true);
  });

  it('열차 종류/좌석/알림 방식은 최소 1개가 필요하다', () => {
    expect(parse({ trainTypes: [] }).success).toBe(false);
    expect(parse({ seatClasses: [] }).success).toBe(false);
    expect(parse({ channels: [] }).success).toBe(false);
  });

  it('이메일 알림을 선택하면 이메일이 필요하다', () => {
    expect(parse({ channels: ['EMAIL'] }).success).toBe(false);
    expect(parse({ channels: ['EMAIL'], email: 'me@example.com' }).success).toBe(true);
    expect(parse({ channels: ['EMAIL'], email: 'not-an-email' }).success).toBe(false);
  });
});
