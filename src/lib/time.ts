/**
 * 한국 철도 시간 처리 유틸.
 *
 * 서비스 전체는 다음 규칙을 따른다.
 *  - 사용자 입력(날짜, 시간)은 항상 KST(Asia/Seoul, UTC+9) 기준이다.
 *  - DB 에는 UTC 로 저장한다. travelDate 는 "KST 날짜"를 UTC 자정으로 정규화해 저장한다.
 *  - 화면/알림 표기는 다시 KST 로 변환한다.
 *
 * Node 의 로컬 타임존에 의존하지 않기 위해 고정 오프셋(+09:00)만 사용한다.
 * (대한민국은 현재 서머타임을 사용하지 않으므로 고정 오프셋이 정확하다.)
 */

export const KST_OFFSET_MINUTES = 9 * 60;
const MS_PER_MINUTE = 60_000;

/** "YYYY-MM-DD" 형식 검사 + 실제 존재하는 날짜인지 검사 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** "HH:mm" 형식 검사 */
export function isValidTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** "HH:mm" -> 자정 기준 분 */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** 자정 기준 분 -> "HH:mm" */
export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** KST 날짜 문자열을 DB 저장용 Date(UTC 자정)로 변환 */
export function travelDateToUtc(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`);
}

/** DB 의 travelDate(Date) 를 "YYYY-MM-DD" 로 변환 */
export function utcToTravelDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** KST 날짜 + "HH:mm" -> 절대 시각(Date) */
export function kstDateTimeToUtc(dateString: string, time: string): Date {
  return new Date(`${dateString}T${time}:00.000+09:00`);
}

/** 절대 시각 -> KST "YYYY-MM-DD" */
export function toKstDateString(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MINUTES * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 10);
}

/** 절대 시각 -> KST "HH:mm" */
export function toKstTimeString(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MINUTES * MS_PER_MINUTE)
    .toISOString()
    .slice(11, 16);
}

/** 절대 시각 -> KST 자정 기준 분 */
export function toKstMinutes(date: Date): number {
  return timeToMinutes(toKstTimeString(date));
}

/** 알림 조건의 기본 만료 시각: 여행일 KST 23:59:59 */
export function defaultExpiryFor(travelDate: string): Date {
  return new Date(`${travelDate}T23:59:59.000+09:00`);
}

/** 사람이 읽는 한국어 날짜: "2026년 9월 20일 (일)" */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;
export function formatKoreanDate(dateString: string): string {
  const [y, m, d] = dateString.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}
