'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/client/api';
import { formatKoreanDate } from '@/lib/time';
import { SEAT_CLASS_LABELS, TRAIN_TYPE_LABELS } from '@/server/providers/types';
import type { AlertDto, ProviderInfo } from '@/types/api';
import { Notice, Spinner } from './ui';

/** 내 알림 목록 + 일시정지/삭제 */
export function AlertList() {
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await api.listAlerts();
      setAlerts(response.alerts);
      setProvider(response.provider);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '알림을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 좌석 상태는 워커가 갱신하므로 주기적으로 목록만 새로고침한다.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function toggle(alert: AlertDto): Promise<void> {
    setBusyId(alert.id);
    try {
      await api.setAlertEnabled(alert.id, !alert.enabled);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '상태를 변경하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(alert: AlertDto): Promise<void> {
    if (!window.confirm('이 알림을 삭제할까요?')) return;
    setBusyId(alert.id);
    try {
      await api.deleteAlert(alert.id);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '삭제하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {provider?.notice ? <Notice>{provider.notice}</Notice> : null}
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}

      {alerts.length === 0 ? (
        <div className="card text-center">
          <p className="mb-4 text-[var(--text-muted)]">등록된 알림이 없습니다.</p>
          <Link className="btn btn-primary" href="/">
            알림 등록하러 가기
          </Link>
        </div>
      ) : null}

      {alerts.map((alert) => (
        <article key={alert.id} className="card flex flex-col gap-3">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">
                {alert.departureStationName} → {alert.arrivalStationName}
              </h2>
              <p className="text-sm text-[var(--text-muted)]">
                {formatKoreanDate(alert.travelDate)} · {alert.startTime} ~ {alert.endTime}
              </p>
            </div>
            <StatusBadge alert={alert} />
          </header>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-[var(--text-muted)]">열차</dt>
              <dd>{alert.trainTypes.map((type) => TRAIN_TYPE_LABELS[type]).join(', ')}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--text-muted)]">좌석</dt>
              <dd>{alert.seatClasses.map((seat) => SEAT_CLASS_LABELS[seat]).join(', ')}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--text-muted)]">승객</dt>
              <dd>{alert.passengerCount}명</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--text-muted)]">알림</dt>
              <dd>
                {alert.channels.map((c) => (c === 'WEB_PUSH' ? '웹 푸시' : '이메일')).join(', ')}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-[var(--text-muted)]">
            {alert.lastCheckedAt
              ? `최근 확인 ${new Date(alert.lastCheckedAt).toLocaleString('ko-KR')}`
              : '아직 확인 기록이 없습니다.'}
            {alert.notificationCount > 0
              ? ` · 알림 ${alert.notificationCount}회 발송`
              : ''}
            {alert.availableNow > 0 ? ` · 현재 조건 충족 ${alert.availableNow}건` : ''}
          </p>

          <footer className="flex gap-2">
            <button
              type="button"
              className="btn btn-ghost flex-1 py-2 text-sm"
              disabled={busyId === alert.id || alert.expired}
              onClick={() => void toggle(alert)}
            >
              {alert.enabled ? '⏸ 일시정지' : '▶ 다시 시작'}
            </button>
            <button
              type="button"
              className="btn btn-danger flex-1 py-2 text-sm"
              disabled={busyId === alert.id}
              onClick={() => void remove(alert)}
            >
              🗑 삭제
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}

function StatusBadge({ alert }: { alert: AlertDto }) {
  if (alert.expired) return <span className="badge">⚪ 만료됨</span>;
  if (!alert.enabled) return <span className="badge">⏸ 일시정지</span>;
  return (
    <span className="badge" style={{ color: 'var(--success)' }}>
      🟢 모니터링 중
    </span>
  );
}
