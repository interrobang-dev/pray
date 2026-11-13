import { describe, expect, it } from 'vitest'
import {
  commandItems,
  firstSelectable,
  isGlobalSearchShortcut,
  matchRank,
  moveSelection,
  openTodoItems,
  queryTokens,
  searchGroups,
  sessionSearchText,
  type SearchInput,
  type SearchItem,
} from './globalSearchItems'
import type { Group, Office, Reminder, Session, Team, TeamTodo } from './types'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    cwd: `D:\\work\\${id}`,
    name: id,
    status: 'idle',
    kind: 'web',
    isAlive: true,
    attendance: 'present',
    lastAt: minutesAgo(60),
    turnEndedAt: minutesAgo(60),
    role: null,
    teamId: null,
    partId: null,
    ...overrides,
  } as Session
}

function todo(id: string, text: string, isDone = false): TeamTodo {
  return { id, text, isDone, createdAt: minutesAgo(10), doneAt: isDone ? minutesAgo(5) : null }
}

function team(id: string, name: string, overrides: Partial<Team> = {}): Team {
  return { id, name, cwd: `D:\\repo\\${id}`, groupId: 'g1', x: 0, y: 0, desks: {}, parts: [], partOf: {}, createdAt: minutesAgo(100), ...overrides }
}

function group(id: string, name: string): Group {
  return { id, name, x: 0, y: 0, w: 0, h: 0 }
}

function reminder(id: string, text: string, overrides: Partial<Reminder> = {}): Reminder {
  return { id, text, at: minutesAgo(-30), createdAt: minutesAgo(1), createdBy: { kind: 'user' }, firedAt: null, acknowledgedAt: null, ...overrides }
}

function input(overrides: Partial<SearchInput> = {}): SearchInput {
  return { sessions: [], office: { groups: [], teams: [] }, now: NOW, isHostReachable: true, isNarrow: false, isOfficeHidden: false, ...overrides }
}

const keys = (items: SearchItem[]) => items.map((item) => item.key)

describe('isGlobalSearchShortcut', () => {
  const key = (overrides: Partial<KeyboardEvent>) => ({ key: 'k', code: 'KeyK', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides })
  it('takes Ctrl+K and Meta+K, also by code on a Korean layout', () => {
    expect(isGlobalSearchShortcut(key({ ctrlKey: true }))).toBe(true)
    expect(isGlobalSearchShortcut(key({ metaKey: true }))).toBe(true)
    expect(isGlobalSearchShortcut(key({ ctrlKey: true, key: 'ㅏ' }))).toBe(true)
    expect(isGlobalSearchShortcut(key({ ctrlKey: true, key: 'K', code: 'KeyK' }))).toBe(true)
  })
  it('ignores plain K and Shift or Alt combinations', () => {
    expect(isGlobalSearchShortcut(key({}))).toBe(false)
    expect(isGlobalSearchShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isGlobalSearchShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isGlobalSearchShortcut(key({ ctrlKey: true, key: 'j', code: 'KeyJ' }))).toBe(false)
  })
})

describe('queryTokens', () => {
  it('trims, lowercases and splits on any whitespace', () => {
    expect(queryTokens('  Foo   BAR\tbaz ')).toEqual(['foo', 'bar', 'baz'])
    expect(queryTokens('   ')).toEqual([])
  })
})

describe('matchRank', () => {
  it('needs every word somewhere in the name or the other fields', () => {
    expect(matchRank('Park', ['FE', 'Pray'], ['park', 'pray'])).toBe(3)
    expect(matchRank('Park', ['FE', 'Pray'], ['park', 'web'])).toBeNull()
    expect(matchRank('Park', [null, undefined], ['park'])).toBe(0)
    expect(matchRank('Park', [], [])).toBeNull()
  })

  it('ranks exact name > name prefix > name contains > other fields only', () => {
    expect(matchRank('Pray', [], ['pray'])).toBe(0)
    expect(matchRank('Pray web', [], ['pray'])).toBe(1)
    expect(matchRank('Do pray', [], ['pray'])).toBe(2)
    expect(matchRank('Kim', ['D:\\pray'], ['pray'])).toBe(3)
  })

  it('treats a name holding every word as a name match even in another order', () => {
    expect(matchRank('web pray', [], ['pray', 'web'])).toBe(2)
    expect(matchRank('Pray Web', [], ['pray', 'web'])).toBe(0)
  })
})

