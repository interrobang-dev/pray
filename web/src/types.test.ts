import { describe, expect, it } from 'vitest'
import { formatAgo, offDutyLabel } from './types'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('formatAgo', () => {
  it('uses one unit: just now, minutes, hours, days', () => {
    expect(formatAgo(ago(0), NOW)).toBe('just now')
    expect(formatAgo(ago(5), NOW)).toBe('5m ago')
    expect(formatAgo(ago(180), NOW)).toBe('3h ago')
    expect(formatAgo(ago(2 * 1440), NOW)).toBe('2d ago')
  })
})

describe('offDutyLabel', () => {
  it('names each off duty reason with how long ago', () => {
    expect(offDutyLabel({ endedAt: ago(0), reason: 'exit', exitCode: 0 }, NOW).text).toBe('Left · just now')
    expect(offDutyLabel({ endedAt: ago(180), reason: 'dismissed', exitCode: 1 }, NOW).text).toBe('Ended · 3h ago')
    expect(offDutyLabel({ endedAt: ago(10), reason: 'released', exitCode: 1 }, NOW).text).toBe('Released by lead · 10m ago')
    expect(offDutyLabel({ endedAt: ago(2 * 1440), reason: 'error', exitCode: 1 }, NOW).text).toBe('Exited with error (code 1) · 2d ago')
    expect(offDutyLabel({ endedAt: ago(5), reason: 'error', exitCode: null }, NOW).text).toBe('Exited with error · 5m ago')
  })

  it('marks only errors red', () => {
    expect(offDutyLabel({ endedAt: ago(10), reason: 'released', exitCode: 1 }, NOW).isError).toBe(false)
    expect(offDutyLabel({ endedAt: ago(10), reason: 'dismissed', exitCode: 1 }, NOW).isError).toBe(false)
    expect(offDutyLabel({ endedAt: ago(10), reason: 'error', exitCode: 1 }, NOW).isError).toBe(true)
  })
})
