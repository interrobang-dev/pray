/**
 * 예약 보내기: 정한 시각에 웹 세션 입력으로 글을 한 번 보낸다. 저장은 hq.ts (최상위 `scheduledMessages`), 여기는 꼴·정리 순수 함수.
 * 보낼지 미룰지 판정과 보내기는 서버 (server/src/scheduledSend.ts). 알림(reminders)과 키를 나눈 것은 옛 트레이·서버가 알림으로 울리지 않게다
 */

export type ScheduledMessageStatus = 'pending' | 'sending' | 'sent' | 'failed'

/**
 * 실패 이유. off-duty = 그 시각에 퇴근, not-found = 세션 기록 없음, blocked = 미루기 한도(at + 60분)까지 막힘(detail = 마지막 막힌 이유),
 * blocked-mid-send = 글을 쓴 뒤 Enter 직전에 막힘(detail = 이유. 글은 입력칸에 남는다), unconfirmed = Enter 뒤 15초 안에 UserPromptSubmit 훅이 없음,
 * missed = 서버가 꺼져 있다 켜졌을 때 이미 at + 60분이 지남, interrupted = 보내는 중에 서버가 꺼짐 (다시 보내지 않는다)
 */
export type ScheduledFailureCode = 'off-duty' | 'not-found' | 'blocked' | 'blocked-mid-send' | 'unconfirmed' | 'missed' | 'interrupted'

export interface ScheduledFailure {
  code: ScheduledFailureCode
  detail?: string
}

export interface ScheduledMessage {
  /** randomUUID 앞 8자리 (할 일·알림과 같다) */
  id: string
  /** 받을 웹 세션. Hand over 로 리드가 바뀌어도 이 세션 그대로 */
  sessionId: string
  /** parseScheduledText 를 지난 글 (줄바꿈 \n 그대로) */
  text: string
  /** 보낼 시각. UTC ISO (toISOString) */
  at: string
  createdAt: string
  createdBy: { kind: 'user' }
  status: ScheduledMessageStatus
  /** 글을 쓰기 직전에 적은 시각 (sending 이 된 시각). 아직이면 null */
  sendingAt: string | null
  /** Enter 를 보낸 시각 (sent 일 때만) */
  sentAt: string | null
  /** sentAt 이 at 보다 SCHEDULED_LATE_MS 넘게 늦었다. 보낼 때 정하고, 보내기 전에는 키가 없다 */
  isLate?: boolean
  failedAt: string | null
  failure: ScheduledFailure | null
  /** 사람이 실패를 확인한 시각. 실패만 확인할 수 있다. 확인하고 SCHEDULED_RETENTION_MS 지나면 지운다 */
  acknowledgedAt: string | null
}

/** 글 길이 상한 (줄바꿈 포함) */
export const SCHEDULED_TEXT_MAX = 10_000
/** 이만큼 넘게 늦게 보내면 늦음 (알림 REMINDER_LATE_MS 와 같다. 서버가 30초마다 본다) */
export const SCHEDULED_LATE_MS = 90_000
/** at 뒤 이 시간까지 미루거나 늦게 보낸다. 넘으면 실패 (blocked 또는 missed) */
export const SCHEDULED_SEND_WINDOW_MS = 60 * 60 * 1000
/** 보낸 것은 sentAt 뒤, 실패는 확인한 뒤 이만큼 지나면 지운다 (알림·퇴근 기록과 같은 7일) */
export const SCHEDULED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type ScheduledTextResult = { text: string } | { error: 'length' | 'slash' | 'backslash' }

/**
 * API 로 받은 글. 줄바꿈은 살리고(\r\n·\r 은 \n 으로 — pty 에 \r 이 가면 그 자리에서 제출된다) 앞뒤 공백을 떼어 1~10,000자.
 * `/` 로 시작하면 자동완성이 Enter 를 먹어 제출되지 않고, `\` 로 끝나면 `\`+Enter 가 줄바꿈이 되어 받지 않는다
 */
export function parseScheduledText(value: unknown): ScheduledTextResult {
  if (typeof value !== 'string') return { error: 'length' }
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (text.length === 0 || text.length > SCHEDULED_TEXT_MAX) return { error: 'length' }
  if (text.startsWith('/')) return { error: 'slash' }
  if (text.endsWith('\\')) return { error: 'backslash' }
  return { text }
}

