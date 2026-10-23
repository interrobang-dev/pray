import { describe, expect, it } from 'vitest'
import { LOUNGE_MIN_H, LOUNGE_W, dropIsland, layoutOffice, pushRight, spotForNewGroup, spotForNewTeam, type Rect } from './officeLayout'
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
    // A 는 짝 7개라 2줄 × 4짝(+ 화분 열)이라 1..12, B 는 A 오른쪽 + 1, C 는 B 오른쪽 + 1
    expect([a.x, a.w]).toEqual([1, 11])
    expect(b.x).toBe(a.x + a.w + 1)
    expect(c.x).toBe(b.x + b.w + 1)
    expect([b.y, c.y]).toEqual([1, 1])
    for (const [one, other] of [[a, b], [b, c], [a, c]]) expect(isApart(one, other, 1)).toBe(true)
    const [g1, g2] = layout.groupAreas
    expect(g2.x).toBe(g1.x + g1.w + 1)
    expect(g2.origin.x - 26).toBe(d.anchor.x - 28)
    expect(layout.seats.get('D-0')).toMatchObject(d.anchor)
    expect(layout.seats.get('B-0')).toMatchObject(b.anchor)
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
    const drawn = { x: spot.x + shift - 1, y: spot.y - 1, w: 7, h: 6 }
    for (const island of layout.islands) expect(isApart(drawn, island, 1)).toBe(true)
  })
})

