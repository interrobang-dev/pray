import type { ChatMessage } from './types'

/** 대화 탭에서 마크한 말풍선 하나 (`GET /api/sessions/:id/marks` 의 marks, 마크한 순서). key = 말풍선의 data-jump-key(메시지 ID) */
export interface ChatMark {
  key: string
  createdAt: string
}

/** 마크 창의 한 줄. message 가 null 이면 대화에 그 말풍선이 없다 ("Message not found") */
export interface MarkListItem {
  key: string
  createdAt: string
  message: ChatMessage | null
}

/** 미리보기 글 최대 길이 (화면은 한 줄 말줄임이라 이보다 길게 들고 있을 필요가 없다) */
const PREVIEW_MAX = 200

/**
 * 마크 버튼을 다는 말풍선인지: claude 답(글 있음)과 사람 쪽 내 말(대기 중·팀장 지시·압축 요약·중지 기록 제외, 글 있음).
 * 대기 중 메시지는 ID 가 queued-N 이라 받아들여지면 바뀐다
 */
export function isMarkableMessage(message: ChatMessage): boolean {
  if (message.text.trim() === '') return false
  if (message.role === 'assistant') return true
  return message.role === 'user' && !message.isQueued && !message.from && !message.isCompactSummary && !message.isInterrupt
}

/** 마크 창 줄: 대화에 있는 것은 대화 순서, 없는 것은 그 뒤에 마크한 순서 */
export function buildMarkList(marks: ChatMark[], messages: ChatMessage[]): MarkListItem[] {
  const indexById = new Map(messages.map((message, index) => [message.id, index]))
  const found: { item: MarkListItem; index: number }[] = []
  const missing: MarkListItem[] = []
  for (const mark of marks) {
    const index = indexById.get(mark.key)
    if (index === undefined) missing.push({ ...mark, message: null })
    else found.push({ item: { ...mark, message: messages[index] }, index })
  }
  found.sort((a, b) => a.index - b.index)
  return [...found.map(({ item }) => item), ...missing]
}

/** 미리보기 글: 첫 번째 빈 줄 아닌 줄에서 마크다운 머리(#·>·목록 기호)와 굵게·코드 표시를 뗀 것 */
export function markPreview(text: string): string {
  const line = text.split(/\r?\n/).find((item) => item.trim() !== '') ?? ''
  const plain = line
    .trim()
    .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
  return plain.length > PREVIEW_MAX ? `${plain.slice(0, PREVIEW_MAX)}…` : plain
}

/** key 를 마크한 목록 (이미 있으면 그대로) */
export function withMark(marks: ChatMark[], key: string, createdAt: string): ChatMark[] {
  return marks.some((mark) => mark.key === key) ? marks : [...marks, { key, createdAt }]
}

/** key 를 뺀 목록 (없으면 그대로) */
export function withoutMark(marks: ChatMark[], key: string): ChatMark[] {
  return marks.some((mark) => mark.key === key) ? marks.filter((mark) => mark.key !== key) : marks
}
