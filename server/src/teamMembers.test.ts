import { describe, expect, it } from 'vitest'
import { idleSinceOf, teamMemberOf } from './teamMembers.js'
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
  pendingTool: null,
  workingSince: null,
  role: 'member',
  teamId: 't1',
  partId: null,
  question: null,
  suggestion: null,
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
})
