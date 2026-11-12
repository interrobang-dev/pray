import { describe, expect, it } from 'vitest'
import { fireDue, parseReminderAt, REMINDER_LATE_MS, REMINDER_MAX_AHEAD_MS, REMINDER_PAST_GRACE_MS, REMINDER_RETENTION_MS, type Reminder } from './reminder.js'

const NOW = new Date('2026-11-12T05:00:00.000Z')

function reminder(fields: Partial<Reminder>): Reminder {
  return { id: 'r1', text: '가', at: NOW.toISOString(), createdAt: '', createdBy: { kind: 'user' }, firedAt: null, acknowledgedAt: null, ...fields }
}

describe('parseReminderAt', () => {
  it('takes an ISO time with Z or an offset and returns UTC ISO', () => {
    expect(parseReminderAt('2026-11-12T06:30:00Z', NOW)).toEqual({ at: '2026-11-12T06:30:00.000Z' })
    expect(parseReminderAt('2026-11-12T15:30+09:00', NOW)).toEqual({ at: '2026-11-12T06:30:00.000Z' })
    expect(parseReminderAt('2026-11-12T06:30:15.5Z', NOW)).toEqual({ at: '2026-11-12T06:30:15.500Z' })
  })

  it('reads a time without offset as this PC local time', () => {
    const local = new Date(NOW.getTime() + 3_600_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const written = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`
    expect(parseReminderAt(written, NOW)).toEqual({ at: local.toISOString() })
  })

  it.each([
    ['date only', '2026-11-13'],
    ['no minutes', '2026-11-13T10'],
    ['space instead of T', '2026-11-13 10:00'],
    ['day that does not exist', '2026-02-31T10:00Z'],
    ['hour 25', '2026-11-13T25:00Z'],
    ['minute 60', '2026-11-13T10:60Z'],
    ['words', 'tomorrow'],
    ['number', 1_700_000_000_000],
    ['missing', undefined],
  ])('refuses %s as format', (_label, value) => {
    expect(parseReminderAt(value, NOW)).toEqual({ error: 'format' })
  })

  it('takes a few seconds in the past but not more than the grace', () => {
    expect(parseReminderAt(new Date(NOW.getTime() - REMINDER_PAST_GRACE_MS).toISOString(), NOW)).toHaveProperty('at')
    expect(parseReminderAt(new Date(NOW.getTime() - REMINDER_PAST_GRACE_MS - 1000).toISOString(), NOW)).toEqual({ error: 'past' })
  })

  it('refuses a time more than a year ahead', () => {
    expect(parseReminderAt(new Date(NOW.getTime() + REMINDER_MAX_AHEAD_MS).toISOString(), NOW)).toHaveProperty('at')
    expect(parseReminderAt(new Date(NOW.getTime() + REMINDER_MAX_AHEAD_MS + 1000).toISOString(), NOW)).toEqual({ error: 'too-far' })
  })
})

describe('fireDue', () => {
  it('fires due reminders once, on time or late, and leaves future ones', () => {
    const onTime = reminder({ id: 'a', at: new Date(NOW.getTime() - 20_000).toISOString() })
    const late = reminder({ id: 'b', at: new Date(NOW.getTime() - REMINDER_LATE_MS - 1).toISOString() })
    const future = reminder({ id: 'c', at: new Date(NOW.getTime() + 1).toISOString() })
    const already = reminder({ id: 'd', firedAt: '2026-11-11T00:00:00.000Z', isLate: false })
    const input = [onTime, late, future, already]
    const { reminders, fired, prunedCount } = fireDue(input, NOW)
    expect(fired.map((r) => [r.id, r.firedAt, r.isLate])).toEqual([
      ['a', NOW.toISOString(), false],
      ['b', NOW.toISOString(), true],
    ])
    expect(reminders.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(reminders[2]).toBe(future)
    expect(reminders[3]).toBe(already)
    expect(prunedCount).toBe(0)
    expect(input[0].firedAt).toBeNull()
    expect(fireDue(reminders, NOW).fired).toEqual([])
  })

  it('fires a reminder exactly at its time', () => {
    expect(fireDue([reminder({})], NOW).fired).toHaveLength(1)
  })

  it('drops acknowledged reminders after the retention, keeping the boundary and unacknowledged ones', () => {
    const old = reminder({ id: 'old', firedAt: '2026-11-01T00:00:00.000Z', acknowledgedAt: new Date(NOW.getTime() - REMINDER_RETENTION_MS - 1).toISOString() })
    const boundary = reminder({ id: 'edge', firedAt: '2026-11-01T00:00:00.000Z', acknowledgedAt: new Date(NOW.getTime() - REMINDER_RETENTION_MS).toISOString() })
    const unacknowledged = reminder({ id: 'open', firedAt: '2026-10-01T00:00:00.000Z' })
    const { reminders, fired, prunedCount } = fireDue([old, boundary, unacknowledged], NOW)
    expect(reminders.map((r) => r.id)).toEqual(['edge', 'open'])
    expect(fired).toEqual([])
    expect(prunedCount).toBe(1)
  })
})
