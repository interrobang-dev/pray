import { describe, expect, it } from 'vitest'
import {
  bannerOf,
  DONE_SHOW_MS,
  nextOutage,
  PARTIAL_SHOW_MS,
  presentWebIds,
  RESUME_TIMEOUT_MS,
  SHOW_DELAY_MS,
  type ConnectionInput,
  type Outage,
} from './reconnect'

type Attendance = 'present' | 'break' | 'off'
const web = (id: string, attendance: Attendance) => ({ id, kind: 'web' as const, attendance, isAlive: attendance === 'present' })
const external = (id: string) => ({ id, kind: 'external' as const, attendance: 'present' as const, isAlive: true })

const linked = (sessions: ConnectionInput['sessions']): ConnectionInput => ({ isConnected: true, isHostReachable: true, sessions })
const serverDown = (sessions: ConnectionInput['sessions']): ConnectionInput => ({ isConnected: false, isHostReachable: true, sessions })
const hostDown = (sessions: ConnectionInput['sessions']): ConnectionInput => ({ isConnected: true, isHostReachable: false, sessions })

/** 입력을 시각 순서대로 넣어 본다 */
function run(steps: [number, ConnectionInput][], healthyIds: string[], request: { target: 'server' | 'host'; at: number } | null = null) {
  let outage: Outage | null = null
  const banners: (string | null)[] = []
  for (const [at, input] of steps) {
    outage = nextOutage(outage, input, at, healthyIds, request)
    banners.push(bannerOf(outage, input)?.text ?? null)
  }
  return { outage, banners }
}

describe('presentWebIds', () => {
  it('keeps only web sessions on duty', () => {
    expect(presentWebIds([web('a', 'present'), web('b', 'break'), web('c', 'off'), external('d')])).toEqual(['a'])
  })
})

describe('nextOutage · bannerOf', () => {
  const present = [web('a', 'present'), web('b', 'present')]
  const onBreak = [web('a', 'break'), web('b', 'break')]

  it('shows nothing while linked', () => {
    expect(nextOutage(null, linked(present), 0, ['a', 'b'], null)).toBeNull()
  })

  it('does not show a blip shorter than the delay, and no "Reconnected" after it', () => {
    const { outage, banners } = run([[0, serverDown(present)], [SHOW_DELAY_MS - 100, serverDown(present)], [SHOW_DELAY_MS - 50, linked(present)]], ['a', 'b'])
    expect(banners).toEqual([null, null, null])
    expect(outage).toBeNull()
  })

  it('says Restarting server… when ↻ started it, then Reconnected for a moment', () => {
    const request = { target: 'server' as const, at: 0 }
    const { banners } = run(
      [
        [100, serverDown(present)],
        [100 + SHOW_DELAY_MS, serverDown(present)],
        [3000, linked(present)],
        [3000 + DONE_SHOW_MS - 1, linked(present)],
        [3000 + DONE_SHOW_MS, linked(present)],
      ],
      ['a', 'b'],
      request,
    )
    expect(banners).toEqual([null, 'Restarting server…', 'Reconnected', 'Reconnected', null])
  })

  it('says Reconnecting … when not started from this screen (tray menu, crash)', () => {
    expect(run([[0, serverDown(present)], [SHOW_DELAY_MS, serverDown(present)]], ['a']).banners[1]).toBe('Reconnecting to server…')
    expect(run([[0, hostDown(onBreak)], [SHOW_DELAY_MS, hostDown(onBreak)]], ['a']).banners[1]).toBe('Reconnecting to host…')
    // ↻ 가 오래전이면 그 재시작으로 보지 않는다
    const old = { target: 'host' as const, at: 0 }
    expect(run([[20_000, hostDown(onBreak)], [20_000 + SHOW_DELAY_MS, hostDown(onBreak)]], ['a'], old).banners[1]).toBe('Reconnecting to host…')
  })

  it('counts web sessions coming back after a host restart, then Reconnected', () => {
    const request = { target: 'host' as const, at: 0 }
    const { banners } = run(
      [
        [0, hostDown(onBreak)],
        [SHOW_DELAY_MS, hostDown(onBreak)],
        [2000, linked(onBreak)],
        [2500, linked([web('a', 'present'), web('b', 'break')])],
        [3000, linked(present)],
      ],
      ['a', 'b'],
      request,
    )
    expect(banners).toEqual([null, 'Restarting host…', 'Resuming sessions 0/2', 'Resuming sessions 1/2', 'Reconnected'])
  })

  it('does not wait for a session that left the list', () => {
    const { banners } = run([[0, hostDown(onBreak)], [SHOW_DELAY_MS, hostDown(onBreak)], [2000, linked([web('a', 'present')])]], ['a', 'b'])
    expect(banners[2]).toBe('Reconnected')
  })

  it('stops waiting after the resume timeout and says how many came back', () => {
    const partly = [web('a', 'present'), web('b', 'break')]
    const { banners, outage } = run(
      [
        [0, hostDown(onBreak)],
        [SHOW_DELAY_MS, hostDown(onBreak)],
        [1000, linked(partly)],
        [1000 + RESUME_TIMEOUT_MS, linked(partly)],
        [1000 + RESUME_TIMEOUT_MS + PARTIAL_SHOW_MS, linked(partly)],
      ],
      ['a', 'b'],
    )
    expect(banners.slice(2)).toEqual(['Resuming sessions 1/2', 'Resumed 1/2 · check the session list', null])
    expect(outage).toBeNull()
  })

  it('starts over when it drops again while showing Reconnected', () => {
    const steps: [number, ConnectionInput][] = [
      [0, serverDown(present)],
      [SHOW_DELAY_MS, serverDown(present)],
      [2000, linked(present)],
      [2500, serverDown(present)],
    ]
    const { outage, banners } = run(steps, ['a', 'b'])
    expect(banners[2]).toBe('Reconnected')
    expect(outage).toMatchObject({ since: 2500, endedAt: null, isShown: false })
  })

  it('returns the same object when nothing changed (React state)', () => {
    const outage = nextOutage(null, serverDown(present), 0, ['a'], null)!
    const shown = nextOutage(outage, serverDown(present), SHOW_DELAY_MS, ['a'], null)!
    expect(nextOutage(shown, serverDown(present), SHOW_DELAY_MS + 250, ['a'], null)).toBe(shown)
  })
})
