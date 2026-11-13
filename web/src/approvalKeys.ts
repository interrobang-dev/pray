/** 승인 막대가 처음 보인 뒤 이 시간 안의 키는 무시한다 (보낸 직후 다시 친 Enter·막 뜬 막대에 반사로 친 키를 거른다. 도구 이름을 읽을 틈) */
export const APPROVAL_KEY_GUARD_MS = 800

/** 키를 누를 때의 포커스: 대화 입력칸 · 아무 데도 없음(body) · 그 밖 (그쪽 키 처리에 맡긴다) */
export type ApprovalKeyFocus = 'composer' | 'none' | 'other'

export interface ApprovalKeyEvent {
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
 * 승인 막대가 보일 때 이 키로 답할지: Enter = 승인, Esc = 거절, 아니면 null.
 * 입력칸에서 Enter 는 보낼 것이 없을 때만 Composer 가 이걸 부른다 (글이 있으면 보내기). 포커스가 입력칸·body 가 아니거나,
 * 모달이 떠 있거나, 다른 처리기가 막았거나, 한글 조합 중·수정 키·키 반복이거나, 막대가 보인 지 APPROVAL_KEY_GUARD_MS 가 안 됐으면 넘긴다
 */
export function approvalKeyAction(
  event: ApprovalKeyEvent,
  state: { focus: ApprovalKeyFocus; isModalOpen: boolean; shownForMs: number },
): 'approve' | 'deny' | null {
  const action = event.key === 'Enter' ? 'approve' : event.key === 'Escape' ? 'deny' : null
  if (!action) return null
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return null
  if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null
  if (state.focus === 'other' || state.isModalOpen) return null
  if (state.shownForMs < APPROVAL_KEY_GUARD_MS) return null
  return action
}
