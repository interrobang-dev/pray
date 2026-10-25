import { describe, expect, it } from 'vitest'
import {
  DESK_WALL_DECOR,
  MAX_WALL_DECOR_RUN,
  PARTITION_W,
  WALL_BAY_TILES,
  WIDE_DESK_ZONE_TILES,
  cornerFixtures,
  deskItems,
  groupFixtures,
  loungeFixtures,
  loungeTableCount,
  wallFixtures,
  type Fixture,
  type PropSizes,
  type WallFixture,
} from './officeFixtures'
import { LOUNGE_MIN_H, layoutOffice, type Rect } from './officeLayout'
import type { Group, Office, Session, Team } from './types'

/** office-v5-props 의 실제 크기 (도트 px) */
const SIZES: PropSizes = {
  'water-cooler': { w: 30, h: 78 },
  printer: { w: 44, h: 60 },
  'trash-bin': { w: 20, h: 24 },
  cabinet: { w: 62, h: 102 },
  fridge: { w: 48, h: 100 },
  'counter-left': { w: 64, h: 63 },
  'counter-mid': { w: 64, h: 62 },
  'counter-right': { w: 64, h: 63 },
  'coffee-machine': { w: 40, h: 60 },
  'plant-large': { w: 56, h: 97 },
  'lounge-table-set': { w: 144, h: 132 },
  'side-table': { w: 44, h: 72 },
  sofa: { w: 144, h: 75 },
  armchair: { w: 72, h: 75 },
  'coffee-table': { w: 96, h: 57 },
  planter: { w: 144, h: 70 },
  'rug-navy': { w: 192, h: 86 },
}
/** 데스크존 위 이름표 줄의 office-v2 큰 화분 */
const ENV_SIZES: PropSizes = { 'plant-large': { w: 42, h: 48 } }
const ITEMS = ['item-mug', 'item-pen-cup', 'item-papers', 'item-sticky-notes', 'item-mug-navy', 'item-succulent', 'item-notebook', 'item-desk-clock']

