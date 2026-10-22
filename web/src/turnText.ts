import type { ChatMessage } from './types'

/**
 * 이번 차례에서 claude 가 가장 최근에 쓴 글 (작업 중 표시기용). 차례 = 가장 최근 사람 쪽 메시지(대기 중 메시지 제외) 이후.
 * 그 뒤로 글이 있는 claude 메시지가 없으면 null. 글은 원문 그대로 (앞뒤 공백만 뺀다)
 */
export function latestTurnText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    // 대기 중 메시지는 아직 claude 가 받지 않아 차례를 시작하지 않았다
    if (message.isQueued) continue
    if (message.role === 'user') return null
    if (message.role === 'assistant' && message.text.trim()) return message.text.trim()
  }
  return null
}

/** 코드 블록 울타리(```·~~~)·가로줄(---·***·___)·표 구분 줄(|---|:--:|) — 글자가 아니라 건너뛴다 */
const SKIPPED_LINE = /^(?:(?:`{3,}|~{3,}).*|(?:[-*_]\s*){3,}|\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?)$/

/** 한 줄의 마크다운 기호를 뺀 글자 */
function plainLine(line: string): string {
  return (
    line
      .trim()
      // 인용 >, 제목 #, 목록 기호 -·*·+·1.·1), 할 일 [ ]·[x] (줄 앞에서 겹쳐 올 수 있다)
      .replace(/^(?:>\s*)+/, '')
      .replace(/^#{1,6}(?:\s+|$)/, '')
      .replace(/^(?:[-*+]|\d+[.)])(?:\s+|$)/, '')
      .replace(/^\[[ xX]\]\s+/, '')
      // 그림·링크는 글자만
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // 굵게·기울임·취소선·인라인 코드. _ 는 낱말 경계에서만 (snake_case 를 지키려고)
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
      .replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?!\w)/g, '$1$2')
      .replace(/`+([^`]+)`+/g, '$1')
      .trim()
  )
}

/** 마크다운 글 → 기호를 뺀 첫 비어 있지 않은 줄. 그런 줄이 없으면 null */
export function firstPlainLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (SKIPPED_LINE.test(line.trim())) continue
    const plain = plainLine(line)
    if (plain) return plain
  }
  return null
}
