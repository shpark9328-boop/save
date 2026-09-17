import { z } from 'zod';

/**
 * 환경변수 검증.
 * 서버 전용 모듈이며, 절대 클라이언트 번들에 포함시키지 않는다.
 * (클라이언트에 필요한 값은 NEXT_PUBLIC_ 접두사 또는 API 응답으로 전달한다.)
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 이 필요합니다.'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  // --- provider ---
  TRAIN_PROVIDER: z.enum(['mock', 'tago', 'http']).default('mock'),
  /** 공공데이터포털 서비스 키 (tago provider) */
  TAGO_SERVICE_KEY: z.string().optional(),
  TAGO_BASE_URL: z.string().url().default('https://apis.data.go.kr/1613000/TrainInfoService'),
  /** 내부 코드 -> provider 역코드 매핑 JSON 파일 경로 */
  PROVIDER_STATION_MAP_PATH: z.string().optional(),
  /** http provider: 운영자가 직접 운영하는 좌석 조회 엔드포인트 */
  SEAT_PROVIDER_URL: z.string().url().optional(),
  SEAT_PROVIDER_TOKEN: z.string().optional(),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // --- mock provider 튜닝 ---
  MOCK_AVAILABILITY_RATE: z.coerce.number().min(0).max(1).default(0.12),
  MOCK_FLIP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(120),
  MOCK_ERROR_RATE: z.coerce.number().min(0).max(1).default(0),

  // --- worker / rate limit ---
  WORKER_ID: z.string().default(''),
  /** 워커 루프 주기(초) */
  WORKER_TICK_SECONDS: z.coerce.number().int().positive().default(15),
  /** 같은 그룹을 다시 조회하기까지의 최소 간격(초) */
  GROUP_MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  /** 외부 제공처로 나가는 요청 사이의 최소 간격(ms) */
  PROVIDER_MIN_GAP_MS: z.coerce.number().int().min(0).default(1_500),
  /** 분당 최대 외부 요청 수 */
  PROVIDER_MAX_RPM: z.coerce.number().int().positive().default(30),
  /** 한 사이클에서 처리할 최대 그룹 수 */
  WORKER_MAX_GROUPS_PER_TICK: z.coerce.number().int().positive().default(10),
  /** 그룹 조회 실패가 이만큼 연속되면 백오프를 크게 늘린다 */
  GROUP_FAILURE_BACKOFF_BASE_SECONDS: z.coerce.number().int().positive().default(60),

  // --- web push ---
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),

  // --- email (선택) ---
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('KTX 좌석 알림 <no-reply@example.com>'),

  /** 예매 딥링크를 제공하지 않는 provider 를 위한 기본 예매 페이지 */
  RESERVATION_FALLBACK_URL: z.string().url().default('https://www.letskorail.com/'),

  // --- 관리자 ---
  ADMIN_TOKEN: z.string().optional(),

  // --- 기타 ---
  ALERT_MAX_PER_TOKEN: z.coerce.number().int().positive().default(10),
  ALERT_MAX_DAYS_AHEAD: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DRY_RUN_NOTIFICATIONS: booleanish.default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`환경변수 설정이 올바르지 않습니다.\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** 테스트에서 캐시를 비우기 위한 용도 */
export function resetEnvCache(): void {
  cached = undefined;
}
