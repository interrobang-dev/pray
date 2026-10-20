import { describe, expect, it } from 'vitest'
import { makeUsageCache, parseUsage } from './usage.js'

const now = new Date('2026-10-20T04:00:00Z')

describe('parseUsage', () => {
  it('labels limits and rounds percent', () => {
    const usage = parseUsage(
      {
        limits: [
          { kind: 'session', percent: 33.4, severity: 'normal', resets_at: '2026-10-20T04:29:59Z', scope: null },
          { kind: 'weekly_all', percent: 23, severity: 'normal', resets_at: '2026-10-24T18:59:59Z', scope: null },
          {
            kind: 'weekly_scoped',
            percent: 6,
            severity: 'normal',
            resets_at: '2026-10-24T18:59:59Z',
            scope: { model: { id: null, display_name: 'Fable' }, surface: null },
          },
        ],
      },
      'max',
      now,
    )
    expect(usage.plan).toBe('max')
    expect(usage.fetchedAt).toBe(now.toISOString())
    expect(usage.limits.map((l) => [l.label, l.percent])).toEqual([
      ['5h', 33],
      ['W', 23],
      ['W Fable', 6],
    ])
  })

  it('falls back to five_hour / seven_day when limits is missing', () => {
    const usage = parseUsage(
      {
        five_hour: { utilization: 10, resets_at: '2026-10-20T04:29:59Z' },
        seven_day: { utilization: 20, resets_at: '2026-10-24T18:59:59Z' },
      },
      null,
      now,
    )
    expect(usage.limits.map((l) => [l.label, l.percent])).toEqual([
      ['5h', 10],
      ['W', 20],
    ])
  })
})

describe('makeUsageCache', () => {
  it('calls loader once within ttl and again after', async () => {
    let calls = 0
    const cache = makeUsageCache(1000, async () => {
      calls += 1
      return { ok: false, reason: `n${calls}` }
    })
    const first = await cache(0)
    const second = await cache(500)
    expect(first).toBe(second)
    expect(calls).toBe(1)
    await cache(Date.now() + 5000)
    expect(calls).toBe(2)
  })
})
