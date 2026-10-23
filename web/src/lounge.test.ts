import { describe, expect, it } from 'vitest'
import atlas from '../public/office/office-v5-props.json'
import { LOUNGE_MORE_AT, overflowNames, planLounge, type LoungeMeta, type LoungePerson } from './lounge'
import { figureRect } from './offDutyStreet'
import { loungeFixtures, loungeTableCount, type PropSizes } from './officeFixtures'

const sizes: PropSizes = Object.fromEntries(
  Object.entries(atlas.frames)
    .filter(([name]) => name.startsWith('prop/'))
    .map(([name, frame]) => [name.slice(5), { w: frame.frame.w, h: frame.frame.h }]),
)

/** 시험용 자리 메타 (실제 메타와 값은 다르다). 원탁은 배열 순서와 y 순서를 일부러 다르게 둔다 */
const META: LoungeMeta = {
  seats: {
    'lounge-table-set': [
      { dir: 'up', x: 0, y: -4, front: [[40, 60, 64, 30]] },
      { dir: 'down', x: 0, y: -90 },
      { dir: 'right', x: -50, y: -40 },
      { dir: 'left', x: 50, y: -40 },
    ],
    sofa: [
      { dir: 'down', x: -40, y: -12 },
      { dir: 'down', x: 0, y: -12 },
      { dir: 'down', x: 40, y: -12, front: [[100, 30, 44, 45]] },
    ],
    armchair: [{ dir: 'down', x: 0, y: -12 }],
  },
  sideOffsetY: { idle: { member: -4, lead: -6 }, doze: { member: 2 } },
}
const SEATS_AT_H10 = 2 * 4 + 3 + 1

const LOUNGE = { x: 30, y: 0, w: 10, h: 10 }
const fixtures = loungeFixtures(LOUNGE, sizes)
const tables = fixtures.flatMap((fixture, index) => (fixture.prop === 'lounge-table-set' ? [index] : []))
const sofa = fixtures.findIndex((fixture) => fixture.prop === 'sofa')
const armchair = fixtures.findIndex((fixture) => fixture.prop === 'armchair')

const T0 = Date.parse('2026-10-23T10:00:00.000Z')
/** i 번째 사람: 번호가 작을수록 최근에 차례가 끝났다 */
const people = (count: number, patch: Partial<LoungePerson> = {}): LoungePerson[] =>
  Array.from({ length: count }, (_, i) => ({ id: `s${String(i).padStart(2, '0')}`, endedAt: T0 - i * 60_000, state: 'idle', character: 'member', ...patch }))

