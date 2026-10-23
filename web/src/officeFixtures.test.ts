import { describe, expect, it } from 'vitest'
import {
  WALL_BAY_TILES,
  cornerFixtures,
  deskItems,
  groupFixtures,
  loungeFixtures,
  loungeTableCount,
  wallFixtures,
  type Fixture,
  type PropSizes,
} from './officeFixtures'
import { LOUNGE_MIN_H, layoutOffice, type Rect } from './officeLayout'
import type { Group, Office, Session, Team } from './types'

/** office-v5-props 의 실제 크기 (도트 px) + 데스크존 모서리의 office-v2 화분 */
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
const ENV_SIZES: PropSizes = { 'plant-large': { w: 42, h: 48 }, 'plant-small': { w: 24, h: 33 } }
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
  it('공간마다 그 가운데가 든 창 칸에 하나: 데스크존 화이트보드, Focus Zone 시계, 라운지 풍경화', () => {
    const office: Office = { groups: [group('g1', 0), group('g2', 12)], teams: [] }
    const layout = layoutOffice(office, [])
    const fixtures = wallFixtures(layout, 1)
    const centerBay = (rect: Rect) => Math.floor((1 + rect.x + rect.w / 2) / WALL_BAY_TILES)
    expect(fixtures).toEqual([
      { prop: 'wall-whiteboard', bay: centerBay(layout.groupAreas[0]) },
      { prop: 'wall-whiteboard', bay: centerBay(layout.groupAreas[1]) },
      { prop: 'wall-clock', bay: centerBay(layout.lobby) },
      { prop: 'wall-landscape', bay: centerBay(layout.lounge) },
    ])
    // 창 칸(3타일)이 그 공간 안에 든다
    for (const [index, rect] of [...layout.groupAreas, layout.lobby, layout.lounge].entries()) {
      const bayLeft = fixtures[index].bay * WALL_BAY_TILES - 1
      expect(bayLeft).toBeGreaterThanOrEqual(rect.x)
      expect(bayLeft + WALL_BAY_TILES).toBeLessThanOrEqual(rect.x + rect.w)
    }
  })

  it('같은 칸을 둘이 가리키면 왼쪽(같으면 위) 공간 것만', () => {
    // 위아래로 쌓은 두 그룹은 가운데가 같은 칸이다
    const office: Office = { groups: [group('low', 0, 20), group('high', 0, 0)], teams: [] }
    const fixtures = wallFixtures(layoutOffice(office, []), 1)
    expect(fixtures.filter((f) => f.prop === 'wall-whiteboard')).toHaveLength(1)
    expect(new Set(fixtures.map((f) => f.bay)).size).toBe(fixtures.length)
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

describe('데스크존 모서리', () => {
  /** 섬이 실제로 그리는 경계 (도트 px, 그룹 영역 기준): 섬 사각형에서 받침·머리·의자가 안 닿는 테두리(왼쪽 24·위 30·오른쪽 36·아래 24)를 뺀 것 */
  const drawnIslands = (office: Office, sessions: Session[]) => {
    const layout = layoutOffice(office, sessions)
    const [area] = layout.groupAreas
    const islands = layout.islands.map((island) => {
      const rect = px({ ...island, x: island.x - area.x, y: island.y - area.y })
      return { x: rect.x + 24, y: rect.y + 30, w: rect.w - 60, h: rect.h - 54 }
    })
    return { area, islands }
  }

  it('그룹 영역 안, 섬(밀린 것 포함)과 겹치지 않는 둘레 고리에 화분 둘·휴지통', () => {
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
    ]
    for (const [office, sessions] of cases) {
      const { area, islands } = drawnIslands(office, sessions)
      const fixtures = groupFixtures(area)
      expect(fixtures.map((f) => f.prop)).toEqual(['plant-large', 'plant-small', 'trash-bin'])
      for (const box of fixtures.map(boxOf)) {
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w).toBeLessThanOrEqual(area.w * 48)
        expect(box.y + box.h).toBeLessThanOrEqual(area.h * 48)
        for (const island of islands) expect(overlaps(box, island)).toBe(false)
      }
    }
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
