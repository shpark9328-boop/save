import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'KTX 좌석 알림',
  description:
    '매진된 KTX 열차에 취소표가 나오면 알려드립니다. 좌석 발생 사실만 알려주며, 예매나 결제는 대신하지 않습니다.',
  applicationName: 'KTX 좌석 알림',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1d4ed8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold">
              <span aria-hidden>🚄</span>
              <span>KTX 좌석 알림</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link className="rounded-lg px-3 py-2 hover:bg-[var(--surface-muted)]" href="/">
                등록
              </Link>
              <Link className="rounded-lg px-3 py-2 hover:bg-[var(--surface-muted)]" href="/alerts">
                내 알림
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>

        <footer className="mx-auto max-w-2xl px-4 pb-10 pt-4 text-xs leading-relaxed text-[var(--text-muted)]">
          <p>
            이 서비스는 좌석이 생겼다는 사실을 알려드릴 뿐, 예매나 결제를 대신 진행하지 않습니다.
            실제 예매는 코레일 공식 채널에서 진행해 주세요.
          </p>
          <p className="mt-2">
            <Link className="underline" href="/admin">
              관리자
            </Link>
          </p>
        </footer>
      </body>
    </html>
  );
}
