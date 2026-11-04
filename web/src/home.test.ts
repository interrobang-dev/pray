import { describe, expect, it } from 'vitest'
import { greetingOf, lastActivityOf, recentSessions } from './home'

const session = (id: string, turnEndedAt: string | null, lastAt: string | null = null) => ({ id, turnEndedAt, lastAt })

describe('lastActivityOf', () => {
  it('prefers the last conversation line, then the last line, and is null when unknown', () => {
    expect(lastActivityOf(session('a', '2026-11-04T01:00:00Z', '2026-11-04T02:00:00Z'))).toBe(Date.parse('2026-11-04T01:00:00Z'))
    expect(lastActivityOf(session('a', null, '2026-11-04T02:00:00Z'))).toBe(Date.parse('2026-11-04T02:00:00Z'))
    expect(lastActivityOf(session('a', null, null))).toBeNull()
    expect(lastActivityOf(session('a', 'not a date'))).toBeNull()
  })
})

describe('recentSessions', () => {
  it('sorts by the latest conversation, unknown ones last, ties in the original order, up to the limit', () => {
    const sessions = [
      session('old', '2026-11-04T01:00:00Z'),
      session('unknown', null),
      session('new', '2026-11-04T03:00:00Z'),
      session('tie-a', '2026-11-04T02:00:00Z'),
      session('tie-b', '2026-11-04T02:00:00Z'),
    ]
    expect(recentSessions(sessions).map((s) => s.id)).toEqual(['new', 'tie-a', 'tie-b', 'old', 'unknown'])
    expect(recentSessions(sessions, 2).map((s) => s.id)).toEqual(['new', 'tie-a'])
    expect(recentSessions([])).toEqual([])
  })
})

describe('greetingOf', () => {
  it('follows the hour of this PC', () => {
    expect([0, 11, 12, 17, 18, 23].map(greetingOf)).toEqual([
      'Good morning',
      'Good morning',
      'Good afternoon',
      'Good afternoon',
      'Good evening',
      'Good evening',
    ])
  })
})
