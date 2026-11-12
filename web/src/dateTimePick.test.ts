import { describe, expect, it } from 'vitest'
import {
  addDays,
  calendarCells,
  confirmText,
  dateLabel,
  dateOf,
  formatTime,
  isPastTime,
  monthTitle,
  parseTimeText,
  quickChoice,
  shiftMonth,
  slotOf,
  timeSlots,
  toIso,
} from './dateTimePick'

/** 이 PC 시각의 ms (month 1~12) */
function local(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

const now = local(2026, 11, 12, 14, 48, 30)
const today = { year: 2026, month: 11, day: 12 }

describe('빠른 칩', () => {
  it('In N 은 지금(초 버림) + N분', () => {
    expect(quickChoice('in-30m', now)).toEqual({ date: today, minutes: 15 * 60 + 18 })
    expect(quickChoice('in-1h', now)).toEqual({ date: today, minutes: 15 * 60 + 48 })
    expect(quickChoice('in-3h', now)).toEqual({ date: today, minutes: 17 * 60 + 48 })
  })

  it('자정을 넘으면 다음 날', () => {
    expect(quickChoice('in-1h', local(2026, 12, 31, 23, 30))).toEqual({ date: { year: 2027, month: 1, day: 1 }, minutes: 30 })
  })

  it('Tomorrow 9:00 은 내일 09:00 (달 넘김 포함)', () => {
    expect(quickChoice('tomorrow-9', now)).toEqual({ date: { year: 2026, month: 11, day: 13 }, minutes: 540 })
    expect(quickChoice('tomorrow-9', local(2026, 11, 30, 23, 59))).toEqual({ date: { year: 2026, month: 12, day: 1 }, minutes: 540 })
  })
})

describe('날짜 계산', () => {
  it('addDays 는 달·해를 넘긴다', () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 })
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 })
  })

  it('shiftMonth 는 해를 넘긴다', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })

  it('dateOf', () => {
    expect(dateOf(now)).toEqual(today)
  })
})

describe('달력 칸', () => {
  it('1일이 든 주의 일요일부터 42칸', () => {
    // 2026-11-01 은 일요일
    const cells = calendarCells(2026, 11, today)
    expect(cells).toHaveLength(42)
    expect(cells[0].date).toEqual({ year: 2026, month: 11, day: 1 })
    expect(cells[41].date).toEqual({ year: 2026, month: 12, day: 12 })
  })

  it('앞 달 날로 시작하고 흐림·지남·오늘을 표시', () => {
    // 2026-12-01 은 화요일 → 11/29(일)부터
    const cells = calendarCells(2026, 12, today)
    expect(cells[0]).toMatchObject({ date: { year: 2026, month: 11, day: 29 }, isInMonth: false, isPast: false })
    expect(cells[2]).toMatchObject({ date: { year: 2026, month: 12, day: 1 }, isInMonth: true })
    const november = calendarCells(2026, 11, today)
    expect(november[10]).toMatchObject({ date: { day: 11 }, isPast: true, isToday: false })
    expect(november[11]).toMatchObject({ date: { day: 12 }, isPast: false, isToday: true })
  })

  it('머리 글자', () => {
    expect(monthTitle(2026, 11)).toBe('November 2026')
  })
})

describe('시각', () => {
  it('목록은 00:00 ~ 23:45 15분마다', () => {
    const slots = timeSlots()
    expect(slots).toHaveLength(96)
    expect(formatTime(slots[0])).toBe('00:00')
    expect(formatTime(slots[95])).toBe('23:45')
    expect(slotOf(15 * 60 + 37)).toBe(15 * 60 + 30)
  })

  it('오늘 지난 칸 (같은 분도 지남)', () => {
    expect(isPastTime(today, 14 * 60 + 45, now)).toBe(true)
    expect(isPastTime(today, 15 * 60, now)).toBe(false)
    expect(isPastTime(today, 14 * 60 + 48, local(2026, 11, 12, 14, 48))).toBe(true)
    expect(isPastTime({ year: 2026, month: 11, day: 13 }, 0, now)).toBe(false)
  })

  it('직접 친 시각 읽기', () => {
    expect(parseTimeText('15:30')).toBe(930)
    expect(parseTimeText(' 1530 ')).toBe(930)
    expect(parseTimeText('930')).toBe(570)
    expect(parseTimeText('0930')).toBe(570)
    expect(parseTimeText('9')).toBe(540)
    expect(parseTimeText('9:5')).toBe(545)
    expect(parseTimeText('15.30')).toBe(930)
    expect(parseTimeText('0')).toBe(0)
  })

  it('못 읽으면 null', () => {
    for (const text of ['', '24', '2400', '15:60', '1560', '15:', ':30', 'abc', '12345', '3pm']) expect(parseTimeText(text)).toBeNull()
  })

  it('ISO 는 이 PC 시각을 Z 꼴로', () => {
    expect(toIso(today, 930)).toBe(new Date(local(2026, 11, 12, 15, 30)).toISOString())
  })
})

describe('글자', () => {
  it('날짜 버튼', () => {
    expect(dateLabel(today, now)).toBe('Today')
    expect(dateLabel({ year: 2026, month: 11, day: 13 }, now)).toBe('Tomorrow')
    expect(dateLabel({ year: 2026, month: 11, day: 20 }, now)).toBe('Fri, Nov 20')
    expect(dateLabel({ year: 2027, month: 1, day: 3 }, now)).toBe('Jan 3, 2027')
  })

  it('확인 줄', () => {
    const at = local(2026, 11, 12, 14, 48)
    expect(confirmText(today, 15 * 60 + 30, at)).toEqual({ text: 'Fires today at 15:30 · in 42m', isPast: false })
    expect(confirmText(today, 16 * 60 + 18, at)).toEqual({ text: 'Fires today at 16:18 · in 1h 30m', isPast: false })
    expect(confirmText({ year: 2026, month: 11, day: 13 }, 540, local(2026, 11, 12, 16, 0))).toEqual({
      text: 'Fires tomorrow at 09:00 · in 17h',
      isPast: false,
    })
    expect(confirmText({ year: 2026, month: 11, day: 20 }, 540, at)).toEqual({ text: 'Fires Fri, Nov 20 at 09:00', isPast: false })
  })

  it('1분 아래 남으면 1m, 지났으면 has passed', () => {
    expect(confirmText(today, 15 * 60, local(2026, 11, 12, 14, 59, 30)).text).toBe('Fires today at 15:00 · in 1m')
    expect(confirmText(today, 14 * 60, now)).toEqual({ text: 'Today at 14:00 has passed', isPast: true })
  })
})
