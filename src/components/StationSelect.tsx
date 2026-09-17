'use client';

import type { StationDto } from '@/types/api';

/** 역 선택 드롭다운. 모바일에서는 네이티브 select 가 가장 쓰기 좋다. */
export function StationSelect({
  id,
  value,
  stations,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  stations: readonly StationDto[];
  onChange: (code: string) => void;
  placeholder: string;
}) {
  return (
    <select
      id={id}
      className="field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {stations.map((station) => (
        <option key={station.code} value={station.code}>
          {station.name}
        </option>
      ))}
    </select>
  );
}
