import { formatKoreanDate, toKstDateString, toKstTimeString } from '@/lib/time';
import { SEAT_CLASS_LABELS, type SeatClass, type Train } from '@/server/providers/types';

/** 알림 문구 생성 (채널 공통) */

export interface SeatAlertMessage {
  title: string;
  body: string;
  /** 알림 클릭 시 이동할 주소 */
  url: string;
  /** 같은 열차/좌석 알림을 브라우저가 묶도록 하는 태그 */
  tag: string;
  data: {
    trainNo: string;
    seatClass: SeatClass;
    departureAt: string;
    alertId: string;
  };
}

export function buildSeatAlertMessage(params: {
  alertId: string;
  departureStationName: string;
  arrivalStationName: string;
  train: Train;
  seatClass: SeatClass;
  remainingSeats: number | null;
  url: string;
}): SeatAlertMessage {
  const { train } = params;
  const date = toKstDateString(train.departureAt);
  const departTime = toKstTimeString(train.departureAt);
  const arriveTime = toKstTimeString(train.arrivalAt);
  const seats =
    params.remainingSeats === null ? '좌석 예약 가능' : `잔여 ${params.remainingSeats}석 · 예약 가능`;

  const body = [
    `${params.departureStationName} → ${params.arrivalStationName}`,
    formatKoreanDate(date),
    `${departTime} 출발 · ${arriveTime} 도착`,
    `${train.trainName} · ${SEAT_CLASS_LABELS[params.seatClass]}`,
    seats,
  ].join('\n');

  return {
    title: '🚄 KTX 좌석이 생겼습니다!',
    body,
    url: params.url,
    tag: `seat-${params.alertId}-${train.trainNo}-${params.seatClass}`,
    data: {
      trainNo: train.trainNo,
      seatClass: params.seatClass,
      departureAt: train.departureAt.toISOString(),
      alertId: params.alertId,
    },
  };
}

/** 이메일 본문(텍스트) */
export function renderEmailText(message: SeatAlertMessage): string {
  return [
    message.title,
    '',
    message.body,
    '',
    `예매하기: ${message.url}`,
    '',
    '— 이 메일은 등록하신 좌석 알림 조건에 따라 발송되었습니다.',
    '이 서비스는 좌석 발생 사실만 알려드리며, 예매나 결제를 대신 진행하지 않습니다.',
  ].join('\n');
}
