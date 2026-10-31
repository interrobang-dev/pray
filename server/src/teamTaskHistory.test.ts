import { describe, expect, it } from 'vitest'
import type { TeamEvent } from './teamTaskFile.js'
import { HISTORY_INSTRUCTION_LIMIT, taskDetailOf, taskHistoryOf } from './teamTaskHistory.js'
import type { Task } from './teamState.js'

const task = (id: string, fields: Partial<Task>): Task => ({
  id,
  teamId: 't1',
  partId: null,
  memberSessionId: 'm1',
  instruction: `지시 ${id}`,
  status: 'done',
  isAcknowledged: true,
  result: `결과 ${id}`,
  error: null,
  createdAt: '2026-10-31T00:00:00Z',
  finishedAt: '2026-10-31T00:10:00Z',
  isDelivered: true,
  startContextTokens: 1000,
  startIdleSince: null,
  endContextTokens: 5000,
  ...fields,
})

const event = (sessionId: string, at: string, fields: Partial<TeamEvent> = {}): TeamEvent => ({
  kind: 'spawn',
  at,
  teamId: 't1',
  partId: null,
  sessionId,
  position: 'FE',
  model: 'sonnet',
  effort: null,
  contextTokens: null,
  idleSince: null,
  ...fields,
})

const lookup = (id: string) => (id === 'm1' ? { name: 'Jisoo', position: 'FE' } : null)

describe('taskHistoryOf', () => {
  it('lists only this team, newest first, with member names when the session is still listed', () => {
    const history = taskHistoryOf(
      't1',
      [
        task('a', { createdAt: '2026-10-31T01:00:00Z' }),
        task('other', { teamId: 't2' }),
        task('b', { createdAt: '2026-10-31T02:00:00Z', memberSessionId: 'gone', partId: 'p1' }),
      ],
      [event('m1', '2026-10-31T00:00:00Z'), event('x', '2026-10-31T03:00:00Z', { kind: 'dismiss', teamId: 't2' })],
      lookup,
    )
    expect(history.tasks.map((t) => [t.id, t.memberName, t.partId])).toEqual([
      ['b', null, 'p1'],
      ['a', 'Jisoo', null],
    ])
    const { teamId: _teamId, ...spawn } = event('m1', '2026-10-31T00:00:00Z')
    expect(history.events).toEqual([{ ...spawn, memberName: 'Jisoo' }])
  })

  it('keeps only the head of the instruction and no result', () => {
    const [item] = taskHistoryOf('t1', [task('a', { instruction: 'i'.repeat(HISTORY_INSTRUCTION_LIMIT + 1) })], [], lookup).tasks
    expect(item.instruction).toHaveLength(HISTORY_INSTRUCTION_LIMIT)
    expect(item.isInstructionClipped).toBe(true)
    expect(item.hasResult).toBe(true)
    expect(item).not.toHaveProperty('result')
    expect(taskHistoryOf('t1', [task('r', { status: 'running', result: null })], [], lookup).tasks[0].hasResult).toBe(false)
  })

  it('puts the later-added task first when times are equal', () => {
    const ids = taskHistoryOf('t1', [task('a', {}), task('b', {})], [], lookup).tasks.map((t) => t.id)
    expect(ids).toEqual(['b', 'a'])
  })
})

describe('taskDetailOf', () => {
  it('gives the full task of this team only', () => {
    const full = task('a', { instruction: 'i'.repeat(1000), result: 'r'.repeat(1000) })
    expect(taskDetailOf('t1', full, lookup)).toEqual({ ...full, memberName: 'Jisoo', memberPosition: 'FE' })
    expect(taskDetailOf('t2', full, lookup)).toBeNull()
    expect(taskDetailOf('t1', undefined, lookup)).toBeNull()
  })
})
