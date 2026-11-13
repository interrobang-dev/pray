import { describe, expect, it } from 'vitest'
import { APPROVAL_KEY_GUARD_MS, approvalKeyAction, type ApprovalKeyEvent } from './approvalKeys'

function key(name: string, extra: Partial<ApprovalKeyEvent> = {}): ApprovalKeyEvent {
  return {
    key: name,
    keyCode: name === 'Enter' ? 13 : name === 'Escape' ? 27 : 65,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
    ...extra,
  }
}

const ready = { focus: 'none' as const, isModalOpen: false, shownForMs: APPROVAL_KEY_GUARD_MS }

describe('approvalKeyAction', () => {
  it('Enter 는 승인, Esc 는 거절', () => {
    expect(approvalKeyAction(key('Enter'), ready)).toBe('approve')
    expect(approvalKeyAction(key('Escape'), ready)).toBe('deny')
  })

  it('다른 키는 넘긴다', () => {
    expect(approvalKeyAction(key('a'), ready)).toBeNull()
    expect(approvalKeyAction(key(' '), ready)).toBeNull()
    expect(approvalKeyAction(key('1'), ready)).toBeNull()
  })

  it('입력칸·body 포커스만 받고 그 밖 포커스는 넘긴다', () => {
    expect(approvalKeyAction(key('Enter'), { ...ready, focus: 'composer' })).toBe('approve')
    expect(approvalKeyAction(key('Escape'), { ...ready, focus: 'composer' })).toBe('deny')
    expect(approvalKeyAction(key('Enter'), { ...ready, focus: 'other' })).toBeNull()
    expect(approvalKeyAction(key('Escape'), { ...ready, focus: 'other' })).toBeNull()
  })

  it('모달이 떠 있으면 넘긴다', () => {
    expect(approvalKeyAction(key('Escape'), { ...ready, isModalOpen: true })).toBeNull()
    expect(approvalKeyAction(key('Enter'), { ...ready, isModalOpen: true })).toBeNull()
  })

  it('다른 처리기가 막았거나 한글 조합 중이거나 키 반복이면 넘긴다', () => {
    expect(approvalKeyAction(key('Escape', { defaultPrevented: true }), ready)).toBeNull()
    expect(approvalKeyAction(key('Enter', { isComposing: true }), ready)).toBeNull()
    expect(approvalKeyAction(key('Enter', { keyCode: 229 }), ready)).toBeNull()
    expect(approvalKeyAction(key('Enter', { repeat: true }), ready)).toBeNull()
  })

  it('수정 키를 같이 누르면 넘긴다', () => {
    for (const modifier of ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'] as const) {
      expect(approvalKeyAction(key('Enter', { [modifier]: true }), ready)).toBeNull()
      expect(approvalKeyAction(key('Escape', { [modifier]: true }), ready)).toBeNull()
    }
  })

  it('막대가 보인 지 800ms 가 안 됐으면 넘긴다', () => {
    expect(APPROVAL_KEY_GUARD_MS).toBe(800)
    expect(approvalKeyAction(key('Enter'), { ...ready, shownForMs: 0 })).toBeNull()
    expect(approvalKeyAction(key('Escape'), { ...ready, shownForMs: APPROVAL_KEY_GUARD_MS - 1 })).toBeNull()
    expect(approvalKeyAction(key('Enter'), { ...ready, shownForMs: APPROVAL_KEY_GUARD_MS })).toBe('approve')
  })
})
