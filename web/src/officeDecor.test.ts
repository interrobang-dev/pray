import { describe, expect, it } from 'vitest'
import { bayRange, DECOR_THEMES, planDecor, themeOf, type PropSizes } from './officeDecor'
import { layoutOffice, type Rect } from './officeLayout'
import type { Group, Office, Session, Team } from './types'

const group = (id: string, x: number, y = 0): Group => ({ id, name: id, x, y, w: 9, h: 7 })
const team = (id: string, groupId: string, x: number, y = 1): Team => ({
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

/** 그룹 g1 에 키가 다른 섬 둘(A 8명 → 3줄, B 2명 → 1줄: B 아래 그룹 안이 빈다), 오른쪽 그룹 g2 는 작은 섬, 그룹이 지워진 팀 C, 로비 세션 하나 */
function scene() {
  const office: Office = {
    groups: [group('g1', 0), group('g2', 20, 12)],
    teams: [team('A', 'g1', 2), team('B', 'g1', 10), team('D', 'g2', 22, 13), team('C', 'gone', 2, 14)],
  }
  const sessions = [...members('A', 8), ...members('B', 2), ...members('D', 2), ...members('C', 2), { id: 'lobby-1', teamId: null, attendance: 'present' } as Session]
  return layoutOffice(office, sessions)
}

/** 모든 테마 소품을 1×1·2×2·1×2 로 */
const sizes: PropSizes = Object.fromEntries(
  DECOR_THEMES.flatMap((theme) => [...Object.keys(theme.floor), ...Object.keys(theme.wall)]).map((id, index) => [
    id,
    [{ w: 1, h: 1 }, { w: 2, h: 2 }, { w: 1, h: 2 }][index % 3],
  ]),
)

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by })

describe('planDecor', () => {
  const layout = scene()

  it('같은 시드·테마면 같은 꾸밈, 시드가 다르면 다른 꾸밈', () => {
    const a = planDecor(layout, { seed: 7, theme: 'office' }, sizes, 12)
    expect(planDecor(layout, { seed: 7, theme: 'office' }, sizes, 12)).toEqual(a)
    expect(planDecor(layout, { seed: 8, theme: 'office' }, sizes, 12)).not.toEqual(a)
    expect(a.floor.length).toBeGreaterThan(3)
  })

  for (const theme of DECOR_THEMES) {
    it(`${theme.id}: 그 테마 소품만 쓰고 책상·이름표·말풍선 자리·로비·Off Duty 와 겹치지 않는다`, () => {
      for (let seed = 1; seed <= 30; seed++) {
        const plan = planDecor(layout, { seed, theme: theme.id }, sizes, 12)
        for (const item of plan.floor) {
          expect(theme.floor[item.prop]).toBeGreaterThan(0)
          // 섬 둘레 1타일(팀 이름표·첫 줄 말풍선) 안에 들어가지 않는다
          for (const island of layout.islands) expect(overlaps(item, inflate(island, 1))).toBe(false)
          expect(overlaps(item, layout.lobby)).toBe(false)
          expect(item.y + item.h).toBeLessThanOrEqual(layout.bottom)
          expect(item.y).toBeGreaterThanOrEqual(-1)
          const area = layout.groupAreas.find((a) => a.group.id === item.groupId)
          if (area) {
            // 그룹 안쪽 (위 줄·양옆 파티션·아래 걸레받이 줄 제외)
            expect(item.x).toBeGreaterThan(area.x)
            expect(item.x + item.w).toBeLessThan(area.x + area.w)
            expect(item.y).toBeGreaterThan(area.y)
            expect(item.y + item.h).toBeLessThan(area.y + area.h)
          } else {
            expect(item.groupId).toBeNull()
            for (const groupArea of layout.groupAreas) expect(overlaps(item, groupArea)).toBe(false)
          }
          if (item.y === -1) expect(item.h).toBe(1)
        }
        // 소품끼리 1타일 띄운다
        plan.floor.forEach((a, i) => plan.floor.slice(i + 1).forEach((b) => expect(overlaps(inflate(a, 1), b)).toBe(false)))
        for (const item of plan.wall) expect(theme.wall[item.prop]).toBeGreaterThan(0)
      }
    })
  }

  it('벽 장식은 이웃 칸에 걸지 않고, 장식을 건 칸 앞 바닥 줄은 비운다', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const plan = planDecor(layout, { seed, theme: 'office' }, sizes, 12)
      plan.wall.forEach((item, i) => {
        if (i > 0) expect(item.bay - plan.wall[i - 1].bay).toBeGreaterThan(1)
        const range = bayRange(item.bay)
        for (const floor of plan.floor.filter((f) => f.y === -1)) expect(overlaps(floor, { ...range, y: -1, h: 1 })).toBe(false)
      })
    }
  })

  it('그룹 안 빈 자리(작은 섬 아래)에도 놓는다', () => {
    const inside = Array.from({ length: 40 }, (_, seed) => planDecor(layout, { seed, theme: 'forest' }, sizes, 12)).flatMap((plan) =>
      plan.floor.filter((item) => item.groupId === 'g1'),
    )
    expect(inside.length).toBeGreaterThan(0)
  })

  it('모르는 테마는 기본 테마로', () => {
    expect(themeOf('nope').id).toBe('office')
  })
})
