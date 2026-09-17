import type { SeatStatus } from '@/server/providers/types';

/**
 * 좌석 상태 전이 판정 (순수 함수).
 *
 * 이 서비스의 핵심 규칙:
 *   "매번 좌석이 있는지"가 아니라 "조건을 충족하지 못하던 상태 → 충족하는 상태"로
 *   바뀐 순간에만 알림을 보낸다.
 *
 *   SOLD_OUT → AVAILABLE              : 알림 O
 *   AVAILABLE → AVAILABLE             : 알림 X (중복 방지)
 *   AVAILABLE → SOLD_OUT              : 알림 X (상태만 재무장)
 *   AVAILABLE → SOLD_OUT → AVAILABLE  : 두 번째 AVAILABLE 에서 다시 알림 O
 *
 * UNKNOWN(조회 실패/미제공) 처리:
 *   직전 상태를 그대로 유지하고 알림하지 않는다.
 *   UNKNOWN 을 "충족하지 않음"으로 처리하면, 일시적 조회 실패 뒤에
 *   같은 좌석에 대해 중복 알림이 발생하기 때문이다.
 */

export interface SeatState {
  /** 직전 사이클에서 알림 조건을 충족했는가 */
  satisfied: boolean;
  lastStatus: SeatStatus;
  remainingSeats: number | null;
  notifyCount: number;
}

export type TransitionReason =
  | 'BECAME_AVAILABLE' // 알림 대상
  | 'STILL_AVAILABLE' // 이미 알림 보냄 → 중복 방지
  | 'NOT_SATISFIED' // 조건 미충족 (재무장)
  | 'UNKNOWN_HELD' // 정보 없음 → 직전 상태 유지
  | 'NOTIFY_LIMIT'; // 알림 횟수 상한 도달

export interface TransitionInput {
  previous: SeatState | null;
  satisfied: boolean;
  status: SeatStatus;
  remainingSeats: number | null;
  /** 이 알림이 이미 보낸 누적 알림 수 (0 이면 제한 없음 처리는 maxNotifications 로) */
  notificationCount?: number;
  /** 0 이면 무제한 */
  maxNotifications?: number;
}

export interface TransitionResult {
  shouldNotify: boolean;
  reason: TransitionReason;
  next: SeatState;
}

const INITIAL_STATE: SeatState = {
  satisfied: false,
  lastStatus: 'UNKNOWN',
  remainingSeats: null,
  notifyCount: 0,
};

export function evaluateTransition(input: TransitionInput): TransitionResult {
  const previous = input.previous ?? INITIAL_STATE;

  if (input.status === 'UNKNOWN') {
    return {
      shouldNotify: false,
      reason: 'UNKNOWN_HELD',
      next: { ...previous, lastStatus: 'UNKNOWN' },
    };
  }

  const next: SeatState = {
    satisfied: input.satisfied,
    lastStatus: input.status,
    remainingSeats: input.remainingSeats,
    notifyCount: previous.notifyCount,
  };

  if (!input.satisfied) {
    // 조건 미충족 → 다음 번 "발생"을 새 이벤트로 감지할 수 있도록 재무장한다.
    return { shouldNotify: false, reason: 'NOT_SATISFIED', next };
  }

  if (previous.satisfied) {
    return { shouldNotify: false, reason: 'STILL_AVAILABLE', next };
  }

  const max = input.maxNotifications ?? 0;
  const sent = input.notificationCount ?? 0;
  if (max > 0 && sent >= max) {
    // 상태는 갱신하되(중복 알림 방지 상태 유지) 알림은 보내지 않는다.
    return { shouldNotify: false, reason: 'NOTIFY_LIMIT', next };
  }

  return {
    shouldNotify: true,
    reason: 'BECAME_AVAILABLE',
    next: { ...next, notifyCount: previous.notifyCount + 1 },
  };
}
