import { describe, expect, it } from 'vitest'
import {
  applyReminder,
  creatorLabel,
  formatDue,
  formatFiredDue,
  localInputToIso,
  reminderSections,
  remindersOf,
  removeReminder,
  toLocalInputValue,
  unacknowledgedCount,
} from './reminders'
import type { Reminder, Session, Team } from './types'

function reminder(id: string, patch: Partial<Reminder> = {}): Reminder {
  return {
    id,
    text: id,
    at: '2026-11-12T06:00:00.000Z',
    createdAt: '2026-11-12T00:00:00.000Z',
    createdBy: { kind: 'user' },
    firedAt: null,
    acknowledgedAt: null,
    ...patch,
  }
}

/** 이 PC 시각으로 만든 시각 (테스트가 어느 시간대에서 돌아도 같은 결과) */
function local(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

describe('remindersOf', () => {
  it('옛 서버 응답(키 없음)은 빈 배열', () => {
    expect(remindersOf({ groups: [], teams: [] })).toEqual([])
  })
})

describe('reminderSections', () => {
  it('Fired 는 울린 시각 최근순, Upcoming 은 울릴 시각 이른 순, 확인한 것은 뺀다', () => {
    const list = [
      reminder('up-late', { at: '2026-11-13T00:00:00.000Z' }),
      reminder('fired-old', { firedAt: '2026-11-12T01:00:00.000Z' }),
      reminder('acked', { firedAt: '2026-11-12T03:00:00.000Z', acknowledgedAt: '2026-11-12T04:00:00.000Z' }),
      reminder('up-soon', { at: '2026-11-12T08:00:00.000Z' }),
      reminder('fired-new', { firedAt: '2026-11-12T02:00:00.000Z' }),
    ]
    const sections = reminderSections(list)
    expect(sections.fired.map((item) => item.id)).toEqual(['fired-new', 'fired-old'])
    expect(sections.upcoming.map((item) => item.id)).toEqual(['up-soon', 'up-late'])
  })

  it('넘긴 배열은 바꾸지 않는다', () => {
    const list = [reminder('b', { at: '2026-11-13T00:00:00.000Z' }), reminder('a')]
    reminderSections(list)
    expect(list.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

describe('unacknowledgedCount', () => {
  it('울렸고 확인 전인 것만 센다', () => {
    const list = [
      reminder('upcoming'),
      reminder('fired', { firedAt: '2026-11-12T01:00:00.000Z' }),
      reminder('acked', { firedAt: '2026-11-12T01:00:00.000Z', acknowledgedAt: '2026-11-12T02:00:00.000Z' }),
    ]
    expect(unacknowledgedCount(list)).toBe(1)
    expect(unacknowledgedCount([])).toBe(0)
  })
})

describe('applyReminder · removeReminder', () => {
  it('같은 id 는 바꾸고 새 id 는 끝에 넣는다', () => {
    const list = [reminder('a'), reminder('b')]
    expect(applyReminder(list, reminder('a', { text: 'changed' })).map((item) => item.text)).toEqual(['changed', 'b'])
    expect(applyReminder(list, reminder('c')).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('지운다', () => {
    expect(removeReminder([reminder('a'), reminder('b')], 'a').map((item) => item.id)).toEqual(['b'])
  })
})

describe('formatDue', () => {
  const now = local(2026, 11, 12, 10, 0)

  it('오늘·내일·어제', () => {
    expect(formatDue(new Date(local(2026, 11, 12, 15, 30)).toISOString(), now)).toBe('Today 15:30')
    expect(formatDue(new Date(local(2026, 11, 13, 9, 0)).toISOString(), now)).toBe('Tomorrow 09:00')
    expect(formatDue(new Date(local(2026, 11, 11, 23, 5)).toISOString(), now)).toBe('Yesterday 23:05')
  })

  it('그 밖은 날짜, 해가 다르면 해까지', () => {
    expect(formatDue(new Date(local(2026, 11, 14, 9, 0)).toISOString(), now)).toBe('Nov 14 09:00')
    expect(formatDue(new Date(local(2027, 1, 3, 0, 0)).toISOString(), now)).toBe('Jan 3, 2027 00:00')
  })

  it('Fired 줄은 오늘이면 시각만', () => {
    expect(formatFiredDue(new Date(local(2026, 11, 12, 9, 0)).toISOString(), now)).toBe('09:00')
    expect(formatFiredDue(new Date(local(2026, 11, 11, 9, 0)).toISOString(), now)).toBe('Yesterday 09:00')
  })
})

describe('datetime-local 값', () => {
  it('이 PC 시각을 분까지 값으로', () => {
    expect(toLocalInputValue(local(2026, 1, 5, 7, 3) + 45_000)).toBe('2026-01-05T07:03')
  })

  it('값을 UTC ISO 로 (이 PC 시각으로 읽는다)', () => {
    expect(localInputToIso('2026-11-12T15:30')).toBe(new Date(local(2026, 11, 12, 15, 30)).toISOString())
  })

  it('비었거나 틀리면 null', () => {
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('2026-11-12')).toBeNull()
    expect(localInputToIso('2026-13-45T99:99')).toBeNull()
  })
})

describe('creatorLabel', () => {
  const team = { id: 't1', name: 'Pray', parts: [{ id: 'p1', name: 'Web', createdAt: '' }] } as unknown as Team
  const lead = { id: 's1', name: 'Mina', title: null, position: 'Lead' } as unknown as Session

  it('사람은 You', () => {
    expect(creatorLabel({ kind: 'user' }, [], [])).toBe('You')
  })

  it('리드는 역할·이름·팀 › 파트', () => {
    expect(creatorLabel({ kind: 'lead', teamId: 't1', partId: null, sessionId: 's1' }, [lead], [team])).toBe('[Lead] Mina · Pray')
    expect(creatorLabel({ kind: 'lead', teamId: 't1', partId: 'p1', sessionId: 's1' }, [lead], [team])).toBe('[Part lead] Mina · Pray › Web')
  })

  it('세션을 못 찾으면 팀 이름, 팀도 없으면 역할만', () => {
    expect(creatorLabel({ kind: 'lead', teamId: 't1', partId: 'p1', sessionId: 'gone' }, [lead], [team])).toBe('[Part lead] Pray › Web')
    expect(creatorLabel({ kind: 'lead', teamId: 'gone', partId: null, sessionId: null }, [], [team])).toBe('[Lead]')
  })
})
