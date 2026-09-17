import { AlertList } from '@/components/AlertList';

export const metadata = { title: '내 알림 · KTX 좌석 알림' };

export default function AlertsPage() {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="text-2xl font-bold">내 알림</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          알림 목록은 이 브라우저에 저장된 토큰으로 식별합니다. 브라우저 데이터를 지우면 목록에
          접근할 수 없습니다.
        </p>
      </section>

      <AlertList />
    </div>
  );
}
