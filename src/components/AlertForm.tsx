'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, type ConfigResponse } from '@/lib/client/api';
import { isPushSupported, setupPush, showLocalTestNotification } from '@/lib/client/push';
import { toKstDateString } from '@/lib/time';
import { SEAT_CLASS_VALUES, TRAIN_TYPE_VALUES } from '@/lib/validation';
import type { StationDto } from '@/types/api';
import { StationSelect } from './StationSelect';
import { ChipGroup, Field, Notice, Spinner } from './ui';

const TRAIN_TYPE_OPTIONS = [
  { value: 'KTX', label: 'KTX' },
  { value: 'KTX_SANCHEON', label: 'KTX-산천' },
  { value: 'KTX_EUM', label: 'KTX-이음' },
  { value: 'KTX_CHEONGRYONG', label: 'KTX-청룡' },
  { value: 'ITX_SAEMAEUL', label: 'ITX-새마을' },
] as const satisfies readonly { value: (typeof TRAIN_TYPE_VALUES)[number]; label: string }[];

const SEAT_CLASS_OPTIONS = [
  { value: 'GENERAL', label: '일반실' },
  { value: 'FIRST', label: '특실' },
] as const satisfies readonly { value: (typeof SEAT_CLASS_VALUES)[number]; label: string }[];

type TrainTypeValue = (typeof TRAIN_TYPE_OPTIONS)[number]['value'];
type SeatClassValue = (typeof SEAT_CLASS_OPTIONS)[number]['value'];
type Channel = 'WEB_PUSH' | 'EMAIL';

