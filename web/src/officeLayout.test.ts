import { describe, expect, it } from 'vitest'
import { dropIsland, layoutOffice, pushRight, spotForNewTeam, type Rect } from './officeLayout'
import type { Group, Office, Session, Team } from './types'

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

const isApart = (a: Rect, b: Rect, gap: number) =>
  a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y

/** 그룹 g1(0,0)에 섬 셋이 1타일씩 띄워 붙어 있고(A 1..8, B 9..16, C 17..24), 그 오른쪽 1타일 옆에 그룹 g2(26,0) */
function office(): Office {
  return {
    groups: [group('g1', 0), group('g2', 26)],
    teams: [team('A', 'g1', 2), team('B', 'g1', 10), team('C', 'g1', 18), team('D', 'g2', 28)],
  }
}
const small = [...members('A', 2), ...members('B', 2), ...members('C', 2), ...members('D', 2)]

describe('pushRight', () => {
  it('겹친 것을 오른쪽으로 밀고 그 뒤 것도 연쇄로 민다', () => {
    const rects = [
      { x: 0, y: 0, w: 10, h: 3 },
      { x: 5, y: 0, w: 3, h: 3 },
      { x: 9, y: 0, w: 3, h: 3 },
    ]
    expect(pushRight(rects, 1)).toEqual([0, 6, 6])
  })

  it('1타일보다 가까우면 민다. 1타일 떨어졌거나 위아래로 떨어졌으면 그대로', () => {
    expect(pushRight([{ x: 0, y: 0, w: 4, h: 3 }, { x: 4, y: 0, w: 2, h: 3 }], 1)).toEqual([0, 1])
    expect(pushRight([{ x: 0, y: 0, w: 4, h: 3 }, { x: 5, y: 0, w: 2, h: 3 }], 1)).toEqual([0, 0])
    expect(pushRight([{ x: 0, y: 0, w: 4, h: 3 }, { x: 2, y: 4, w: 2, h: 3 }], 1)).toEqual([0, 0])
  })

  it('x 가 같으면 위에 있는 것이 자리를 지키고 아래 것이 오른쪽으로 밀린다 (아래로는 안 민다)', () => {
    expect(pushRight([{ x: 0, y: 4, w: 4, h: 3 }, { x: 0, y: 0, w: 4, h: 5 }], 1)).toEqual([5, 0])
  })
})

describe('layoutOffice 섬 밀기', () => {
  it('섬이 작으면 아무것도 밀지 않는다', () => {
    const layout = layoutOffice(office(), small)
    expect(layout.islands.map((i) => [i.x, i.anchor.x])).toEqual([[1, 2], [9, 10], [17, 18], [27, 28]])
    expect(layout.groupAreas.map((a) => a.origin.x)).toEqual([0, 26])
  })

  it('첫 섬이 14명으로 커지면 같은 그룹 섬들이 연쇄로, 넓어진 그룹의 오른쪽 그룹도 안의 섬·책상과 같이 오른쪽으로 밀린다', () => {
    const data = office()
    const layout = layoutOffice(data, [...members('A', 14), ...small.filter((s) => s.teamId !== 'A')])
    const [a, b, c, d] = layout.islands
    // A 는 4열이라 1..14, B 는 A 오른쪽 + 1, C 는 B 오른쪽 + 1
    expect([a.x, a.w]).toEqual([1, 13])
    expect(b.x).toBe(a.x + a.w + 1)
    expect(c.x).toBe(b.x + b.w + 1)
    expect([b.y, c.y]).toEqual([1, 1])
    for (const [one, other] of [[a, b], [b, c], [a, c]]) expect(isApart(one, other, 1)).toBe(true)
    const [g1, g2] = layout.groupAreas
    expect(g2.x).toBe(g1.x + g1.w + 1)
    expect(g2.origin.x - 26).toBe(d.anchor.x - 28)
    expect(layout.seats.get('D-0')).toEqual(d.anchor)
    expect(layout.seats.get('B-0')).toEqual(b.anchor)
    expect(layout.lobby.x).toBe(g2.x + g2.w + 1)
    // 저장된 좌표는 그대로
    expect(data.teams.map((t) => t.x)).toEqual([2, 10, 18, 28])
    expect(data.groups.map((g) => g.x)).toEqual([0, 26])
  })

  it('다시 작아지면 저장된 자리로 돌아온다', () => {
    const data = office()
    layoutOffice(data, [...members('A', 14), ...small.filter((s) => s.teamId !== 'A')])
    expect(layoutOffice(data, small).islands.map((i) => i.anchor.x)).toEqual([2, 10, 18, 28])
  })

  it('그룹이 지워진 팀끼리도 민다', () => {
    const data: Office = { groups: [], teams: [team('A', 'gone', 2), team('B', 'gone', 10)] }
    const layout = layoutOffice(data, [...members('A', 14), ...members('B', 2)])
    expect(layout.islands[1].x).toBe(layout.islands[0].x + layout.islands[0].w + 1)
  })
})

describe('밀린 자리에서 끌기·새 팀', () => {
  const pushed = () => {
    const data = office()
    return { data, layout: layoutOffice(data, [...members('A', 14), ...small.filter((s) => s.teamId !== 'A')]) }
  }

  it('밀린 그룹의 섬을 그려진 자리 그대로 놓으면 그룹이 밀리기 전 좌표로 저장해 다시 그려도 그 자리다', () => {
    const { data, layout } = pushed()
    const d = layout.islands[3]
    const drop = dropIsland(layout, data.teams[3], { x: d.anchor.x, y: d.anchor.y + 1 })
    expect(drop).toEqual({ groupId: 'g2', x: 28, y: 3 })
    const teams = data.teams.map((t) => (t.id === 'D' ? { ...t, ...drop } : t))
    const again = layoutOffice({ ...data, teams }, [...members('A', 14), ...small.filter((s) => s.teamId !== 'A')])
    expect(again.islands[3].anchor).toEqual({ x: d.anchor.x, y: d.anchor.y + 1 })
  })

  it('밀린 섬을 다른 섬 위에 놓으면 그려진 섬들 기준으로 가장 가까운 빈 자리', () => {
    const { data, layout } = pushed()
    const [a, b] = layout.islands
    const drop = dropIsland(layout, data.teams[1], a.anchor)
    const moved = { ...b, x: drop.x - (b.anchor.x - b.x), y: drop.y - (b.anchor.y - b.y) }
    for (const other of layout.islands.filter((i) => i.team.id !== 'B')) expect(isApart(moved, other, 1)).toBe(true)
  })

  it('밀린 그룹의 새 팀 앵커는 그룹이 밀리기 전 좌표', () => {
    const { layout } = pushed()
    const area = layout.groupAreas[1]
    const shift = area.origin.x - area.group.x
    const spot = spotForNewTeam(layout, 'g2')!
    const drawn = { x: spot.x + shift - 1, y: spot.y - 1, w: 7, h: 5 }
    for (const island of layout.islands) expect(isApart(drawn, island, 1)).toBe(true)
  })
})
