import { describe, expect, it } from 'vitest';
import { evaluateTransition, type SeatState } from '@/server/monitor/transition';

/** 상태 전이 규칙: 중복 알림 방지의 핵심 */

const initial = (over: Partial<SeatState> = {}): SeatState => ({
  satisfied: false,
  lastStatus: 'SOLD_OUT',
  remainingSeats: 0,
  notifyCount: 0,
  ...over,
});

describe('evaluateTransition', () => {
  it('SOLD_OUT → AVAILABLE 이면 알림을 보낸다', () => {
    const result = evaluateTransition({
      previous: initial(),
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 2,
    });

    expect(result.shouldNotify).toBe(true);
    expect(result.reason).toBe('BECAME_AVAILABLE');
    expect(result.next.satisfied).toBe(true);
    expect(result.next.notifyCount).toBe(1);
  });

  it('상태 기록이 없던 좌석이 처음부터 AVAILABLE 이면 알림을 보낸다', () => {
    const result = evaluateTransition({
      previous: null,
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 1,
    });
    expect(result.shouldNotify).toBe(true);
  });

  it('AVAILABLE → AVAILABLE 이면 중복 알림을 보내지 않는다', () => {
    const previous = initial({ satisfied: true, lastStatus: 'AVAILABLE', remainingSeats: 2, notifyCount: 1 });
    const result = evaluateTransition({
      previous,
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 2,
    });

    expect(result.shouldNotify).toBe(false);
    expect(result.reason).toBe('STILL_AVAILABLE');
    expect(result.next.notifyCount).toBe(1);
  });

  it('AVAILABLE → SOLD_OUT → AVAILABLE 이면 두 번째 AVAILABLE 에서 다시 알린다', () => {
    const first = evaluateTransition({
      previous: initial(),
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 1,
    });
    expect(first.shouldNotify).toBe(true);

    const soldOut = evaluateTransition({
      previous: first.next,
      satisfied: false,
      status: 'SOLD_OUT',
      remainingSeats: 0,
    });
    expect(soldOut.shouldNotify).toBe(false);
    expect(soldOut.reason).toBe('NOT_SATISFIED');
    expect(soldOut.next.satisfied).toBe(false);

    const second = evaluateTransition({
      previous: soldOut.next,
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 3,
    });
    expect(second.shouldNotify).toBe(true);
    expect(second.next.notifyCount).toBe(2);
  });

  it('UNKNOWN 은 직전 상태를 유지하고 알리지 않는다', () => {
    const previous = initial({ satisfied: true, lastStatus: 'AVAILABLE', notifyCount: 1 });
    const result = evaluateTransition({
      previous,
      satisfied: false,
      status: 'UNKNOWN',
      remainingSeats: null,
    });

    expect(result.shouldNotify).toBe(false);
    expect(result.reason).toBe('UNKNOWN_HELD');
    // satisfied 를 false 로 떨어뜨리면 조회 복구 시 중복 알림이 발생한다.
    expect(result.next.satisfied).toBe(true);
  });

  it('UNKNOWN 이후 다시 AVAILABLE 이 되어도 중복 알림하지 않는다', () => {
    const notified = evaluateTransition({
      previous: initial(),
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 1,
    });
    const unknown = evaluateTransition({
      previous: notified.next,
      satisfied: false,
      status: 'UNKNOWN',
      remainingSeats: null,
    });
    const recovered = evaluateTransition({
      previous: unknown.next,
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 1,
    });

    expect(recovered.shouldNotify).toBe(false);
  });

  it('알림 횟수 상한에 도달하면 더 보내지 않는다', () => {
    const result = evaluateTransition({
      previous: initial(),
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 1,
      notificationCount: 20,
      maxNotifications: 20,
    });

    expect(result.shouldNotify).toBe(false);
    expect(result.reason).toBe('NOTIFY_LIMIT');
    // 상태는 갱신되어야 다음 사이클에서 또 시도하지 않는다.
    expect(result.next.satisfied).toBe(true);
  });

  it('maxNotifications 가 0 이면 무제한이다', () => {
    const result = evaluateTransition({
      previous: initial(),
      satisfied: true,
      status: 'AVAILABLE',
      remainingSeats: 1,
      notificationCount: 999,
      maxNotifications: 0,
    });
    expect(result.shouldNotify).toBe(true);
  });

  it('WAITLIST(예약대기)는 좌석 발생으로 보지 않는다', () => {
    const result = evaluateTransition({
      previous: initial(),
      satisfied: false,
      status: 'WAITLIST',
      remainingSeats: 0,
    });
    expect(result.shouldNotify).toBe(false);
  });
});
