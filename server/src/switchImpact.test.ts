import { describe, expect, it } from 'vitest'
import { hasBusyWebSessions, isBusy, switchImpact, type ImpactCandidate } from './switchImpact.js'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function candidate(id: string, fields: Partial<ImpactCandidate> = {}): ImpactCandidate {
  return {
    id,
    name: null,
    title: null,
    kind: 'web',
    status: 'my-turn',
    attendance: 'present',
    turnEndedAt: minutesAgo(5),
    contextTokens: 1000,
    ...fields,
  }
}

const ids = (sessions: { id: string }[]) => sessions.map((s) => s.id)

describe('switchImpact', () => {
  it('counts sessions whose turn ended less than 60 minutes ago', () => {
    const impact = switchImpact(
      [
        candidate('just-now', { turnEndedAt: minutesAgo(0) }),
        candidate('almost', { turnEndedAt: new Date(NOW - 60 * 60_000 + 1).toISOString() }),
        candidate('exactly-60', { turnEndedAt: minutesAgo(60) }),
        candidate('old', { turnEndedAt: minutesAgo(61) }),
      ],
      NOW,
    )
    expect(ids(impact.recentSessions).sort()).toEqual(['almost', 'just-now'])
    expect(impact.recentSessions.find((s) => s.id === 'almost')?.minutesSinceTurn).toBe(59)
    expect(impact.busySessions).toEqual([])
  })

  it('counts working and needs-approval sessions however old the turn is, and lists them as busy', () => {
    const impact = switchImpact(
      [
        candidate('working', { status: 'working', turnEndedAt: minutesAgo(300) }),
        candidate('approval', { status: 'needs-approval', turnEndedAt: null, kind: 'external' }),
        candidate('idle', { status: 'idle', turnEndedAt: minutesAgo(300) }),
        candidate('unknown', { status: 'unknown', turnEndedAt: minutesAgo(10) }),
      ],
      NOW,
    )
    expect(ids(impact.recentSessions).sort()).toEqual(['approval', 'unknown', 'working'])
    expect(ids(impact.busySessions).sort()).toEqual(['approval', 'working'])
    expect(impact.busySessions.find((s) => s.id === 'approval')).toMatchObject({ kind: 'external', minutesSinceTurn: null })
  })

  it('leaves out break and off-duty sessions even if they look busy or recent', () => {
    const impact = switchImpact(
      [
        candidate('break', { attendance: 'break', status: 'working' }),
        candidate('off', { attendance: 'off', status: 'needs-approval', turnEndedAt: minutesAgo(1) }),
      ],
      NOW,
    )
    expect(impact).toEqual({ recentSessions: [], totalContextTokens: 0, busySessions: [] })
  })

  it('treats unknown or unreadable turn times as not recent, and future times as just now', () => {
    const impact = switchImpact(
      [
        candidate('none', { turnEndedAt: null }),
        candidate('broken', { turnEndedAt: 'not a date' }),
        candidate('future', { turnEndedAt: minutesAgo(-3) }),
      ],
      NOW,
    )
    expect(impact.recentSessions).toMatchObject([{ id: 'future', minutesSinceTurn: 0 }])
  })

  it('sums context tokens with null as 0 and sorts by context tokens, nulls last', () => {
    const impact = switchImpact(
      [
        candidate('small', { contextTokens: 20_000 }),
        candidate('unknown-b', { contextTokens: null, status: 'working' }),
        candidate('large', { contextTokens: 450_000, status: 'working' }),
        candidate('unknown-a', { contextTokens: null }),
        candidate('zero', { contextTokens: 0 }),
      ],
      NOW,
    )
    expect(ids(impact.recentSessions)).toEqual(['large', 'small', 'zero', 'unknown-a', 'unknown-b'])
    expect(impact.totalContextTokens).toBe(470_000)
    expect(ids(impact.busySessions)).toEqual(['large', 'unknown-b'])
  })

  it('names sessions like the list does and keeps only the impact fields', () => {
    // 서버는 Session 전체에 contextTokens 를 붙여 넘긴다 — 나머지 필드(마지막 말 등)는 응답에 싣지 않는다
    const fullSession = {
      ...candidate('named', { name: '[FE] Minji', title: '자동 제목', contextTokens: 1 }),
      cwd: 'D:/workspace/x',
      lastAssistantText: '마지막 말',
    }
    const impact = switchImpact(
      [
        candidate('a56abbde-182b-475e-ab39-c3cf9c7933a7', { contextTokens: 3 }),
        candidate('titled', { title: '자동 제목', contextTokens: 2 }),
        fullSession,
      ],
      NOW,
    )
    expect(impact.recentSessions).toEqual([
      { id: 'a56abbde-182b-475e-ab39-c3cf9c7933a7', name: 'a56abbde', kind: 'web', status: 'my-turn', minutesSinceTurn: 5, contextTokens: 3 },
      { id: 'titled', name: '자동 제목', kind: 'web', status: 'my-turn', minutesSinceTurn: 5, contextTokens: 2 },
      { id: 'named', name: '[FE] Minji', kind: 'web', status: 'my-turn', minutesSinceTurn: 5, contextTokens: 1 },
    ])
  })
})

describe('isBusy', () => {
  it('is true only for on-duty working or needs-approval', () => {
    expect(isBusy({ attendance: 'present', status: 'working' })).toBe(true)
    expect(isBusy({ attendance: 'present', status: 'needs-approval' })).toBe(true)
    expect(isBusy({ attendance: 'present', status: 'my-turn' })).toBe(false)
    expect(isBusy({ attendance: 'break', status: 'working' })).toBe(false)
  })
})

describe('hasBusyWebSessions', () => {
  it('ignores external sessions and sessions that are not on duty', () => {
    expect(hasBusyWebSessions([])).toBe(false)
    expect(hasBusyWebSessions([{ kind: 'external', attendance: 'present', status: 'working' }])).toBe(false)
    expect(hasBusyWebSessions([{ kind: 'web', attendance: 'off', status: 'working' }])).toBe(false)
    expect(
      hasBusyWebSessions([
        { kind: 'web', attendance: 'present', status: 'my-turn' },
        { kind: 'web', attendance: 'present', status: 'needs-approval' },
      ]),
    ).toBe(true)
  })
})