describe('sessionSearchText', () => {
  it('searches the role, team, part and folder besides the name', () => {
    const teams = [team('t1', 'Pray', { parts: [{ id: 'p1', name: 'Front', createdAt: minutesAgo(1) }] })]
    const text = sessionSearchText(session('s1', { name: 'Park', position: 'FE', teamId: 't1', partId: 'p1', cwd: 'D:\\pray' }), teams)
    expect(text).toEqual({ name: 'Park', fields: ['FE', 'Pray', 'Front', 'D:\\pray'] })
  })
})

describe('searchGroups with a query', () => {
  const teams = [team('t1', 'Pray'), team('t2', 'Seasight', { groupId: 'g2' })]
  const office: Office = {
    groups: [group('g1', 'Products'), group('g2', 'Sites')],
    teams: [{ ...teams[0], todos: [todo('a', 'Fix pray login'), todo('b', 'Pray done', true)] }, teams[1]],
    todos: [todo('d', 'Call pray vendor')],
    reminders: [reminder('r1', 'Pray standup'), reminder('r2', 'Pray old', { firedAt: minutesAgo(1), acknowledgedAt: minutesAgo(1) })],
  }
  const sessions = [
    session('kim', { name: 'Kim', teamId: 't1' }),
    session('pray-bot', { name: 'pray bot' }),
    session('pray', { name: 'Pray', attendance: 'off', isAlive: false }),
  ]

  it('orders groups and ranks inside each group, ties in the original order', () => {
    const groups = searchGroups(input({ sessions, office }), 'pray')
    expect(groups.map((g) => g.key)).toEqual(['sessions', 'teams', 'todos', 'reminders'])
    // Pray(같음) > pray bot(시작) > Kim(팀 이름에만)
    expect(keys(groups[0].items)).toEqual(['session:pray', 'session:pray-bot', 'session:kim'])
    expect(keys(groups[1].items)).toEqual(['team:t1'])
    // 미완료만, 내 책상 먼저. 확인한 알림은 없다
    expect(keys(groups[2].items)).toEqual(['todo:desk:d', 'todo:t1:a'])
    expect(keys(groups[3].items)).toEqual(['reminder:r1'])
  })

  it('finds groups by name and commands by label', () => {
    expect(searchGroups(input({ sessions, office }), 'sites').map((g) => g.key)).toEqual(['groups'])
    const commands = searchGroups(input({ sessions, office }), 'show')
    expect(commands.map((g) => g.key)).toEqual(['commands'])
    expect(commands[0].items.map((item) => item.kind === 'command' && item.label)).toEqual(['Show sessions', 'Show Needs you', 'Show All TODOs'])
  })

  it('counts on-duty sessions per team and teams per group', () => {
    const [teamGroup] = searchGroups(input({ sessions, office }), 'seasight')
    expect(teamGroup.items[0]).toMatchObject({ kind: 'team', presentCount: 0 })
    const [prayTeam] = searchGroups(input({ sessions, office }), 'D:\\repo\\t1').filter((g) => g.key === 'teams')
    expect(prayTeam.items[0]).toMatchObject({ kind: 'team', presentCount: 1 })
    const [groups] = searchGroups(input({ sessions, office }), 'products')
    expect(groups.items[0]).toMatchObject({ kind: 'group', teamCount: 1 })
  })

  it('limits sessions to 8 and the rest to 5', () => {
    const many = Array.from({ length: 12 }, (_, index) => session(`s${index}`, { name: `alpha ${index}` }))
    const manyTeams = Array.from({ length: 7 }, (_, index) => team(`t${index}`, `alpha ${index}`))
    const groups = searchGroups(input({ sessions: many, office: { groups: [group('g1', 'G')], teams: manyTeams } }), 'alpha')
    expect(groups.find((g) => g.key === 'sessions')?.items).toHaveLength(8)
    expect(groups.find((g) => g.key === 'teams')?.items).toHaveLength(5)
  })

  it('returns no groups when nothing matches', () => {
    expect(searchGroups(input({ sessions, office }), 'zzz')).toEqual([])
  })
})

