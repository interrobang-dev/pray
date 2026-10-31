import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HookState } from './hookState.js'
import type { Session } from './types.js'

// listSessions 는 홈 폴더(~/.claude/sessions·projects)를 모듈을 읽을 때 정하므로 임시 홈을 먼저 두고 불러온다
let home: string
let listSessions: typeof import('./sessions.js').listSessions

const DEAD_PID = 0x7ffffff0
const record = (sessionId: string, cwd = 'd:/repo') => ({ sessionId, cwd, createdAt: '2026-10-31T00:00:00.000Z' })

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'pray-sessions-list-'))
  const sessionsDir = join(home, '.claude', 'sessions')
  mkdirSync(sessionsDir, { recursive: true })
  mkdirSync(join(home, '.claude', 'projects', 'd--repo'), { recursive: true })
  const pidRecord = (file: string, sessionId: string, pid: number) =>
    writeFileSync(join(sessionsDir, file), JSON.stringify({ sessionId, pid, cwd: 'd:/repo' }))
  pidRecord('1.json', 'external-live', process.pid)
  pidRecord('2.json', 'external-ended', DEAD_PID)
  pidRecord('3.json', 'off-resumed-in-terminal', process.pid)
  // 끝난 외부 세션은 jsonl 이 남아 있어도 목록에 없다
  writeFileSync(join(home, '.claude', 'projects', 'd--repo', 'external-ended.jsonl'), '')
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('HOME', home)
  vi.resetModules()
  ;({ listSessions } = await import('./sessions.js'))
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

describe('listSessions attendance', () => {
  it('sorts sessions into on duty, break and off duty, and leaves out ended external and hook-only sessions', async () => {
    const hooks = new Map<string, HookState>([['hook-only', { status: 'my-turn' } as HookState]])
    const hostList = new Map([['web-present', 'd:/repo']])
    const recorded = [record('web-present'), record('web-break')]
    const offDuty = [
      { ...record('web-off'), endedAt: '2026-10-31T01:00:00.000Z', reason: 'released' as const, exitCode: null },
      { ...record('off-resumed-in-terminal'), endedAt: '2026-10-31T01:00:00.000Z', reason: 'exit' as const, exitCode: 0 },
    ]
    const sessions = await listSessions(hooks, hostList, [], {}, new Map(), new Map(), recorded, offDuty)
    const byId = Object.fromEntries(sessions.map((s) => [s.id, s])) as Record<string, Session>
    expect(Object.keys(byId).sort()).toEqual(['external-live', 'off-resumed-in-terminal', 'web-break', 'web-off', 'web-present'])
    const view = (id: string) => {
      const { attendance, kind, isAlive, offDuty: off } = byId[id]
      return { attendance, kind, isAlive, reason: off?.reason ?? null }
    }
    expect(view('web-present')).toEqual({ attendance: 'present', kind: 'web', isAlive: true, reason: null })
    expect(view('web-break')).toEqual({ attendance: 'break', kind: 'web', isAlive: false, reason: null })
    expect(view('web-off')).toEqual({ attendance: 'off', kind: 'web', isAlive: false, reason: 'released' })
    expect(view('external-live')).toEqual({ attendance: 'present', kind: 'external', isAlive: true, reason: null })
    // 터미널에서 직접 resume 한 퇴근 세션은 근무 중인 외부 세션
    expect(view('off-resumed-in-terminal')).toEqual({ attendance: 'present', kind: 'external', isAlive: true, reason: null })
  })
})
