import * as pty from 'node-pty'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addWebSession } from './hq.js'
import { PtyPool, type SpawnOptions } from './ptyPool.js'

// 실제 claude 를 띄우지 않고 넘어간 인자만 본다
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({ pid: 1, onData: vi.fn(), onExit: vi.fn() })),
}))

// spawn 이 hq.json 에 기록한다(addWebSession). 실제 ~/.claude/jk-corp/hq.json 대신 가짜로 바꾼다
vi.mock('./hq.js', () => ({ addWebSession: vi.fn(), removeWebSession: vi.fn() }))

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
