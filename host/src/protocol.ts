export const PIPE_PATH = '\\\\.\\pipe\\jk-corp-host'

export interface HostSession {
  sessionId: string
  cwd: string
  pid: number
}

export type ClientMessage =
  | { type: 'list' }
  | { type: 'spawn'; sessionId: string; cwd: string; prompt?: string; resume?: boolean; extraArgs?: string[] }
  | { type: 'attach'; sessionId: string }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  /** isReleased = 팀장이 정리한 팀원 (jk_dismiss). 퇴근 이유가 dismissed 대신 released 가 된다 */
  | { type: 'kill'; sessionId: string; isReleased?: boolean }
  /** 퇴근 기록의 cwd·extraArgs 그대로 --resume 하고 기록을 webSessions 로 되돌린다 (다시 출근) */
  | { type: 'resume'; sessionId: string }
  /** 퇴근 기록과 그 세션 이름을 지운다 */
  | { type: 'forget'; sessionId: string }
  /** 호스트 스스로 종료 (0 이 아닌 코드). 트레이 앱이 3초 뒤 새 코드로 다시 띄운다 */
  | { type: 'restart' }

export type HostMessage =
  | { type: 'sessions'; sessions: HostSession[] }
  | { type: 'snapshot'; sessionId: string; data: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'exit'; sessionId: string; exitCode: number }
  | { type: 'error'; sessionId?: string; message: string }

export function encode(message: ClientMessage | HostMessage): string {
  return JSON.stringify(message) + '\n'
}

/** 줄 단위 JSON 프레이밍. 불완전한 마지막 줄은 다음 chunk 까지 보관한다. */
export class LineDecoder {
  private rest = ''

  push(chunk: string): unknown[] {
    this.rest += chunk
    const lines = this.rest.split('\n')
    this.rest = lines.pop() ?? ''
    const messages: unknown[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        messages.push(JSON.parse(line))
      } catch {
        continue
      }
    }
    return messages
  }
}
