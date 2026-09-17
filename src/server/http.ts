import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getEnv } from './env';
import { logger } from './logger';
import { watchTokenSchema } from '@/lib/validation';

/** API 라우트 공통 헬퍼 */

export const WATCH_TOKEN_HEADER = 'x-watch-token';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonError(status: number, message: string, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

/** 라우트 핸들러를 감싸 공통 오류 처리를 적용한다. */
export function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonError(error.status, error.message, error.details);
      }
      if (error instanceof z.ZodError) {
        return jsonError(400, '입력값이 올바르지 않습니다.', formatZodIssues(error));
      }
      logger.error('처리되지 않은 API 오류', error);
      return jsonError(500, '서버 오류가 발생했습니다.');
    }
  };
}

export function formatZodIssues(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    result[path] ??= issue.message;
  }
  return result;
}

/** watch token 은 평문 저장하지 않는다. */
export function hashWatchToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function requireWatchToken(request: Request): string {
  const raw = request.headers.get(WATCH_TOKEN_HEADER);
  if (!raw) throw new HttpError(401, '알림 토큰이 없습니다. 브라우저에서 다시 시도해 주세요.');
  const parsed = watchTokenSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, '알림 토큰 형식이 올바르지 않습니다.');
  return parsed.data;
}

/**
 * CSRF 방어.
 * 인증은 쿠키가 아니라 커스텀 헤더(x-watch-token)로 하므로 기본적으로 CSRF 에 강하지만,
 * 변경 요청에 대해서는 Origin 헤더도 함께 확인한다.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return; // 동일 출처 요청이거나 비브라우저 클라이언트
  const allowed = getEnv().APP_BASE_URL;
  try {
    if (new URL(origin).origin !== new URL(allowed).origin) {
      throw new HttpError(403, '허용되지 않은 요청 출처입니다.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, '요청 출처를 확인할 수 없습니다.');
  }
}

/** 관리자 토큰 확인 (타이밍 공격 방지 비교) */
export function requireAdmin(request: Request): void {
  const expected = getEnv().ADMIN_TOKEN;
  if (!expected) throw new HttpError(503, '관리자 토큰(ADMIN_TOKEN)이 설정되지 않았습니다.');

  const provided =
    request.headers.get('x-admin-token') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  const a = Buffer.from(provided.padEnd(expected.length).slice(0, expected.length));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(401, '관리자 인증에 실패했습니다.');
  }
}

/**
 * 아주 단순한 인메모리 요청 제한.
 * 단일 인스턴스 기준이며, 다중 인스턴스에서는 Redis 기반으로 교체해야 한다.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export function clientKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
  return `${suffix}:${ip}`;
}
