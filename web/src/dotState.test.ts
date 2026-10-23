import { describe, expect, it } from 'vitest'
import { LOUNGE_AFTER_MS, LOUNGE_DOZE_AFTER_MS, dotStateOf, loungeLabel, seatPlaceKey, seatPlaceOf, turnEndedAtOf } from './dotState'
import type { Session } from './types'

const NOW = Date.parse('2026-10-23T10:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 60 * 60_000

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's1',
  cwd: 'D:/work',
  name: null,
  title: null,
  status: 'my-turn',
  kind: 'web',
  isAlive: true,
  attendance: 'present',
  lastAt: null,
  turnEndedAt: null,
  lastAssistantText: null,
  pendingTool: null,
  workingSince: null,
  role: null,
  teamId: null,
  partId: null,
  ...patch,
})

describe('seatPlaceOf', () => {
  it('차례가 끝난 지 29:59 책상, 30:00 라운지, 24시간 미만 라운지, 24시간부터 라운지 졸기', () => {
    const at = (elapsed: number) => seatPlaceOf(session({ turnEndedAt: ago(elapsed) }), NOW)
    expect(at(0)).toBe('desk')
    expect(at(LOUNGE_AFTER_MS - 1000)).toBe('desk')
    expect(at(LOUNGE_AFTER_MS)).toBe('lounge')
    expect(at(LOUNGE_DOZE_AFTER_MS - 1)).toBe('lounge')
    expect(at(LOUNGE_DOZE_AFTER_MS)).toBe('lounge-doze')
    expect(at(7 * LOUNGE_DOZE_AFTER_MS)).toBe('lounge-doze')
  })

  it('my-turn·idle·unknown·ended 는 같은 시간 규칙 (ended 도 책상에서 졸지 않는다)', () => {
    for (const status of ['my-turn', 'idle', 'unknown', 'ended'] as const) {
      expect(seatPlaceOf(session({ status, turnEndedAt: ago(LOUNGE_AFTER_MS - 1) }), NOW)).toBe('desk')
      expect(seatPlaceOf(session({ status, turnEndedAt: ago(LOUNGE_AFTER_MS) }), NOW)).toBe('lounge')
      expect(seatPlaceOf(session({ status, turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }), NOW)).toBe('lounge-doze')
    }
  })

  it('작업 중·승인 대기는 오래됐어도 늘 책상', () => {
    for (const status of ['working', 'needs-approval'] as const) {
      expect(seatPlaceOf(session({ status, turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS * 2) }), NOW)).toBe('desk')
    }
  })

  it('휴식·퇴근(옛 응답의 isAlive false 포함)은 라운지에 가지 않는다', () => {
    const old = ago(LOUNGE_DOZE_AFTER_MS * 2)
    expect(seatPlaceOf(session({ attendance: 'break', turnEndedAt: old }), NOW)).toBe('desk')
    expect(seatPlaceOf(session({ attendance: 'off', isAlive: false, turnEndedAt: old }), NOW)).toBe('desk')
    expect(seatPlaceOf(session({ attendance: undefined, isAlive: false, turnEndedAt: old }), NOW)).toBe('desk')
    expect(seatPlaceOf(session({ attendance: undefined, isAlive: true, turnEndedAt: old }), NOW)).toBe('lounge-doze')
  })

  it('차례 끝난 시각을 모르면(없음·옛 서버·해석 불가) 책상', () => {
    expect(seatPlaceOf(session({ turnEndedAt: null }), NOW)).toBe('desk')
    expect(seatPlaceOf(session({ turnEndedAt: undefined }), NOW)).toBe('desk')
    expect(seatPlaceOf(session({ turnEndedAt: 'nope' }), NOW)).toBe('desk')
    expect(turnEndedAtOf(session({ turnEndedAt: 'nope' }))).toBeNull()
    expect(turnEndedAtOf(session({ turnEndedAt: ago(5) }))).toBe(NOW - 5)
  })

  it('외부 세션·지시자도 같은 규칙', () => {
    expect(seatPlaceOf(session({ kind: 'external', status: 'unknown', turnEndedAt: ago(LOUNGE_AFTER_MS) }), NOW)).toBe('lounge')
    expect(seatPlaceOf(session({ role: 'lead', partId: 'p1', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }), NOW)).toBe('lounge-doze')
  })
})

