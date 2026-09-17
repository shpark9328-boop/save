import { z } from 'zod';
import { findRoute, isKnownStation } from './stations';
import { isValidDateString, isValidTimeString, timeToMinutes, toKstDateString } from './time';

/**
 * 입력 검증 스키마 (클라이언트/서버 공용).
 * 서버는 이 스키마를 신뢰 경계로 삼는다 — 클라이언트 검증은 UX 용일 뿐이다.
 */

export const TRAIN_TYPE_VALUES = [
  'KTX',
  'KTX_SANCHEON',
  'KTX_EUM',
  'KTX_CHEONGRYONG',
  'ITX_SAEMAEUL',
] as const;

export const SEAT_CLASS_VALUES = ['GENERAL', 'FIRST'] as const;
export const CHANNEL_VALUES = ['WEB_PUSH', 'EMAIL'] as const;

export const MAX_PASSENGERS = 9;

const stationCode = z
  .string()
  .min(1, '역을 선택하세요.')
  .refine(isKnownStation, '알 수 없는 역입니다.');

const timeString = z.string().refine(isValidTimeString, '시간 형식은 HH:mm 이어야 합니다.');

export interface CreateAlertSchemaOptions {
  /** 오늘로부터 최대 며칠 뒤까지 예약 알림을 허용할지 */
  maxDaysAhead?: number;
  /** 오늘 날짜("YYYY-MM-DD", KST). 테스트에서 주입 */
  today?: string;
}

export function createAlertSchema(options: CreateAlertSchemaOptions = {}) {
  const maxDaysAhead = options.maxDaysAhead ?? 60;
  const today = options.today ?? toKstDateString(new Date());

  return z
    .object({
      departureStationCode: stationCode,
      arrivalStationCode: stationCode,
      travelDate: z.string().refine(isValidDateString, '날짜 형식은 YYYY-MM-DD 이어야 합니다.'),
      startTime: timeString,
      endTime: timeString,
      passengerCount: z.coerce.number().int().min(1).max(MAX_PASSENGERS),
      trainTypes: z.array(z.enum(TRAIN_TYPE_VALUES)).min(1, '열차 종류를 하나 이상 선택하세요.'),
      seatClasses: z.array(z.enum(SEAT_CLASS_VALUES)).min(1, '좌석 등급을 하나 이상 선택하세요.'),
      channels: z.array(z.enum(CHANNEL_VALUES)).min(1, '알림 방식을 하나 이상 선택하세요.'),
      email: z.string().email('이메일 형식이 올바르지 않습니다.').max(254).optional(),
      memo: z.string().max(100).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.departureStationCode === value.arrivalStationCode) {
        ctx.addIssue({
          code: 'custom',
          path: ['arrivalStationCode'],
          message: '출발역과 도착역이 같습니다.',
        });
      } else if (!findRoute(value.departureStationCode, value.arrivalStationCode)) {
        ctx.addIssue({
          code: 'custom',
          path: ['arrivalStationCode'],
          message: '직통 열차가 운행하지 않는 구간입니다.',
        });
      }

      if (timeToMinutes(value.startTime) > timeToMinutes(value.endTime)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endTime'],
          message: '종료 시간이 시작 시간보다 빠릅니다.',
        });
      }

      if (value.travelDate < today) {
        ctx.addIssue({ code: 'custom', path: ['travelDate'], message: '지난 날짜입니다.' });
      } else {
        const limit = new Date(`${today}T00:00:00.000Z`);
        limit.setUTCDate(limit.getUTCDate() + maxDaysAhead);
        if (value.travelDate > limit.toISOString().slice(0, 10)) {
          ctx.addIssue({
            code: 'custom',
            path: ['travelDate'],
            message: `예매 가능 범위를 벗어났습니다. (최대 ${maxDaysAhead}일 후까지)`,
          });
        }
      }

      if (value.channels.includes('EMAIL') && !value.email) {
        ctx.addIssue({
          code: 'custom',
          path: ['email'],
          message: '이메일 알림을 선택하면 이메일 주소가 필요합니다.',
        });
      }
    });
}

export type CreateAlertInput = z.infer<ReturnType<typeof createAlertSchema>>;

export const updateAlertSchema = z.object({
  enabled: z.boolean(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  userAgent: z.string().max(256).optional(),
});

/** 브라우저가 보관하는 watch token 형식 */
export const watchTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32,128}$/, 'watch token 형식이 올바르지 않습니다.');
