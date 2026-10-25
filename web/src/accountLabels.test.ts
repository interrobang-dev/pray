import { describe, expect, it } from 'vitest'
import { accountName, accountTitle, busyLabel, impactMeta, isLoginOver, planLabel, reloginLabel, shortList, tokenLabel, turnLabel } from './accountLabels'
import type { Account } from './types'

const NOW = Date.parse('2026-10-25T12:00:00.000Z')
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const DAY = 1440

const ACCOUNT: Account = {
  id: 'a1',
  email: 'kim@example.com',
  displayName: 'Kim',
  organizationName: 'EngSoft',
  plan: 'max 5x',
  isActive: false,
  refreshExpiresAt: null,
  savedAt: '2026-10-20T03:00:00.000Z',
}

describe('reloginLabel', () => {
  it('shows days left, yellow at 3 days or less', () => {
    expect(reloginLabel(inMinutes(12 * DAY + 60), NOW)).toMatchObject({ text: 'Re-login in 12d', level: '' })
    expect(reloginLabel(inMinutes(4 * DAY), NOW)).toMatchObject({ text: 'Re-login in 4d', level: '' })
    expect(reloginLabel(inMinutes(4 * DAY - 1), NOW)).toMatchObject({ text: 'Re-login in 3d', level: 'warn' })
    expect(reloginLabel(inMinutes(DAY), NOW)).toMatchObject({ text: 'Re-login in 1d', level: 'warn' })
  })

  it('shows hours or minutes under a day', () => {
    expect(reloginLabel(inMinutes(DAY - 1), NOW)).toMatchObject({ text: 'Re-login in 23h', level: 'warn' })
    expect(reloginLabel(inMinutes(59), NOW)).toMatchObject({ text: 'Re-login in 59m', level: 'warn' })
    expect(reloginLabel(new Date(NOW + 10_000).toISOString(), NOW)).toMatchObject({ text: 'Re-login in 1m', level: 'warn' })
  })

  it('is red Expired once the time has passed', () => {
    expect(reloginLabel(inMinutes(0), NOW)).toMatchObject({ text: 'Expired', level: 'danger' })
    expect(reloginLabel(inMinutes(-3 * DAY), NOW)).toMatchObject({ text: 'Expired', level: 'danger' })
  })

  it('shows nothing when the time is unknown or not a date', () => {
    expect(reloginLabel(null, NOW)).toBeNull()
    expect(reloginLabel('', NOW)).toBeNull()
    expect(reloginLabel('soon', NOW)).toBeNull()
  })

  it('puts the expiry time in the tooltip', () => {
    expect(reloginLabel(inMinutes(5 * DAY), NOW)?.title).toMatch(/^Sign-in expires /)
    expect(reloginLabel(inMinutes(-5), NOW)?.title).toMatch(/^Sign-in expired /)
  })
})

describe('isLoginOver', () => {
  it('ends the sign-in on 404 and 500', () => {
    expect(isLoginOver(404, { message: 'Sign-in not found or expired. Start it again' })).toBe(true)
    expect(isLoginOver(500, { message: 'Timed out waiting for claude to finish signing in. Start the sign-in again' })).toBe(true)
    expect(isLoginOver(500, null)).toBe(true)
  })

  it('ends a 400 only when the server says isLoginEnded: true', () => {
    expect(isLoginOver(400, { message: 'Claude rejected the code', isLoginEnded: true })).toBe(true)
    expect(isLoginOver(400, { message: 'Invalid code', isLoginEnded: false })).toBe(false)
    expect(isLoginOver(400, { message: 'Invalid code' })).toBe(false)
    expect(isLoginOver(400, { message: 'Invalid code', isLoginEnded: 'true' })).toBe(false)
    expect(isLoginOver(400, null)).toBe(false)
  })

  it('keeps the sign-in on 409 (already checking) and network errors', () => {
    expect(isLoginOver(409, { message: 'Already checking a code for this sign-in' })).toBe(false)
    expect(isLoginOver(0, null)).toBe(false)
  })
})

describe('planLabel', () => {
  it('capitalizes only the first letter', () => {
    expect(planLabel('max')).toBe('Max')
    expect(planLabel('max 5x')).toBe('Max 5x')
    expect(planLabel('pro')).toBe('Pro')
  })
})

