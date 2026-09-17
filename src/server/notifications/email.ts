import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '@/server/env';
import { logger } from '@/server/logger';
import { renderEmailText, type SeatAlertMessage } from './message';

/** 이메일 발송기 (선택 기능). SMTP_URL 이 없으면 비활성. */

let transporter: Transporter | undefined;

export function isEmailConfigured(): boolean {
  return Boolean(getEnv().SMTP_URL);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const env = getEnv();
  if (!env.SMTP_URL) throw new Error('SMTP_URL 이 설정되지 않았습니다.');
  transporter = nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

export async function sendEmail(
  to: string,
  message: SeatAlertMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const env = getEnv();
    await getTransporter().sendMail({
      from: env.MAIL_FROM,
      to,
      subject: `${message.title} ${message.body.split('\n')[0] ?? ''}`.trim(),
      text: renderEmailText(message),
    });
    return { ok: true };
  } catch (error) {
    logger.warn('이메일 발송 실패', { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
