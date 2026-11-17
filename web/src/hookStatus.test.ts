import { describe, expect, it } from 'vitest'
import { hookWarningTitle, parseHookStatus } from './hookStatus'

describe('parseHookStatus', () => {
  it('꼴에 맞으면 값, 아니면 null', () => {
    expect(parseHookStatus({ state: 'failed', missing: ['Stop', 3], message: 'bad', checkedAt: 'x' })).toEqual({ state: 'failed', missing: ['Stop'], message: 'bad' })
    expect(parseHookStatus({ state: 'ok', added: [] })).toEqual({ state: 'ok', missing: [], message: null })
    expect(parseHookStatus({ state: 'weird' })).toBeNull()
    expect(parseHookStatus(null)).toBeNull()
    expect(parseHookStatus('ok')).toBeNull()
  })
})

describe('hookWarningTitle', () => {
  it('서버 문구가 있으면 그것, 없으면 기본 문구로 시작한다', () => {
    expect(hookWarningTitle({ state: 'failed', missing: [], message: 'X is broken' })).toMatch(/^X is broken\. Without them/)
    expect(hookWarningTitle({ state: 'failed', missing: [], message: null })).toMatch(/^Pray hooks aren't in/)
  })
})