describe('accountName', () => {
  it('uses the email, then the display name', () => {
    expect(accountName(ACCOUNT)).toBe('kim@example.com')
    expect(accountName({ ...ACCOUNT, email: null })).toBe('Kim')
    expect(accountName({ ...ACCOUNT, email: null, displayName: null })).toBe('Unknown account')
  })
})

describe('accountTitle', () => {
  it('lists what is known, one per line, and skips the save time if it is not a date', () => {
    expect(accountTitle(ACCOUNT).split('\n').slice(0, 3)).toEqual(['kim@example.com', 'Kim', 'EngSoft'])
    expect(accountTitle(ACCOUNT)).toMatch(/\nSaved /)
    expect(accountTitle({ ...ACCOUNT, displayName: null, organizationName: null, savedAt: 'x' })).toBe('kim@example.com')
  })
})

describe('tokenLabel', () => {
  it('keeps small counts as they are', () => {
    expect(tokenLabel(0)).toBe('0')
    expect(tokenLabel(950)).toBe('950')
    expect(tokenLabel(999.4)).toBe('999')
  })

  it('uses k with one decimal under 10k, whole k up to 500k', () => {
    expect(tokenLabel(999.6)).toBe('1k')
    expect(tokenLabel(1000)).toBe('1k')
    expect(tokenLabel(1234)).toBe('1.2k')
    expect(tokenLabel(9949)).toBe('9.9k')
    expect(tokenLabel(9950)).toBe('10k')
    expect(tokenLabel(12_345)).toBe('12k')
    expect(tokenLabel(182_400)).toBe('182k')
    expect(tokenLabel(499_499)).toBe('499k')
  })

  it('uses M with one decimal from 500k', () => {
    expect(tokenLabel(499_500)).toBe('0.5M')
    expect(tokenLabel(912_345)).toBe('0.9M')
    expect(tokenLabel(1_000_000)).toBe('1M')
    expect(tokenLabel(1_234_567)).toBe('1.2M')
    expect(tokenLabel(12_345_678)).toBe('12.3M')
  })
})

describe('turnLabel', () => {
  it('says working or needs approval for a running turn, whatever the minutes', () => {
    expect(turnLabel({ status: 'working', minutesSinceTurn: 30 })).toBe('working')
    expect(turnLabel({ status: 'needs-approval', minutesSinceTurn: null })).toBe('needs approval')
  })

  it('shows how long ago the turn ended', () => {
    expect(turnLabel({ status: 'my-turn', minutesSinceTurn: 0 })).toBe('just now')
    expect(turnLabel({ status: 'my-turn', minutesSinceTurn: 12 })).toBe('12m ago')
    expect(turnLabel({ status: 'idle', minutesSinceTurn: 59 })).toBe('59m ago')
    expect(turnLabel({ status: 'idle', minutesSinceTurn: 130 })).toBe('2h ago')
    expect(turnLabel({ status: 'unknown', minutesSinceTurn: null })).toBeNull()
  })
})

describe('impactMeta', () => {
  it('joins tokens and turn, leaving out what is unknown', () => {
    expect(impactMeta({ status: 'my-turn', minutesSinceTurn: 12, contextTokens: 182_400 })).toBe('~182k tokens · 12m ago')
    expect(impactMeta({ status: 'working', minutesSinceTurn: null, contextTokens: 640_000 })).toBe('~0.6M tokens · working')
    expect(impactMeta({ status: 'my-turn', minutesSinceTurn: 3, contextTokens: null })).toBe('3m ago')
    expect(impactMeta({ status: 'unknown', minutesSinceTurn: null, contextTokens: 5000 })).toBe('~5k tokens')
    expect(impactMeta({ status: 'unknown', minutesSinceTurn: null, contextTokens: null })).toBe('')
  })
})

describe('busyLabel', () => {
  it('uses singular for one session', () => {
    expect(busyLabel(1)).toBe('1 session is working or waiting for approval.')
    expect(busyLabel(3)).toBe('3 sessions are working or waiting for approval.')
  })
})

describe('shortList', () => {
  const items = (count: number) => Array.from({ length: count }, (_, i) => i)

  it('keeps up to 6 items', () => {
    expect(shortList(items(0))).toEqual({ shown: [], moreCount: 0 })
    expect(shortList(items(6))).toEqual({ shown: items(6), moreCount: 0 })
  })

  it('cuts to 5 and counts the rest past 6', () => {
    expect(shortList(items(7))).toEqual({ shown: items(5), moreCount: 2 })
    expect(shortList(items(8))).toEqual({ shown: items(5), moreCount: 3 })
  })
})
