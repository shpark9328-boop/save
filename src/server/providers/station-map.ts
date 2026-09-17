import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * 서비스 내부 역 코드 -> 외부 제공처 역 코드 매핑.
 *
 * 외부 제공처(코레일 NAT 코드, TAGO nodeId 등)의 코드값은 공식 문서/데이터셋에서
 * 받아와야 하는 값이므로 소스코드에 추측값을 하드코딩하지 않는다.
 * 운영자가 PROVIDER_STATION_MAP_PATH 로 JSON 파일을 제공한다.
 *
 * 파일 형식:
 * {
 *   "SEOUL": "NAT010000",
 *   "BUSAN": "NAT014445"
 * }
 */

const stationMapSchema = z.record(z.string(), z.string().min(1));

export type ProviderStationMap = Record<string, string>;

const cache = new Map<string, ProviderStationMap>();

export function loadStationMap(path: string | undefined): ProviderStationMap {
  if (!path) return {};
  const cached = cache.get(path);
  if (cached) return cached;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `역 코드 매핑 파일을 읽을 수 없습니다: ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const parsed = stationMapSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`역 코드 매핑 파일 형식이 올바르지 않습니다: ${path}`);
  }
  cache.set(path, parsed.data);
  return parsed.data;
}

export function clearStationMapCache(): void {
  cache.clear();
}
