import { describe, expect, it } from 'vitest'
import { hookWarningOf, hookWarningToast, shouldNotifyHookWarning } from './hookNotice'

describe('hookWarningOf', () => {
  it('failed 일 때만 글, 나머지는 null', () => {
    expect(hookWarningOf({ state: 'failed', message: 'bad json' })).toBe('bad json')
    expect(hookWarningOf({ state: 'failed', message: null })).toMatch(/aren't in/)
    expect(hookWarningOf({ state: 'ok' })).toBeNull()
    expect(hookWarningOf({ state: 'installed' })).toBeNull()
    expect(hookWarningOf({ message: 'Not found' })).toBeNull()
    expect(hookWarningOf(null)).toBeNull()
  })
})

describe('shouldNotifyHookWarning', () => {
  it('새로 생기거나 글이 바뀔 때만', () => {
    expect(shouldNotifyHookWarning(null, 'a')).toBe(true)
    expect(shouldNotifyHookWarning('a', 'a')).toBe(false)
    expect(shouldNotifyHookWarning('a', 'b')).toBe(true)
    expect(shouldNotifyHookWarning('a', null)).toBe(false)
  })
})

describe('hookWarningToast', () => {
  it('제목과 이유가 든 본문', () => {
    const toast = hookWarningToast('bad json')
    expect(toast.title).toBe('Pray hooks missing')
    expect(toast.body).toMatch(/^bad json\. /)
    expect(toast.iconUrl).toBeNull()
  })
})
