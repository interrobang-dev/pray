import { describe, expect, it } from 'vitest'
import { accountName, accountTitle, isLoginOver, planLabel, reloginLabel } from './accountLabels'
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
