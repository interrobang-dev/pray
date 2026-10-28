import { hashOf } from './dotCharacter'
import type { OfficeLayout, Rect } from './officeLayout'

/**
 * 고정 꾸미기 (순수 함수). 배치 결과(officeLayout.ts 의 섬 밀기 뒤 좌표)만 보고 늘 같은 자리에 놓는다 — 시드·무작위 없음.
 * 놓는 곳은 모두 그 공간이 늘 비워 두는 자리라 섬 밀기·그룹 이동·끌기와 겹치지 않는다. 통로(열린 바닥)는 그룹을 끌어 놓을 자리라 비운다.
 * 좌표는 도트 px (타일 48), 소품 그림의 아래 가운데. 기준점은 함수마다 다르다 (라운지·그룹 영역·짝의 왼쪽 위, 배치 원점)
 */

const TILE = 48
/** 데스크존·라운지 낮은 벽(파티션) 두께 (도트 px). 그리기(Office.tsx)도 이 값으로 그린다 */
export const PARTITION_W = 9

export interface Fixture {
  /** props = office-v5-props 의 prop/<prop>, env = office-v2 의 prop/<prop>, wall = office-v5-wall 의 prop/<prop> */
  sheet: 'props' | 'env' | 'wall'
  prop: string
  /** 그림 아래 가운데 (도트 px) */
  x: number
  y: number
}

/** office-v5-props 소품 크기 (도트 px). 이어 붙이는 탕비 줄만 폭을 쓴다 */
export type PropSizes = Record<string, { w: number; h: number }>

// ---------- 벽 ----------

/** 벽 창 칸 폭 (타일) = 벽 타일 144 도트 px. 칸 i 는 맵 왼쪽 끝에서 3i 타일부터 */
export const WALL_BAY_TILES = 3
/** 이 폭(타일) 이상인 데스크존은 가운데 두 칸에 건다 (창 칸 4개) */
export const WIDE_DESK_ZONE_TILES = 4 * WALL_BAY_TILES
/** 장식 칸이 이어지는 최대 수 (이은 벽은 두 칸까지) */
export const MAX_WALL_DECOR_RUN = 2

export interface WallFixture {
  sheet: Fixture['sheet']
  prop: string
  bay: number
}

/** 데스크존 벽 장식: 왼쪽 데스크존부터 이 순서로 돌아가며 건다 */
export const DESK_WALL_DECOR: Pick<WallFixture, 'sheet' | 'prop'>[] = [
  { sheet: 'props', prop: 'wall-whiteboard' },
  { sheet: 'wall', prop: 'wall-corkboard' },
  { sheet: 'wall', prop: 'wall-poster' },
  { sheet: 'wall', prop: 'wall-photos' },
]

/**
 * 공간마다 벽 장식: Focus Zone = 시계, 라운지 = 풍경화, 데스크존(그룹) = 왼쪽부터(x, 같으면 y) DESK_WALL_DECOR 를 돌아가며.
 * 그 공간 가운데가 든 창 칸에 하나. 폭이 창 칸 4개 이상인 데스크존은 두 칸 사이 기둥이 공간 가운데에 가장 가까운 연속 두 칸
 * (늘 공간 안이다)에 순서상 다음 둘을 건다. 같은 칸을 둘이 가리키면 왼쪽(같으면 위) 공간 것만이고, 걸면 장식 칸이
 * MAX_WALL_DECOR_RUN 보다 길게 이어지는 칸도 건너뛴다 (모든 공간 같은 규칙. 먼저 건 것이 이긴다). 못 건 칸은 순서를 넘기지 않는다.
 * 이웃 칸(번호 차이 1)에 같은 소품이 이미 있으면 순서상 그다음 것을 건다. 나머지 칸은 창 그대로. padTiles = 배치 원점이 맵 왼쪽 끝에서 떨어진 타일 수
 */
export function wallFixtures(layout: Pick<OfficeLayout, 'groupAreas' | 'lobby' | 'lounge'>, padTiles: number): WallFixture[] {
  const spaces: { rect: Rect; decor: Pick<WallFixture, 'sheet' | 'prop'> | null }[] = [
    ...layout.groupAreas.map((area) => ({ rect: area, decor: null })),
    { rect: layout.lobby, decor: { sheet: 'props', prop: 'wall-clock' } },
    { rect: layout.lounge, decor: { sheet: 'props', prop: 'wall-landscape' } },
  ]
  spaces.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y)
  const fixtures: WallFixture[] = []
  const propAt = (bay: number) => fixtures.find((fixture) => fixture.bay === bay)?.prop
  // 그 칸에 걸면 이어지는 장식 칸 수 (그 칸 포함)
  const runWith = (bay: number) => {
    let left = bay - 1
    while (propAt(left) !== undefined) left--
    let right = bay + 1
    while (propAt(right) !== undefined) right++
    return right - left - 1
  }
  // 데스크존 순서에서 다음에 걸 소품
  let next = 0
  for (const { rect, decor } of spaces) {
    const center = (padTiles + rect.x + rect.w / 2) / WALL_BAY_TILES
    const pairRight = Math.round(center)
    const bays = !decor && rect.w >= WIDE_DESK_ZONE_TILES ? [pairRight - 1, pairRight] : [Math.floor(center)]
    for (const bay of bays) {
      if (propAt(bay) !== undefined || runWith(bay) > MAX_WALL_DECOR_RUN) continue
      if (decor) {
        fixtures.push({ ...decor, bay })
        continue
      }
      const neighbors = [propAt(bay - 1), propAt(bay + 1)]
      let index = next
      while (neighbors.includes(DESK_WALL_DECOR[index % DESK_WALL_DECOR.length].prop)) index++
      fixtures.push({ ...DESK_WALL_DECOR[index % DESK_WALL_DECOR.length], bay })
      next = (index + 1) % DESK_WALL_DECOR.length
    }
  }
  return fixtures
}

