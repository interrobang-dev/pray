import { describe, expect, it } from 'vitest'
import { clipStatusText, idleSinceOf, STATUS_INACTIVE_MEMBER_LIMIT, teamMemberOf, teamStatusMembers, teamStatusTasks } from './teamMembers.js'
import type { Task } from './teamState.js'
import type { Session } from './types.js'

const session = (fields: Partial<Session>): Session => ({
  id: 'abcdef1234567890',
  cwd: 'd:/repo',
  name: null,
  position: 'FE',
  title: '제목',
  status: 'done',
  kind: 'web',
  attendance: 'present',
  isAlive: true,
  offDuty: null,
  createdAt: null,
  lastAt: '2026-10-31T01:05:00Z',
  turnEndedAt: '2026-10-31T01:00:00Z',
  lastAssistantText: '끝',
  model: 'claude-sonnet-5-5',
  effort: 'high',
  modelSetting: null,
  contextTokens: 123456,
  turnUsage: null,
  pendingTool: null,
  approvalRequestedAt: null,
  workingSince: null,
  role: 'member',
  teamId: 't1',
  partId: null,
  question: null,
  suggestion: null,
  handover: null,
  shells: [],
  character: null,
  gender: null,
  ...fields,
})

describe('idleSinceOf', () => {
  it('is null while the member is still in its turn', () => {
    expect(idleSinceOf('working', '2026-10-31T01:00:00Z')).toBeNull()
    expect(idleSinceOf('needs-approval', '2026-10-31T01:00:00Z')).toBeNull()
    expect(idleSinceOf('waiting', '2026-10-31T01:00:00Z')).toBeNull()
  })

  it('is the last conversation line time once the turn is over', () => {
    for (const status of ['done', 'my-turn', 'idle', 'ended', 'unknown'] as const) {
      expect(idleSinceOf(status, '2026-10-31T01:00:00Z')).toBe('2026-10-31T01:00:00Z')
    }
    expect(idleSinceOf('done', null)).toBeNull()
  })
})

describe('teamMemberOf', () => {
  it('carries context size and idle time for team_status', () => {
    expect(teamMemberOf(session({}))).toEqual({
      sessionId: 'abcdef1234567890',
      name: '제목',
      position: 'FE',
      kind: 'web',
      role: 'member',
      status: 'done',
      isAlive: true,
      model: 'claude-sonnet-5-5',
      effort: 'high',
      contextTokens: 123456,
      idleSince: '2026-10-31T01:00:00Z',
      lastAssistantText: '끝',
      pendingTool: null,
    })
  })

  it('uses name, then title, then the id prefix', () => {
    expect(teamMemberOf(session({ name: 'Jisoo' })).name).toBe('Jisoo')
    expect(teamMemberOf(session({ title: null })).name).toBe('abcdef12')
  })

  it('has no idle time while working', () => {
    expect(teamMemberOf(session({ status: 'working', contextTokens: null }))).toMatchObject({ idleSince: null, contextTokens: null })
  })

  it('carries only the head of a long last message', () => {
    expect(teamMemberOf(session({ lastAssistantText: 'a'.repeat(500) })).lastAssistantText).toBe(`${'a'.repeat(200)}…`)
    expect(teamMemberOf(session({ lastAssistantText: null })).lastAssistantText).toBeNull()
  })
})

describe('teamStatusMembers', () => {
  const off = (id: string, endedAt: string, reason: 'released' | 'error' = 'released') =>
    session({ id, name: id, attendance: 'off', isAlive: false, offDuty: { endedAt, reason, exitCode: null } })

  it('keeps live sessions in full and the rest in short form, break first then latest off duty', () => {
    const lead = session({ id: 'lead', role: 'lead', name: 'Lead' })
    const live = session({ id: 'm1', name: 'Jisoo' })
    const onBreak = session({ id: 'b1', name: 'Minji', attendance: 'break', isAlive: false })
    const result = teamStatusMembers([off('o1', '2026-10-31T01:00:00Z'), lead, onBreak, live, off('o2', '2026-10-31T02:00:00Z', 'error')])
    expect(result.members.map((m) => m.sessionId)).toEqual(['lead', 'm1'])
    expect(result.members[1]).toEqual(teamMemberOf(live))
    expect(result.inactiveMembers).toEqual([
      { sessionId: 'b1', name: 'Minji', position: 'FE', attendance: 'break', endedAt: null, reason: null },
      { sessionId: 'o2', name: 'o2', position: 'FE', attendance: 'off', endedAt: '2026-10-31T02:00:00Z', reason: 'error' },
      { sessionId: 'o1', name: 'o1', position: 'FE', attendance: 'off', endedAt: '2026-10-31T01:00:00Z', reason: 'released' },
    ])
    expect(result.inactiveMemberCount).toBe(3)
  })

  it('cuts inactive sessions at the limit but counts them all', () => {
    const many = Array.from({ length: STATUS_INACTIVE_MEMBER_LIMIT + 3 }, (_, i) => off(`o${i}`, `2026-10-31T${String(i).padStart(2, '0')}:00:00Z`))
    const result = teamStatusMembers(many)
    expect(result.inactiveMembers).toHaveLength(STATUS_INACTIVE_MEMBER_LIMIT)
    expect(result.inactiveMembers[0].sessionId).toBe(`o${STATUS_INACTIVE_MEMBER_LIMIT + 2}`)
    expect(result.inactiveMemberCount).toBe(STATUS_INACTIVE_MEMBER_LIMIT + 3)
    expect(result.members).toEqual([])
  })
})

describe('clipStatusText', () => {
  it('keeps short text and cuts long text at the limit', () => {
    expect(clipStatusText('a'.repeat(200))).toBe('a'.repeat(200))
    expect(clipStatusText('a'.repeat(201))).toBe(`${'a'.repeat(200)}…`)
    expect(clipStatusText(null)).toBeNull()
  })
})

describe('teamStatusTasks', () => {
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
    startContextTokens: null,
    startIdleSince: null,
    endContextTokens: null,
    usage: null,
    model: null,
    ...fields,
  })

  it('keeps running and undelivered tasks, and only the latest delivered ones', () => {
    const delivered = Array.from({ length: 8 }, (_, i) => task(`d${i}`, {}))
    const running = task('r', { status: 'running', result: null, finishedAt: null, isDelivered: false })
    const undelivered = task('u', { status: 'failed', result: null, error: '실패', isDelivered: false })
    const ids = teamStatusTasks([running, ...delivered.slice(0, 4), undelivered, ...delivered.slice(4)]).map((t) => t.id)
    expect(ids).toEqual(['r', 'd3', 'u', 'd4', 'd5', 'd6', 'd7'])
  })

  it('cuts instruction and result to their heads without touching the store', () => {
    const original = task('a', { instruction: 'i'.repeat(300), result: 'r'.repeat(300) })
    const [view] = teamStatusTasks([original])
    expect(view.instruction).toBe(`${'i'.repeat(200)}…`)
    expect(view.result).toBe(`${'r'.repeat(200)}…`)
    expect(original.result).toHaveLength(300)
  })
})
