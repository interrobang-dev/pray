/** 예약 보내기(Scheduled messages)가 실패했을 때의 Windows 알림 판정과 글자. Electron 을 쓰지 않는 순수 함수 */
import { bundleToast, fitOneLine, nameOf, type NotifySession } from './notify'
import type { ToastContent } from './toast'

/** 실패 이유. host/src/scheduledMessage.ts 의 ScheduledFailureCode 사본 (desktop 은 CommonJS 빌드라 host 를 import 하지 않는다) */
export type NotifyScheduledFailureCode = 'off-duty' | 'not-found' | 'blocked' | 'blocked-mid-send' | 'unconfirmed' | 'missed' | 'interrupted'

/** `GET /api/scheduled-messages` 의 한 항목 중 알림에 쓰는 필드. host/src/scheduledMessage.ts 의 ScheduledMessage 사본 — 서버 꼴을 고치면 같이 고친다 */
export interface NotifyScheduled {
  id: string
  /** 받을 웹 세션 */
  sessionId: string
  text: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  /** 실패한 시각. 실패 전이면 null */
  failedAt: string | null
  failure: { code: NotifyScheduledFailureCode; detail?: string } | null
  /** 사람이 실패를 확인한 시각. 확인 전이면 null */
  acknowledgedAt: string | null
}

/**
 * 새로 알릴 것: 트레이를 켠 시각(notifyFrom, ms) 이후에 실패했고, 확인 전이고, 아직 알리지 않은 것 (넣은 순서 그대로).
 * 알림(Reminders)의 newlyFiredReminders 와 같은 방식 — 서버가 켜지자마자 실패로 적은 것(missed·interrupted)도 켠 뒤라 알린다
 */
export function newlyFailedScheduled(notifiedIds: ReadonlySet<string>, notifyFrom: number, items: NotifyScheduled[]): NotifyScheduled[] {
  return items.filter((item) => {
    if (item.status !== 'failed' || item.failedAt === null || item.acknowledgedAt !== null || notifiedIds.has(item.id)) return false
    const failedAt = Date.parse(item.failedAt)
    return !Number.isNaN(failedAt) && failedAt >= notifyFrom
  })
}

/** 받을 세션 (그림의 인물 머리·누를 때 열 세션). 목록에 없으면 undefined (Pray 마크·창만) */
export function scheduledSession(item: NotifyScheduled, sessions: readonly NotifySession[]): NotifySession | undefined {
  return sessions.find((session) => session.id === item.sessionId)
}

/** 미루던 이유·Enter 직전에 막힌 이유 → 글자. web/src/scheduledMessages.ts 의 DETAIL_LABELS 사본 — 화면을 고치면 같이 고친다 */
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

/** 실패 이유 글자. web/src/scheduledMessages.ts 의 failureText 사본 — 화면과 같은 글자를 쓴다 (모르는 code·detail 은 그대로) */
export function scheduledFailureText(failure: NotifyScheduled['failure']): string {
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

/** "Scheduled message not sent". unconfirmed 는 Enter 는 보냈으니 화면과 같은 뜻으로 "Scheduled message unconfirmed" */
export function scheduledTitle(item: NotifyScheduled): string {
  return item.failure?.code === 'unconfirmed' ? 'Scheduled message unconfirmed' : 'Scheduled message not sent'
}

/** 받을 세션 이름 (화면 targetLabel 처럼 목록에 없으면 ID 앞 8자리) */
function targetName(item: NotifyScheduled, sessions: readonly NotifySession[]): string {
  const session = scheduledSession(item, sessions)
  return session ? nameOf(session) : item.sessionId.slice(0, 8)
}

/** 줄바꿈을 공백 하나로 (본문은 한 줄로 자른다) */
function flatText(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

/** 한 건의 토스트: 제목 · 글 한 줄(fitOneLine) · 회색 줄 "세션 이름 · 이유" */
export function scheduledToast(item: NotifyScheduled, sessions: readonly NotifySession[], iconUrl: string | null): ToastContent {
  return {
    title: scheduledTitle(item),
    body: fitOneLine(flatText(item.text)),
    attribution: `${targetName(item, sessions)} · ${scheduledFailureText(item.failure)}`,
    iconUrl,
  }
}

/** 묶음 알림의 한 줄: "세션 이름 · 글" (자르지 않는다 — 긴 줄은 Windows 가 접는다) */
export function scheduledBundleLine(item: NotifyScheduled, sessions: readonly NotifySession[]): string {
  return `${targetName(item, sessions)} · ${flatText(item.text)}`
}

/** 묶음 알림 "Pray · N scheduled messages failed": 본문은 bundleToast 와 같이 줄마다 */
export function scheduledBundleToast(lines: string[], iconUrl: string | null): ToastContent {
  return { ...bundleToast(lines, iconUrl), title: `Pray · ${lines.length} scheduled message${lines.length === 1 ? '' : 's'} failed` }
}
