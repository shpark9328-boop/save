/**
 * 의존성 없는 구조화 로거.
 * 운영에서는 stdout 의 JSON 라인을 수집기(예: Loki, CloudWatch)가 파싱한다.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info';
}

export type LogContext = Record<string, unknown>;

function serializeError(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}),
    };
  }
  return { errorMessage: String(error) };
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

function write(level: LogLevel, scope: LogContext, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...scope,
    ...context,
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(bindings: LogContext = {}): Logger {
  return {
    debug: (message, context) => write('debug', bindings, message, context),
    info: (message, context) => write('info', bindings, message, context),
    warn: (message, context) => write('warn', bindings, message, context),
    error: (message, error, context) =>
      write('error', bindings, message, { ...serializeError(error), ...context }),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ service: 'ktx-seat-alert' });
