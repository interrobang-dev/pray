import { nameOf } from './sessionPosition'
import type { Office, Reminder, ReminderCreator, Session, Team } from './types'

/** office 의 알림. 옛 서버 응답에는 키가 없다 */
export function remindersOf(office: Office): Reminder[] {
  return office.reminders ?? []
}

/** 울렸고 아직 확인하지 않은 것 */
export function isUnacknowledgedFired(reminder: Reminder): boolean {
  return reminder.firedAt !== null && reminder.acknowledgedAt === null
}

/**
 * 보기의 두 구역. Fired = 울렸고 확인 전(울린 시각 최근순), Upcoming = 안 울림(울릴 시각 이른 순).
 * 확인한 것은 어디에도 넣지 않는다 (서버가 7일 뒤 지운다)
 */
export function reminderSections(reminders: readonly Reminder[]): { fired: Reminder[]; upcoming: Reminder[] } {
  const fired = reminders.filter(isUnacknowledgedFired).sort((a, b) => timeOf(b.firedAt) - timeOf(a.firedAt))
  const upcoming = reminders.filter((reminder) => reminder.firedAt === null).sort((a, b) => timeOf(a.at) - timeOf(b.at))
  return { fired, upcoming }
}

/** 툴바 배지 개수: 울렸고 확인 전인 것만 (예정은 세지 않는다) */
export function unacknowledgedCount(reminders: readonly Reminder[]): number {
  return reminders.filter(isUnacknowledgedFired).length
}

/** 서버 응답 항목을 넣는다: 같은 id 가 있으면 바꾸고 없으면 끝에 (서버도 끝에 넣는다) */
export function applyReminder(reminders: readonly Reminder[], reminder: Reminder): Reminder[] {
  return reminders.some((item) => item.id === reminder.id)
    ? reminders.map((item) => (item.id === reminder.id ? reminder : item))
    : [...reminders, reminder]
}

export function removeReminder(reminders: readonly Reminder[], reminderId: string): Reminder[] {
  return reminders.filter((item) => item.id !== reminderId)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 울릴 시각 (이 PC 시각): "Today 15:30" · "Tomorrow 09:00" · "Yesterday 14:00" · "Nov 14 09:00" · 해가 다르면 "Jan 3, 2027 09:00" */
export function formatDue(iso: string, now: number): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const dayDiff = Math.round((startOfDay(date.getTime()) - startOfDay(now)) / DAY_MS)
  if (dayDiff === 0) return `Today ${time}`
  if (dayDiff === 1) return `Tomorrow ${time}`
  if (dayDiff === -1) return `Yesterday ${time}`
  const isSameYear = date.getFullYear() === new Date(now).getFullYear()
  const day = date.toLocaleDateString('en-US', isSameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${day} ${time}`
}

/** Fired 줄의 울릴 시각: 오늘이면 시각만("14:00"), 아니면 formatDue */
export function formatFiredDue(iso: string, now: number): string {
  const due = formatDue(iso, now)
  return due.startsWith('Today ') ? due.slice('Today '.length) : due
}

/** 이 PC 시각의 Date → <input type="datetime-local"> 값 "2026-11-12T15:30" (min 에 쓴다) */
export function toLocalInputValue(time: number): string {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** datetime-local 값(오프셋 없는 이 PC 시각) → 서버에 보낼 UTC ISO. 다른 시간대 기기에서도 같은 절대 시각이 가게 Z 꼴만 보낸다. 비었거나 틀리면 null */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * 만든 이 글자. 사람 = "You", 리드 = "[Lead] 이름 · 팀 › 파트" (파트장은 "[Part lead]").
 * 리드 세션을 목록에서 못 찾으면(퇴근 기록 삭제 등) 이름 없이 "[Lead] 팀 › 파트", 팀도 없으면 "[Lead]"
 */
export function creatorLabel(createdBy: ReminderCreator, sessions: readonly Session[], teams: readonly Team[]): string {
  if (createdBy.kind === 'user') return 'You'
  const role = createdBy.partId ? '[Part lead]' : '[Lead]'
  const team = teams.find((candidate) => candidate.id === createdBy.teamId)
  const part = createdBy.partId ? team?.parts.find((candidate) => candidate.id === createdBy.partId) : undefined
  const place = team ? (part ? `${team.name} › ${part.name}` : team.name) : null
  const session = createdBy.sessionId ? sessions.find((candidate) => candidate.id === createdBy.sessionId) : undefined
  const parts = [session ? `${role} ${nameOf(session)}` : role, place].filter((text): text is string => text !== null)
  return session ? parts.join(' · ') : parts.join(' ')
}

function timeOf(iso: string | null): number {
  const time = iso ? Date.parse(iso) : NaN
  return Number.isNaN(time) ? 0 : time
}

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
