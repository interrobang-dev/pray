import type { OfficeLayout, Rect } from './officeLayout'

/**
 * 도트 사무실 꾸미기 (순수 함수, 좌표는 officeLayout.ts 와 같은 타일). 배치 결과(officeLayout)는 바꾸지 않고
 * 그 빈 자리에 소품을 시드로 놓는다. 같은 배치·시드·테마면 늘 같은 꾸밈이다 (모든 화면이 hq.json 의 시드·테마를 본다)
 */

/** 서버 host/src/hq.ts 의 DECOR_THEMES 와 손으로 맞춘다 */
export type DecorThemeId = 'office' | 'cafe' | 'forest' | 'winter'

export interface OfficeDecor {
  seed: number
  theme: DecorThemeId
}

/** 옛 서버 응답(꾸밈 없음)일 때. 서버 DEFAULT_DECOR 와 같다 */
export const DEFAULT_DECOR: OfficeDecor = { seed: 1, theme: 'office' }

export interface DecorTheme {
  id: DecorThemeId
  label: string
  /** 바닥 소품 id → 뽑힐 무게 */
  floor: Record<string, number>
  /** 벽 장식 id → 뽑힐 무게 */
  wall: Record<string, number>
  /** 빈 바닥 칸 중 소품을 놓으려는 비율 */
  density: number
  /** 벽 창 칸 중 장식을 거는 비율 */
  wallRate: number
  /** 바닥·그룹 카펫·섬 러그·Focus Zone 카펫에 곱할 색 (null = 그대로) */
  tint: { floor: number | null; groupFloor: number | null; rug: number | null; focusCarpet: number | null }
}

export const DECOR_THEMES: DecorTheme[] = [
  {
    id: 'office',
    label: '기본',
    floor: {
      'plant-snake': 3,
      'plant-large': 3,
      'plant-small': 2,
      'water-cooler': 2,
      'coffee-machine': 1,
      'trash-bin': 2,
      'floor-lamp': 2,
      lockers: 1,
      printer: 1,
      'coat-rack': 1,
      'bookshelf-tall': 1,
      'bookshelf-low': 1,
      sofa: 1,
      armchair: 1,
    },
    wall: { 'wall-whiteboard': 3, 'wall-corkboard': 3, 'wall-clock': 2, 'wall-landscape': 1, 'wall-poster': 1, 'wall-photos': 1 },
    density: 0.06,
    wallRate: 0.3,
    tint: { floor: null, groupFloor: null, rug: null, focusCarpet: null },
  },
  {
    id: 'cafe',
    label: '카페',
    floor: {
      'coffee-machine': 3,
      sofa: 3,
      armchair: 3,
      'cafe-sign': 2,
      'floor-lamp': 2,
      'plant-small': 2,
      'plant-large': 1,
      'coat-rack': 1,
      'bookshelf-low': 1,
      'trash-bin': 1,
    },
    wall: { 'wall-photos': 3, 'wall-landscape': 2, 'wall-poster': 2, 'wall-clock': 2, 'wall-corkboard': 1 },
    density: 0.07,
    wallRate: 0.35,
    tint: { floor: 0xf6d9b8, groupFloor: 0xf7dfc4, rug: 0xf2d4b0, focusCarpet: 0xffe6cc },
  },
  {
    id: 'forest',
    label: '숲',
    floor: {
      monstera: 4,
      'plant-large': 4,
      'plant-snake': 3,
      'plant-small': 3,
      armchair: 1,
      'bookshelf-tall': 1,
      'floor-lamp': 1,
      'water-cooler': 1,
    },
    wall: { 'wall-landscape': 4, 'wall-photos': 2, 'wall-corkboard': 1, 'wall-poster': 1 },
    density: 0.09,
    wallRate: 0.3,
    tint: { floor: 0xd8ebcc, groupFloor: 0xdcefd4, rug: 0xcfe6c2, focusCarpet: 0xe3f0d2 },
  },
  {
    id: 'winter',
    label: '겨울',
    floor: {
      'xmas-tree': 3,
      gifts: 3,
      'coat-rack': 2,
      'floor-lamp': 2,
      armchair: 2,
      sofa: 1,
      'coffee-machine': 1,
      'plant-small': 1,
    },
    wall: { 'wall-clock': 2, 'wall-photos': 2, 'wall-landscape': 2, 'wall-corkboard': 1 },
    density: 0.07,
    wallRate: 0.3,
    tint: { floor: 0xdde8f6, groupFloor: 0xeaf1fb, rug: 0xe2ecf8, focusCarpet: 0xe6edf8 },
  },
]

export function themeOf(id: string | undefined): DecorTheme {
  return DECOR_THEMES.find((theme) => theme.id === id) ?? DECOR_THEMES[0]
}

/** 소품 id → 차지하는 타일 크기 (그림 크기를 타일로 올림. 화면은 아틀라스 텍스처 크기로 만든다) */
export type PropSizes = Record<string, { w: number; h: number }>

/**
 * 바닥 소품: 차지하는 타일 사각형 (그림은 아래 가운데에 붙인다). groupId 가 있으면 그 그룹 안 (그룹을 끌 때 같이 움직인다).
 * y = -1 은 벽 앞 바닥 줄(그룹·섬이 놓이는 y 0 위의 1타일)이라 h 가 늘 1 이고 그림은 벽을 덮고 올라간다
 */
export interface FloorDecor extends Rect {
  prop: string
  groupId: string | null
}

