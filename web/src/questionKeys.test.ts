import { describe, expect, it } from 'vitest'
import { questionEnterAction, type QuestionKeyEvent, type QuestionKeyFocus } from './questionKeys'

const enter = (extra: Partial<QuestionKeyEvent> = {}): QuestionKeyEvent => ({
  key: 'Enter',
  keyCode: 13,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  repeat: false,
  defaultPrevented: false,
  ...extra,
})
const state = (focus: QuestionKeyFocus, canSubmit = true, isModalOpen = false) => ({ focus, canSubmit, isModalOpen })

describe('questionEnterAction', () => {
  it('submits from the custom text box, an option button or nowhere', () => {
    expect(questionEnterAction(enter(), state('custom'))).toBe('submit')
    expect(questionEnterAction(enter(), state('option'))).toBe('submit')
    expect(questionEnterAction(enter(), state('none'))).toBe('submit')
  })

  it('only blocks the default when not every question is answered yet', () => {
    expect(questionEnterAction(enter(), state('custom', false))).toBe('block')
    expect(questionEnterAction(enter(), state('option', false))).toBe('block')
    expect(questionEnterAction(enter(), state('none', false))).toBeNull()
  })

  it('leaves Shift+Enter as a new line and other modifiers alone', () => {
    expect(questionEnterAction(enter({ shiftKey: true }), state('custom'))).toBeNull()
    expect(questionEnterAction(enter({ ctrlKey: true }), state('custom'))).toBeNull()
    expect(questionEnterAction(enter({ altKey: true }), state('none'))).toBeNull()
    expect(questionEnterAction(enter({ metaKey: true }), state('option'))).toBeNull()
  })

  it('passes keys during Korean composition, handled keys, other focus, modals and other keys', () => {
    expect(questionEnterAction(enter({ isComposing: true }), state('custom'))).toBeNull()
    expect(questionEnterAction(enter({ keyCode: 229 }), state('custom'))).toBeNull()
    expect(questionEnterAction(enter({ defaultPrevented: true }), state('none'))).toBeNull()
    expect(questionEnterAction(enter(), state('other'))).toBeNull()
    expect(questionEnterAction(enter(), state('custom', true, true))).toBeNull()
    expect(questionEnterAction(enter({ key: 'a' }), state('custom'))).toBeNull()
  })

  it('does not submit on key repeat', () => {
    expect(questionEnterAction(enter({ repeat: true }), state('custom'))).toBe('block')
    expect(questionEnterAction(enter({ repeat: true }), state('none'))).toBeNull()
  })
})
