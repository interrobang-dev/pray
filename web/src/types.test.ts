import { describe, expect, it } from 'vitest'
import { offDutyLabel } from './types'

const NOW = Date.parse('2026-10-23T12:00:00.000Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('offDutyLabel', () => {
  it('names each off duty reason with how long ago', () => {
    expect(offDutyLabel({ endedAt: ago(0), reason: 'exit', exitCode: 0 }, NOW).text).toBe('퇴근 · 방금')
    expect(offDutyLabel({ endedAt: ago(180), reason: 'dismissed', exitCode: 1 }, NOW).text).toBe('정리됨 · 3시간 전')
    expect(offDutyLabel({ endedAt: ago(10), reason: 'released', exitCode: 1 }, NOW).text).toBe('팀장이 정리 · 10분 전')
    expect(offDutyLabel({ endedAt: ago(2 * 1440), reason: 'error', exitCode: 1 }, NOW).text).toBe('오류로 퇴근 (코드 1) · 2일 전')
    expect(offDutyLabel({ endedAt: ago(5), reason: 'error', exitCode: null }, NOW).text).toBe('오류로 퇴근 · 5분 전')
  })

  it('marks only errors red', () => {
    expect(offDutyLabel({ endedAt: ago(10), reason: 'released', exitCode: 1 }, NOW).isError).toBe(false)
    expect(offDutyLabel({ endedAt: ago(10), reason: 'dismissed', exitCode: 1 }, NOW).isError).toBe(false)
    expect(offDutyLabel({ endedAt: ago(10), reason: 'error', exitCode: 1 }, NOW).isError).toBe(true)
  })
})
