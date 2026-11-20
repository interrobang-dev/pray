/** 질문 카드에서 Enter 를 누를 때의 포커스: 직접 입력 칸 · 선택지 버튼 · 아무 데도 없음(body) · 그 밖 (그쪽 키 처리에 맡긴다) */
export type QuestionKeyFocus = 'custom' | 'option' | 'none' | 'other'

export interface QuestionKeyEvent {
  key: string
  keyCode: number
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  isComposing: boolean
  repeat: boolean
  defaultPrevented: boolean
}

/**
 * 질문 카드의 Enter: 'submit' = 보내기 (Submit 버튼과 같은 조건 canSubmit), 'block' = 기본 동작만 막기
 * (직접 입력 칸의 줄바꿈·선택지 버튼 다시 누르기 — 줄바꿈은 Shift+Enter), null = 넘긴다.
 * 넘기는 때: Enter 아님, 다른 처리기가 막음, 한글 조합 중, Shift(직접 입력 칸의 줄바꿈)·Ctrl·Alt·Meta, 포커스가 그 밖(탭·Chat about this·Cancel·카드 밖 입력칸), 모달이 떠 있음.
 * 키 반복은 보내지 않는다 (누르고 있으면 보낸 뒤 다음 질문 카드까지 보낼 수 있어서)
 */
export function questionEnterAction(
  event: QuestionKeyEvent,
  state: { focus: QuestionKeyFocus; isModalOpen: boolean; canSubmit: boolean },
): 'submit' | 'block' | null {
  if (event.key !== 'Enter') return null
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null
  if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null
  if (state.focus === 'other' || state.isModalOpen) return null
  const fallback = state.focus === 'none' ? null : 'block'
  if (event.repeat || !state.canSubmit) return fallback
  return 'submit'
}
