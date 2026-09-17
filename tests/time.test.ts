import { describe, expect, it } from 'vitest';
import {
  defaultExpiryFor,
  formatKoreanDate,
  kstDateTimeToUtc,
  toKstDateString,
  toKstMinutes,
  toKstTimeString,
  travelDateToUtc,
  utcToTravelDate,
} from '@/lib/time';

describe('KST 시간 처리', () => {
  it('KST 날짜+시각을 UTC 로 변환한다', () => {
    expect(kstDateTimeToUtc('2026-09-20', '19:10').toISOString()).toBe('2026-09-20T10:10:00.000Z');
  });

  it('UTC 시각을 KST 문자열로 되돌린다', () => {
    const date = new Date('2026-09-20T10:10:00.000Z');
    expect(toKstTimeString(date)).toBe('19:10');
    expect(toKstDateString(date)).toBe('2026-09-20');
    expect(toKstMinutes(date)).toBe(19 * 60 + 10);
  });

  it('자정을 넘는 UTC 시각도 KST 날짜로 올바르게 계산한다', () => {
    // 2026-09-20 23:30 KST = 2026-09-20 14:30 UTC
    const date = new Date('2026-09-20T14:30:00.000Z');
    expect(toKstDateString(date)).toBe('2026-09-20');

    // 2026-09-20 16:00 UTC = 2026-09-21 01:00 KST
    expect(toKstDateString(new Date('2026-09-20T16:00:00.000Z'))).toBe('2026-09-21');
  });

  it('여행 날짜를 UTC 자정으로 정규화한다', () => {
    expect(travelDateToUtc('2026-09-20').toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(utcToTravelDate(new Date('2026-09-20T00:00:00.000Z'))).toBe('2026-09-20');
  });

  it('기본 만료 시각은 여행일 KST 자정 직전이다', () => {
    expect(defaultExpiryFor('2026-09-20').toISOString()).toBe('2026-09-20T14:59:59.000Z');
  });

  it('한국어 날짜를 포맷한다', () => {
    expect(formatKoreanDate('2026-09-20')).toBe('2026년 9월 20일 (일)');
  });
});
