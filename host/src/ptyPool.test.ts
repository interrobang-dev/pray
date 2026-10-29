import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import * as pty from 'node-pty'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addWebSession, discardWebSession, moveToOffDuty, pruneOffDuty, setWebSessionArgs } from './hq.js'
import { offDutyReason, PtyPool, type SpawnOptions } from './ptyPool.js'

// 실제 claude 를 띄우지 않고 넘어간 인자만 본다
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() })),
}))

// spawn·exit 가 hq.json 에 기록한다. 실제 ~/.claude/pray/hq.json 대신 가짜로 바꾼다
vi.mock('./hq.js', () => ({
  addWebSession: vi.fn(),
  discardWebSession: vi.fn(),
  moveToOffDuty: vi.fn(),
  pruneOffDuty: vi.fn(() => []),
  setWebSessionArgs: vi.fn(() => true),
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
    expect(offDutyReason({ killReason: 'dismissed', exitCode: 1, hasTranscript: false })).toBeNull()
    expect(offDutyReason({ killReason: 'released', exitCode: 1, hasTranscript: false })).toBeNull()
    expect(offDutyReason({ killReason: null, exitCode: 0, hasTranscript: false })).toBeNull()
  })

  it('uses the kill reason whatever the exit code (kill exits with 1)', () => {
    expect(offDutyReason({ killReason: 'dismissed', exitCode: 1, hasTranscript: true })).toBe('dismissed')
    expect(offDutyReason({ killReason: 'dismissed', exitCode: null, hasTranscript: true })).toBe('dismissed')
    expect(offDutyReason({ killReason: 'released', exitCode: 1, hasTranscript: true })).toBe('released')
    expect(offDutyReason({ killReason: 'released', exitCode: 0, hasTranscript: true })).toBe('released')
  })

  it('tells a clean exit (0) from an error', () => {
    expect(offDutyReason({ killReason: null, exitCode: 0, hasTranscript: true })).toBe('exit')
    expect(offDutyReason({ killReason: null, exitCode: 1, hasTranscript: true })).toBe('error')
    expect(offDutyReason({ killReason: null, exitCode: null, hasTranscript: true })).toBe('error')
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

  it('records a kill by the lead as released', () => {
    const pool = new PtyPool(() => true)
    pool.spawn({ sessionId: SESSION_ID, cwd: 'D:/repo' })
    pool.kill(SESSION_ID, 'released')
    exitLast(1)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'released', exitCode: 1 }))
  })

  it('moves a record without a process straight to dismissed off duty on kill', () => {
    new PtyPool(() => true).kill(SESSION_ID)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'dismissed', exitCode: null }))
  })

  it('moves a record without a process straight to released off duty on a kill by the lead', () => {
    new PtyPool(() => true).kill(SESSION_ID, 'released')
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'released', exitCode: null }))
  })
})

