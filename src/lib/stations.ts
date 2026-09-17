/**
 * 역 마스터 데이터.
 *
 * 주의: 이 서비스는 내부 코드(예: "SEOUL")를 사용한다.
 * 코레일/SRT 등 실제 제공처는 각자의 역 코드 체계(예: NAT 코드)를 쓰므로,
 * 실제 provider 를 붙일 때 provider 내부에서 매핑 테이블을 갖는다.
 * (근거 없는 외부 코드값을 이 파일에 하드코딩하지 않는다.)
 *
 * lines 의 km 값은 노선 기점으로부터의 대략적인 영업거리이며,
 * MockTrainProvider 가 그럴듯한 소요시간을 만들기 위해서만 사용한다.
 */

export const RAIL_LINES = {
  GYEONGBU: '경부선',
  HONAM: '호남선',
  JEOLLA: '전라선',
  GYEONGJEON: '경전선',
  DONGHAE: '동해선',
  GANGNEUNG: '강릉선',
  JUNGANG: '중앙선',
} as const;

export type RailLine = keyof typeof RAIL_LINES;

export interface Station {
  /** 서비스 내부 코드 */
  code: string;
  name: string;
  /** 이 역이 속한 노선과 기점으로부터의 대략적 거리(km) */
  lines: Partial<Record<RailLine, number>>;
}

export const STATIONS: readonly Station[] = [
  { code: 'SEOUL', name: '서울', lines: { GYEONGBU: 0, GANGNEUNG: 0 } },
  { code: 'YONGSAN', name: '용산', lines: { HONAM: 0, JEOLLA: 0 } },
  { code: 'CHEONGRYANGNI', name: '청량리', lines: { GANGNEUNG: 9, JUNGANG: 0 } },
  { code: 'SANGBONG', name: '상봉', lines: { GANGNEUNG: 14, JUNGANG: 5 } },
  { code: 'GWANGMYEONG', name: '광명', lines: { GYEONGBU: 22, HONAM: 22 } },
  { code: 'SUWON', name: '수원', lines: { GYEONGBU: 42 } },
  { code: 'CHEONAN_ASAN', name: '천안아산', lines: { GYEONGBU: 96, HONAM: 96 } },
  { code: 'OSONG', name: '오송', lines: { GYEONGBU: 129, HONAM: 129 } },
  { code: 'DAEJEON', name: '대전', lines: { GYEONGBU: 166 } },
  { code: 'GIMCHEON_GUMI', name: '김천구미', lines: { GYEONGBU: 253 } },
  { code: 'DONGDAEGU', name: '동대구', lines: { GYEONGBU: 294, DONGHAE: 0, GYEONGJEON: 0 } },
  { code: 'GYEONGJU', name: '경주', lines: { GYEONGBU: 355, DONGHAE: 61 } },
  { code: 'ULSAN', name: '울산(통도사)', lines: { GYEONGBU: 391 } },
  { code: 'BUSAN', name: '부산', lines: { GYEONGBU: 442 } },
  { code: 'GUPO', name: '구포', lines: { GYEONGBU: 425 } },
  { code: 'POHANG', name: '포항', lines: { DONGHAE: 71 } },
  { code: 'MIRYANG', name: '밀양', lines: { GYEONGBU: 347, GYEONGJEON: 53 } },
  { code: 'JINYEONG', name: '진영', lines: { GYEONGJEON: 84 } },
  { code: 'CHANGWONJUNGANG', name: '창원중앙', lines: { GYEONGJEON: 102 } },
  { code: 'CHANGWON', name: '창원', lines: { GYEONGJEON: 111 } },
  { code: 'MASAN', name: '마산', lines: { GYEONGJEON: 118 } },
  { code: 'JINJU', name: '진주', lines: { GYEONGJEON: 168 } },
  { code: 'GONGJU', name: '공주', lines: { HONAM: 179 } },
  { code: 'IKSAN', name: '익산', lines: { HONAM: 240, JEOLLA: 240 } },
  { code: 'JEONGEUP', name: '정읍', lines: { HONAM: 286 } },
  { code: 'GWANGJUSONGJEONG', name: '광주송정', lines: { HONAM: 351 } },
  { code: 'NAJU', name: '나주', lines: { HONAM: 368 } },
  { code: 'MOKPO', name: '목포', lines: { HONAM: 407 } },
  { code: 'JEONJU', name: '전주', lines: { JEOLLA: 264 } },
  { code: 'NAMWON', name: '남원', lines: { JEOLLA: 314 } },
  { code: 'GOKSEONG', name: '곡성', lines: { JEOLLA: 337 } },
  { code: 'SUNCHEON', name: '순천', lines: { JEOLLA: 371 } },
  { code: 'YEOSU_EXPO', name: '여수엑스포', lines: { JEOLLA: 415 } },
  { code: 'YANGPYEONG', name: '양평', lines: { GANGNEUNG: 56, JUNGANG: 36 } },
  { code: 'SEOWONJU', name: '서원주', lines: { GANGNEUNG: 96, JUNGANG: 86 } },
  { code: 'MANJONG', name: '만종', lines: { GANGNEUNG: 103 } },
  { code: 'HOENGSEONG', name: '횡성', lines: { GANGNEUNG: 118 } },
  { code: 'DUNNAE', name: '둔내', lines: { GANGNEUNG: 141 } },
  { code: 'PYEONGCHANG', name: '평창', lines: { GANGNEUNG: 166 } },
  { code: 'JINBU', name: '진부(오대산)', lines: { GANGNEUNG: 186 } },
  { code: 'GANGNEUNG', name: '강릉', lines: { GANGNEUNG: 223 } },
  { code: 'JECHEON', name: '제천', lines: { JUNGANG: 130 } },
  { code: 'DANYANG', name: '단양', lines: { JUNGANG: 152 } },
  { code: 'PUNGGI', name: '풍기', lines: { JUNGANG: 170 } },
  { code: 'YEONGJU', name: '영주', lines: { JUNGANG: 180 } },
  { code: 'ANDONG', name: '안동', lines: { JUNGANG: 211 } },
] as const;

const STATION_BY_CODE = new Map(STATIONS.map((s) => [s.code, s]));

export function getStation(code: string): Station | undefined {
  return STATION_BY_CODE.get(code);
}

export function getStationName(code: string): string {
  return STATION_BY_CODE.get(code)?.name ?? code;
}

export function isKnownStation(code: string): boolean {
  return STATION_BY_CODE.has(code);
}

export interface RouteInfo {
  line: RailLine;
  distanceKm: number;
  /** 하행(기점에서 멀어지는 방향)이면 true */
  downward: boolean;
}

/**
 * 두 역이 같은 노선 위에 있는지 확인하고 거리/방향을 돌려준다.
 * 직결 노선이 없으면 undefined (= 직통 열차가 없는 조합).
 */
export function findRoute(fromCode: string, toCode: string): RouteInfo | undefined {
  const from = getStation(fromCode);
  const to = getStation(toCode);
  if (!from || !to || from.code === to.code) return undefined;

  let best: RouteInfo | undefined;
  for (const [line, fromKm] of Object.entries(from.lines) as [RailLine, number][]) {
    const toKm = to.lines[line];
    if (toKm === undefined) continue;
    const distanceKm = Math.abs(toKm - fromKm);
    if (distanceKm === 0) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { line, distanceKm, downward: toKm > fromKm };
    }
  }
  return best;
}
