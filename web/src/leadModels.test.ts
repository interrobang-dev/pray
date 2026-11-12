import { describe, expect, it } from 'vitest'
import { initialRows, leadBlockReason, leadPlaceOf, leadSessions, modelRequestBody, modelSwitchImpact, rowsToApply } from './leadModels'
import type { Session, Team } from './types'

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    kind: 'web',
    role: 'lead',
    isAlive: true,
    attendance: 'present',
    status: 'my-turn',
    pendingTool: null,
    shells: [],
    model: 'claude-opus-5-5',
    effort: 'high',
    modelSetting: null,
    contextTokens: 100_000,
    teamId: 't1',
    partId: null,
    ...overrides,
  } as Session
}

const teams = [{ id: 't1', name: 'Pray', parts: [{ id: 'p1', name: 'Web' }] }] as unknown as Team[]

describe('leadSessions', () => {
  it('takes on-duty web leads and part leads only', () => {
    const sessions = [
      session('lead'),
      session('part-lead', { partId: 'p1' }),
      session('member', { role: 'member' }),
      session('break', { attendance: 'break', isAlive: false }),
      session('off', { attendance: 'off', isAlive: false }),
      session('external', { kind: 'external' }),
    ]
    expect(leadSessions(sessions).map((lead) => lead.id)).toEqual(['lead', 'part-lead'])
  })
})

describe('leadPlaceOf', () => {
  it('names the team, the part, or Focus Zone', () => {
    expect(leadPlaceOf({ teamId: 't1', partId: null }, teams)).toBe('Pray')
    expect(leadPlaceOf({ teamId: 't1', partId: 'p1' }, teams)).toBe('Pray · Web')
    expect(leadPlaceOf({ teamId: 'gone', partId: null }, teams)).toBe('Focus Zone')
  })
})

describe('rows', () => {
  it('starts all checked with the current choice, so nothing applies yet', () => {
    const rows = initialRows([session('a'), session('b', { status: 'working' })])
    expect(rows.map((row) => row.isChecked)).toEqual([true, true])
    expect(rows[0].choice).toEqual({ model: 'opus', effort: 'high' })
    expect(rowsToApply(rows)).toEqual([])
  })

  it('applies checked rows whose choice changed', () => {
    const [a, b, c] = initialRows([session('a'), session('b'), session('c', { model: null, effort: null })])
    const rows = [
      { ...a, choice: { model: 'sonnet' as const, effort: 'high' as const } },
      { ...b, choice: { model: 'sonnet' as const, effort: 'high' as const }, isChecked: false },
      { ...c, choice: { model: null, effort: 'max' as const } },
    ]
    expect(rowsToApply(rows).map((row) => row.sessionId)).toEqual(['a'])
  })

  it('sums context only for rows whose model changes', () => {
    const sessions = [session('a', { contextTokens: 150_000 }), session('b', { contextTokens: 90_000 }), session('c', { contextTokens: null })]
    const [a, b, c] = initialRows(sessions)
    const rows = [
      { ...a, choice: { model: 'sonnet' as const, effort: 'high' as const } },
      { ...b, choice: { model: 'opus' as const, effort: 'max' as const } },
      { ...c, choice: { model: 'haiku' as const, effort: 'high' as const } },
    ]
    expect(modelSwitchImpact(rows, sessions)).toEqual({ count: 2, tokens: 150_000 })
  })
})

describe('modelRequestBody', () => {
  it('sends auto effort as null', () => {
    expect(modelRequestBody({ model: 'sonnet', effort: 'auto' })).toEqual({ model: 'sonnet', effort: null })
    expect(modelRequestBody({ model: 'opus', effort: 'max' })).toEqual({ model: 'opus', effort: 'max' })
    expect(modelRequestBody({ model: null, effort: 'max' })).toBeNull()
  })
})

describe('leadBlockReason', () => {
  it('shows what the screen knows', () => {
    expect(leadBlockReason(session('a', { status: 'working' }))).toBe('Wait until claude finishes')
    expect(leadBlockReason(session('b', { status: 'waiting' }))).toBe('Wait until background tasks finish')
    expect(leadBlockReason(session('c'))).toBeNull()
  })
})
