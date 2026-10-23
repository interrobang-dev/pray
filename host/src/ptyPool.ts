import { EventEmitter } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as pty from 'node-pty'
import { RingBuffer } from './ringBuffer.js'
import type { HostSession } from './protocol.js'
import { addWebSession, discardWebSession, moveToOffDuty, pruneOffDuty, type OffDutyReason } from './hq.js'
import { getArg } from './runtime.js'

const RING_LIMIT = 200_000
/** 작업 스케줄러 환경에는 사용자 PATH 가 없을 수 있어 설치 스크립트가 `--claude=<exe>` 로 넘긴다 */
const CLAUDE_COMMAND = getArg('claude') ?? process.env.JK_CORP_CLAUDE ?? 'claude.exe'
/** 웹 세션에만 불러오는 저장소의 mod (입력칸 제안을 서버로 보낸다). 절대 경로 */
const MOD_DIR = join(import.meta.dirname, '..', '..', 'mod')

/**
 * 호스트가 Claude 세션 안에서 실행됐을 때 상속되는 변수.
 * CLAUDE* 를 남겨두면 자식 claude 가 중첩 실행으로 판단해 종료하고, NO_COLOR 를 남겨두면 색 없이 렌더링한다.
 * mod 폴더(CLAUDE_CODE_PLUGIN_DIRS)는 CLAUDE* 를 지운 뒤에 넣는다
 */
function childEnv(sessionId: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key === 'NO_COLOR') continue
    env[key] = value
  }
  env.JK_CORP_SESSION = sessionId
  env.CLAUDE_CODE_PLUGIN_DIRS = MOD_DIR
  return env
}

const projectsDir = join(homedir(), '.claude', 'projects')

/** `~/.claude/projects/<프로젝트>/<id>.jsonl` 이 있는지. 대화가 한 번도 없던 세션은 없고 resume 할 수 없다 */
function transcriptExists(sessionId: string): boolean {
  try {
    return readdirSync(projectsDir).some((name) => existsSync(join(projectsDir, name, `${sessionId}.jsonl`)))
  } catch {
    return false
  }
}

/** kill 요청의 퇴근 이유. released = 팀장이 정리한 팀원(jk_dismiss), dismissed = 그 밖(화면 종료 버튼) */
export type KillReason = 'dismissed' | 'released'

/**
 * 끝난 웹 세션의 퇴근 이유. null 이면 다시 출근(resume)할 수 없어 기록 없이 지운다.
 * kill 은 종료 코드 1 로 끝나서(실측) 코드가 아니라 kill 요청 여부로 정리됨을 가린다. /exit 는 0
 */
export function offDutyReason(end: { killReason: KillReason | null; exitCode: number | null; hasTranscript: boolean }): OffDutyReason | null {
  if (!end.hasTranscript) return null
  if (end.killReason) return end.killReason
  return end.exitCode === 0 ? 'exit' : 'error'
}

/** hq.json 이 깨져 있으면 hq 함수가 던진다. 호스트가 죽으면 웹 세션이 전부 끊기므로 로그만 남기고 넘어간다 (기록은 그대로) */
function updateHq(what: string, update: () => void): void {
  try {
    update()
  } catch (error) {
    console.error(`hq.json 기록 실패 (${what})`, error)
  }
}

interface Entry {
  pty: pty.IPty
  ring: RingBuffer
  cwd: string
  /** kill 요청으로 끝나는 중이면 그 퇴근 이유 */
  killReason: KillReason | null
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
  private readonly hasTranscript: (sessionId: string) => boolean

  constructor(hasTranscript = transcriptExists) {
    super()
    this.hasTranscript = hasTranscript
  }

  list(): HostSession[] {
    return [...this.entries].map(([sessionId, entry]) => ({ sessionId, cwd: entry.cwd, pid: entry.pty.pid }))
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  spawn({ sessionId, cwd, prompt, resume, extraArgs = [] }: SpawnOptions): void {
    if (this.entries.has(sessionId)) throw new Error(`이미 실행 중: ${sessionId}`)
    const args = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
    // --mcp-config 는 값을 여러 개 받아서 첫 지시를 뒤에 두면 설정 파일 이름으로 읽고 claude 가 종료된다
    if (prompt) args.push(prompt)
    args.push(...extraArgs)

    const child = pty.spawn(CLAUDE_COMMAND, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: childEnv(sessionId),
    })
    const ring = new RingBuffer(RING_LIMIT)
    const entry: Entry = { pty: child, ring, cwd, killReason: null }
    this.entries.set(sessionId, entry)
    if (!resume) {
      const record = { sessionId, cwd, createdAt: new Date().toISOString(), extraArgs: extraArgs.length ? extraArgs : undefined }
      updateHq(`추가 ${sessionId}`, () => addWebSession(record))
    }

    child.onData((data) => {
      ring.push(data)
      this.emit('output', sessionId, data)
    })
    child.onExit(({ exitCode }) => {
      this.entries.delete(sessionId)
      // 호스트 자체가 죽을 때는 여기가 돌지 않아 기록이 webSessions 에 남는다 (휴식 → 다음 호스트가 resume)
      const hasTranscript = this.hasTranscript(sessionId)
      this.recordEnd(sessionId, offDutyReason({ killReason: entry.killReason, exitCode, hasTranscript }), exitCode)
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
    try {
      this.entries.get(sessionId)?.pty.resize(cols, rows)
    } catch {
      // claude 가 끝난 뒤 onExit 전에 오면 node-pty 가 던진다. 꺼진 세션 하나로 호스트가 죽으면 웹 세션이 전부 끊긴다
    }
  }

  /** 기록은 onExit 가 reason 퇴근으로 옮긴다. 프로세스 없이 기록만 남은 세션(휴식)은 바로 옮긴다 */
  kill(sessionId: string, reason: KillReason = 'dismissed'): void {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      const hasTranscript = this.hasTranscript(sessionId)
      this.recordEnd(sessionId, offDutyReason({ killReason: reason, exitCode: null, hasTranscript }), null)
      return
    }
    entry.killReason = reason
    entry.pty.kill()
  }

  /** 끝난 웹 세션을 퇴근 기록으로 옮기거나(reason) 기록 없이 지우고(null), 보관 기간이 지난 퇴근 기록을 정리한다 */
  private recordEnd(sessionId: string, reason: OffDutyReason | null, exitCode: number | null): void {
    updateHq(`퇴근 ${sessionId}`, () => {
      if (reason === null) discardWebSession(sessionId)
      else moveToOffDuty(sessionId, { endedAt: new Date().toISOString(), reason, exitCode })
    })
    updateHq('퇴근 기록 정리', () => {
      const expired = pruneOffDuty()
      if (expired.length) console.log(`퇴근 기록 보관 기간 지남, 지움: ${expired.join(', ')}`)
    })
  }
}
