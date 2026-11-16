import { dateLabel, dateOf, formatTime } from './dateTimePick'
import { formatDue } from './reminders'
import { nameOf } from './sessionPosition'
import type { Office, ScheduledMessage, Session } from './types'

/** 서버 글 상한 (host/src/scheduledMessage.ts SCHEDULED_TEXT_MAX 와 같다) */
export const SCHEDULED_TEXT_MAX = 10_000

/** office 의 예약 보내기. 옛 서버 응답에는 키가 없다 */
export function scheduledOf(office: Office): ScheduledMessage[] {
  return office.scheduledMessages ?? []
}

/** 실패했고 아직 확인하지 않은 것 (툴바 배지·Scheduled 구역 맨 위) */
export function isUnacknowledgedFailure(message: ScheduledMessage): boolean {
  return message.status === 'failed' && message.acknowledgedAt === null
}

/**
 * Reminders 창 Scheduled 구역. failed = 확인 전 실패(실패 시각 최근순), upcoming = pending·sending(보낼 시각 이른 순),
 * sent = 보냄(보낸 시각 최근순). 확인한 실패는 어디에도 넣지 않는다 (서버가 7일 뒤 지운다)
 */
export function scheduledSections(messages: readonly ScheduledMessage[]): { failed: ScheduledMessage[]; upcoming: ScheduledMessage[]; sent: ScheduledMessage[] } {
  const failed = messages.filter(isUnacknowledgedFailure).sort((a, b) => timeOf(b.failedAt) - timeOf(a.failedAt))
  const upcoming = messages.filter(isUpcoming).sort(compareAt)
  const sent = messages.filter((message) => message.status === 'sent').sort((a, b) => timeOf(b.sentAt) - timeOf(a.sentAt))
  return { failed, upcoming, sent }
}

/** 툴바 Reminders 배지에 더하는 수: 확인하지 않은 실패만 (대기·보냄은 세지 않는다) */
export function unacknowledgedFailureCount(messages: readonly ScheduledMessage[]): number {
  return messages.filter(isUnacknowledgedFailure).length
}

/**
 * 입력 상자 위 띠 글자: 그 세션의 pending·sending 이 있을 때만. 가장 이른 것의 시각으로
 * "1 scheduled · Tomorrow 09:00", 가장 이른 것이 보내는 중이면 "2 scheduled · Sending now"
 */
export function scheduledBandText(messages: readonly ScheduledMessage[], sessionId: string, now: number): string | null {
  const upcoming = messages.filter((message) => message.sessionId === sessionId && isUpcoming(message)).sort(compareAt)
  const first = upcoming[0]
  if (!first) return null
  const when = first.status === 'sending' ? 'Sending now' : formatDue(first.at, now)
  return `${upcoming.length} scheduled · ${when}`
}

/** 등록한 뒤 잠깐 띄우는 한 줄: "Scheduled for today at 15:30" · "Scheduled for tomorrow at 09:00" · "Scheduled for Fri, Nov 14 at 09:00" */
export function scheduledNotice(at: string, now: number): string {
  const date = new Date(at)
  const label = dateLabel(dateOf(date.getTime()), now)
  const day = label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label
  return `Scheduled for ${day} at ${formatTime(date.getHours() * 60 + date.getMinutes())}`
}

/**
 * 창에서 미리 막는 이유 (서버 400 과 같은 조건, 보낼 최종 글로 본다). 없으면 null.
 * `/` 로 시작하면 Claude Code 자동완성이 Enter 를 먹고, `\` 로 끝나면 `\`+Enter 가 줄바꿈이 된다
 */
export function scheduleBlockReason(text: string): string | null {
  const trimmed = text.replace(/\r\n?/g, '\n').trim()
  if (trimmed === '') return 'Nothing to send'
  if (trimmed.length > SCHEDULED_TEXT_MAX) return `Text is over ${SCHEDULED_TEXT_MAX.toLocaleString('en-US')} characters`
  if (trimmed.startsWith('/')) return "Slash commands can't be scheduled (they aren't sent as a message)"
  if (trimmed.endsWith('\\')) return "Text can't end with \\ (Enter would add a new line instead of sending)"
  return null
}

