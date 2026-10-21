import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import * as pty from 'node-pty'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addWebSession, discardWebSession, moveToOffDuty, pruneOffDuty } from './hq.js'
import { offDutyReason, PtyPool, type SpawnOptions } from './ptyPool.js'

// 실제 claude 를 띄우지 않고 넘어간 인자만 본다
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() })),
}))

// spawn·exit 가 hq.json 에 기록한다. 실제 ~/.claude/jk-corp/hq.json 대신 가짜로 바꾼다
vi.mock('./hq.js', () => ({
  addWebSession: vi.fn(),
  discardWebSession: vi.fn(),
  moveToOffDuty: vi.fn(),
  pruneOffDuty: vi.fn(() => []),
}))

// 모킹이 안 먹었으면 실제 기록을 건드리게 되므로 시작하지 않는다
if (!vi.isMockFunction(addWebSession)) throw new Error('hq.js 가 모킹되지 않음')

const SESSION_ID = '00000000-0000-0000-0000-000000000001'
const PROMPT = '첫 지시'
const EXTRA_ARGS = [
  '--name',
  '개발 팀장',
  '--permission-mode',
  'bypassPermissions',
  '--append-system-prompt',
  '지침',
  '--mcp-config',
  '{"mcpServers":{}}',
]

function spawnedArgs(options: Omit<SpawnOptions, 'sessionId' | 'cwd'>): string[] | string {
  new PtyPool().spawn({ sessionId: SESSION_ID, cwd: 'D:/repo', ...options })
  return vi.mocked(pty.spawn).mock.lastCall![1]
}

describe('PtyPool.spawn args', () => {
  beforeEach(() => vi.mocked(pty.spawn).mockClear())

  it('puts the first instruction before extraArgs so --mcp-config does not read it as a config file', () => {
    const args = spawnedArgs({ prompt: PROMPT, extraArgs: EXTRA_ARGS })
    expect(args.indexOf(PROMPT)).toBeLessThan(args.indexOf('--mcp-config'))
    expect(args).toEqual(['--session-id', SESSION_ID, PROMPT, ...EXTRA_ARGS])
  })

  it('passes extraArgs as is without a prompt', () => {
    expect(spawnedArgs({ extraArgs: EXTRA_ARGS })).toEqual(['--session-id', SESSION_ID, ...EXTRA_ARGS])
  })

  it('passes extraArgs as is on resume', () => {
    expect(spawnedArgs({ resume: true, extraArgs: EXTRA_ARGS })).toEqual(['--resume', SESSION_ID, ...EXTRA_ARGS])
  })
})

describe('PtyPool child env', () => {
  it('loads the repo mod/ through CLAUDE_CODE_PLUGIN_DIRS, set after dropping inherited CLAUDE* variables', () => {
    vi.stubEnv('CLAUDE_CODE_PLUGIN_DIRS', 'D:/elsewhere')
    vi.stubEnv('CLAUDECODE', '1')
    try {
      new PtyPool().spawn({ sessionId: SESSION_ID, cwd: 'D:/repo' })
      const env = vi.mocked(pty.spawn).mock.lastCall![2].env as Record<string, string>
      const modDir = resolve(import.meta.dirname, '..', '..', 'mod')
      expect(env.CLAUDE_CODE_PLUGIN_DIRS).toBe(modDir)
      expect(isAbsolute(env.CLAUDE_CODE_PLUGIN_DIRS)).toBe(true)
      expect(existsSync(join(modDir, '.claude-plugin', 'plugin.json'))).toBe(true)
      expect(env.CLAUDECODE).toBeUndefined()
      expect(env.JK_CORP_SESSION).toBe(SESSION_ID)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('PtyPool.resize', () => {
  it('does not throw when the pty has already exited', () => {
    const exitedPty = {
      pid: 1,
      onData: vi.fn(),
      onExit: vi.fn(),
      resize: vi.fn(() => {
        throw new Error('Cannot resize a pty that has already exited')
      }),
    }
    vi.mocked(pty.spawn).mockReturnValueOnce(exitedPty as unknown as pty.IPty)
    const pool = new PtyPool()
    pool.spawn({ sessionId: SESSION_ID, cwd: 'D:/repo' })
    expect(() => pool.resize(SESSION_ID, 80, 24)).not.toThrow()
    expect(exitedPty.resize).toHaveBeenCalledWith(80, 24)
  })
})

describe('offDutyReason', () => {
  it('drops a session without a transcript since it cannot be resumed', () => {
    expect(offDutyReason({ isDismissed: true, exitCode: 1, hasTranscript: false })).toBeNull()
    expect(offDutyReason({ isDismissed: false, exitCode: 0, hasTranscript: false })).toBeNull()
  })

  it('marks a kill request as dismissed whatever the exit code (kill exits with 1)', () => {
    expect(offDutyReason({ isDismissed: true, exitCode: 1, hasTranscript: true })).toBe('dismissed')
    expect(offDutyReason({ isDismissed: true, exitCode: null, hasTranscript: true })).toBe('dismissed')
  })

  it('tells a clean exit (0) from an error', () => {
    expect(offDutyReason({ isDismissed: false, exitCode: 0, hasTranscript: true })).toBe('exit')
    expect(offDutyReason({ isDismissed: false, exitCode: 1, hasTranscript: true })).toBe('error')
    expect(offDutyReason({ isDismissed: false, exitCode: null, hasTranscript: true })).toBe('error')
  })
})

describe('PtyPool exit records', () => {
  beforeEach(() => {
    vi.mocked(pty.spawn).mockClear()
    vi.mocked(moveToOffDuty).mockClear()
    vi.mocked(discardWebSession).mockClear()
    vi.mocked(pruneOffDuty).mockClear()
  })

  /** 마지막으로 띄운 가짜 pty 의 onExit 처리기를 부른다 */
  function exitLast(exitCode: number): void {
    const fake = vi.mocked(pty.spawn).mock.results.at(-1)!.value as { onExit: ReturnType<typeof vi.fn> }
    fake.onExit.mock.calls[0][0]({ exitCode })
  }

  it('moves the record to off duty with the reason and exit code, then prunes expired ones', () => {
    const pool = new PtyPool(() => true)
    pool.spawn({ sessionId: SESSION_ID, cwd: 'D:/repo' })
    exitLast(0)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'exit', exitCode: 0 }))
    expect(pruneOffDuty).toHaveBeenCalled()
    expect(pool.has(SESSION_ID)).toBe(false)
  })

  it('records a kill request as dismissed even though the exit code is 1', () => {
    const pool = new PtyPool(() => true)
    pool.spawn({ sessionId: SESSION_ID, cwd: 'D:/repo' })
    pool.kill(SESSION_ID)
    exitLast(1)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'dismissed', exitCode: 1 }))
  })

  it('discards the record of a session that never talked (no jsonl)', () => {
    const pool = new PtyPool(() => false)
    pool.spawn({ sessionId: SESSION_ID, cwd: 'D:/repo', resume: true })
    exitLast(1)
    expect(discardWebSession).toHaveBeenCalledWith(SESSION_ID)
    expect(moveToOffDuty).not.toHaveBeenCalled()
  })

  it('moves a record without a process straight to dismissed off duty on kill', () => {
    new PtyPool(() => true).kill(SESSION_ID)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'dismissed', exitCode: null }))
  })
})
