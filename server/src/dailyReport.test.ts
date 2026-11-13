import { describe, expect, it } from 'vitest'
import type { Team, Todo } from '@pray/host/team'
import type { TeamEvent } from './teamTaskFile.js'
import type { Task } from './teamState.js'
import {
  dailyEventsOf,
  dailyTasksOf,
  dailyTodosOf,
  dailyTokensOf,
  dayRangeOf,
  firstLine,
  leadIdsOf,
  localDateKey,
  oldestDateOf,
  parseDayParam,
} from './dailyReport.js'

const NOW = new Date(2026, 10, 13, 15, 30)
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString()

function task(partial: Partial<Task>): Task {
  return {
    id: 't',
    teamId: 'team',
    partId: null,
    memberSessionId: 'm1',
    instruction: '\n  첫 줄 지시\n둘째',
    status: 'done',
    isAcknowledged: true,
    result: '결과 첫 줄\n자세히',
    error: null,
    createdAt: at(13, 9),
    finishedAt: at(13, 10),
    isDelivered: true,
    startContextTokens: null,
    startIdleSince: null,
    endContextTokens: null,
    usage: null,
    model: null,
    ...partial,
  }
}

describe('dailyReport 날짜', () => {
  it('로컬 자정부터 다음 자정까지', () => {
    const range = dayRangeOf(NOW)
    expect(range.date).toBe('2026-11-13')
    expect(range.from.getTime()).toBe(new Date(2026, 10, 13).getTime())
    expect(range.to.getTime()).toBe(new Date(2026, 10, 14).getTime())
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('?date= 는 오늘부터 7일 전까지만, 빠지면 오늘', () => {
    expect(parseDayParam(undefined, NOW)?.date).toBe('2026-11-13')
    expect(parseDayParam('2026-11-06', NOW)?.date).toBe('2026-11-06')
    expect(oldestDateOf(NOW)).toBe('2026-11-06')
    expect(parseDayParam('2026-11-05', NOW)).toBeNull()
    expect(parseDayParam('2026-11-14', NOW)).toBeNull()
    expect(parseDayParam('2026-02-30', NOW)).toBeNull()
    expect(parseDayParam('2026-11-1', NOW)).toBeNull()
    expect(parseDayParam(['2026-11-13'], NOW)).toBeNull()
  })

  it('달을 넘는 날짜', () => {
    const range = parseDayParam('2026-11-01', new Date(2026, 10, 3))!
    expect(range.to.getTime()).toBe(new Date(2026, 10, 2).getTime())
    expect(oldestDateOf(new Date(2026, 10, 3))).toBe('2026-10-27')
  })
})

describe('firstLine', () => {
  it('빈 줄이 아닌 첫 줄, 길면 자른다', () => {
    expect(firstLine('\n\n  hello  \nworld')).toBe('hello')
    expect(firstLine('')).toBeNull()
    expect(firstLine(null)).toBeNull()
    expect(firstLine(' \n ')).toBeNull()
    expect(firstLine('abcdef', 3)).toBe('abc…')
  })
})

describe('dailyTasksOf', () => {
  const range = dayRangeOf(NOW)
  const lookup = (id: string) => (id === 'm1' ? { name: 'Jisoo', position: 'FE' } : null)

  it('끝난 시각이 그날인 task, 진행 중은 지시 시각이 그날인 것, 최근순', () => {
    const tasks = [
      task({ id: 'a', finishedAt: at(13, 10) }),
      task({ id: 'b', createdAt: at(12, 20), finishedAt: at(13, 1) }),
      task({ id: 'c', finishedAt: at(12, 23) }),
      task({ id: 'd', status: 'running', finishedAt: null, createdAt: at(13, 14) }),
      task({ id: 'e', status: 'running', finishedAt: null, createdAt: at(12, 14) }),
      task({ id: 'f', teamId: 'other' }),
      task({ id: 'g', status: 'failed', error: '오류', result: null, finishedAt: at(13, 12), memberSessionId: 'gone' }),
    ]
    const result = dailyTasksOf('team', tasks, range, lookup)
    expect(result.map((item) => item.id)).toEqual(['d', 'g', 'a', 'b'])
    expect(result[2]).toMatchObject({ memberName: 'Jisoo', memberPosition: 'FE', instructionHead: '첫 줄 지시', resultHead: '결과 첫 줄', hasError: false })
    expect(result[1]).toMatchObject({ memberName: null, resultHead: null, hasError: true })
  })
})

describe('dailyTodosOf·dailyEventsOf', () => {
  const range = dayRangeOf(NOW)
  it('그날 끝낸 할 일만 최근순', () => {
    const todos: Todo[] = [
      { id: '1', text: 'a', isDone: true, createdAt: at(1, 1), doneAt: at(13, 9) },
      { id: '2', text: 'b', isDone: true, createdAt: at(1, 1), doneAt: at(12, 9) },
      { id: '3', text: 'c', isDone: false, createdAt: at(1, 1), doneAt: null },
      { id: '4', text: 'd', isDone: true, createdAt: at(1, 1), doneAt: at(13, 11), priority: 'high' },
    ]
    expect(dailyTodosOf(todos, range)).toEqual([
      { id: '4', text: 'd', priority: 'high', doneAt: at(13, 11) },
      { id: '1', text: 'a', priority: null, doneAt: at(13, 9) },
    ])
  })

  it('그날 spawn·dismiss 수', () => {
    const event = (kind: TeamEvent['kind'], when: string, teamId = 'team'): TeamEvent => ({
      kind,
      at: when,
      teamId,
      partId: null,
      sessionId: 's',
      position: null,
      model: null,
      effort: null,
      contextTokens: null,
      idleSince: null,
    })
    const events = [event('spawn', at(13, 1)), event('spawn', at(13, 2)), event('dismiss', at(13, 3)), event('dismiss', at(12, 3)), event('spawn', at(13, 1), 'other')]
    expect(dailyEventsOf('team', events, range)).toEqual({ joined: 2, released: 1 })
  })
})

describe('토큰 나누기', () => {
  const usage = (outputTokens: number) => ({ inputTokens: 1, outputTokens, cacheCreationTokens: 2, cacheReadTokens: 3, turns: 1 })

  it('리드 ID: 지금 지시자·파트장·팀 폴더 웹 기록의 --mcp-config', () => {
    const team = {
      id: 'team',
      cwd: 'D:\\repo',
      leadSessionId: 'lead-now',
      parts: [{ id: 'p', name: 'P', leadSessionId: 'part-lead', createdAt: '' }],
    } as unknown as Team
    const records = [
      { sessionId: 'old-lead', cwd: 'd:/repo/', extraArgs: ['--append-system-prompt', 'x', '--mcp-config', '{}'] },
      { sessionId: 'member', cwd: 'D:\\repo', extraArgs: ['--name', 'x'] },
      { sessionId: 'elsewhere', cwd: 'D:\\other', extraArgs: ['--mcp-config', '{}'] },
    ]
    const isTeamCwd = (cwd: string) => cwd.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === 'd:/repo'
    expect([...leadIdsOf(team, records, isTeamCwd)].sort()).toEqual(['lead-now', 'old-lead', 'part-lead'])
  })

  it('리드 > 팀원 > 그 밖으로 더하고 세션 줄은 출력 많은 순', () => {
    const bySession = new Map([
      ['lead', { usage: usage(10), model: 'claude-opus-5-5' }],
      ['m1', { usage: usage(30), model: 'claude-sonnet-5-5' }],
      ['m2', { usage: usage(5), model: null }],
      ['x', { usage: usage(1), model: null }],
    ])
    const tokens = dailyTokensOf(bySession, { leadIds: new Set(['lead']), memberIds: new Set(['m1', 'm2', 'lead']) }, (id) => (id === 'm1' ? { name: 'Jisoo', position: 'FE' } : null))
    expect(tokens.lead).toEqual(usage(10))
    expect(tokens.members).toEqual({ inputTokens: 2, outputTokens: 35, cacheCreationTokens: 4, cacheReadTokens: 6, turns: 2 })
    expect(tokens.other).toEqual(usage(1))
    expect(tokens.sessions.map((s) => [s.sessionId, s.kind])).toEqual([
      ['m1', 'member'],
      ['lead', 'lead'],
      ['m2', 'member'],
      ['x', 'other'],
    ])
    expect(tokens.sessions[0]).toMatchObject({ name: 'Jisoo', position: 'FE', model: 'claude-sonnet-5-5' })
  })

  it('세션이 없으면 셋 다 null', () => {
    expect(dailyTokensOf(new Map(), { leadIds: new Set(), memberIds: new Set() }, () => null)).toEqual({ lead: null, members: null, other: null, sessions: [] })
  })
})
