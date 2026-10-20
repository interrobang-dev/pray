import { EventEmitter } from 'node:events'
import * as pty from 'node-pty'
import { RingBuffer } from './ringBuffer.js'
import type { HostSession } from './protocol.js'
import { addWebSession, removeWebSession } from './hq.js'
import { getArg } from './runtime.js'

const RING_LIMIT = 200_000
/** 작업 스케줄러 환경에는 사용자 PATH 가 없을 수 있어 설치 스크립트가 `--claude=<exe>` 로 넘긴다 */
const CLAUDE_COMMAND = getArg('claude') ?? process.env.JK_CORP_CLAUDE ?? 'claude.exe'

/**
 * 호스트가 Claude 세션 안에서 실행됐을 때 상속되는 변수.
 * CLAUDE* 를 남겨두면 자식 claude 가 중첩 실행으로 판단해 종료하고, NO_COLOR 를 남겨두면 색 없이 렌더링한다.
 */
function childEnv(sessionId: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key === 'NO_COLOR') continue
    env[key] = value
  }
  env.JK_CORP_SESSION = sessionId
  return env
}

interface Entry {
  pty: pty.IPty
  ring: RingBuffer
  cwd: string
}

export interface SpawnOptions {
  sessionId: string
  cwd: string
  prompt?: string
  resume?: boolean
  /** claude 에 추가로 넘길 인자 (--name, --permission-mode, --mcp-config 등) */
  extraArgs?: string[]
}

/** 이벤트: output(sessionId, data), exit(sessionId, exitCode), change() */
export class PtyPool extends EventEmitter {
  private entries = new Map<string, Entry>()

  list(): HostSession[] {
    return [...this.entries].map(([sessionId, entry]) => ({ sessionId, cwd: entry.cwd, pid: entry.pty.pid }))
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  spawn({ sessionId, cwd, prompt, resume, extraArgs = [] }: SpawnOptions): void {
    if (this.entries.has(sessionId)) throw new Error(`이미 실행 중: ${sessionId}`)
    const args = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
    args.push(...extraArgs)
    if (prompt) args.push(prompt)

    const child = pty.spawn(CLAUDE_COMMAND, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: childEnv(sessionId),
    })
    const ring = new RingBuffer(RING_LIMIT)
    this.entries.set(sessionId, { pty: child, ring, cwd })
    if (!resume) addWebSession({ sessionId, cwd, createdAt: new Date().toISOString(), extraArgs: extraArgs.length ? extraArgs : undefined })

    child.onData((data) => {
      ring.push(data)
      this.emit('output', sessionId, data)
    })
    child.onExit(({ exitCode }) => {
      this.entries.delete(sessionId)
      removeWebSession(sessionId)
      this.emit('exit', sessionId, exitCode)
      this.emit('change')
    })
    this.emit('change')
  }

  snapshot(sessionId: string): string | null {
    return this.entries.get(sessionId)?.ring.toString() ?? null
  }

  write(sessionId: string, data: string): void {
    this.entries.get(sessionId)?.pty.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    this.entries.get(sessionId)?.pty.resize(cols, rows)
  }

  kill(sessionId: string): void {
    this.entries.get(sessionId)?.pty.kill()
    removeWebSession(sessionId)
  }
}