// ---------- 맵 왼쪽 위 코너 ----------

/**
 * 맵 왼쪽 위 벽 앞 = 정수기·복합기·휴지통 코너 (배치 원점 기준). 벽과 내용 사이 줄(y −1 타일)과 왼쪽 여백 열(x −1 타일)은
 * 내용이 y·x 0 부터라 늘 빈다. 키 큰 그림은 벽 아래쪽에 겹쳐 그려진다
 */
export function cornerFixtures(padTiles: number): Fixture[] {
  const left = -padTiles * TILE
  return [
    { sheet: 'props', prop: 'water-cooler', x: left + 22, y: -4 },
    { sheet: 'props', prop: 'printer', x: left + 66, y: -4 },
    { sheet: 'props', prop: 'trash-bin', x: left + 104, y: -6 },
  ]
}

// ---------- 데스크존 ----------

/** 데스크존 위 줄 큰 화분(office-v2 plant-large, 폭 42): 그룹 오른쪽 끝에서 그림 가운데까지와 그림 반폭 (도트 px) */
const GROUP_PLANT_FROM_RIGHT = 36
const GROUP_PLANT_HALF_W = 21
/** 이름표 오른쪽 끝과 화분 사이에 남길 틈 (도트 px). 이름표의 마우스 올림 테두리(3px 밖)도 닿지 않게 */
const GROUP_PLANT_GAP = 6

/**
 * 데스크존 위 이름표 줄 (그룹 영역 왼쪽 위 기준). 그룹 영역 = 섬들 + 위 이름표 줄 1타일이라 이 줄에는 섬이 오지 않는다.
 * 왼쪽은 그룹 이름표, 오른쪽 끝 큰 화분. 화분 아래 끝을 줄 아래 끝에 맞춰 어느 섬과도 겹치지 않는다 (위는 파티션에 걸친다).
 * labelRight = 이름표가 차지한 오른쪽 끝 (도트 px). 화분이 거기에 닿으면(좁은 그룹·긴 이름) 화분을 두지 않는다.
 * 왼쪽·오른쪽·아래는 섬 테두리가 그룹 벽에 닿아 소품을 둘 자리가 없다
 */
export function groupFixtures(area: Rect, labelRight: number): Fixture[] {
  const x = area.w * TILE - GROUP_PLANT_FROM_RIGHT
  if (x - GROUP_PLANT_HALF_W < labelRight + GROUP_PLANT_GAP) return []
  return [{ sheet: 'env', prop: 'plant-large', x, y: TILE }]
}

// ---------- 라운지 ----------

/** 탕비 줄 소품 아래 끝 (모두 같은 바닥선에 선다. 카운터 윗면이 위 파티션에 닿고 냉장고·수납장은 파티션 위로 조금 나온다) */
const KITCHEN_FLOOR = 80
/** 탕비 줄: 오른쪽 끝(구석)부터 키 큰 수납장·냉장고 → 카운터(왼쪽 끝·싱크·주전자) → 커피머신(받침장째 바닥)·정수기. 왼쪽 끝은 이름표 자리 */
const KITCHEN_FROM_RIGHT = ['cabinet', 'fridge', 'counter-right', 'counter-mid', 'counter-left', 'coffee-machine', 'water-cooler']
/** 원탁 세트(원탁 + 의자 4): 참고 그림처럼 두 열을 번갈아 지그재그로 놓는다 (왼쪽 열부터). 열 가운데 x, 세트 높이, 다음 세트까지 세로 간격(같은 열은 두 배) */
const TABLE_COLUMNS = [136, 334]
const TABLE_SET_H = 132
const TABLE_STEP = 100
/** 원탁이 들어가는 구역 위 끝 (탕비 줄 아래) */
const TABLES_TOP = KITCHEN_FLOOR + 12
/** 소파 띠: 라운지 아래 끝에서 이만큼 위가 러그 아래 끝, 띠 위 끝(소파 등받이)은 아래 끝에서 SOFA_BAND_H */
const SOFA_FLOOR_FROM_BOTTOM = 14
const SOFA_BAND_H = 133

