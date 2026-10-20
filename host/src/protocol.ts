export const PIPE_PATH = '\\\\.\\pipe\\jk-corp-host'

export interface HostSession {
  sessionId: string
  cwd: string
  pid: number
}

export type ClientMessage =
  | { type: 'list' }
  | { type: 'spawn'; sessionId: string; cwd: string; prompt?: string; resume?: boolean }
  | { type: 'attach'; sessionId: string }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'kill'; sessionId: string }

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
