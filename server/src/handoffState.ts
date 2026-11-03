/**
 * 새 지시자의 인계 중 상태 (순수 함수). Hand over 로 띄운 새 팀장·파트장이 인계 글에 답할 때까지 화면 입력 상자를 막는다.
 * preparing = 인계 글을 만들거나 보내기를 기다리는 중, sent = 보냈고 답을 기다리는 중.
 * 풀림: 보낸 뒤 Stop(그 답의 차례가 끝남), SessionEnd·호스트 exit, 글 없음·실패, 시작 뒤 HANDOVER_TIMEOUT_MS.
 * 상태는 서버 메모리에만 있다 (index.ts 의 Map. 서버를 재시작하면 사라진다)
 */

export interface HandoverState {
  fromSessionId: string
  /** 직전 지시자 이름 (역할 없이) */
  fromName: string
  phase: 'preparing' | 'sent'
  /** 시작 시각 (ms) */
  startedAt: number
}

/** 시작 뒤 이 시간이 지나면 인계 중이 아닌 것으로 본다 (답이 안 와도 입력 상자를 영영 막지 않게) */
export const HANDOVER_TIMEOUT_MS = 5 * 60_000

/** 인계 중 입력·곁가지 질문 409 문구 (화면 입력 상자 placeholder 와 같다) */
export const HANDOVER_BLOCK_MESSAGE = "Handing over — wait for the new lead's reply"

export function startHandover(fromSessionId: string, fromName: string, now: number): HandoverState {
  return { fromSessionId, fromName, phase: 'preparing', startedAt: now }
}

export function markHandoverSent(state: HandoverState): HandoverState {
  return { ...state, phase: 'sent' }
}

/**
 * 훅 이벤트 반영. null = 풀림.
 * Stop 은 보낸 뒤에만 푼다 — 보내기 전 Stop 은 인계 글의 답이 아니다. SessionEnd 는 늘 푼다
 */
export function applyHandoverHook(state: HandoverState, event: string): HandoverState | null {
  if (event === 'SessionEnd') return null
  if (event === 'Stop' && state.phase === 'sent') return null
  return state
}

/** 지금 인계 중인지 (시작 뒤 HANDOVER_TIMEOUT_MS 가 지나면 아니다) */
export function isHandoverActive(state: HandoverState | undefined, now: number): state is HandoverState {
  return state !== undefined && now - state.startedAt < HANDOVER_TIMEOUT_MS
}