describe('PtyPool.restart', () => {
  const NEW_ARGS = ['--name', '개발 팀장', '--model', 'opus', '--effort', 'max']

  beforeEach(() => {
    vi.mocked(pty.spawn).mockClear()
    vi.mocked(moveToOffDuty).mockClear()
    vi.mocked(discardWebSession).mockClear()
    vi.mocked(addWebSession).mockClear()
    vi.mocked(setWebSessionArgs).mockClear()
  })

  type FakePty = { pid: number; cols?: number; rows?: number; onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }

  /** n 번째(0부터)로 띄운 가짜 pty */
  function spawned(index: number): FakePty {
    return vi.mocked(pty.spawn).mock.results[index].value as FakePty
  }

  function exit(fake: FakePty, exitCode: number): void {
    fake.onExit.mock.calls[0][0]({ exitCode })
  }

  function startPool(): PtyPool {
    vi.mocked(pty.spawn).mockReturnValueOnce({ pid: 1, cols: 90, rows: 40, onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() } as unknown as pty.IPty)
    const pool = new PtyPool(() => true)
    pool.spawn({ sessionId: SESSION_ID, cwd: 'D:/repo', extraArgs: EXTRA_ARGS })
    return pool
  }

  it('saves the new args, kills claude and resumes it with them instead of moving it off duty', () => {
    const pool = startPool()
    const events: string[] = []
    pool.on('exit', () => events.push('exit'))
    pool.on('change', () => events.push('change'))
    pool.restart(SESSION_ID, NEW_ARGS)
    expect(setWebSessionArgs).toHaveBeenCalledWith(SESSION_ID, NEW_ARGS)
    expect(spawned(0).kill).toHaveBeenCalledTimes(1)

    exit(spawned(0), 1)
    expect(vi.mocked(pty.spawn).mock.calls[1][1]).toEqual(['--resume', SESSION_ID, ...NEW_ARGS])
    expect(vi.mocked(pty.spawn).mock.calls[1][2]).toMatchObject({ cwd: 'D:/repo', cols: 90, rows: 40 })
    expect(moveToOffDuty).not.toHaveBeenCalled()
    expect(discardWebSession).not.toHaveBeenCalled()
    // resume 은 기록을 새로 만들지 않는다 (처음 spawn 의 한 번뿐)
    expect(addWebSession).toHaveBeenCalledTimes(1)
    expect(pool.has(SESSION_ID)).toBe(true)
    expect(events).toEqual(['change', 'exit', 'change'])
  })

  it('ends the resumed process normally afterwards', () => {
    const pool = startPool()
    pool.restart(SESSION_ID, NEW_ARGS)
    exit(spawned(0), 1)
    exit(spawned(1), 0)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'exit', exitCode: 0 }))
    expect(pool.has(SESSION_ID)).toBe(false)
  })

  it('throws and changes nothing for a session without a process', () => {
    expect(() => new PtyPool(() => true).restart(SESSION_ID, NEW_ARGS)).toThrow('Not running')
    expect(setWebSessionArgs).not.toHaveBeenCalled()
  })

  it('throws and does not kill when there is no web session record', () => {
    const pool = startPool()
    vi.mocked(setWebSessionArgs).mockReturnValueOnce(false)
    expect(() => pool.restart(SESSION_ID, NEW_ARGS)).toThrow('No web session record')
    expect(spawned(0).kill).not.toHaveBeenCalled()
  })

  it('does not kill when hq.json cannot be written', () => {
    const pool = startPool()
    vi.mocked(setWebSessionArgs).mockImplementationOnce(() => {
      throw new Error('hq.json 을 읽을 수 없어 읽기·저장을 막음')
    })
    expect(() => pool.restart(SESSION_ID, NEW_ARGS)).toThrow('hq.json')
    expect(spawned(0).kill).not.toHaveBeenCalled()
  })

  it('lets a kill request win over a restart in progress', () => {
    const pool = startPool()
    pool.restart(SESSION_ID, NEW_ARGS)
    pool.kill(SESSION_ID)
    exit(spawned(0), 1)
    expect(vi.mocked(pty.spawn)).toHaveBeenCalledTimes(1)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'dismissed', exitCode: 1 }))
  })

  it('refuses to restart a session that is being killed', () => {
    const pool = startPool()
    pool.kill(SESSION_ID)
    expect(() => pool.restart(SESSION_ID, NEW_ARGS)).toThrow('Ending')
    expect(setWebSessionArgs).not.toHaveBeenCalled()
  })

  it('takes the latest args when asked again while restarting, killing only once', () => {
    const pool = startPool()
    const latest = ['--name', '개발 팀장', '--model', 'sonnet']
    pool.restart(SESSION_ID, NEW_ARGS)
    pool.restart(SESSION_ID, latest)
    expect(spawned(0).kill).toHaveBeenCalledTimes(1)
    expect(setWebSessionArgs).toHaveBeenLastCalledWith(SESSION_ID, latest)
    exit(spawned(0), 1)
    expect(vi.mocked(pty.spawn).mock.calls[1][1]).toEqual(['--resume', SESSION_ID, ...latest])
  })

  it('moves the session off duty as an error when it cannot be started again', () => {
    const pool = startPool()
    pool.restart(SESSION_ID, NEW_ARGS)
    vi.mocked(pty.spawn).mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })
    exit(spawned(0), 1)
    expect(moveToOffDuty).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ reason: 'error', exitCode: null }))
    expect(pool.has(SESSION_ID)).toBe(false)
  })
})