describe('planLounge', () => {
  it('높이 10 라운지는 원탁 2개 + 소파 + 안락의자', () => {
    expect(loungeTableCount(10)).toBe(2)
    expect(tables).toHaveLength(2)
    expect(sofa).toBeGreaterThan(-1)
    expect(armchair).toBeGreaterThan(-1)
  })

  it('자리 순서: 원탁들(소품 순서, 원탁마다 메타 배열 순서) → 소파 → 안락의자에 최근 사람부터', () => {
    const plan = planLounge(META, fixtures, sizes, people(SEATS_AT_H10))
    const seatOf = new Map(plan.seats.map((seat) => [seat.sessionId, seat]))
    const expected: [number, number][] = [
      ...tables.flatMap((table) => [0, 1, 2, 3].map((i): [number, number] => [table, i])),
      ...[0, 1, 2].map((i): [number, number] => [sofa, i]),
      [armchair, 0],
    ]
    expected.forEach(([fixtureIndex, metaIndex], person) => {
      const seat = seatOf.get(`s${String(person).padStart(2, '0')}`)!
      const fixture = fixtures[fixtureIndex]
      const meta = META.seats[fixture.prop as 'lounge-table-set' | 'sofa' | 'armchair']![metaIndex]
      const offset = meta.dir === 'right' || meta.dir === 'left' ? -4 : 0
      expect(seat.fixture).toBe(fixtureIndex)
      expect(seat.dir).toBe(meta.dir)
      expect([seat.x, seat.y]).toEqual([fixture.x + meta.x, fixture.y + meta.y + offset])
    })
    expect(plan.overflow).toEqual([])
    expect(plan.more).toBeNull()
  })

  it('사람 순서: 차례가 끝난 시각이 최근인 사람부터, 같으면 id 순 (받은 순서와 무관)', () => {
    const list: LoungePerson[] = [
      { id: 'old', endedAt: T0 - 600_000, state: 'idle', character: 'member' },
      { id: 'tie-b', endedAt: T0, state: 'idle', character: 'member' },
      { id: 'tie-a', endedAt: T0, state: 'idle', character: 'member' },
      { id: 'mid', endedAt: T0 - 60_000, state: 'idle', character: 'member' },
    ]
    const plan = planLounge(META, fixtures, sizes, list)
    // 첫 원탁의 메타 0~3번 자리에 tie-a, tie-b, mid, old
    const byMetaOrder = ['tie-a', 'tie-b', 'mid', 'old'].map((id) => plan.seats.find((seat) => seat.sessionId === id)!)
    expect(byMetaOrder.map((seat) => seat.fixture)).toEqual([tables[0], tables[0], tables[0], tables[0]])
    expect(byMetaOrder.map((seat) => seat.dir)).toEqual(['up', 'down', 'right', 'left'])
  })

  it('그리는 순서: 소품 번호 → 자리 y (같으면 메타 순서)', () => {
    const plan = planLounge(META, fixtures, sizes, people(SEATS_AT_H10))
    const keys = plan.seats.map((seat) => [seat.fixture, seat.y] as const)
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    expect(keys).toEqual(sorted)
    // 첫 원탁: 위 의자(down) → 옆 의자 둘(right·left 메타 순서) → 아래 의자(up)
    expect(plan.seats.filter((seat) => seat.fixture === tables[0]).map((seat) => seat.dir)).toEqual(['down', 'right', 'left', 'up'])
  })

  it('넘치면 가장 오래된 사람들이 "+N" (최근순), 명판은 이름표 아래', () => {
    const plan = planLounge(META, fixtures, sizes, people(SEATS_AT_H10 + 3))
    expect(plan.seats).toHaveLength(SEATS_AT_H10)
    expect(plan.overflow).toEqual(['s12', 's13', 's14'])
    expect(plan.more).toEqual({ count: 3, ...LOUNGE_MORE_AT })
    expect(plan.figures.has('s11')).toBe(true)
    expect(plan.figures.has('s12')).toBe(false)
  })

  it('라운지가 길어 원탁이 늘면 자리도 는다', () => {
    const tall = loungeFixtures({ ...LOUNGE, h: 14 }, sizes)
    const tableCount = tall.filter((fixture) => fixture.prop === 'lounge-table-set').length
    expect(tableCount).toBe(loungeTableCount(14))
    expect(tableCount).toBeGreaterThan(2)
    const plan = planLounge(META, tall, sizes, people(30))
    expect(plan.seats).toHaveLength(tableCount * 4 + 4)
    expect(plan.overflow).toHaveLength(30 - plan.seats.length)
  })

  it('옆모습 자리만 인물·상태별 sideOffsetY 를 더한다 (없으면 0)', () => {
    const at = (state: 'idle' | 'doze', character: string) => {
      const plan = planLounge(META, fixtures, sizes, people(4, { state, character }))
      return plan.seats.filter((seat) => seat.fixture === tables[0]).map((seat) => seat.y - fixtures[tables[0]].y)
    }
    // 그리는 순서: down(−90) · right(−40) · left(−40) · up(−4)
    expect(at('idle', 'member')).toEqual([-90, -44, -44, -4])
    expect(at('doze', 'member')).toEqual([-90, -38, -38, -4])
    expect(at('idle', 'lead')).toEqual([-90, -46, -46, -4])
    expect(at('doze', 'lead')).toEqual([-90, -40, -40, -4])
    expect(planLounge({ seats: META.seats }, fixtures, sizes, people(3)).seats.find((seat) => seat.dir === 'right')!.y).toBe(
      fixtures[tables[0]].y - 40,
    )
  })

  it('front: 소품 프레임 안 사각형을 라운지의 같은 자리(소품 왼쪽 위 + x·y)에 덮는다', () => {
    const plan = planLounge(META, fixtures, sizes, people(SEATS_AT_H10))
    const table = fixtures[tables[0]]
    const size = sizes['lounge-table-set']
    const up = plan.seats.find((seat) => seat.fixture === tables[0] && seat.dir === 'up')!
    expect(up.front).toEqual([{ frame: { x: 40, y: 60, w: 64, h: 30 }, at: { x: table.x - size.w / 2 + 40, y: table.y - size.h + 60 } }])
    expect(plan.seats.find((seat) => seat.fixture === tables[0] && seat.dir === 'down')!.front).toEqual([])
  })

  it('전신 사각형은 방향별 (거리와 같은 크기, left 는 뒤집음)', () => {
    const plan = planLounge(META, fixtures, sizes, people(SEATS_AT_H10))
    for (const seat of plan.seats) expect(plan.figures.get(seat.sessionId)).toEqual(figureRect(seat.dir, seat.x, seat.y))
    const right = plan.seats.find((seat) => seat.dir === 'right')!
    const left = plan.seats.find((seat) => seat.dir === 'left')!
    expect(plan.figures.get(right.sessionId)!.x).toBe(right.x - 8)
    expect(plan.figures.get(left.sessionId)!.x + plan.figures.get(left.sessionId)!.w).toBe(left.x + 8)
  })

  it('실제 아틀라스 메타: 세 소품 모두 자리가 있고 높이 10 라운지의 자리를 다 채운다', () => {
    const real = (atlas.meta.jkCorp as unknown as { lounge?: LoungeMeta }).lounge!
    const counts = (['lounge-table-set', 'sofa', 'armchair'] as const).map((prop) => real.seats[prop]?.length ?? 0)
    expect(counts.every((count) => count > 0)).toBe(true)
    const total = 2 * counts[0] + counts[1] + counts[2]
    const plan = planLounge(real, fixtures, sizes, people(total + 1))
    expect(plan.seats).toHaveLength(total)
    expect(plan.overflow).toEqual([`s${String(total).padStart(2, '0')}`])
  })

  it('자리 메타가 없으면(옛 아틀라스) 아무도 못 앉고 모두 "+N", 아무도 없으면 명판도 없다', () => {
    const plan = planLounge(null, fixtures, sizes, people(3))
    expect(plan.seats).toEqual([])
    expect(plan.overflow).toEqual(['s00', 's01', 's02'])
    expect(plan.more).toEqual({ count: 3, ...LOUNGE_MORE_AT })
    expect(planLounge(META, fixtures, sizes, []).more).toBeNull()
  })
})

describe('overflowNames', () => {
  it('5명까지는 다, 넘으면 5명 + "외 N명"', () => {
    expect(overflowNames(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(overflowNames(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e', '외 1명'])
    expect(overflowNames(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toEqual(['a', 'b', 'c', 'd', 'e', '외 3명'])
  })
})