describe('dotStateOf', () => {
  it('working 타자, 승인 대기 손 들기 (오래됐어도)', () => {
    expect(dotStateOf(session({ status: 'working', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS * 2) }), NOW)).toBe('typing')
    expect(dotStateOf(session({ status: 'needs-approval', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS * 2) }), NOW)).toBe('raise-hand')
  })

  it('책상·라운지에 깨어 있으면 idle, 라운지 졸기만 doze (ended 도 마찬가지)', () => {
    for (const status of ['my-turn', 'idle', 'unknown', 'ended'] as const) {
      expect(dotStateOf(session({ status }), NOW)).toBe('idle')
      expect(dotStateOf(session({ status, turnEndedAt: ago(LOUNGE_AFTER_MS) }), NOW)).toBe('idle')
      expect(dotStateOf(session({ status, turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS - 1) }), NOW)).toBe('idle')
      expect(dotStateOf(session({ status, turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }), NOW)).toBe('doze')
    }
  })
})

describe('seatPlaceKey', () => {
  it('근무 세션마다 있는 곳을 ID 순으로 잇고, 누가 경계를 넘을 때만 바뀐다', () => {
    const sessions = [
      session({ id: 'b', turnEndedAt: ago(LOUNGE_AFTER_MS) }),
      session({ id: 'a', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }),
      session({ id: 'c', turnEndedAt: ago(0) }),
      session({ id: 'd', attendance: 'break', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }),
      session({ id: 'e', attendance: 'off', isAlive: false, status: 'ended' }),
      session({ id: 'f', status: 'working', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }),
    ]
    expect(seatPlaceKey(sessions, NOW)).toBe('a:lounge-doze,b:lounge,c:desk,f:desk')
    expect(seatPlaceKey(sessions, NOW + LOUNGE_AFTER_MS - 1000)).toBe(seatPlaceKey(sessions, NOW))
    expect(seatPlaceKey(sessions, NOW + LOUNGE_AFTER_MS)).toBe('a:lounge-doze,b:lounge,c:lounge,f:desk')
  })
})

describe('loungeLabel', () => {
  it('라운지 줄: 쉬는 중·조는 중 · 마지막 대화 시각 (목록 퇴근 시각과 같은 표기)', () => {
    expect(loungeLabel(session({ turnEndedAt: ago(LOUNGE_AFTER_MS) }), NOW)).toBe('라운지에서 쉬는 중 · 마지막 대화 30분 전')
    expect(loungeLabel(session({ turnEndedAt: ago(3 * HOUR + 59 * 60_000) }), NOW)).toBe('라운지에서 쉬는 중 · 마지막 대화 3시간 전')
    expect(loungeLabel(session({ turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }), NOW)).toBe('라운지에서 조는 중 · 마지막 대화 1일 전')
    expect(loungeLabel(session({ turnEndedAt: ago(2 * LOUNGE_DOZE_AFTER_MS + HOUR) }), NOW)).toBe('라운지에서 조는 중 · 마지막 대화 2일 전')
  })

  it('책상이면 없다', () => {
    expect(loungeLabel(session({ turnEndedAt: ago(LOUNGE_AFTER_MS - 1) }), NOW)).toBeNull()
    expect(loungeLabel(session({ status: 'working', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }), NOW)).toBeNull()
    expect(loungeLabel(session({ attendance: 'break', turnEndedAt: ago(LOUNGE_DOZE_AFTER_MS) }), NOW)).toBeNull()
  })
})
