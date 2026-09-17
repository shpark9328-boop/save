import { NextResponse } from 'next/server';
import { STATIONS } from '@/lib/stations';
import type { StationDto } from '@/types/api';

export const runtime = 'nodejs';

/** 역 목록 (정적 데이터) */
export function GET(): NextResponse<{ stations: StationDto[] }> {
  const stations: StationDto[] = STATIONS.map((station) => ({
    code: station.code,
    name: station.name,
  }));
  return NextResponse.json({ stations });
}