/** 미루거나 늦게 보낼 수 있는 마지막 시각 (ms) */
export function sendDeadline(message: Pick<ScheduledMessage, 'at'>): number {
  return Date.parse(message.at) + SCHEDULED_SEND_WINDOW_MS
}

/**
 * 보관 기간이 지난 것을 뺀다: sent 는 sentAt 뒤 7일, failed 는 확인한 뒤 7일. pending·sending·확인 전 실패는 지우지 않는다.
 * 경계 시각의 것은 남긴다 (fireDue 와 같다). 넘긴 배열은 바꾸지 않는다
 */
export function pruneScheduled(messages: ScheduledMessage[], now: Date): { messages: ScheduledMessage[]; prunedCount: number } {
  const nowTime = now.getTime()
  const isExpired = (message: ScheduledMessage): boolean => {
    const since = message.status === 'sent' ? message.sentAt : message.status === 'failed' ? message.acknowledgedAt : null
    return since !== null && nowTime - Date.parse(since) > SCHEDULED_RETENTION_MS
  }
  const kept = messages.filter((message) => !isExpired(message))
  return { messages: kept, prunedCount: messages.length - kept.length }
}

/**
 * 서버가 시작할 때: sending 으로 남은 것(보내는 중에 서버가 꺼짐)을 interrupted 실패로. 글이 들어갔는지 모르므로 다시 보내지 않는다 (두 번 보내기 막기).
 * 넘긴 배열은 바꾸지 않는다
 */
export function failLeftSending(messages: ScheduledMessage[], now: Date): { messages: ScheduledMessage[]; failed: ScheduledMessage[] } {
  const failed: ScheduledMessage[] = []
  const next = messages.map((message) => {
    if (message.status !== 'sending') return message
    const failedMessage = markFailed(message, { code: 'interrupted' }, now)
    failed.push(failedMessage)
    return failedMessage
  })
  return { messages: next, failed }
}

/**
 * 이번 회차에 볼 것: 시각이 된 pending 을 세션마다 하나씩 (at → createdAt → 넣은 순서로 가장 이른 것).
 * 그 세션에 sending 이 있으면 그 세션은 건너뛴다 (한 세션에 하나씩 차례로). 결과는 at 이른 순
 */
export function dueMessages(messages: ScheduledMessage[], now: Date): ScheduledMessage[] {
  const nowTime = now.getTime()
  const busySessions = new Set(messages.filter((m) => m.status === 'sending').map((m) => m.sessionId))
  const firstBySession = new Map<string, ScheduledMessage>()
  for (const message of [...messages].sort(compareSchedule)) {
    if (message.status !== 'pending' || busySessions.has(message.sessionId) || firstBySession.has(message.sessionId)) continue
    firstBySession.set(message.sessionId, message)
  }
  return [...firstBySession.values()].filter((message) => Date.parse(message.at) <= nowTime)
}

/** at → createdAt 순 (sort 는 안정 정렬이라 같으면 넣은 순서) */
function compareSchedule(a: ScheduledMessage, b: ScheduledMessage): number {
  return Date.parse(a.at) - Date.parse(b.at) || Date.parse(a.createdAt) - Date.parse(b.createdAt)
}

export function markSending(message: ScheduledMessage, now: Date): ScheduledMessage {
  return { ...message, status: 'sending', sendingAt: now.toISOString() }
}

/** 글을 못 쓰고 끝남 (호스트 연결이 끊겨 쓰기 실패). 아무것도 안 들어갔으니 다시 기다린다 */
export function markBackToPending(message: ScheduledMessage): ScheduledMessage {
  return { ...message, status: 'pending', sendingAt: null }
}

export function markSent(message: ScheduledMessage, sentAt: Date): ScheduledMessage {
  return { ...message, status: 'sent', sentAt: sentAt.toISOString(), isLate: sentAt.getTime() - Date.parse(message.at) > SCHEDULED_LATE_MS }
}

export function markFailed(message: ScheduledMessage, failure: ScheduledFailure, now: Date): ScheduledMessage {
  return { ...message, status: 'failed', failedAt: now.toISOString(), failure }
}