/** 탕비 줄과 소파 띠 사이 원탁 구역 높이 (도트 px) */
function tableRegion(heightTiles: number): number {
  return heightTiles * TILE - SOFA_BAND_H - 8 - TABLES_TOP
}

/** 라운지 원탁 세트 수: 원탁 구역에 지그재그로 들어가는 만큼 (최소 1). 라운지가 길어지면 이것만 는다 */
export function loungeTableCount(heightTiles: number): number {
  return Math.max(1, Math.floor((tableRegion(heightTiles) - TABLE_SET_H) / TABLE_STEP) + 1)
}

/**
 * 라운지 안 (라운지 왼쪽 위 기준, 그리는 순서): 바닥 러그 → 아래 끝이 위인 것부터.
 * 위 파티션을 따라 탕비 줄, 그 아래 오른쪽 벽에 큰 화분, 가운데 원탁 세트 지그재그 두 열(높이가 늘면 세트만 늘고 묶음은 구역 세로 가운데),
 * 맨 아래 남색 러그 위 소파·낮은 테이블과 옆 안락의자·조명 탁자, 오른쪽 아래 긴 화분
 */
export function loungeFixtures(lounge: Rect, sizes: PropSizes): Fixture[] {
  const w = lounge.w * TILE
  const h = lounge.h * TILE
  const props = (prop: string, x: number, y: number): Fixture => ({ sheet: 'props', prop, x, y })
  const items: Fixture[] = []
  let right = w - PARTITION_W
  for (const prop of KITCHEN_FROM_RIGHT) {
    const width = sizes[prop]?.w ?? TILE
    items.push(props(prop, right - width / 2, KITCHEN_FLOOR))
    right -= width
  }
  items.push(props('plant-large', w - PARTITION_W - 32, KITCHEN_FLOOR + 100))
  const count = loungeTableCount(lounge.h)
  const top = TABLES_TOP + Math.max(0, tableRegion(lounge.h) - (count - 1) * TABLE_STEP - TABLE_SET_H) / 2
  for (let index = 0; index < count; index++) {
    items.push(props('lounge-table-set', TABLE_COLUMNS[index % 2], Math.round(top + index * TABLE_STEP + TABLE_SET_H)))
  }
  const floor = h - SOFA_FLOOR_FROM_BOTTOM
  items.push(
    props('side-table', 40, floor - 44),
    props('sofa', 150, floor - 44),
    props('armchair', 262, floor - 26),
    props('coffee-table', 150, floor - 4),
    props('planter', w - 88, floor - 4),
  )
  items.sort((a, b) => a.y - b.y || a.x - b.x)
  return [props('rug-navy', 160, floor), ...items]
}

// ---------- 책상 소품 ----------

/**
 * 칸막이 블록 짝 안 책상 소품 자리 (짝 왼쪽 위 = 블록 원점 + 96·i 기준, 아래 가운데. 블록 모듈은 y 48 부터).
 * 윗자리 = 윗책상 상판의 모니터 뒷면 왼쪽·오른쪽, 아랫자리 = 아랫책상 상판의 모니터·키보드 왼쪽·오른쪽 (사람 머리·팔 바깥)
 */
const DESK_ITEM_SLOTS: Record<'top' | 'bottom', { x: number; y: number }[]> = {
  top: [
    { x: 17, y: 81 },
    { x: 83, y: 81 },
  ],
  bottom: [
    { x: 17, y: 124 },
    { x: 84, y: 124 },
  ],
}

/**
 * 팀원 책상 위 개인 소품 1~2개: 세션 ID 해시로 고른다 (같은 세션은 늘 같은 소품·같은 자리, 사람을 따라다닌다). items = 소품 이름 목록 (아틀라스 meta).
 * 외부 세션의 윗자리는 오른쪽 상판에 명패가 있어 왼쪽에 하나만. 빈 자리·지휘자 자리에는 부르지 않는다
 */
export function deskItems(sessionId: string, side: 'top' | 'bottom', isExternal: boolean, items: string[]): Fixture[] {
  if (items.length === 0) return []
  const hash = hashOf(sessionId)
  const slots = DESK_ITEM_SLOTS[side]
  if (isExternal && side === 'top') return [{ sheet: 'props', prop: items[hash % items.length], ...slots[0] }]
  const first = hash % items.length
  const picked = [first]
  if (items.length > 1 && (hash >>> 4) % 2 === 1) picked.push((first + 1 + ((hash >>> 8) % (items.length - 1))) % items.length)
  // 하나면 왼쪽·오른쪽 중 하나, 둘이면 첫 소품이 그 자리이고 둘째가 반대쪽
  const firstSlot = (hash >>> 12) % 2
  return picked.map((index, order) => ({ sheet: 'props', prop: items[index], ...slots[(firstSlot + order) % 2] }))
}
