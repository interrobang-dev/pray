/**
 * Reminders 창 날짜·시각 고르기(DateTimePicker.tsx)의 순수 함수. 모두 이 PC 시각 기준이고, 지금 시각은 인자 now(ms)로 받는다.
 * 시각은 하루 안의 분(0~1439)으로 다룬다
 */

/** 이 PC 달력의 날 (month 는 1~12) */
export interface LocalDate {
  year: number
  month: number
  day: number
}

/** 시각 목록 간격 (분) */
export const TIME_STEP_MINUTES = 15
/** 달력 요일 줄 (주 시작 일요일) */
export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const MINUTE_MS = 60_000

export function dateOf(time: number): LocalDate {
  const date = new Date(time)
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

export function isSameDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/** a 가 b 보다 이르면 음수, 같으면 0, 늦으면 양수 */
export function compareDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

/** 날짜 더하기 (달·해 넘김은 Date 가 맡는다) */
export function addDays(date: LocalDate, days: number): LocalDate {
  return dateOf(new Date(date.year, date.month - 1, date.day + days).getTime())
}

/** 달 옮기기 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** 날짜 + 하루 안의 분 → 그 시각(ms, 이 PC 시각) */
export function timeAt(date: LocalDate, minutes: number): number {
  return new Date(date.year, date.month - 1, date.day, Math.floor(minutes / 60), minutes % 60).getTime()
}

/** 서버에 보낼 UTC ISO (Z 꼴 — 다른 시간대 기기에서도 같은 절대 시각) */
export function toIso(date: LocalDate, minutes: number): string {
  return new Date(timeAt(date, minutes)).toISOString()
}

/** 하루 안의 분 → "15:30" (24시간제) */
export function formatTime(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** 시각 목록: 00:00 ~ 23:45 를 15분마다 (하루 안의 분) */
export function timeSlots(): number[] {
  return Array.from({ length: (24 * 60) / TIME_STEP_MINUTES }, (_, index) => index * TIME_STEP_MINUTES)
}

/** 그 시각을 포함하는 목록 칸 (15:37 → 15:30 칸) */
export function slotOf(minutes: number): number {
  return minutes - (minutes % TIME_STEP_MINUTES)
}

/** 그 날의 그 시각이 이미 지났다 (지금과 같은 분도 지난 것으로 본다 — 목록에서 누를 수 없게) */
export function isPastTime(date: LocalDate, minutes: number, now: number): boolean {
  return timeAt(date, minutes) <= now
}

/**
 * 직접 친 시각 → 하루 안의 분. 못 읽으면 null.
 * "15:30"·"15.30"·"9:5"(09:05)·"9"(09:00)·"15"·"930"(09:30)·"1530"
 */
export function parseTimeText(text: string): number | null {
  const value = text.trim()
  let hour: number
  let minute: number
  const separated = /^(\d{1,2})[:.](\d{1,2})$/.exec(value)
  if (separated) {
    hour = Number(separated[1])
    minute = Number(separated[2])
  } else if (/^\d{1,2}$/.test(value)) {
    hour = Number(value)
    minute = 0
  } else if (/^\d{3,4}$/.test(value)) {
    hour = Number(value.slice(0, -2))
    minute = Number(value.slice(-2))
  } else {
    return null
  }
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export type QuickChoiceKind = 'in-30m' | 'in-1h' | 'in-3h' | 'tomorrow-9'

export const QUICK_CHOICES: { kind: QuickChoiceKind; label: string }[] = [
  { kind: 'in-30m', label: 'In 30m' },
  { kind: 'in-1h', label: 'In 1h' },
  { kind: 'in-3h', label: 'In 3h' },
  { kind: 'tomorrow-9', label: 'Tomorrow 9:00' },
]

/** 빠른 칩의 날짜·시각. In N = 지금(초는 버린 분) + N분, 자정을 넘으면 다음 날. Tomorrow 9:00 = 내일 09:00 */
export function quickChoice(kind: QuickChoiceKind, now: number): { date: LocalDate; minutes: number } {
  if (kind === 'tomorrow-9') return { date: addDays(dateOf(now), 1), minutes: 9 * 60 }
  const offset = kind === 'in-30m' ? 30 : kind === 'in-1h' ? 60 : 180
  const target = new Date(Math.floor(now / MINUTE_MS) * MINUTE_MS + offset * MINUTE_MS)
  return { date: dateOf(target.getTime()), minutes: target.getHours() * 60 + target.getMinutes() }
}

/** 달력 머리 "November 2026" */
export function monthTitle(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export interface CalendarCell {
  date: LocalDate
  /** 보는 달의 날 (앞뒤 달 날은 흐리게) */
  isInMonth: boolean
  /** 오늘보다 이르다 (누를 수 없다) */
  isPast: boolean
  isToday: boolean
}

/** 달력 칸: 그 달 1일이 든 주의 일요일부터 6주 42칸 (달마다 높이가 같게) */
export function calendarCells(year: number, month: number, today: LocalDate): CalendarCell[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const start: LocalDate = addDays({ year, month, day: 1 }, -firstWeekday)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
    return {
      date,
      isInMonth: date.year === year && date.month === month,
      isPast: compareDates(date, today) < 0,
      isToday: isSameDate(date, today),
    }
  })
}

/** 날짜 버튼 글자: "Today"·"Tomorrow"·"Fri, Nov 14"·해가 다르면 "Jan 3, 2027" */
export function dateLabel(date: LocalDate, now: number): string {
  const today = dateOf(now)
  if (isSameDate(date, today)) return 'Today'
  if (isSameDate(date, addDays(today, 1))) return 'Tomorrow'
  const value = new Date(date.year, date.month - 1, date.day)
  return date.year === today.year
    ? value.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** 남은 시간 "42m"·"1h 30m"·"17h" (1분 아래는 올려 1m. 10시간부터는 시만) */
function formatRemaining(milliseconds: number): string {
  const totalMinutes = Math.ceil(milliseconds / MINUTE_MS)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours >= 10 || minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/**
 * 확인 한 줄: "Fires today at 15:30 · in 42m" · "Fires tomorrow at 09:00 · in 17h" · "Fires Fri, Nov 14 at 09:00".
 * 지났으면 "Today at 09:00 has passed" 꼴과 isPast (보내면 서버가 400 을 준다)
 */
export function confirmText(date: LocalDate, minutes: number, now: number): { text: string; isPast: boolean } {
  const label = dateLabel(date, now)
  const time = formatTime(minutes)
  const remaining = timeAt(date, minutes) - now
  if (remaining <= 0) return { text: `${label} at ${time} has passed`, isPast: true }
  if (label === 'Today' || label === 'Tomorrow') {
    return { text: `Fires ${label.toLowerCase()} at ${time} · in ${formatRemaining(remaining)}`, isPast: false }
  }
  return { text: `Fires ${label} at ${time}`, isPast: false }
}