/** 미루던 이유·Enter 직전에 막힌 이유 (서버 DeferReason·enterBlocker 값) → 글자 */
const DETAIL_LABELS: Record<string, string> = {
  'host-unreachable': 'host unreachable',
  break: 'on break',
  'needs-approval': 'waiting for approval',
  question: 'asking a question',
  handover: 'handing over',
  unqueue: 'busy',
  interrupt: 'busy',
  btw: 'busy',
  approval: 'busy',
  'recent-input': 'you were typing',
  'session-ended': 'session ended',
}

/**
 * 실패 줄 빨간 글자. unconfirmed 는 Enter 는 보냈으니 "Not sent" 가 아니라 "Unconfirmed".
 * 모르는 code(새 서버)는 code 그대로
 */
export function failureText(failure: ScheduledMessage['failure']): string {
  if (!failure) return 'Not sent'
  const detail = failure.detail ? (DETAIL_LABELS[failure.detail] ?? failure.detail) : null
  switch (failure.code) {
    case 'off-duty':
      return 'Not sent: the session was off duty'
    case 'not-found':
      return 'Not sent: session not found'
    case 'blocked':
      return detail ? `Not sent: blocked for an hour (${detail})` : 'Not sent: blocked for an hour'
    case 'blocked-mid-send':
      return `Not sent: stopped before Enter${detail ? ` (${detail})` : ''} · text left in the input`
    case 'unconfirmed':
      return "Unconfirmed: sent, but claude didn't pick it up"
    case 'missed':
      return 'Not sent: the server was off at that time'
    case 'interrupted':
      return 'Not sent: the server stopped while sending'
    default:
      return `Not sent: ${String(failure.code)}`
  }
}

/** 받는 세션 "→ 이름". 목록에서 빠졌으면 ID 앞 8자리 */
export function targetLabel(sessionId: string, sessions: readonly Session[]): string {
  const session = sessions.find((candidate) => candidate.id === sessionId)
  return `→ ${session ? nameOf(session) : sessionId.slice(0, 8)}`
}

/** 서버 응답 항목을 넣는다: 같은 id 가 있으면 바꾸고 없으면 끝에 (서버도 끝에 넣는다) */
export function applyScheduled(messages: readonly ScheduledMessage[], message: ScheduledMessage): ScheduledMessage[] {
  return messages.some((item) => item.id === message.id)
    ? messages.map((item) => (item.id === message.id ? message : item))
    : [...messages, message]
}

export function removeScheduled(messages: readonly ScheduledMessage[], messageId: string): ScheduledMessage[] {
  return messages.filter((item) => item.id !== messageId)
}

/**
 * 예약 보내기 API 응답의 실패 글자. 서버 message 가 없고 404 면 옛 서버(경로 없음)라 재시작 안내.
 * (등록의 "Session not found" 같은 404 는 message 가 있어 그대로)
 */
export function scheduledFailureMessage(status: number, message: unknown): string {
  if (typeof message === 'string' && message) return message
  return status === 404 ? 'The server needs a restart to support this' : `HTTP ${status}`
}

function isUpcoming(message: ScheduledMessage): boolean {
  return message.status === 'pending' || message.status === 'sending'
}

/** at → createdAt (서버 dueMessages 와 같은 순서) */
function compareAt(a: ScheduledMessage, b: ScheduledMessage): number {
  return timeOf(a.at) - timeOf(b.at) || timeOf(a.createdAt) - timeOf(b.createdAt)
}

function timeOf(iso: string | null): number {
  const time = iso ? Date.parse(iso) : NaN
  return Number.isNaN(time) ? 0 : time
}