describe('섬 안 자리 (지휘자 옆자리 + 칸막이 블록 줄)', () => {
  /** 팀 T(앵커 2,2)에 지휘자 lead + 팀원 count 명 */
  const withLead = (count: number) => {
    const lead = { id: 'lead', teamId: 'T', role: 'lead', attendance: 'present' } as Session
    const data: Office = { groups: [], teams: [{ ...team('T', 'gone', 2), leadSessionId: 'lead' }] }
    return layoutOffice(data, [lead, ...members('T', count)])
  }
  const size = (count: number) => {
    const [island] = withLead(count).islands
    return [island.w, island.h]
  }
  const seat = (x: number, y: number, h: number, dir: string) => ({ x, y, w: 2, h, dir, isBooth: false })

  it('섬 크기: 지휘자 열 2 + 짝마다 2 + 화분 열 1 + 테두리, 블록 줄 4타일, 한 줄 최대 4짝이고 넘치면 줄마다 고르게 나눈다', () => {
    // 팀원이 없어도 빈 짝 하나라 팀원 1~2명과 같다
    expect(size(0)).toEqual([7, 6])
    expect(size(1)).toEqual([7, 6])
    expect(size(3)).toEqual([9, 6])
    expect(size(6)).toEqual([11, 6])
    expect(size(8)).toEqual([13, 6])
    // 짝 5개 = 3 + 2, 블록 줄 사이 통로 1
    expect(size(9)).toEqual([11, 11])
  })

  it('자리 사각형: 윗자리 위 2타일, 아랫자리 그 아래 3타일(의자까지), 지휘자는 블록 왼쪽 열 가운데 2타일', () => {
    const layout = withLead(3)
    expect(layout.seats.get('lead')).toEqual(seat(2, 3, 2, 'right'))
    expect(layout.seats.get('T-0')).toEqual(seat(4, 2, 2, 'down'))
    expect(layout.seats.get('T-1')).toEqual(seat(4, 4, 3, 'up'))
    expect(layout.seats.get('T-2')).toEqual(seat(6, 2, 2, 'down'))
    const [island] = layout.islands
    // 홀수면 마지막 짝의 아랫자리가 빈 자리 (빈 의자만)
    expect(island.rows).toEqual([
      {
        x: 4,
        y: 2,
        w: 4,
        h: 4,
        pairs: [
          { top: 'T-0', bottom: 'T-1' },
          { top: 'T-2', bottom: null },
        ],
        leadId: 'lead',
      },
    ])
    expect(island.plants).toEqual([{ x: 8, y: 2, w: 1, h: 4 }])
  })

  it('자리 사각형끼리 겹치지 않는다', () => {
    const rects = [...withLead(9).seats.values()]
    for (const a of rects) for (const b of rects) if (a !== b) expect(isApart(a, b, 0)).toBe(true)
  })

  it('지휘자만 있으면 지휘자 + 팀원이 앉을 빈 짝 하나(윗자리·아랫자리 빈 책상)와 옆 화분', () => {
    const layout = withLead(0)
    expect(layout.seats.get('lead')).toEqual(seat(2, 3, 2, 'right'))
    expect(layout.islands[0].rows).toEqual([{ x: 4, y: 2, w: 2, h: 4, pairs: [{ top: null, bottom: null }], leadId: 'lead' }])
    expect(layout.islands[0].plants).toEqual([{ x: 6, y: 2, w: 1, h: 4 }])
    // 팀원 1명이면 그 빈 짝 윗자리에 앉고 섬 크기는 같다
    const one = withLead(1)
    expect(one.islands[0].rows[0].pairs).toEqual([{ top: 'T-0', bottom: null }])
    expect([one.islands[0].w, one.islands[0].h]).toEqual([layout.islands[0].w, layout.islands[0].h])
  })

  it('두 줄이면 둘째 줄은 블록 줄 아래 통로 1타일 뒤에서 시작하고 지휘자·화분은 첫 줄 왼쪽·줄마다 같은 열', () => {
    const layout = withLead(9)
    expect(layout.seats.get('T-6')).toEqual(seat(4, 7, 2, 'down'))
    const [first, second] = layout.islands[0].rows
    expect([first.x, first.y, first.w, first.leadId]).toEqual([4, 2, 6, 'lead'])
    expect([second.x, second.y, second.w, second.leadId]).toEqual([4, 7, 4, null])
    expect(second.pairs).toEqual([
      { top: 'T-6', bottom: 'T-7' },
      { top: 'T-8', bottom: null },
    ])
    expect(layout.islands[0].plants.map((p) => [p.x, p.y])).toEqual([
      [10, 2],
      [10, 7],
    ])
  })

  it('지휘자가 없으면 지휘자 열이 없고, 세션 없는 팀은 빈 짝 하나', () => {
    const data: Office = { groups: [], teams: [team('T', 'gone', 2), team('E', 'gone', 20)] }
    const layout = layoutOffice(data, members('T', 2))
    const [t, e] = layout.islands
    expect([t.w, t.h]).toEqual([5, 6])
    expect(layout.seats.get('T-0')).toEqual(seat(2, 2, 2, 'down'))
    expect([...layout.seats.values()].some((s) => s.dir === 'right')).toBe(false)
    expect([e.w, e.h]).toEqual([5, 6])
    expect(e.rows).toEqual([{ x: 20, y: 2, w: 2, h: 4, pairs: [{ top: null, bottom: null }], leadId: null }])
  })

  it('파트는 팀 직속 아래로 이름표 여백 2타일 뒤에 같은 규칙으로 쌓는다', () => {
    const base = team('T', 'gone', 2)
    const data: Office = {
      groups: [],
      teams: [{ ...base, leadSessionId: 'lead', parts: [{ id: 'p', name: 'P', leadSessionId: 'plead', createdAt: base.createdAt }] }],
    }
    const session = (id: string, partId: string | null, role: 'lead' | 'member') =>
      ({ id, teamId: 'T', partId, role, attendance: 'present' }) as Session
    const layout = layoutOffice(data, [session('lead', null, 'lead'), session('m', null, 'member'), session('plead', 'p', 'lead'), session('pm', 'p', 'member')])
    const [island] = layout.islands
    expect(layout.seats.get('plead')).toEqual(seat(2, 9, 2, 'right'))
    expect(layout.seats.get('pm')).toEqual(seat(4, 8, 2, 'down'))
    expect(island.zones.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([{ x: 2, y: 8, w: 5, h: 4 }])
    expect([island.y, island.h]).toEqual([1, 12])
  })

  it('파트장만 있는 파트도 빈 짝 하나 (파트 구역은 지휘자 열 + 짝 + 화분 열)', () => {
    const base = team('T', 'gone', 2)
    const data: Office = {
      groups: [],
      teams: [{ ...base, leadSessionId: 'lead', parts: [{ id: 'p', name: 'P', leadSessionId: 'plead', createdAt: base.createdAt }] }],
    }
    const session = (id: string, partId: string | null) => ({ id, teamId: 'T', partId, role: 'lead', attendance: 'present' }) as Session
    const layout = layoutOffice(data, [session('lead', null), session('plead', 'p')])
    const [island] = layout.islands
    expect(island.rows.map((row) => [row.y, row.h, row.pairs, row.leadId])).toEqual([
      [2, 4, [{ top: null, bottom: null }], 'lead'],
      [8, 4, [{ top: null, bottom: null }], 'plead'],
    ])
    expect(island.zones.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([{ x: 2, y: 8, w: 5, h: 4 }])
    expect([island.w, island.h]).toEqual([7, 12])
  })
})

describe('라운지', () => {
  it('Focus Zone 오른쪽에 1타일 띄워 붙고 높이가 같다. 오른쪽 끝·아래 끝은 라운지까지', () => {
    const layout = layoutOffice(office(), small)
    const { lobby, lounge } = layout
    expect(lounge).toEqual({ x: lobby.x + lobby.w + 1, y: 0, w: LOUNGE_W, h: lobby.h })
    expect(layout.right).toBe(lounge.x + lounge.w)
    expect(layout.bottom).toBe(lounge.y + lounge.h)
  })

  it('내용이 낮으면 최소 높이, 그룹·섬이 길면 그 아래 끝까지 (Focus Zone 도 같이)', () => {
    expect(layoutOffice({ groups: [], teams: [] }, []).lounge).toEqual({ x: 9, y: 0, w: LOUNGE_W, h: LOUNGE_MIN_H })
    const data: Office = { groups: [group('g1', 0), group('g2', 0, 30)], teams: [] }
    const layout = layoutOffice(data, [])
    const bottom = Math.max(...layout.groupAreas.map((a) => a.y + a.h))
    expect(layout.lounge.h).toBe(bottom)
    expect(layout.lobby.h).toBe(bottom)
  })

  it('자리·그룹·섬·Focus Zone 과 겹치지 않고 세션은 앉지 않는다', () => {
    const lobbySessions = Array.from({ length: 5 }, (_, index) => ({ id: `L${index}`, teamId: null, attendance: 'present' }) as Session)
    const layout = layoutOffice(office(), [...members('A', 14), ...small.filter((s) => s.teamId !== 'A'), ...lobbySessions])
    const { lounge } = layout
    for (const rect of [...layout.seats.values(), ...layout.booths, ...layout.groupAreas, ...layout.islands, layout.lobby]) {
      expect(isApart(rect, lounge, 1)).toBe(true)
    }
  })

  it('새 그룹을 빈 자리에 놓아도 라운지는 늘 내용 오른쪽 끝을 따라가 겹치지 않는다', () => {
    const data = office()
    const spot = spotForNewGroup(layoutOffice(data, small))
    const after = layoutOffice({ ...data, groups: [...data.groups, { ...group('new', spot.x, spot.y) }] }, small)
    for (const area of after.groupAreas) {
      expect(isApart(area, after.lounge, 1)).toBe(true)
      expect(area.x + area.w).toBeLessThan(after.lounge.x)
    }
  })
})

describe('Focus Zone 부스', () => {
  it('팀 없는 세션은 2열 부스에 위를 보고 앉고, 구역 높이만큼 빈 부스가 있다', () => {
    const lobby = Array.from({ length: 3 }, (_, index) => ({ id: `L${index}`, teamId: null, attendance: 'present' }) as Session)
    const layout = layoutOffice({ groups: [], teams: [] }, lobby)
    expect(layout.lobby).toEqual({ x: 0, y: 0, w: 8, h: 11 })
    const booth = (x: number, y: number) => ({ x, y, w: 2, h: 3, dir: 'up', isBooth: true })
    expect(lobby.map((s) => layout.seats.get(s.id))).toEqual([booth(1, 2), booth(4, 2), booth(1, 6)])
    expect(layout.booths).toHaveLength(4)
  })
})
