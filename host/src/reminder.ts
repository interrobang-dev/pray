/** 알림(Reminders): 정한 시각에 사람에게 한 번 울리는 알림. 저장은 hq.ts (최상위 `reminders`), 여기는 꼴·시각 판정 순수 함수 */

/** 등록한 쪽. 사람(화면) 또는 지휘 단위의 리드(MCP). 리드 세션 ID 는 등록할 때 서버가 그 단위의 leadSessionId 로 찾는다 */
export type ReminderCreator = { kind: 'user' } | { kind: 'lead'; teamId: string; partId: string | null; sessionId: string | null }

export interface Reminder {
  /** randomUUID 앞 8자리 (할 일과 같다) */
  id: string
  /** 할 일 글과 같은 규칙 (parseTodoText: 줄바꿈 → 공백, trim, 1~500자) */
  text: string
  /** 울릴 시각. UTC ISO (toISOString) */
  at: string
  createdAt: string
  createdBy: ReminderCreator
  /** 서버가 울린 시각. 아직이면 null */
  firedAt: string | null
  /** 울린 시각이 at 보다 REMINDER_LATE_MS 넘게 늦었다 (서버가 꺼져 있던 사이 지남). 울릴 때 정하고, 울리기 전에는 키가 없다 */
  isLate?: boolean
  /** 사람이 확인한 시각. 확인 전이면 null. 확인하고 REMINDER_RETENTION_MS 지나면 지운다 */
  acknowledgedAt: string | null
}

/** 이만큼 넘게 늦게 울리면 늦음. 서버가 30초마다 보므로 그보다 넉넉히 */
export const REMINDER_LATE_MS = 90_000
/** 확인한 알림 보관 기간 (퇴근 기록·task 와 같은 7일) */
export const REMINDER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** 이만큼 넘게 과거인 시각은 받지 않는다 (입력하는 사이 지난 몇 초는 받아 다음 회차에 울린다) */
export const REMINDER_PAST_GRACE_MS = 60_000
/** 이만큼보다 먼 시각은 받지 않는다 (연도 오타 막기) */
export const REMINDER_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000

/** 날짜와 시각이 다 있는 ISO 꼴. 오프셋이 없으면 이 PC 시각으로 본다 (JS Date.parse 규칙). 날짜만 있는 꼴은 UTC 로 해석돼 헷갈려 받지 않는다 */
const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/

export type ReminderAtResult = { at: string } | { error: 'format' | 'past' | 'too-far' }

/** API 로 받은 울릴 시각. 맞으면 UTC ISO, 아니면 이유 */
export function parseReminderAt(value: unknown, now: Date): ReminderAtResult {
  if (typeof value !== 'string' || !AT_PATTERN.test(value)) return { error: 'format' }
  const time = Date.parse(value)
  if (Number.isNaN(time) || !hasRealCalendarFields(value)) return { error: 'format' }
  if (time < now.getTime() - REMINDER_PAST_GRACE_MS) return { error: 'past' }
  if (time > now.getTime() + REMINDER_MAX_AHEAD_MS) return { error: 'too-far' }
  return { at: new Date(time).toISOString() }
}

/** 적힌 날짜·시·분이 실제로 있는 값인지 (2026-02-31·25:00 은 아니다). Date 는 넘치는 칸을 다음 달·날로 넘겨 버려서 칸끼리 되짚는다 */
function hasRealCalendarFields(value: string): boolean {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const [hour, minute] = value.slice(11, 16).split(':').map(Number)
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute))
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute
  )
}

/**
 * 시각이 된 알림을 울리고(firedAt·isLate) 확인한 지 보관 기간이 지난 것을 뺀다. 넘긴 배열은 바꾸지 않는다.
 * 보관 기간 경계 시각의 것은 남긴다 (pruneOffDuty 와 같다)
 */
export function fireDue(reminders: Reminder[], now: Date): { reminders: Reminder[]; fired: Reminder[]; prunedCount: number } {
  const nowTime = now.getTime()
  const fired: Reminder[] = []
  const kept = reminders.filter((reminder) => !(reminder.acknowledgedAt && nowTime - Date.parse(reminder.acknowledgedAt) > REMINDER_RETENTION_MS))
  const next = kept.map((reminder) => {
    if (reminder.firedAt || Date.parse(reminder.at) > nowTime) return reminder
    const firedReminder = { ...reminder, firedAt: now.toISOString(), isLate: nowTime - Date.parse(reminder.at) > REMINDER_LATE_MS }
    fired.push(firedReminder)
    return firedReminder
  })
  return { reminders: next, fired, prunedCount: reminders.length - kept.length }
}