describe('searchGroups without a query', () => {
  it('shows Needs you (approval, your turn) then Recent without duplicates then commands', () => {
    const sessions = [
      session('old', { turnEndedAt: minutesAgo(500) }),
      session('turn', { status: 'my-turn', turnEndedAt: minutesAgo(30) }),
      session('approve', { status: 'needs-approval', turnEndedAt: minutesAgo(100) }),
      session('done', { status: 'done', turnEndedAt: minutesAgo(1) }),
      session('member', { status: 'my-turn', role: 'member', turnEndedAt: minutesAgo(2) }),
    ]
    const groups = searchGroups(input({ sessions }), '  ')
    expect(groups.map((g) => g.key)).toEqual(['needs-you', 'recent', 'commands'])
    expect(keys(groups[0].items)).toEqual(['session:approve', 'session:turn'])
    expect(keys(groups[1].items)).toEqual(['session:done', 'session:member', 'session:old'])
  })

  it('leaves out an empty Needs you group', () => {
    expect(searchGroups(input({ sessions: [session('a')] }), '').map((g) => g.key)).toEqual(['recent', 'commands'])
  })
})

describe('commandItems', () => {
  it('picks the office command for the current state and drops it on phones', () => {
    const labels = (items: SearchItem[]) => items.map((item) => item.kind === 'command' && item.label)
    expect(labels(commandItems(input()))).toContain('Hide office')
    expect(labels(commandItems(input({ isOfficeHidden: true })))).toContain('Show office')
    const phone = labels(commandItems(input({ isNarrow: true })))
    expect(phone).not.toContain('Hide office')
    expect(phone).not.toContain('Show office')
  })

  it('disables New session without the host and Lead models without leads on duty', () => {
    const offline = commandItems(input({ isHostReachable: false }))
    expect(offline.find((item) => item.command === 'new-session')?.disabledReason).toBe('Session host disconnected')
    expect(offline.find((item) => item.command === 'lead-models')?.disabledReason).toBe('No leads on duty')
    const withLead = commandItems(input({ sessions: [session('lead', { role: 'lead', teamId: 't1' })] }))
    expect(withLead.find((item) => item.command === 'lead-models')?.disabledReason).toBeNull()
  })

  it("has Today's work", () => {
    expect(commandItems(input()).find((item) => item.command === 'daily')).toMatchObject({ label: "Today's work", disabledReason: null })
  })

  it('has no dangerous commands', () => {
    const labels = commandItems(input()).map((item) => item.label).join(' ')
    expect(labels).not.toMatch(/End|Restart|Delete/)
  })
})

describe('openTodoItems', () => {
  it('takes open desk todos then open team todos in list order', () => {
    const office: Office = {
      groups: [group('g1', 'A'), group('g2', 'B')],
      teams: [team('t2', 'Second', { groupId: 'g2', todos: [todo('x', 'x')] }), team('t1', 'First', { todos: [todo('y', 'y'), todo('z', 'z', true)] })],
      todos: [todo('d', 'd')],
    }
    expect(openTodoItems(office).map((item) => `${item.placeName}:${item.todo.id}`)).toEqual(['My desk:d', 'First:y', 'Second:x'])
  })
})

describe('moveSelection', () => {
  const items = commandItems(input({ isHostReachable: false }))
  // 0 New session(비활성) … 5 Lead models(비활성)
  it('skips disabled rows and wraps at both ends', () => {
    expect(firstSelectable(items)).toBe(1)
    expect(moveSelection(items, 1, -1)).toBe(items.length - 1)
    expect(moveSelection(items, items.length - 1, 1)).toBe(1)
    expect(moveSelection(items, 4, 1)).toBe(6)
    expect(moveSelection(items, -1, 1)).toBe(1)
    expect(moveSelection(items, -1, -1)).toBe(items.length - 1)
  })

  it('returns -1 when nothing can be chosen', () => {
    expect(moveSelection([], 0, 1)).toBe(-1)
    expect(firstSelectable([])).toBe(-1)
  })
})
