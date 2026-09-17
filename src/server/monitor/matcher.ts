import { timeToMinutes, toKstMinutes } from '@/lib/time';
import type { SeatAvailability, SeatClass, Train, TrainType } from '@/server/providers/types';

/**
 * "알림 조건 ↔ 조회 결과" 매칭 로직 (순수 함수).
 * DB/네트워크에 의존하지 않으므로 단위 테스트가 쉽다.
 */

export interface AlertCriteria {
  /** 출발 시각 하한 "HH:mm" (KST, 포함) */
  startTime: string;
  /** 출발 시각 상한 "HH:mm" (KST, 포함) */
  endTime: string;
  passengerCount: number;
  trainTypes: readonly TrainType[];
  seatClasses: readonly SeatClass[];
}

/** 출발 시각이 사용자가 지정한 시간대 안에 있는가 */
export function isWithinTimeWindow(train: Train, criteria: AlertCriteria): boolean {
  const departMinutes = toKstMinutes(train.departureAt);
  return (
    departMinutes >= timeToMinutes(criteria.startTime) &&
    departMinutes <= timeToMinutes(criteria.endTime)
  );
}

/** 열차 종별이 사용자가 선택한 종별에 포함되는가 */
export function isTrainTypeAllowed(train: Train, criteria: AlertCriteria): boolean {
  return criteria.trainTypes.length === 0 || criteria.trainTypes.includes(train.trainType);
}

/** 열차 단위 1차 필터 */
export function trainMatches(train: Train, criteria: AlertCriteria): boolean {
  return isTrainTypeAllowed(train, criteria) && isWithinTimeWindow(train, criteria);
}

/**
 * 좌석 단위 조건 충족 여부.
 *
 * - 좌석 등급이 선택 목록에 있어야 한다.
 * - 상태가 AVAILABLE 이어야 한다. (WAITLIST 는 "좌석"이 아니므로 제외)
 * - 잔여 좌석 수를 제공하는 경우 승객 수 이상이어야 한다.
 *   제공하지 않으면(null) 좌석 수 조건은 통과시킨다.
 */
export function seatSatisfies(seat: SeatAvailability, criteria: AlertCriteria): boolean {
  if (!criteria.seatClasses.includes(seat.seatClass)) return false;
  if (seat.status !== 'AVAILABLE') return false;
  if (seat.remainingSeats === null) return true;
  return seat.remainingSeats >= criteria.passengerCount;
}

export interface SeatMatch {
  train: Train;
  seat: SeatAvailability;
  /** 이 알림 조건을 충족하는가 */
  satisfied: boolean;
}

/**
 * 알림 조건에 해당하는 (열차 x 좌석등급) 조합을 모두 평가한다.
 * satisfied=false 인 항목도 포함해서 돌려준다 — 상태 전이를 추적하려면
 * "매진이었다"는 사실도 기록해야 하기 때문이다.
 */
export function evaluateTrains(trains: readonly Train[], criteria: AlertCriteria): SeatMatch[] {
  const matches: SeatMatch[] = [];
  for (const train of trains) {
    if (!trainMatches(train, criteria)) continue;
    for (const seat of train.seats) {
      if (!criteria.seatClasses.includes(seat.seatClass)) continue;
      matches.push({ train, seat, satisfied: seatSatisfies(seat, criteria) });
    }
  }
  return matches;
}
