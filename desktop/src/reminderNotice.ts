/** 알림(Reminders)이 울렸을 때의 Windows 알림 판정과 글자. Electron 을 쓰지 않는 순수 함수 */
import { bundleToast, fitOneLine, nameOf, placeLabel, placeOf, type NotifySession } from './notify'
import type { ToastContent } from './toast'

/** 만든 이. host/src/reminder.ts 의 ReminderCreator 사본 (desktop 은 CommonJS 빌드라 host 를 import 하지 않는다) */
export type NotifyReminderCreator =
  | { kind: 'user' }
  | { kind: 'lead'; teamId: string; partId: string | null; sessionId: string | null }

/** `GET /api/reminders` 의 한 항목. host/src/reminder.ts 의 Reminder 사본 — 서버 꼴을 고치면 같이 고친다 */
export interface NotifyReminder {
  id: string
  text: string
  /** 울릴 시각 (UTC ISO) */
  at: string
  createdAt: string
  createdBy: NotifyReminderCreator
  /** 서버가 울린 시각. 아직이면 null */
  firedAt: string | null
  /** 서버가 꺼져 있던 사이 지나 늦게 울렸다. 울리기 전에는 키가 없다 */
  isLate?: boolean
  /** 사람이 확인한 시각. 확인 전이면 null */
  acknowledgedAt: string | null
}

/** `/api/office` 중 알림 자리 글자와 누를 때 대상에 쓰는 필드 (notify.ts 의 NotifyOffice 에 지금 리드를 더한 것) */
export interface ReminderOffice {
  teams: { id: string; name: string; leadSessionId?: string; parts?: { id: string; name: string; leadSessionId?: string }[] }[]
}

/**
 * 새로 알릴 것: 트레이를 켠 시각(notifyFrom, ms) 이후에 울렸고, 확인 전이고, 아직 알리지 않은 것 (넣은 순서 그대로).
 * 첫 폴링에서 기준만 잡지 않는다 — 서버가 켜지자마자 늦음으로 울린 것을 놓친다. 켜기 전에 울린 것은 화면 배지로 본다
 */
export function newlyFiredReminders(notifiedIds: ReadonlySet<string>, notifyFrom: number, reminders: NotifyReminder[]): NotifyReminder[] {
  return reminders.filter((reminder) => {
    if (reminder.firedAt === null || reminder.acknowledgedAt !== null || notifiedIds.has(reminder.id)) return false
    const firedAt = Date.parse(reminder.firedAt)
    return !Number.isNaN(firedAt) && firedAt >= notifyFrom
  })
}

/** 등록한 리드 세션 (그림의 인물 머리). 사람이 등록했거나 세션을 못 찾으면 undefined (Pray 마크) */
export function reminderSession(reminder: NotifyReminder, sessions: readonly NotifySession[]): NotifySession | undefined {
  const creator = reminder.createdBy
  if (creator.kind !== 'lead' || !creator.sessionId) return undefined
  return sessions.find((session) => session.id === creator.sessionId)
}

/** "[Lead] 이름" · "[Part lead] 이름". 역할은 화면 creatorLabel(web/src/reminders.ts)처럼 partId 로, 세션을 못 찾으면 이름 없이. 사람이 등록한 것은 null */
function senderOf(reminder: NotifyReminder, sessions: readonly NotifySession[]): string | null {
  const creator = reminder.createdBy
  if (creator.kind !== 'lead') return null
  const role = creator.partId ? '[Part lead]' : '[Lead]'
  const session = reminderSession(reminder, sessions)
  return session ? `${role} ${nameOf(session)}` : role
}

/** "[Lead] 이름 · Reminder" (늦었으면 "Late reminder"). 사람이 등록한 것은 "Reminder", 리드 세션을 못 찾으면 "[Lead] Reminder" */
export function reminderTitle(reminder: NotifyReminder, sessions: readonly NotifySession[]): string {
  const label = reminder.isLate ? 'Late reminder' : 'Reminder'
  const sender = senderOf(reminder, sessions)
  if (!sender) return label
  return reminderSession(reminder, sessions) ? `${sender} · ${label}` : `${sender} ${label}`
}

/** 한 알림의 토스트: 제목 · 글 한 줄(fitOneLine) · 회색 줄 "팀 › 파트" (사람이 등록한 것·팀을 못 찾으면 줄 없음) */
export function reminderToast(
  reminder: NotifyReminder,
  sessions: readonly NotifySession[],
  office: ReminderOffice | null,
  iconUrl: string | null,
): ToastContent {
  const creator = reminder.createdBy
  const place = creator.kind === 'lead' ? placeOf({ teamId: creator.teamId, partId: creator.partId }, office) : null
  return { title: reminderTitle(reminder, sessions), body: fitOneLine(reminder.text), attribution: placeLabel(place), iconUrl }
}

/** 묶음 알림의 한 줄: "[Lead] 이름 · 글" (사람이 등록한 것은 글만) */
export function reminderBundleLine(reminder: NotifyReminder, sessions: readonly NotifySession[]): string {
  const sender = senderOf(reminder, sessions)
  return sender ? `${sender} · ${reminder.text}` : reminder.text
}

/** 묶음 알림 "Pray · N reminders": 본문은 bundleToast 와 같이 줄마다 (자르지 않는다) */
export function reminderBundleToast(lines: string[], iconUrl: string | null): ToastContent {
  return { ...bundleToast(lines, iconUrl), title: `Pray · ${lines.length} reminder${lines.length === 1 ? '' : 's'}` }
}

/**
 * 누를 때 열 세션: 그 지휘 단위(팀 직속·파트)의 지금 리드 — Hand over 로 등록한 리드가 바뀌었을 수 있다.
 * 지금 리드가 없거나 사무실 정보를 못 받았으면 등록한 리드(createdBy.sessionId). 사람이 등록한 것은 null (창만 연다)
 */
export function reminderTarget(reminder: NotifyReminder, office: ReminderOffice | null): string | null {
  const creator = reminder.createdBy
  if (creator.kind !== 'lead') return null
  const team = office?.teams.find((each) => each.id === creator.teamId)
  const unit = creator.partId ? team?.parts?.find((each) => each.id === creator.partId) : team
  return unit?.leadSessionId ?? creator.sessionId
}
