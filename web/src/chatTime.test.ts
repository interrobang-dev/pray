import { describe, expect, it } from 'vitest'
import { dateDividerLabel, formatTimeOfDay, localDayKey, rowTimes, type RowStamp } from './chatTime'

/** 이 PC 시각으로 만든 ISO (시험이 시간대에 따라 바뀌지 않게) */
function at(year: number, month: number, day: number, hour: number, minute: number, second = 0): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString()
}

const NOW = new Date(2026, 10, 13, 15, 0)

function stamp(sender: string | null, iso: string | null): RowStamp {
  return { at: iso, sender }
}

describe('formatTimeOfDay', () => {
  it('24시간 두 자리', () => {
    expect(formatTimeOfDay(new Date(2026, 0, 2, 9, 5))).toBe('09:05')
    expect(formatTimeOfDay(new Date(2026, 0, 2, 23, 59))).toBe('23:59')
    expect(formatTimeOfDay(new Date(2026, 0, 2, 0, 0))).toBe('00:00')
  })
})

describe('localDayKey', () => {
  it('이 PC 날짜', () => {
    expect(localDayKey(new Date(2026, 10, 3, 23, 59))).toBe('2026-11-03')
  })
})

describe('dateDividerLabel', () => {
  it('오늘·어제·그 밖', () => {
    expect(dateDividerLabel(new Date(2026, 10, 13, 0, 1), NOW)).toBe('Today')
    expect(dateDividerLabel(new Date(2026, 10, 12, 23, 59), NOW)).toBe('Yesterday')
    expect(dateDividerLabel(new Date(2026, 10, 11, 12, 0), NOW)).toBe('Nov 11, 2026')
    expect(dateDividerLabel(new Date(2025, 0, 5, 12, 0), NOW)).toBe('Jan 5, 2025')
  })

  it('달·해가 바뀌는 어제', () => {
    const newYear = new Date(2027, 0, 1, 8, 0)
    expect(dateDividerLabel(new Date(2026, 11, 31, 22, 0), newYear)).toBe('Yesterday')
    expect(dateDividerLabel(new Date(2026, 11, 30, 22, 0), newYear)).toBe('Dec 30, 2026')
  })

  it('미래 날짜(시계 어긋남)는 날짜 그대로', () => {
    expect(dateDividerLabel(new Date(2026, 10, 14, 1, 0), NOW)).toBe('Nov 14, 2026')
  })
})

describe('rowTimes', () => {
  it('첫 줄 앞에 구분선, 같은 날은 다시 넣지 않는다', () => {
    const result = rowTimes([stamp('me', at(2026, 11, 13, 10, 0)), stamp('claude', at(2026, 11, 13, 10, 1))], NOW)
    expect(result).toEqual([
      { time: '10:00', dateLabel: 'Today' },
      { time: '10:01', dateLabel: null },
    ])
  })

  it('날짜가 바뀌는 줄 앞에 구분선 (작업 묶음처럼 시각 없는 줄도 날짜는 본다)', () => {
    const result = rowTimes(
      [stamp('me', at(2026, 11, 11, 23, 58)), stamp(null, at(2026, 11, 12, 0, 1)), stamp('claude', at(2026, 11, 12, 0, 3)), stamp('me', at(2026, 11, 13, 9, 0))],
      NOW,
    )
    expect(result.map((row) => row.dateLabel)).toEqual(['Nov 11, 2026', 'Yesterday', null, 'Today'])
    expect(result.map((row) => row.time)).toEqual(['23:58', null, '00:03', '09:00'])
  })

  it('같은 쪽이 같은 분에 연달아 보내면 마지막 것에만', () => {
    const result = rowTimes([stamp('me', at(2026, 11, 13, 10, 0, 1)), stamp('me', at(2026, 11, 13, 10, 0, 30)), stamp('me', at(2026, 11, 13, 10, 0, 59))], NOW)
    expect(result.map((row) => row.time)).toEqual([null, null, '10:00'])
  })

  it('분이 다르면 둘 다', () => {
    const result = rowTimes([stamp('me', at(2026, 11, 13, 10, 0, 59)), stamp('me', at(2026, 11, 13, 10, 1, 0))], NOW)
    expect(result.map((row) => row.time)).toEqual(['10:00', '10:01'])
  })

  it('사이에 다른 쪽·시각 없는 줄이 끼면 끊긴다', () => {
    const result = rowTimes(
      [
        stamp('me', at(2026, 11, 13, 10, 0)),
        stamp('claude', at(2026, 11, 13, 10, 0)),
        stamp('me', at(2026, 11, 13, 10, 0)),
        stamp(null, at(2026, 11, 13, 10, 0)),
        stamp('me', at(2026, 11, 13, 10, 0)),
      ],
      NOW,
    )
    expect(result.map((row) => row.time)).toEqual(['10:00', '10:00', '10:00', null, '10:00'])
  })

  it('지시자가 다르면 다른 쪽', () => {
    const result = rowTimes([stamp('relay:Lead', at(2026, 11, 13, 10, 0)), stamp('relay:Part', at(2026, 11, 13, 10, 0)), stamp('relay:Part', at(2026, 11, 13, 10, 0))], NOW)
    expect(result.map((row) => row.time)).toEqual(['10:00', null, '10:00'])
  })

  it('시각을 읽을 수 없는 줄은 시각도 구분선도 없다', () => {
    const result = rowTimes([stamp('me', null), stamp('me', 'nope'), stamp('me', at(2026, 11, 13, 10, 0))], NOW)
    expect(result).toEqual([
      { time: null, dateLabel: null },
      { time: null, dateLabel: null },
      { time: '10:00', dateLabel: 'Today' },
    ])
  })

  it('빈 목록', () => {
    expect(rowTimes([], NOW)).toEqual([])
  })
})
