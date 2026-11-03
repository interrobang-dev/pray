import { describe, expect, it } from 'vitest'
import { LEAD_END_POLL_MS, LEAD_END_TIMEOUT_MS, waitForLeadEnd } from './leadReplace.js'

/** 가짜 시계: sleep 이 시계를 그만큼 돌린다 */
function fakeClock() {
  let time = 0
  const sleeps: number[] = []
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      time += ms
    },
    sleeps,
    elapsed: () => time,
  }
}

describe('waitForLeadEnd', () => {
  it('returns ended once the old lead is no longer alive', async () => {
    const clock = fakeClock()
    let checks = 0
    const outcome = await waitForLeadEnd({
      leadId: 'old',
      currentLeadId: () => 'old',
      isAlive: async () => ++checks < 4,
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(outcome).toBe('ended')
    expect(checks).toBe(4)
    expect(clock.sleeps).toEqual([LEAD_END_POLL_MS, LEAD_END_POLL_MS, LEAD_END_POLL_MS])
  })

  it('returns ended without waiting when the lead already ended', async () => {
    const clock = fakeClock()
    expect(await waitForLeadEnd({ leadId: 'old', currentLeadId: () => 'old', isAlive: async () => false, now: clock.now, sleep: clock.sleep })).toBe('ended')
    expect(clock.sleeps).toEqual([])
  })

  it('times out after the limit when the lead never ends', async () => {
    const clock = fakeClock()
    const outcome = await waitForLeadEnd({ leadId: 'old', currentLeadId: () => 'old', isAlive: async () => true, now: clock.now, sleep: clock.sleep })
    expect(outcome).toBe('timeout')
    expect(clock.elapsed()).toBe(LEAD_END_TIMEOUT_MS)
    expect(clock.sleeps).toHaveLength(LEAD_END_TIMEOUT_MS / LEAD_END_POLL_MS)
  })

  it('uses the given timeout and interval', async () => {
    const clock = fakeClock()
    const outcome = await waitForLeadEnd({
      leadId: 'old',
      currentLeadId: () => 'old',
      isAlive: async () => true,
      timeoutMs: 1_000,
      pollMs: 250,
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(outcome).toBe('timeout')
    expect(clock.sleeps).toEqual([250, 250, 250, 250])
  })

  it('returns superseded when another request changed the lead while waiting', async () => {
    const clock = fakeClock()
    let leadId = 'old'
    let checks = 0
    const outcome = await waitForLeadEnd({
      leadId: 'old',
      currentLeadId: () => leadId,
      isAlive: async () => {
        checks++
        if (checks === 2) leadId = 'other-new'
        return true
      },
      now: clock.now,
      sleep: clock.sleep,
    })
    expect(outcome).toBe('superseded')
    expect(checks).toBe(2)
  })

  it('returns superseded when the lead changed during the last alive check, even if it ended', async () => {
    let leadId = 'old'
    const outcome = await waitForLeadEnd({
      leadId: 'old',
      currentLeadId: () => leadId,
      isAlive: async () => {
        leadId = 'other-new'
        return false
      },
    })
    expect(outcome).toBe('superseded')
  })

  it('returns superseded right away when the lead is already different', async () => {
    let checks = 0
    const outcome = await waitForLeadEnd({
      leadId: 'old',
      currentLeadId: () => undefined,
      isAlive: async () => {
        checks++
        return true
      },
    })
    expect(outcome).toBe('superseded')
    expect(checks).toBe(0)
  })
})