/** 소품 그림이 차지하는 사각형 (도트 px) */
const boxOf = (fixture: Fixture): Rect => {
  const size = (fixture.sheet === 'env' ? ENV_SIZES : SIZES)[fixture.prop]
  return { x: fixture.x - size.w / 2, y: fixture.y - size.h, w: size.w, h: size.h }
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const px = (rect: Rect): Rect => ({ x: rect.x * 48, y: rect.y * 48, w: rect.w * 48, h: rect.h * 48 })

const group = (id: string, x: number, y = 0): Group => ({ id, name: id, x, y, w: 9, h: 7 })
const team = (id: string, groupId: string, x: number, y = 2): Team => ({
  id,
  name: id,
  cwd: `D:/${id}`,
  groupId,
  x,
  y,
  desks: {},
  parts: [],
  partOf: {},
  createdAt: '2026-10-22T10:00:00.000Z',
})
const members = (teamId: string, count: number): Session[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${teamId}-${index}`, teamId, attendance: 'present' }) as Session)

describe('벽 장식', () => {
  const [WHITEBOARD, CORKBOARD, POSTER, PHOTOS] = DESK_WALL_DECOR
  const CLOCK = { sheet: 'props', prop: 'wall-clock' }
  const LANDSCAPE = { sheet: 'props', prop: 'wall-landscape' }
  /** 데스크존(그룹 영역)만 손으로 놓은 배치. Focus Zone·라운지는 데스크존들 오른쪽 멀리 */
  const spaces = (areas: Rect[]) => ({
    groupAreas: areas.map((area) => ({ ...area, group: group('g', area.x, area.y), origin: { x: area.x, y: area.y } })),
    lobby: { x: 100, y: 0, w: 8, h: 10 },
    lounge: { x: 109, y: 0, w: 10, h: 10 },
  })
  /** 데스크존 장식만 칸 순서대로 (Focus Zone·라운지 것은 뺀다) */
  const deskDecor = (fixtures: WallFixture[]) =>
    fixtures
      .filter((fixture) => fixture.bay < 33)
      .sort((a, b) => a.bay - b.bay)
      .map(({ bay, prop }) => [bay, prop])
  /** 그 칸(3타일)이 공간 안에 든다 (padTiles 1) */
  const isBayInside = (bay: number, rect: Rect) => bay * WALL_BAY_TILES - 1 >= rect.x && bay * WALL_BAY_TILES - 1 + WALL_BAY_TILES <= rect.x + rect.w
  /** 가장 길게 이어진 장식 칸 수 */
  const longestRun = (fixtures: WallFixture[]) => {
    const bays = new Set(fixtures.map((fixture) => fixture.bay))
    let longest = 0
    for (const bay of bays) {
      if (bays.has(bay - 1)) continue
      let run = 1
      while (bays.has(bay + run)) run++
      longest = Math.max(longest, run)
    }
    return longest
  }
  /** wallFixtures (padTiles 1) + 어느 배치에서든 장식 칸이 MAX_WALL_DECOR_RUN 보다 길게 이어지지 않는다 */
  const place = (layout: Parameters<typeof wallFixtures>[0]) => {
    const fixtures = wallFixtures(layout, 1)
    expect(longestRun(fixtures)).toBeLessThanOrEqual(MAX_WALL_DECOR_RUN)
    return fixtures
  }

  it('공간마다 그 가운데가 든 창 칸: 데스크존은 화이트보드부터 돌아가며, Focus Zone 시계, 라운지 풍경화', () => {
    const office: Office = { groups: [group('g1', 0), group('g2', 12)], teams: [] }
    const layout = layoutOffice(office, [])
    const fixtures = place(layout)
    const centerBay = (rect: Rect) => Math.floor((1 + rect.x + rect.w / 2) / WALL_BAY_TILES)
    expect(fixtures).toEqual([
      { ...WHITEBOARD, bay: centerBay(layout.groupAreas[0]) },
      { ...CORKBOARD, bay: centerBay(layout.groupAreas[1]) },
      { ...CLOCK, bay: centerBay(layout.lobby) },
      { ...LANDSCAPE, bay: centerBay(layout.lounge) },
    ])
    for (const [index, rect] of [...layout.groupAreas, layout.lobby, layout.lounge].entries()) expect(isBayInside(fixtures[index].bay, rect)).toBe(true)
  })

  it('데스크존은 왼쪽부터 화이트보드 → 게시판 → 포스터 → 액자를 돌아가며 건다 (그룹 목록 순서와 관계없이)', () => {
    const areas = [40, 10, 30, 0, 20].map((x) => ({ x, y: 0, w: 9, h: 8 }))
    expect(deskDecor(place(spaces(areas)))).toEqual([
      [1, WHITEBOARD.prop],
      [5, CORKBOARD.prop],
      [8, POSTER.prop],
      [11, PHOTOS.prop],
      [15, WHITEBOARD.prop],
    ])
  })

  it('폭이 창 칸 4개 이상인 데스크존은 공간 위 가운데 연속 두 칸에 순서상 다음 둘, 그보다 좁으면 한 칸', () => {
    const areas = [
      { x: 0, y: 0, w: 9, h: 8 },
      { x: 10, y: 0, w: WIDE_DESK_ZONE_TILES, h: 8 },
      { x: 23, y: 0, w: WIDE_DESK_ZONE_TILES - 1, h: 8 },
    ]
    expect(deskDecor(place(spaces(areas)))).toEqual([
      [1, WHITEBOARD.prop],
      [5, CORKBOARD.prop],
      [6, POSTER.prop],
      [9, PHOTOS.prop],
    ])
    // 어느 위치·폭이든 두 칸은 이웃하고 공간 안이며, 두 칸 사이 기둥은 공간 가운데에서 1.5타일 안
    for (let x = 0; x < 6; x++) {
      for (let w = WIDE_DESK_ZONE_TILES; w <= 30; w++) {
        const area = { x, y: 0, w, h: 8 }
        const bays = place(spaces([area]))
          .filter((fixture) => fixture.bay < 33)
          .map((fixture) => fixture.bay)
        expect(bays, `x ${x} w ${w}`).toHaveLength(2)
        expect(bays[1] - bays[0]).toBe(1)
        for (const bay of bays) expect(isBayInside(bay, area), `x ${x} w ${w} 칸 ${bay}`).toBe(true)
        expect(Math.abs(bays[1] * WALL_BAY_TILES - (1 + x + w / 2))).toBeLessThanOrEqual(1.5)
      }
    }
  })

  it('같은 칸을 둘이 가리키면 왼쪽(같으면 위) 공간 것만이고, 못 건 데스크존은 순서를 넘기지 않는다', () => {
    // 위아래로 쌓은 두 그룹은 가운데가 같은 칸이다 (목록에서는 아래 그룹이 먼저)
    const office: Office = { groups: [group('low', 0, 20), group('high', 0, 0), group('right', 12)], teams: [] }
    const layout = layoutOffice(office, [])
    const fixtures = place(layout)
    const high = layout.groupAreas[1]
    expect(fixtures.filter((f) => f.prop === WHITEBOARD.prop)).toEqual([{ ...WHITEBOARD, bay: Math.floor((1 + high.x + high.w / 2) / WALL_BAY_TILES) }])
    // 오른쪽 그룹은 순서상 다음(게시판)을 받는다
    expect(fixtures.find((f) => isBayInside(f.bay, layout.groupAreas[2]))?.prop).toBe(CORKBOARD.prop)
    expect(new Set(fixtures.map((f) => f.bay)).size).toBe(fixtures.length)
  })

  it('넓은 데스크존의 두 칸 중 하나를 위 공간이 이미 가졌으면 남은 한 칸에만', () => {
    // 둘째 칸이 먼저 걸린 경우: 위 보통 그룹이 2, 아래 넓은 그룹의 두 칸은 1·2
    expect(
      deskDecor(
        place(
          spaces([
            { x: 0, y: 0, w: 11, h: 8 },
            { x: 0, y: 10, w: 12, h: 8 },
          ]),
        ),
      ),
    ).toEqual([
      [1, CORKBOARD.prop],
      [2, WHITEBOARD.prop],
    ])
    // 첫째 칸이 먼저 걸린 경우: 위 보통 그룹이 1, 아래 넓은 그룹의 두 칸은 1·2
    expect(
      deskDecor(
        place(
          spaces([
            { x: 0, y: 0, w: 9, h: 8 },
            { x: 0, y: 10, w: 12, h: 8 },
          ]),
        ),
      ),
    ).toEqual([
      [1, WHITEBOARD.prop],
      [2, CORKBOARD.prop],
    ])
  })

  it('넓은 그룹 둘을 위아래로 쌓으면 아래 그룹은 남은 칸을 받지 않는다 (장식 칸이 세 칸 이어지므로) — 순서도 넘기지 않는다', () => {
    // 위 넓은 그룹이 4·5, 아래 넓은 그룹의 두 칸은 3·4: 4 는 걸림, 3 에 걸면 3·4·5 가 이어진다
    expect(
      deskDecor(
        place(
          spaces([
            { x: 0, y: 0, w: 27, h: 8 },
            { x: 0, y: 10, w: 23, h: 8 },
            { x: 30, y: 0, w: 9, h: 8 },
          ]),
        ),
      ),
    ).toEqual([
      [4, WHITEBOARD.prop],
      [5, CORKBOARD.prop],
      [11, POSTER.prop],
    ])
  })

  it('Focus Zone·라운지도 걸면 장식 칸이 세 칸 이어지는 칸은 받지 않는다', () => {
    // 넓은 그룹이 1·2, Focus Zone 가운데 칸 3, 라운지 가운데 칸 5
    const fixtures = place({
      groupAreas: [{ x: 0, y: 0, w: 12, h: 8, group: group('g', 0), origin: { x: 0, y: 0 } }],
      lobby: { x: 5, y: 10, w: 8, h: 10 },
      lounge: { x: 9, y: 20, w: 10, h: 10 },
    })
    expect(fixtures.map(({ bay, prop }) => [bay, prop])).toEqual([
      [1, WHITEBOARD.prop],
      [2, CORKBOARD.prop],
      [5, LANDSCAPE.prop],
    ])
  })

  it('이웃 칸에 같은 소품이 있으면 순서상 그다음 것을 건다', () => {
    const fixtures = place(
      spaces([
        { x: 0, y: 0, w: 9, h: 8 }, // 1 화이트보드
        { x: 0, y: 10, w: 30, h: 8 }, // 4·5 게시판·포스터
        { x: 0, y: 20, w: 42, h: 8 }, // 6·7 중 6 은 4·5·6 이 이어져 건너뛰고 7 액자
        { x: 1, y: 30, w: 9, h: 8 }, // 2: 순서는 화이트보드지만 왼쪽 1 이 화이트보드 → 게시판
        { x: 40, y: 0, w: 9, h: 8 }, // 15: 게시판 다음인 포스터
      ]),
    )
    expect(deskDecor(fixtures)).toEqual([
      [1, WHITEBOARD.prop],
      [2, CORKBOARD.prop],
      [4, CORKBOARD.prop],
      [5, POSTER.prop],
      [7, PHOTOS.prop],
      [15, POSTER.prop],
    ])
  })

  it('여러 배치에서 칸마다 장식 하나, 이웃 칸(번호 차이 1)에 같은 소품이 없고, 장식 칸은 두 칸까지만 이어진다', () => {
    // 고정 난수 (LCG)
    let seed = 7
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 300; round++) {
      const areas = Array.from({ length: 6 + random(5) }, () => ({ x: random(40), y: random(4) * 10, w: 9 + random(20), h: 8 }))
      const fixtures = place(spaces(areas))
      const byBay = new Map(fixtures.map((fixture) => [fixture.bay, fixture.prop]))
      expect(byBay.size).toBe(fixtures.length)
      for (const [bay, prop] of byBay) expect(byBay.get(bay + 1), `round ${round} 칸 ${bay}`).not.toBe(prop)
    }
  })
})

describe('맵 왼쪽 위 코너', () => {
  it('벽과 내용 사이 줄·왼쪽 여백 열 안에 정수기·복합기·휴지통 (내용 y 0 위, 맵 왼쪽 끝 안)', () => {
    const fixtures = cornerFixtures(1)
    expect(fixtures.map((f) => f.prop)).toEqual(['water-cooler', 'printer', 'trash-bin'])
    const boxes = fixtures.map(boxOf)
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(-48)
      expect(box.y + box.h).toBeLessThanOrEqual(0)
    }
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(overlaps(a, b)).toBe(false)
  })
})

describe('데스크존 이름표 줄', () => {
  /** 짧은 이름표 + TODO 버튼이 차지하는 오른쪽 끝 (도트 px) */
  const SHORT_LABEL_RIGHT = 120

  it('큰 화분 하나만 위 이름표 줄(1타일) 오른쪽 끝에 놓여 오른쪽 파티션 안이고, 어느 섬(밀린 것·오른쪽 끝에 닿은 것 포함)과도 겹치지 않는다', () => {
    const cases: [Office, Session[]][] = [
      // 큰 섬이 오른쪽 위 끝, 아래 섬이 왼쪽 아래 끝에 닿는다 (C 는 A 와 겹쳐 오른쪽으로 밀린다)
      [
        { groups: [group('g1', 0)], teams: [team('A', 'g1', 2), team('B', 'g1', 10), team('C', 'g1', 2, 9)] },
        [...members('A', 14), ...members('B', 3), ...members('C', 9)],
      ],
      [
        { groups: [group('g1', 0)], teams: [team('A', 'g1', 2), team('B', 'g1', 10), team('C', 'g1', 2, 9), team('D', 'g1', 14, 14)] },
        [...members('A', 2), ...members('B', 14), ...members('C', 9), ...members('D', 4)],
      ],
      // 가장 좁은 그룹: 지휘자 없는 섬 하나 (5타일)
      [{ groups: [group('g1', 0)], teams: [team('A', 'g1', 2)] }, members('A', 1)],
    ]
    for (const [office, sessions] of cases) {
      const layout = layoutOffice(office, sessions)
      const [area] = layout.groupAreas
      const fixtures = groupFixtures(area, SHORT_LABEL_RIGHT)
      expect(fixtures.map((f) => f.prop)).toEqual(['plant-large'])
      const box = boxOf(fixtures[0])
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(area.w * 48 - PARTITION_W)
      expect(box.y + box.h).toBeLessThanOrEqual(48)
      // 섬 사각형 전체 (명판·받침·화분 열·윗사람 머리가 다 이 안이다)
      for (const island of layout.islands) expect(overlaps(box, px({ ...island, x: island.x - area.x, y: island.y - area.y }))).toBe(false)
    }
  })

  it('이름표·TODO 버튼이 화분 자리에 닿으면(좁은 그룹·긴 이름) 화분을 두지 않고, 둘 때는 버튼 오른쪽 끝과 겹치지 않는다', () => {
    const area = (w: number): Rect => ({ x: 0, y: 0, w, h: 7 })
    for (const w of [5, 7, 9, 14]) {
      for (let labelRight = 60; labelRight <= w * 48; labelRight += 6) {
        const fixtures = groupFixtures(area(w), labelRight)
        if (fixtures.length === 0) continue
        expect(boxOf(fixtures[0]).x).toBeGreaterThan(labelRight)
      }
    }
    // 5타일(240) 그룹: 짧은 이름이면 있고, 긴 이름이면 없다
    expect(groupFixtures(area(5), 150)).toHaveLength(1)
    expect(groupFixtures(area(5), 190)).toEqual([])
  })
})

describe('라운지', () => {
  const lounge = (h: number): Rect => ({ x: 30, y: 0, w: 10, h })

  it('탕비 줄은 이름표(왼쪽 위 2타일) 오른쪽부터 오른쪽 벽까지 같은 바닥선에 겹치지 않게 이어 붙는다', () => {
    const fixtures = loungeFixtures(lounge(LOUNGE_MIN_H), SIZES)
    const kitchen = fixtures.filter((f) => f.y === 80)
    expect(kitchen.map((f) => f.prop)).toEqual(['water-cooler', 'coffee-machine', 'counter-left', 'counter-mid', 'counter-right', 'fridge', 'cabinet'])
    const boxes = kitchen.map(boxOf)
    expect(boxes[0].x).toBeGreaterThanOrEqual(96)
    expect(boxes.at(-1)!.x + boxes.at(-1)!.w).toBe(480 - 9)
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBe(boxes[i - 1].x + boxes[i - 1].w)
  })

  it('최소 높이에 원탁 둘, 높이가 늘면 원탁만 는다 (지그재그 두 열)', () => {
    expect(loungeTableCount(LOUNGE_MIN_H)).toBe(2)
    expect(loungeTableCount(14)).toBeGreaterThan(2)
    const tables = (h: number) => loungeFixtures(lounge(h), SIZES).filter((f) => f.prop === 'lounge-table-set')
    const others = (h: number) => loungeFixtures(lounge(h), SIZES).filter((f) => f.prop !== 'lounge-table-set').map((f) => f.prop)
    expect(others(20)).toEqual(others(LOUNGE_MIN_H))
    const many = tables(20)
    expect(many).toHaveLength(loungeTableCount(20))
    expect(new Set(many.filter((_, index) => index % 2 === 0).map((f) => f.x)).size).toBe(1)
    expect(many[0].x).not.toBe(many[1].x)
  })

  it('높이마다 모든 소품이 라운지 파티션 안이고 (키 큰 수납장·냉장고·정수기만 위 파티션에 걸친다) 러그 말고는 서로 겹치지 않는다', () => {
    for (const h of [LOUNGE_MIN_H, 11, 13, 17, 30]) {
      const fixtures = loungeFixtures(lounge(h), SIZES)
      expect(fixtures[0].prop).toBe('rug-navy')
      const boxes = fixtures.slice(1).map((f) => ({ prop: f.prop, box: boxOf(f) }))
      for (const { prop, box } of [{ prop: 'rug-navy', box: boxOf(fixtures[0]) }, ...boxes]) {
        expect(box.x).toBeGreaterThanOrEqual(9)
        expect(box.x + box.w).toBeLessThanOrEqual(480 - 9)
        expect(box.y + box.h).toBeLessThanOrEqual(h * 48 - 9)
        expect(box.y).toBeGreaterThanOrEqual(['cabinet', 'fridge', 'water-cooler'].includes(prop) ? -30 : 12)
      }
      // 소파 띠(소파·낮은 테이블·안락의자·조명 탁자)는 한 묶음이라 서로 겹쳐도 되고, 묶음 밖과는 겹치지 않는다
      const sofaSet = ['sofa', 'coffee-table', 'armchair', 'side-table']
      for (const a of boxes) {
        for (const b of boxes) {
          if (a === b || (sofaSet.includes(a.prop) && sofaSet.includes(b.prop))) continue
          expect(overlaps(a.box, b.box), `${h}: ${a.prop} / ${b.prop}`).toBe(false)
        }
      }
    }
  })
})

describe('책상 소품', () => {
  it('같은 세션은 늘 같은 소품·자리이고 1~2개, 둘이면 서로 다른 소품이 왼쪽·오른쪽에', () => {
    const counts = new Set<number>()
    for (let index = 0; index < 50; index++) {
      const id = `session-${index}`
      const items = deskItems(id, 'bottom', false, ITEMS)
      expect(deskItems(id, 'bottom', false, ITEMS)).toEqual(items)
      expect(items.length).toBeGreaterThanOrEqual(1)
      expect(items.length).toBeLessThanOrEqual(2)
      counts.add(items.length)
      for (const item of items) expect(ITEMS).toContain(item.prop)
      if (items.length === 2) {
        expect(items[0].prop).not.toBe(items[1].prop)
        expect(items[0].x).not.toBe(items[1].x)
      }
    }
    // 하나인 사람도 둘인 사람도 있다
    expect(counts).toEqual(new Set([1, 2]))
  })

  it('윗자리는 윗책상 상판(블록 y 52~82), 아랫자리는 아랫책상 상판(y 101~126), 짝 칸막이(x 0~5) 밖', () => {
    for (let index = 0; index < 30; index++) {
      for (const [side, top, bottom] of [
        ['top', 52, 82],
        ['bottom', 101, 126],
      ] as const) {
        for (const item of deskItems(`s${index}`, side, false, ITEMS)) {
          expect(item.y).toBeGreaterThan(top)
          expect(item.y).toBeLessThanOrEqual(bottom)
          expect(item.x - 11).toBeGreaterThan(5)
          expect(item.x + 11).toBeLessThan(96)
        }
      }
    }
  })

  it('외부 세션 윗자리는 오른쪽 명패를 피해 왼쪽에 하나만, 소품 목록이 없으면 없다', () => {
    for (let index = 0; index < 20; index++) {
      const items = deskItems(`ext-${index}`, 'top', true, ITEMS)
      expect(items).toHaveLength(1)
      expect(items[0].x).toBeLessThan(48)
    }
    expect(deskItems('any', 'top', false, [])).toEqual([])
  })
})
