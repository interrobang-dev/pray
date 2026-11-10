import { describe, expect, it } from 'vitest'
import { applyTodo, clearDone, moveTo, openTodoGroups, remainingCount, removeTodo, reorderOpen, splitTodos, teamsInListOrder, todosOf, totalRemaining } from './teamTodos'
import type { Group, Team, TeamTodo } from './types'

const todo = (id: string, isDone = false): TeamTodo => ({
  id,
  text: id,
  isDone,
  createdAt: '2026-10-25T00:00:00.000Z',
  doneAt: isDone ? '2026-10-25T01:00:00.000Z' : null,
})
const team = (todos?: TeamTodo[]): Team => ({ id: 't', name: 't', cwd: 'd:/t', groupId: 'g', x: 0, y: 0, desks: {}, parts: [], partOf: {}, createdAt: '2026-10-25T00:00:00.000Z', ...(todos ? { todos } : {}) })
const ids = (todos: TeamTodo[]) => todos.map((item) => item.id)

/** 서버 순서: 할 일 a·b·c, 완료 x(먼저 완료)·y */
const sample = () => [todo('a'), todo('b'), todo('c'), todo('x', true), todo('y', true)]

describe('todosOf·remainingCount', () => {
  it('필드가 없는 옛 응답은 빈 목록, 남은 개수는 미완료만', () => {
    expect(todosOf(team())).toEqual([])
    expect(remainingCount(team())).toBe(0)
    expect(remainingCount(team(sample()))).toBe(3)
  })
})

describe('splitTodos', () => {
  it('할 일은 서버 순서 그대로, 완료는 최근 완료한 것부터', () => {
    const { open, done } = splitTodos(sample())
    expect(ids(open)).toEqual(['a', 'b', 'c'])
    expect(ids(done)).toEqual(['y', 'x'])
  })
})

describe('applyTodo', () => {
  it('새 할 일은 할 일 맨 끝 (완료 앞)', () => {
    expect(ids(applyTodo(sample(), todo('n')))).toEqual(['a', 'b', 'c', 'n', 'x', 'y'])
    expect(ids(applyTodo([], todo('n')))).toEqual(['n'])
  })

  it('글만 바뀌면 제자리', () => {
    const next = applyTodo(sample(), { ...todo('b'), text: 'changed' })
    expect(ids(next)).toEqual(['a', 'b', 'c', 'x', 'y'])
    expect(next[1].text).toBe('changed')
  })

  it('완료하면 전체 맨 끝, 완료를 풀면 할 일 맨 끝', () => {
    expect(ids(applyTodo(sample(), todo('a', true)))).toEqual(['b', 'c', 'x', 'y', 'a'])
    expect(ids(applyTodo(sample(), todo('x')))).toEqual(['a', 'b', 'c', 'x', 'y'])
    expect(ids(applyTodo(sample(), todo('y')))).toEqual(['a', 'b', 'c', 'y', 'x'])
  })

  it('서버 결과(SSE)가 먼저 와 있어도 다시 넣으면 그대로다', () => {
    const server = applyTodo(sample(), todo('a', true))
    expect(applyTodo(server, todo('a', true))).toEqual(server)
    const added = applyTodo(sample(), todo('n'))
    expect(applyTodo(added, todo('n'))).toEqual(added)
  })
})

describe('removeTodo', () => {
  it('그 항목만 뺀다', () => {
    expect(ids(removeTodo(sample(), 'b'))).toEqual(['a', 'c', 'x', 'y'])
    expect(ids(removeTodo(sample(), 'none'))).toEqual(['a', 'b', 'c', 'x', 'y'])
  })
})

describe('clearDone', () => {
  it('완료만 빼고 할 일 순서는 그대로', () => {
    expect(ids(clearDone(sample()))).toEqual(['a', 'b', 'c'])
    expect(clearDone([])).toEqual([])
  })
})

describe('reorderOpen', () => {
  it('할 일만 새 순서로, 완료는 뒤에 그대로', () => {
    expect(ids(reorderOpen(sample(), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b', 'x', 'y'])
  })

  it('지금 할 일 집합과 다르면(빠짐·더함·중복·완료 항목) 그대로', () => {
    for (const order of [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'a', 'b'], ['a', 'b', 'x']]) {
      expect(ids(reorderOpen(sample(), order))).toEqual(['a', 'b', 'c', 'x', 'y'])
    }
  })
})

describe('moveTo', () => {
  it('dropIndex 는 원래 목록에서 그 순번 앞 자리', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 4)).toEqual(['b', 'c', 'd', 'a'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveTo(['a', 'b', 'c', 'd'], 'c', 1)).toEqual(['a', 'c', 'b', 'd'])
  })
})

describe('teamsInListOrder·openTodoGroups·totalRemaining', () => {
  const group = (id: string): Group => ({ id, name: id, x: 0, y: 0, w: 0, h: 0 })
  const teamIn = (id: string, groupId: string, todos?: TeamTodo[]): Team => ({ ...team(todos), id, name: id, groupId })
  // 그룹 순서 g2 → g1, 팀 배열 순서 a(g1)·b(g2)·c(없는 그룹)·d(g1)·e(g2)
  const office = () => ({
    groups: [group('g2'), group('g1')],
    teams: [
      teamIn('a', 'g1', [todo('a1'), todo('a2', true)]),
      teamIn('b', 'g2', [todo('b1', true)]),
      teamIn('c', 'gone', [todo('c1')]),
      teamIn('d', 'g1'),
      teamIn('e', 'g2', [todo('e2'), todo('e1'), todo('e3', true)]),
    ],
  })

  it('그룹 순 → 그 그룹 팀의 배열 순, 그룹이 지워진 팀은 맨 뒤', () => {
    expect(teamsInListOrder(office()).map((item) => item.id)).toEqual(['b', 'e', 'a', 'd', 'c'])
  })

  it('미완료가 없는 팀(완료만·필드 없음)은 빼고, 할 일은 서버 순서 그대로', () => {
    const groups = openTodoGroups(office())
    expect(groups.map((item) => item.team.id)).toEqual(['e', 'a', 'c'])
    expect(groups.map((item) => ids(item.open))).toEqual([['e2', 'e1'], ['a1'], ['c1']])
  })

  it('모두 없으면 빈 목록, 합계는 0', () => {
    const empty = { groups: [group('g1')], teams: [teamIn('a', 'g1', [todo('a1', true)]), teamIn('d', 'g1')] }
    expect(openTodoGroups(empty)).toEqual([])
    expect(totalRemaining(empty.teams)).toBe(0)
  })

  it('합계는 모든 팀(그룹이 지워진 팀 포함)의 미완료 수', () => {
    expect(totalRemaining(office().teams)).toBe(4)
  })
})
