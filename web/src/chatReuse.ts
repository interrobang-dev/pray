import { rowKeyOf, type ChatRow, type Work, type WorkPart } from './chatRows'
import type { ChatMessage, ToolUse } from './types'

/**
 * 대화를 다시 받았을 때 바뀌지 않은 것은 이전 객체를 그대로 쓴다. 대화 탭은 몇 초마다 대화 전체를 다시 받는데,
 * 객체가 새로 생기면 memo 한 줄이 모두 다시 그려진다 (말풍선 마크다운 파싱까지). 그대로인 줄은 같은 객체라 건너뛴다
 */

const jsonOf = (value: unknown) => JSON.stringify(value) ?? ''

function isSameToolUse(a: ToolUse, b: ToolUse): boolean {
  return a.id === b.id && a.name === b.name && a.result === b.result && jsonOf(a.input) === jsonOf(b.input) && jsonOf(a.answers) === jsonOf(b.answers)
}

/** 메시지 내용이 같은지 (서버가 주는 필드 전부) */
export function isSameMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.timestamp === b.timestamp &&
    a.text === b.text &&
    a.isQueued === b.isQueued &&
    a.isCompactSummary === b.isCompactSummary &&
    a.isInterrupt === b.isInterrupt &&
    a.from?.sessionId === b.from?.sessionId &&
    a.from?.name === b.from?.name &&
    a.toolUses.length === b.toolUses.length &&
    a.toolUses.every((toolUse, index) => isSameToolUse(toolUse, b.toolUses[index]))
  )
}

/** 다시 받은 메시지 중 ID·내용이 같은 것은 이전 객체로 바꾼다. 하나도 안 바뀌었으면(개수·순서·내용) 이전 배열 그대로 */
export function reuseMessages(previous: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  if (previous.length === 0) return next
  const byId = new Map(previous.map((message) => [message.id, message]))
  let isChanged = previous.length !== next.length
  const merged = next.map((message, index) => {
    const old = byId.get(message.id)
    if (old && isSameMessage(old, message)) {
      if (previous[index] !== old) isChanged = true
      return old
    }
    isChanged = true
    return message
  })
  return isChanged ? merged : previous
}

function isSamePart(a: WorkPart, b: WorkPart): boolean {
  return a.message === b.message && a.text === b.text && a.toolUses.length === b.toolUses.length && a.toolUses.every((toolUse, index) => toolUse === b.toolUses[index])
}

function isSameWork(a: Work, b: Work): boolean {
  return (
    a.key === b.key &&
    a.isInProgress === b.isInProgress &&
    a.toolCount === b.toolCount &&
    a.durationMs === b.durationMs &&
    jsonOf(a.toolCounts) === jsonOf(b.toolCounts) &&
    a.parts.length === b.parts.length &&
    a.parts.every((part, index) => isSamePart(part, b.parts[index]))
  )
}

function isSameRow<S>(a: ChatRow<S>, b: ChatRow<S>, isSameSpecial: (a: S, b: S) => boolean): boolean {
  if (a.kind === 'work' && b.kind === 'work') return isSameWork(a.work, b.work)
  if (a.kind === 'special' && b.kind === 'special') return a.toolUse === b.toolUse && isSameSpecial(a.special, b.special)
  if ((a.kind === 'message' && b.kind === 'message') || (a.kind === 'text' && b.kind === 'text')) return a.message === b.message
  return false
}

/**
 * 다시 만든 줄 중 같은 키·같은 내용인 것은 이전 줄 객체로 바꾼다 (메시지는 reuseMessages 로 이미 같은 객체여야 한다).
 * 하나도 안 바뀌었으면 이전 배열 그대로. 특별한 줄(relay·질문 카드)의 내용 비교는 isSameSpecial 로
 */
export function reuseRows<S>(previous: ChatRow<S>[], next: ChatRow<S>[], isSameSpecial: (a: S, b: S) => boolean): ChatRow<S>[] {
  if (previous.length === 0) return next
  const byKey = new Map(previous.map((row) => [rowKeyOf(row), row]))
  let isChanged = previous.length !== next.length
  const merged = next.map((row, index) => {
    const old = byKey.get(rowKeyOf(row))
    if (old && isSameRow(old, row, isSameSpecial)) {
      if (previous[index] !== old) isChanged = true
      return old
    }
    isChanged = true
    return row
  })
  return isChanged ? merged : previous
}
