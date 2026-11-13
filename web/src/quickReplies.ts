/**
 * 빠른 답 칩: 세션이 결정을 물으면(표시 상태 my-turn) 입력 상자 바로 위에 뜨는 한 줄 칩 ("진행"·"보류"·"수정…").
 * 누르면 그 글을 바로 보내고, `:` 로 끝나는 칩은 보내지 않고 입력칸에 `수정: ` 을 채운다.
 * 칩 목록은 이 브라우저의 localStorage `pray.quickReplies` 에 두고 설정 창 Chat 탭(QuickRepliesSettings.tsx)에서 고친다.
 * 대화 모양(`pray.appearance`)과 따로 둔다 — Reset chat style 이 칩을 건드리지 않게.
 */
import type { ChatMessage } from './types'

/** localStorage 키. 꼴은 `{ format: 1, replies: string[] }` */
export const QUICK_REPLIES_KEY = 'pray.quickReplies'
/** 기본 칩. 대화 내용(claude 에게 가는 글)이라 한국어다 */
export const DEFAULT_QUICK_REPLIES: readonly string[] = ['진행', '보류', '수정:']
export const MAX_QUICK_REPLIES = 6
export const MAX_QUICK_REPLY_LENGTH = 40

/** trim·40자 자르기·빈 것과 중복 빼기·6개까지. 빈 배열이면 기능이 꺼진다 */
export function normalizeQuickReplies(replies: readonly unknown[]): string[] {
  const result: string[] = []
  for (const reply of replies) {
    if (typeof reply !== 'string') continue
    const text = reply.trim().slice(0, MAX_QUICK_REPLY_LENGTH).trim()
    if (!text || result.includes(text)) continue
    result.push(text)
    if (result.length === MAX_QUICK_REPLIES) break
  }
  return result
}

/** 저장 글 → 칩 목록. 없거나 못 읽는 꼴이면 기본 칩 (빈 배열을 저장했으면 빈 배열 = 꺼짐) */
export function parseQuickReplies(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_QUICK_REPLIES]
  try {
    const value = JSON.parse(raw) as { format?: unknown; replies?: unknown }
    if (value?.format !== 1 || !Array.isArray(value.replies)) return [...DEFAULT_QUICK_REPLIES]
    return normalizeQuickReplies(value.replies)
  } catch {
    return [...DEFAULT_QUICK_REPLIES]
  }
}

export function serializeQuickReplies(replies: readonly string[]): string {
  return JSON.stringify({ format: 1, replies: normalizeQuickReplies(replies) })
}

/** `:` 로 끝나는 칩은 보내지 않고 입력칸을 채운다 */
export function isFillReply(reply: string): boolean {
  return reply.endsWith(':')
}

/** 채우기 칩이 입력칸에 넣는 글 (`수정:` → `수정: `) */
export function fillTextOf(reply: string): string {
  return `${reply} `
}

/** 칩에 보이는 글 (`수정:` → `수정…`. `:` 하나뿐이면 그대로) */
export function quickReplyLabel(reply: string): string {
  if (!isFillReply(reply)) return reply
  const head = reply.slice(0, -1).trimEnd()
  return head ? `${head}…` : reply
}

/** 대화의 마지막 메시지(대기 중 제외)가 글이 있는 claude 메시지인지 (중지 줄·도구만 있는 응답·사람 말·system 이면 false) */
export function endsWithClaudeText(messages: readonly ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.isQueued) continue
    return message.role === 'assistant' && !message.isInterrupt && message.text.trim() !== ''
  }
  return false
}

/**
 * 칩을 띄울 차례인지 (입력칸이 비었는지는 입력 상자가 따로 본다 — 글·첨부·인용 칩 state 가 Composer 안이다).
 * 물음인지는 서버의 표시 상태(turnEnd.ts: 끝 6줄의 `?` 등)를 그대로 쓴다 — 화면에서 다시 판정하지 않는다
 */
export function isQuickRepliesVisible(state: {
  /** 근무 중인 웹 세션 */
  isWritable: boolean
  /** 팀원(member)에게는 띄우지 않는다 (팀원의 물음은 팀장이 받는다) */
  isMember: boolean
  /** 표시 상태가 my-turn */
  isMyTurn: boolean
  /** 불러온 대화가 지금 세션 것이고 마지막이 글이 있는 claude 메시지 (endsWithClaudeText) */
  endsWithClaudeText: boolean
  isWorking: boolean
  isApprovalNeeded: boolean
  isAsking: boolean
  isHandingOver: boolean
  /** 확인 안 된 Sending 임시 말풍선이 있음 (누른 직후 칩을 숨겨 두 번 안 보내게. 실패하면 다시 보인다) */
  hasUnconfirmedPending: boolean
}): boolean {
  return (
    state.isWritable &&
    !state.isMember &&
    state.isMyTurn &&
    state.endsWithClaudeText &&
    !state.isWorking &&
    !state.isApprovalNeeded &&
    !state.isAsking &&
    !state.isHandingOver &&
    !state.hasUnconfirmedPending
  )
}

// ── 저장소: 대화 탭·설정 창이 같은 값을 본다 (useSyncExternalStore) ──

let current: string[] | null = null
const listeners = new Set<() => void>()

/** 지금 칩 목록. 같은 값이면 같은 배열이다 (useSyncExternalStore 의 getSnapshot) */
export function quickReplies(): string[] {
  if (current === null) {
    try {
      current = parseQuickReplies(localStorage.getItem(QUICK_REPLIES_KEY))
    } catch {
      current = [...DEFAULT_QUICK_REPLIES]
    }
  }
  return current
}

/** 정리해서 저장하고 알린다. 저장이 막혀도 이 페이지에서는 바뀐다 */
export function setQuickReplies(replies: readonly string[]): void {
  current = normalizeQuickReplies(replies)
  try {
    localStorage.setItem(QUICK_REPLIES_KEY, serializeQuickReplies(current))
  } catch {
    // 저장소가 막힘 (사생활 보호 창 등). 다음에 열면 기본 칩
  }
  for (const listener of listeners) listener()
}

export function subscribeQuickReplies(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