export function AlertForm() {
  const router = useRouter();
  const [stations, setStations] = useState<StationDto[]>([]);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => toKstDateString(new Date()), []);
  const [departureStationCode, setDeparture] = useState('SEOUL');
  const [arrivalStationCode, setArrival] = useState('BUSAN');
  const [travelDate, setTravelDate] = useState(today);
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('22:00');
  const [passengerCount, setPassengerCount] = useState(1);
  const [trainTypes, setTrainTypes] = useState<TrainTypeValue[]>(['KTX', 'KTX_SANCHEON']);
  const [seatClasses, setSeatClasses] = useState<SeatClassValue[]>(['GENERAL']);
  const [channels, setChannels] = useState<Channel[]>(['WEB_PUSH']);
  const [email, setEmail] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [stationsRes, configRes] = await Promise.all([api.getStations(), api.getConfig()]);
        if (cancelled) return;
        setStations(stationsRes.stations);
        setConfig(configRes);
        if (!configRes.pushEnabled) setChannels(configRes.emailEnabled ? ['EMAIL'] : ['WEB_PUSH']);
      } catch (error) {
        if (!cancelled) {
          setFormError(error instanceof Error ? error.message : '초기 데이터를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxDate = useMemo(() => {
    const days = config?.maxDaysAhead ?? 60;
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }, [config?.maxDaysAhead, today]);

  const swapStations = (): void => {
    setDeparture(arrivalStationCode);
    setArrival(departureStationCode);
  };

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      // 푸시를 선택했다면 먼저 권한/구독을 확보한다(사용자 제스처 컨텍스트 유지).
      if (channels.includes('WEB_PUSH')) {
        const result = await setupPush(config?.pushPublicKey ?? null);
        if (!result.ok) {
          setPushMessage(`웹 푸시를 사용할 수 없습니다: ${result.message}`);
          if (!channels.includes('EMAIL')) {
            setFormError(
              '웹 푸시를 사용할 수 없어 알림을 등록할 수 없습니다. 이메일 알림을 함께 선택해 주세요.',
            );
            setSubmitting(false);
            return;
          }
        } else {
          setPushMessage(null);
        }
      }

      await api.createAlert({
        departureStationCode,
        arrivalStationCode,
        travelDate,
        startTime,
        endTime,
        passengerCount,
        trainTypes,
        seatClasses,
        channels,
        ...(channels.includes('EMAIL') && email ? { email } : {}),
      });

      if (channels.includes('WEB_PUSH')) await showLocalTestNotification();
      router.push('/alerts');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.details ?? {});
        setFormError(error.message);
      } else {
        setFormError(error instanceof Error ? error.message : '알림 등록에 실패했습니다.');
      }
    } finally {
      setSubmitting(false);
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
    <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
      {config?.provider.notice ? <Notice>{config.provider.notice}</Notice> : null}

      <div className="card flex flex-col gap-4">
        <Field label="출발역" htmlFor="departure" error={errors.departureStationCode}>
          <StationSelect
            id="departure"
            value={departureStationCode}
            stations={stations}
            onChange={setDeparture}
            placeholder="출발역 선택"
          />
        </Field>

        <div className="flex justify-center">
          <button
            type="button"
            className="btn btn-ghost px-3 py-2 text-sm"
            onClick={swapStations}
            aria-label="출발역과 도착역 바꾸기"
          >
            ⇅ 바꾸기
          </button>
        </div>

        <Field label="도착역" htmlFor="arrival" error={errors.arrivalStationCode}>
          <StationSelect
            id="arrival"
            value={arrivalStationCode}
            stations={stations}
            onChange={setArrival}
            placeholder="도착역 선택"
          />
        </Field>
      </div>

      <div className="card flex flex-col gap-4">
        <Field
          label="날짜"
          htmlFor="travelDate"
          error={errors.travelDate}
          hint={`오늘부터 ${config?.maxDaysAhead ?? 60}일 후까지 등록할 수 있습니다.`}
        >
          <input
            id="travelDate"
            type="date"
            className="field"
            value={travelDate}
            min={today}
            max={maxDate}
            onChange={(event) => setTravelDate(event.target.value)}
          />
        </Field>

        <Field label="출발 시간대" htmlFor="startTime" error={errors.endTime ?? errors.startTime}>
          <div className="flex items-center gap-2">
            <input
              id="startTime"
              type="time"
              className="field min-w-0 flex-1"
              value={startTime}
              step={600}
              onChange={(event) => setStartTime(event.target.value)}
            />
            <span aria-hidden className="text-[var(--text-muted)]">
              ~
            </span>
            <input
              aria-label="종료 시간"
              type="time"
              className="field min-w-0 flex-1"
              value={endTime}
              step={600}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </div>
        </Field>

        <Field label="승객" htmlFor="passengerCount" error={errors.passengerCount}>
          <select
            id="passengerCount"
            className="field"
            value={passengerCount}
            onChange={(event) => setPassengerCount(Number(event.target.value))}
          >
            {Array.from({ length: 9 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                성인 {count}명
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="card flex flex-col gap-4">
        <Field label="열차 종류" error={errors.trainTypes}>
          <ChipGroup
            name="열차 종류"
            options={TRAIN_TYPE_OPTIONS}
            value={trainTypes}
            onChange={setTrainTypes}
          />
        </Field>

        <Field
          label="좌석"
          error={errors.seatClasses}
          hint="선택한 등급 중 하나라도 좌석이 생기면 알려드립니다."
        >
          <ChipGroup
            name="좌석 등급"
            options={SEAT_CLASS_OPTIONS}
            value={seatClasses}
            onChange={setSeatClasses}
          />
        </Field>
      </div>

      <div className="card flex flex-col gap-4">
        <Field label="알림 방식" error={errors.channels}>
          <ChipGroup
            name="알림 방식"
            options={[
              { value: 'WEB_PUSH' as const, label: '웹 푸시' },
              { value: 'EMAIL' as const, label: '이메일' },
            ]}
            value={channels}
            onChange={setChannels}
          />
        </Field>

        {!config?.pushEnabled ? (
          <Notice>서버에 VAPID 키가 없어 웹 푸시가 비활성화되어 있습니다.</Notice>
        ) : null}
        {!isPushSupported() && channels.includes('WEB_PUSH') ? (
          <Notice>
            이 브라우저는 웹 푸시를 지원하지 않습니다. iOS 는 홈 화면에 추가한 뒤 사용할 수 있습니다.
          </Notice>
        ) : null}
        {pushMessage ? <Notice>{pushMessage}</Notice> : null}

        {channels.includes('EMAIL') ? (
          <Field
            label="이메일"
            htmlFor="email"
            error={errors.email}
            hint="알림 발송 용도로만 사용하며, 알림을 삭제하면 함께 지울 수 있습니다."
          >
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              placeholder="you@example.com"
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="error-text text-sm">
          {formError}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full py-4 text-lg" disabled={submitting}>
        {submitting ? '등록 중…' : '🔔 좌석 알림 시작'}
      </button>
    </form>
  );
}
