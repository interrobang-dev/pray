import { describe, expect, it } from 'vitest'
import { AuthStore, isLoopback, parseCookie } from './auth.js'

function makeStore(startAt = 1_000_000) {
  let now = startAt
  const store = new AuthStore(['me@example.com'], null, () => now)
  return { store, advance: (ms: number) => (now += ms) }
}

describe('AuthStore', () => {
  it('issues a code only for allowed emails and verifies it once', () => {
    const { store } = makeStore()
    expect(store.requestCode('other@example.com').result).toBe('not-allowed')
    const { result, code } = store.requestCode('Me@Example.com')
    expect(result).toBe('sent')
    expect(code).toMatch(/^\d{6}$/)
    const verified = store.verifyCode('me@example.com', code!)
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(store.emailOf(verified.token)).toBe('me@example.com')
    expect(store.verifyCode('me@example.com', code!)).toEqual({ ok: false, reason: 'no-code' })
  })

  it('rejects wrong codes and locks after 5 attempts', () => {
    const { store } = makeStore()
    const { code } = store.requestCode('me@example.com')
    for (let i = 0; i < 5; i++) expect(store.verifyCode('me@example.com', '000000')).toEqual({ ok: false, reason: 'wrong' })
    expect(store.verifyCode('me@example.com', code!)).toEqual({ ok: false, reason: 'locked' })
  })

  it('expires codes after 10 minutes and throttles resend for 30 seconds', () => {
    const { store, advance } = makeStore()
    const { code } = store.requestCode('me@example.com')
    expect(store.requestCode('me@example.com').result).toBe('too-soon')
    advance(11 * 60 * 1000)
    expect(store.verifyCode('me@example.com', code!)).toEqual({ ok: false, reason: 'expired' })
  })

  it('expires tokens after 30 days and revokes on logout', () => {
    const { store, advance } = makeStore()
    const { code } = store.requestCode('me@example.com')
    const verified = store.verifyCode('me@example.com', code!)
    if (!verified.ok) throw new Error('unexpected')
    advance(31 * 24 * 60 * 60 * 1000)
    expect(store.emailOf(verified.token)).toBeNull()
    store.revoke(verified.token)
    expect(store.emailOf(verified.token)).toBeNull()
  })
})

describe('helpers', () => {
  it('detects loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopback('192.168.0.10')).toBe(false)
    expect(isLoopback(undefined)).toBe(false)
  })

  it('reads a cookie by name', () => {
    expect(parseCookie('a=1; jk_session=abc%3D; b=2', 'jk_session')).toBe('abc=')
    expect(parseCookie(undefined, 'jk_session')).toBeUndefined()
  })
})
