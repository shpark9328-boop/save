import { AdminDashboard } from '@/components/AdminDashboard';

export const metadata = { title: '관리자 · KTX 좌석 알림' };

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">관리자</h1>
      <AdminDashboard />
    </div>
  );
}
