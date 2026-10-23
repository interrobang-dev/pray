import { describe, expect, it } from 'vitest'
import { DOZE_AFTER_MS, dotStateOf, dozingKey } from './dotState'
import type { Session } from './types'

const NOW = Date.parse('2026-10-23T10:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

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

describe('dotStateOf', () => {
  it('working 타자, 승인 대기 손 들기 (오래됐어도)', () => {
    expect(dotStateOf(session({ status: 'working', turnEndedAt: ago(DOZE_AFTER_MS * 2) }), NOW)).toBe('typing')
    expect(dotStateOf(session({ status: 'needs-approval', turnEndedAt: ago(DOZE_AFTER_MS * 2) }), NOW)).toBe('raise-hand')
  })

  it('ended 는 늘 졸기', () => {
    expect(dotStateOf(session({ status: 'ended', turnEndedAt: ago(0) }), NOW)).toBe('doze')
    expect(dotStateOf(session({ status: 'ended' }), NOW)).toBe('doze')
  })

  it('my-turn·idle·unknown 은 차례가 끝난 지 30분부터 졸기', () => {
    for (const status of ['my-turn', 'idle', 'unknown'] as const) {
      expect(dotStateOf(session({ status, turnEndedAt: ago(DOZE_AFTER_MS - 1) }), NOW)).toBe('idle')
      expect(dotStateOf(session({ status, turnEndedAt: ago(DOZE_AFTER_MS) }), NOW)).toBe('doze')
    }
  })

  it('차례 끝난 시각을 모르면(없음·옛 서버·해석 불가) 앉아 있기', () => {
    expect(dotStateOf(session({ status: 'idle' }), NOW)).toBe('idle')
    expect(dotStateOf(session({ status: 'unknown', turnEndedAt: undefined }), NOW)).toBe('idle')
    expect(dotStateOf(session({ status: 'my-turn', turnEndedAt: 'nope' }), NOW)).toBe('idle')
  })
})

describe('dozingKey', () => {
  it('조는 근무 세션 ID 만 정렬해 잇는다', () => {
    const old = ago(DOZE_AFTER_MS)
    const sessions = [
      session({ id: 'b', turnEndedAt: old }),
      session({ id: 'a', status: 'ended' }),
      session({ id: 'c', turnEndedAt: ago(0) }),
      session({ id: 'd', attendance: 'break', turnEndedAt: old }),
      session({ id: 'e', attendance: 'off', isAlive: false, status: 'ended' }),
    ]
    expect(dozingKey(sessions, NOW)).toBe('a,b')
    expect(dozingKey(sessions, NOW + DOZE_AFTER_MS)).toBe('a,b,c')
  })
})
