import { describe, expect, it } from 'vitest'
import { applyHandoverHook, HANDOVER_TIMEOUT_MS, isHandoverActive, markHandoverSent, startHandover } from './handoffState.js'

describe('handoffState', () => {
  const started = startHandover('old-lead', 'Pray', 1_000)

  it('시작하면 preparing', () => {
    expect(started).toEqual({ fromSessionId: 'old-lead', fromName: 'Pray', phase: 'preparing', startedAt: 1_000 })
  })

  it('보내면 sent, 시작 시각은 그대로', () => {
    expect(markHandoverSent(started)).toEqual({ ...started, phase: 'sent' })
  })

  it('preparing 중 Stop 은 무시한다', () => {
    expect(applyHandoverHook(started, 'Stop')).toBe(started)
  })

  it('sent 뒤 Stop 이면 풀린다', () => {
    expect(applyHandoverHook(markHandoverSent(started), 'Stop')).toBeNull()
  })

  it('SessionEnd 는 언제나 푼다', () => {
    expect(applyHandoverHook(started, 'SessionEnd')).toBeNull()
    expect(applyHandoverHook(markHandoverSent(started), 'SessionEnd')).toBeNull()
  })

  it('다른 훅은 그대로', () => {
    const sent = markHandoverSent(started)
    for (const event of ['UserPromptSubmit', 'PostToolUse', 'PermissionRequest']) expect(applyHandoverHook(sent, event)).toBe(sent)
  })

  it('시작 뒤 5분이 지나면 인계 중이 아니다', () => {
    expect(isHandoverActive(undefined, 1_000)).toBe(false)
    expect(isHandoverActive(started, 1_000)).toBe(true)
    expect(isHandoverActive(started, 1_000 + HANDOVER_TIMEOUT_MS - 1)).toBe(true)
    expect(isHandoverActive(started, 1_000 + HANDOVER_TIMEOUT_MS)).toBe(false)
  })
})
