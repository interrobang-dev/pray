import { describe, expect, it } from 'vitest'
import { LOUNGE_AFTER_MS } from './dotState'
import { officeSceneKey } from './officeScene'
import type { Office, Session } from './types'

const NOW = Date.parse('2026-11-09T10:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const session = (patch: Partial<Session> = {}): Session => ({
  id: 's1',
  cwd: 'D:/work',
  name: 'Kim',
  title: null,
  status: 'working',
  kind: 'web',
  isAlive: true,
  attendance: 'present',
  lastAt: ago(1000),
  turnEndedAt: ago(1000),
  lastAssistantText: null,
  pendingTool: null,
  workingSince: null,
  role: 'member',
  teamId: 't1',
  partId: null,
  ...patch,
})

const office = (patch: Partial<Office['teams'][number]> = {}): Office => ({
  groups: [{ id: 'g1', name: 'Dev', x: 0, y: 0, w: 7, h: 7 }],
  teams: [{ id: 't1', name: 'Pray', cwd: 'D:/work', groupId: 'g1', x: 1, y: 1, desks: {}, parts: [], partOf: {}, createdAt: ago(0), ...patch }],
})

const keyOf = (sessions: Session[], selectedId: string | null = null, data = office()) => officeSceneKey(data, sessions, selectedId, NOW)

describe('officeSceneKey', () => {
  it('내용이 같으면 새 객체여도 같다', () => {
    expect(keyOf([session()])).toBe(keyOf([session()]))
  })

  it('그리기에 안 쓰는 값만 바뀌면 같다', () => {
    const base = keyOf([session()])
    expect(
      keyOf([
        session({
          lastAt: ago(0),
          turnEndedAt: ago(0),
          lastAssistantText: 'done',
          pendingTool: 'Bash',
          workingSince: ago(5000),
          model: 'claude-opus-5-5',
          effort: 'high',
          contextTokens: 143_000,
          turnUsage: { inputTokens: 1, cacheCreationTokens: 2, cacheReadTokens: 3 },
          shells: [{ id: 'b1', command: 'npm run dev', description: null, startedAt: ago(0) }],
          suggestion: 'next',
          cwd: 'D:/work/sub',
          createdAt: ago(9000),
        }),
      ]),
    ).toBe(base)
  })

  it('그리는 값이 바뀌면 다르다', () => {
    const base = keyOf([session()])
    const changed: Partial<Session>[] = [
      { status: 'my-turn' },
      { attendance: 'break' },
      { name: 'Lee' },
      { position: 'FE', name: '[BE] Kim' },
      { role: 'lead' },
      { partId: 'p1' },
      { teamId: null },
      { kind: 'external' },
      { character: { id: 'c1', hair: null, top: null } },
      { gender: 'female' },
    ]
    for (const patch of changed) expect(keyOf([session(patch)])).not.toBe(base)
    expect(keyOf([session({ character: { id: 'c1', hair: '#111111', top: null } })])).not.toBe(keyOf([session({ character: { id: 'c1', hair: null, top: null } })]))
  })

  it('세션 추가·순서·선택이 바뀌면 다르다', () => {
    const a = session({ id: 'a' })
    const b = session({ id: 'b' })
    expect(keyOf([a])).not.toBe(keyOf([a, b]))
    expect(keyOf([a, b])).not.toBe(keyOf([b, a]))
    expect(keyOf([a, b], 'a')).not.toBe(keyOf([a, b], 'b'))
    expect(keyOf([a, b], null)).not.toBe(keyOf([a, b], 'a'))
  })

  it('office 의 그리는 값(팀 이름·위치·TODO·파트)이 바뀌면 다르다', () => {
    const sessions = [session()]
    const base = keyOf(sessions)
    expect(keyOf(sessions, null, office({ name: 'Other' }))).not.toBe(base)
    expect(keyOf(sessions, null, office({ x: 3 }))).not.toBe(base)
    expect(keyOf(sessions, null, office({ todos: [{ id: 'd1', text: 'a', isDone: false, createdAt: ago(0), doneAt: null }] }))).not.toBe(base)
    expect(keyOf(sessions, null, office({ parts: [{ id: 'p1', name: 'UI', createdAt: ago(0) }] }))).not.toBe(base)
  })

  it('차례가 끝난 시각은 라운지에 간 세션만 본다 (라운지 앉는 순서)', () => {
    const ended = (elapsed: number) => keyOf([session({ status: 'my-turn', turnEndedAt: ago(elapsed) })])
    expect(ended(1000)).toBe(ended(2000))
    expect(ended(LOUNGE_AFTER_MS + 1000)).not.toBe(ended(LOUNGE_AFTER_MS + 2000))
  })

  it('퇴근 세션은 퇴근 시각(없으면 lastAt)을 보고, 근무 세션의 lastAt 은 안 본다', () => {
    const off = (patch: Partial<Session>) =>
      keyOf([session({ attendance: 'off', isAlive: false, offDuty: { reason: 'exit', endedAt: ago(1000), exitCode: 0 }, ...patch })])
    expect(off({ lastAt: ago(0) })).toBe(off({ lastAt: ago(5000) }))
    expect(off({ offDuty: { reason: 'exit', endedAt: ago(2000), exitCode: 0 } })).not.toBe(off({}))
    expect(off({ offDuty: null, lastAt: ago(0) })).not.toBe(off({ offDuty: null, lastAt: ago(5000) }))
  })
})
