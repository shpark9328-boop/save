import { AlertForm } from '@/components/AlertForm';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-bold">매진된 KTX, 취소표가 나오면 알려드립니다</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          조건을 등록해두면 서버가 주기적으로 좌석 상태를 확인하고, 매진 → 좌석 발생으로 바뀌는
          순간에만 알림을 보냅니다. 같은 상태가 계속되면 다시 알리지 않습니다.
        </p>
      </section>

      <AlertForm />
    </div>
  );
}
