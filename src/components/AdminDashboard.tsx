'use client';

import { useCallback, useEffect, useState } from 'react';
import { SEAT_STATUS_LABELS } from '@/server/providers/types';
import type { AdminStats } from '@/types/api';
import { Notice, Spinner } from './ui';

const TOKEN_KEY = 'ktx-alert.admin-token';

/** 관리자 대시보드. 토큰은 sessionStorage 에만 보관한다(탭을 닫으면 사라짐). */
export function AdminDashboard() {
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const load = useCallback(async (adminToken: string): Promise<void> => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const response = await fetch('/api/admin/stats', {
        headers: { 'x-admin-token': adminToken },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setStats((await response.json()) as AdminStats);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '통계를 불러오지 못했습니다.');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void load(token);
    const timer = setInterval(() => void load(token), 15_000);
    return () => clearInterval(timer);
  }, [token, load]);

  if (!token) {
    return (
      <form
        className="card flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          sessionStorage.setItem(TOKEN_KEY, input);
          setToken(input);
        }}
      >
        <label className="label" htmlFor="admin-token">
          관리자 토큰
        </label>
        <input
          id="admin-token"
          type="password"
          className="field"
          value={input}
          autoComplete="off"
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          로그인
        </button>
        <p className="text-xs text-[var(--text-muted)]">
          서버 환경변수 ADMIN_TOKEN 과 동일한 값을 입력하세요.
        </p>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        {loading ? <Spinner label="갱신 중…" /> : <span className="text-sm text-[var(--text-muted)]">15초마다 자동 갱신</span>}
        <button
          type="button"
          className="btn btn-ghost px-3 py-1.5 text-sm"
          onClick={() => {
            sessionStorage.removeItem(TOKEN_KEY);
            setToken('');
            setStats(null);
          }}
        >
          로그아웃
        </button>
      </div>

      {error ? <Notice>{error}</Notice> : null}
      {!stats ? null : (
        <>
          {stats.provider.notice ? <Notice>{stats.provider.notice}</Notice> : null}

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="전체 알림" value={stats.alerts.total} sub={`활성 ${stats.alerts.enabled}`} />
            <Stat label="조회 그룹" value={stats.groups.total} sub={`활성 ${stats.groups.active} / 잠금 ${stats.groups.locked}`} />
            <Stat label="사용자" value={stats.users.total} sub={`푸시 ${stats.users.withPush}`} />
            <Stat
              label="24h 알림"
              value={stats.notifications.last24h}
              sub={`실패 ${stats.notifications.failed24h}`}
            />
          </section>

          <Panel title="워커 상태">
            {stats.worker.length === 0 ? (
              <Empty>실행 중인 워커가 없습니다. `npm run worker` 로 실행하세요.</Empty>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {stats.worker.map((worker) => (
                  <li key={worker.id} className="flex flex-wrap items-center gap-2">
                    <span className="badge" style={{ color: worker.alive ? 'var(--success)' : 'var(--danger)' }}>
                      {worker.alive ? '🟢 정상' : '🔴 중단'}
                    </span>
                    <code className="text-xs">{worker.id}</code>
                    <span className="text-[var(--text-muted)]">
                      provider={worker.provider} · 사이클 {worker.cyclesCompleted} · 조회{' '}
                      {worker.groupsChecked} · 최근 {new Date(worker.lastBeatAt).toLocaleTimeString('ko-KR')}
                    </span>
                    {worker.lastError ? (
                      <span className="text-xs" style={{ color: 'var(--danger)' }}>
                        {worker.lastError}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="최근 좌석 확인">
            <Table
              head={['시각', '노선', '날짜', '결과', '열차', '소요']}
              rows={stats.recentChecks.map((check) => [
                new Date(check.startedAt).toLocaleTimeString('ko-KR'),
                check.route,
                check.travelDate ?? '-',
                check.status === 'OK' ? '✅' : `❌ ${check.errorMessage ?? ''}`,
                String(check.trainsFound),
                `${check.durationMs}ms`,
              ])}
            />
          </Panel>

          <Panel title="최근 좌석 상태 변화">
            <Table
              head={['시각', '노선', '열차', '좌석', '변화']}
              rows={stats.recentEvents.map((event) => [
                new Date(event.occurredAt).toLocaleTimeString('ko-KR'),
                event.route,
                event.trainNo,
                event.seatClass === 'GENERAL' ? '일반실' : '특실',
                `${SEAT_STATUS_LABELS[event.fromStatus]} → ${SEAT_STATUS_LABELS[event.toStatus]}`,
              ])}
            />
          </Panel>

          <Panel title="최근 알림 발송">
            <Table
              head={['시각', '열차', '채널', '상태', '내용']}
              rows={stats.recentNotifications.map((log) => [
                new Date(log.sentAt).toLocaleTimeString('ko-KR'),
                log.trainNo,
                log.channel === 'WEB_PUSH' ? '푸시' : '이메일',
                log.status === 'SENT' ? '✅ 발송' : log.status === 'FAILED' ? `❌ ${log.error ?? ''}` : `⏭ ${log.error ?? ''}`,
                log.body.split('\n').slice(0, 2).join(' / '),
              ])}
            />
          </Panel>

          <Panel title="최근 오류">
            <Table
              head={['시각', 'provider', '노선', '메시지']}
              rows={stats.recentErrors.map((err) => [
                new Date(err.startedAt).toLocaleTimeString('ko-KR'),
                err.provider,
                err.route,
                err.errorMessage,
              ])}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub ? <p className="text-xs text-[var(--text-muted)]">{sub}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-3 text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--text-muted)]">{children}</p>;
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <Empty>기록이 없습니다.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead>
          <tr className="text-[var(--text-muted)]">
            {head.map((cell) => (
              <th key={cell} className="pb-2 pr-3 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-[var(--border)]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-2 pr-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
