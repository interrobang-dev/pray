import { describe, expect, it } from 'vitest'
import { DONE_MAX_AGE_MS, isNeedsYou, needsYouSessions } from './needsYou'
import type { Session } from './types'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60_000).toISOString()

type Fields = Pick<Session, 'status' | 'role' | 'isAlive' | 'attendance' | 'turnEndedAt' | 'lastAt'> & { id: string }

function session(id: string, status: Session['status'], overrides: Partial<Fields> = {}): Fields {
  return { id, status, role: null, isAlive: true, attendance: 'present', turnEndedAt: hoursAgo(1), lastAt: hoursAgo(1), ...overrides }
}

describe('isNeedsYou', () => {
  it('takes on-duty sessions that need approval, are waiting for you, or are done', () => {
    expect(isNeedsYou(session('a', 'needs-approval'), NOW)).toBe(true)
    expect(isNeedsYou(session('a', 'my-turn'), NOW)).toBe(true)
    expect(isNeedsYou(session('a', 'done'), NOW)).toBe(true)
    for (const status of ['working', 'waiting', 'idle', 'ended', 'unknown'] as const) {
      expect(isNeedsYou(session('a', status), NOW)).toBe(false)
    }
  })

  it('leaves out sessions on break or off duty, including old responses without attendance', () => {
    expect(isNeedsYou(session('a', 'needs-approval', { attendance: 'break', isAlive: false }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'my-turn', { attendance: 'off', isAlive: false }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'done', { attendance: undefined, isAlive: false }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'done', { attendance: undefined, isAlive: true }), NOW)).toBe(true)
  })

  it('leaves out members whose turn ended (the lead gets it with team_wait) but keeps their approvals', () => {
    expect(isNeedsYou(session('a', 'my-turn', { role: 'member' }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'done', { role: 'member' }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'needs-approval', { role: 'member' }), NOW)).toBe(true)
    expect(isNeedsYou(session('a', 'my-turn', { role: 'lead' }), NOW)).toBe(true)
  })

  it('drops done sessions after a day from the last conversation, falling back to the last line', () => {
    const day = DONE_MAX_AGE_MS / (60 * 60_000)
    expect(day).toBe(24)
    expect(isNeedsYou(session('a', 'done', { turnEndedAt: hoursAgo(23.9) }), NOW)).toBe(true)
    expect(isNeedsYou(session('a', 'done', { turnEndedAt: hoursAgo(24) }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'done', { turnEndedAt: null, lastAt: hoursAgo(30) }), NOW)).toBe(false)
    expect(isNeedsYou(session('a', 'done', { turnEndedAt: null, lastAt: null }), NOW)).toBe(true)
  })

  it('keeps old approvals and your-turn sessions', () => {
    expect(isNeedsYou(session('a', 'my-turn', { turnEndedAt: hoursAgo(72) }), NOW)).toBe(true)
    expect(isNeedsYou(session('a', 'needs-approval', { turnEndedAt: hoursAgo(72) }), NOW)).toBe(true)
  })
})

describe('needsYouSessions', () => {
  it('groups approvals, your turn, then done, each newest first, unknown times last, ties in the original order', () => {
    const sessions = [
      session('done-old', 'done', { turnEndedAt: hoursAgo(5) }),
      session('working', 'working'),
      session('turn-unknown', 'my-turn', { turnEndedAt: null, lastAt: null }),
      session('done-new', 'done', { turnEndedAt: hoursAgo(1) }),
      session('turn-new', 'my-turn', { turnEndedAt: hoursAgo(0.5) }),
      session('approval-old', 'needs-approval', { turnEndedAt: hoursAgo(3) }),
      session('turn-tie-a', 'my-turn', { turnEndedAt: hoursAgo(2) }),
      session('turn-tie-b', 'my-turn', { turnEndedAt: hoursAgo(2) }),
      session('approval-new', 'needs-approval', { turnEndedAt: null, lastAt: hoursAgo(0.1) }),
      session('member-done', 'done', { role: 'member' }),
      session('done-stale', 'done', { turnEndedAt: hoursAgo(30) }),
    ]
    expect(needsYouSessions(sessions, NOW).map((s) => s.id)).toEqual([
      'approval-new',
      'approval-old',
      'turn-new',
      'turn-tie-a',
      'turn-tie-b',
      'turn-unknown',
      'done-new',
      'done-old',
    ])
    expect(needsYouSessions([], NOW)).toEqual([])
  })
})