/** 벽 장식: 벽 타일 반복 칸(창 하나) 번호. 칸 k 는 world 타일 x 3k..3k+2 = 배치 타일 x 3k-1..3k+1 (PAD_X 가 1타일) */
export interface WallDecor {
  prop: string
  bay: number
}

export interface DecorPlan {
  floor: FloorDecor[]
  wall: WallDecor[]
}

/** 벽 칸 하나 = 3타일. 배치 타일 x 로 바꿀 때 PAD_X(1타일)를 뺀다 */
export const WALL_BAY_TILES = 3

export function bayRange(bay: number): { x: number; w: number } {
  return { x: bay * WALL_BAY_TILES - 1, w: WALL_BAY_TILES }
}

/** 시드 난수 (mulberry32) */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(weights: Record<string, number>, sizes: PropSizes, next: () => number): string | null {
  const entries = Object.entries(weights).filter(([id, weight]) => weight > 0 && sizes[id])
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = next() * total
  for (const [id, weight] of entries) {
    roll -= weight
    if (roll < 0) return id
  }
  return entries.at(-1)?.[0] ?? null
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 꾸밈 계획. 소품을 놓는 곳:
 * - 벽: 창 칸 중 wallRate 만큼 (이웃 칸은 비운다). 화면이 그 창 유리를 벽으로 메우고 장식을 건다
 * - 벽 앞 바닥 줄(y -1, x 0 ~ 내용 오른쪽 끝): 장식을 건 칸 앞은 비운다 (키 큰 소품이 장식을 가린다)
 * - 열린 바닥: 그룹·로비 바깥, 내용 왼쪽 위 ~ 로비 왼쪽·내용 아래 끝 (Off Duty 띠·맵 오른쪽 여분은 쓰지 않는다)
 * - 그룹 안: 위 줄(이름표·화분·메모)·왼쪽·오른쪽 파티션 줄·아래 걸레받이 줄을 뺀 안쪽에서 섬 둘레 1타일(팀 이름표·첫 줄 말풍선 자리) 밖
 * 그룹이 지워진 팀의 섬도 둘레 1타일까지 피한다. 소품끼리는 1타일 띄운다
 */
export function planDecor(layout: OfficeLayout, decor: OfficeDecor, sizes: PropSizes, wallBayCount: number): DecorPlan {
  const theme = themeOf(decor.theme)
  const next = random(decor.seed)

  const wall: WallDecor[] = []
  for (let bay = 0; bay < wallBayCount; bay++) {
    if (wall.at(-1)?.bay === bay - 1) continue
    if (next() >= theme.wallRate) continue
    const prop = pick(theme.wall, sizes, next)
    if (prop) wall.push({ prop, bay })
  }

  /** 칸 "x,y" → 그 칸이 속한 곳 ('floor' = 열린 바닥, 'wall' = 벽 앞 줄, 그 밖은 그룹 id) */
  const regions = new Map<string, string>()
  const groupIds = new Set(layout.groupAreas.map((area) => area.group.id))
  const orphanIslands = layout.islands.filter((island) => !groupIds.has(island.team.groupId)).map((island) => inflate(island, 1))
  const isInside = (x: number, y: number, rect: Rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  for (let y = 0; y < layout.bottom; y++) {
    for (let x = 0; x < layout.lobby.x; x++) {
      if (layout.groupAreas.some((area) => isInside(x, y, area)) || orphanIslands.some((rect) => isInside(x, y, rect))) continue
      regions.set(`${x},${y}`, 'floor')
    }
  }
  for (const area of layout.groupAreas) {
    const blocked = layout.islands.filter((island) => island.team.groupId === area.group.id).map((island) => inflate(island, 1))
    for (let y = area.y + 1; y < area.y + area.h - 1; y++) {
      for (let x = area.x + 1; x < area.x + area.w - 1; x++) {
        if (blocked.some((rect) => isInside(x, y, rect))) continue
        regions.set(`${x},${y}`, area.group.id)
      }
    }
  }
  const wallBlocked = wall.map((item) => bayRange(item.bay))
  const islandRims = layout.islands.map((island) => inflate(island, 1))
  for (let x = 0; x < layout.right; x++) {
    if (wallBlocked.some((range) => x >= range.x && x < range.x + range.w)) continue
    // 섬이 맨 위에 붙어 있으면 첫 줄 말풍선이 이 줄까지 올라온다
    if (islandRims.some((rect) => isInside(x, -1, rect))) continue
    regions.set(`${x},-1`, 'wall')
  }

  const floor: FloorDecor[] = []
  const target = Math.round(regions.size * theme.density)
  for (const key of shuffle([...regions.keys()], next)) {
    if (floor.length >= target) break
    const [x, y] = key.split(',').map(Number)
    const region = regions.get(key)!
    const prop = pick(theme.floor, sizes, next)
    if (!prop) break
    const size = sizes[prop]
    const rect = { x, y, w: size.w, h: region === 'wall' ? 1 : size.h }
    let isFree = true
    for (let cy = rect.y; cy < rect.y + rect.h && isFree; cy++) {
      for (let cx = rect.x; cx < rect.x + rect.w && isFree; cx++) isFree = regions.get(`${cx},${cy}`) === region
    }
    if (!isFree || floor.some((item) => overlaps(inflate(item, 1), rect))) continue
    floor.push({ ...rect, prop, groupId: region === 'floor' || region === 'wall' ? null : region })
  }
  return { floor, wall }
}
