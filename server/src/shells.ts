import { open } from 'node:fs/promises'
import type { Shell } from './types.js'

/** 백그라운드 shell 하나. outputPath 는 Claude Code 가 출력을 쓰는 파일이라 서버 안에서만 쓴다 (Session.shells 에는 없다) */
export interface ShellRecord extends Shell {
  /** tool_result 글의 "Output is being written to: <경로>". 없으면 null */
  outputPath: string | null
  isRunning: boolean
}

/** 백그라운드로 돌 수 있는 shell 도구 (Windows 에서는 PowerShell 도구도 run_in_background 를 받는다) */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
/** 백그라운드 작업을 멈추는 도구 (입력 task_id, 옛 이름은 shell_id). 성공해도 task-notification 이 오지 않는다(실측) */
const STOP_TOOLS = new Set(['TaskStop', 'KillShell'])

interface Block {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as Block[]).map((block) => (block.type === 'text' && block.text ? block.text : '')).join('\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 글 안의 끝난 작업 알림 `<task-notification>` 들의 task-id. 상태(`<status>`)가 없는 것(모니터 이벤트)은 끝이 아니라 뺀다 */
function endedTaskIds(text: string): string[] {
  const ids: string[] = []
  for (const [notification] of text.matchAll(/<task-notification>[\s\S]*?<\/task-notification>/g)) {
    const id = notification.match(/<task-id>([^<]+)<\/task-id>/)?.[1]
    if (id && /<status>[^<]+<\/status>/.test(notification)) ids.push(id.trim())
  }
  return ids
}

/** 사람 쪽 글(대기열에 넣은 글·queued_command 첨부·user 줄). 알림은 여기에만 진짜로 남는다 (api-request-*·prompt_snapshot 등은 사본) */
function deliveredText(record: Record<string, unknown>): string {
  if (record.type === 'queue-operation') return typeof record.content === 'string' ? record.content : ''
  if (record.type === 'attachment') {
    const attachment = record.attachment as { type?: string; prompt?: unknown } | undefined
    return attachment?.type === 'queued_command' && typeof attachment.prompt === 'string' ? attachment.prompt : ''
  }
  if (record.type !== 'user') return ''
  const content = (record.message as { content?: unknown } | undefined)?.content
  return typeof content === 'string' ? content : resultText(content)
}

/**
 * jsonl → 이 세션에서 백그라운드로 돈 shell 들 (시작 순). Bash·PowerShell 결과의 toolUseResult.backgroundTaskId 로 시작을 안다:
 * run_in_background 로 띄운 것과, 시간 초과로 백그라운드로 넘어간 것("moved to the background") 둘 다 이것이 있다.
 * 끝: 상태가 있는 task-notification(completed·failed·killed·stopped), 성공한 TaskStop·KillShell, 프로세스 경계 cost-state
 * (Claude Code 프로세스가 세션을 떠날 때 남긴다. 그 프로세스가 띄운 shell 은 같이 죽었다 — messages.ts 의 대기열 규칙과 같은 이유).
 * 사이드체인·메타 줄은 뺀다. 백그라운드 에이전트·모니터·백그라운드로 넘어간 MCP 호출은 shell 도구가 아니라 저절로 빠진다
 */
export function parseShells(jsonl: string): ShellRecord[] {
  const shells = new Map<string, ShellRecord>()
  /** shell 도구 호출 (tool_use ID → 시작 정보). 결과가 백그라운드 시작이면 shell 이 된다 */
  const shellCalls = new Map<string, Omit<Shell, 'id'>>()
  /** 멈추기 도구 호출 (tool_use ID → 멈출 작업 ID) */
  const stopCalls = new Map<string, string>()
  const end = (id: string) => {
    const shell = shells.get(id)
    if (shell) shell.isRunning = false
  }

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.isSidechain || record.isMeta) continue
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : ''
    if (record.type === 'cost-state') {
      for (const id of shells.keys()) end(id)
      shellCalls.clear()
      stopCalls.clear()
      continue
    }
    for (const id of endedTaskIds(deliveredText(record))) end(id)

    const content = (record.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const block of content as Block[]) {
      if (record.type === 'assistant' && block.type === 'tool_use' && block.id && block.name) {
        const input = block.input ?? {}
        if (SHELL_TOOLS.has(block.name) && typeof input.command === 'string') {
          const description = typeof input.description === 'string' && input.description.trim() ? input.description : null
          shellCalls.set(block.id, { command: input.command, description, startedAt: timestamp })
        }
        const stopId = input.task_id ?? input.shell_id
        if (STOP_TOOLS.has(block.name) && typeof stopId === 'string') stopCalls.set(block.id, stopId)
      }
      if (record.type !== 'user' || block.type !== 'tool_result' || !block.tool_use_id) continue
      const text = resultText(block.content)
      const call = shellCalls.get(block.tool_use_id)
      if (call) {
        shellCalls.delete(block.tool_use_id)
        const id = (record.toolUseResult as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId
        // 한 줄에 결과가 여럿이어도 이 결과의 것인지 글로 한 번 더 맞춘다
        if (typeof id !== 'string' || !id || !text.includes(id)) continue
        const outputPath = text.match(new RegExp(`Output is being written to: (.+?[\\\\/]${escapeRegExp(id)}\\.output)`))?.[1] ?? null
        shells.set(id, { ...call, id, outputPath, isRunning: true })
      }
      const stopId = stopCalls.get(block.tool_use_id)
      if (stopId !== undefined) {
        stopCalls.delete(block.tool_use_id)
        if (block.is_error !== true && !text.startsWith('<tool_use_error>')) end(stopId)
      }
    }
  }
  return [...shells.values()]
}

/** 지금 도는 shell (Session.shells 꼴). 근무 중인 세션에만 쓴다 — 프로세스가 없으면 shell 도 없다 */
export function runningShells(jsonl: string): Shell[] {
  // 백그라운드 shell 이 한 번도 없던 jsonl 은 다시 해석하지 않는다 (세션 목록이 5초마다 돈다)
  if (!jsonl.includes('backgroundTaskId')) return []
  return parseShells(jsonl)
    .filter((shell) => shell.isRunning)
    .map(({ id, command, description, startedAt }) => ({ id, command, description, startedAt }))
}

/** 끝에서 이만큼씩 늘려 읽는다. 최대까지 읽어도 줄이 모자라면 그만큼만 준다 (한 줄이 아주 긴 출력) */
const TAIL_CHUNK_BYTES = 64 * 1024
const TAIL_MAX_BYTES = 1024 * 1024

/**
 * 파일의 마지막 count 줄. 큰 파일은 끝부분만 읽는다. 줄 끝 CRLF 는 떼고, 줄 안의 CR(진행 막대 다시 그리기)은 터미널처럼 마지막 것만 남긴다.
 * isTruncated = 앞에 더 있다 (줄이 더 있거나 읽지 않은 앞부분이 있음). size = 파일 크기(바이트)
 */
export async function readTail(path: string, count: number): Promise<{ lines: string[]; isTruncated: boolean; size: number }> {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    let start = size
    let buffer = Buffer.alloc(0)
    while (start > 0 && buffer.length < TAIL_MAX_BYTES) {
      const length = Math.min(TAIL_CHUNK_BYTES, start, TAIL_MAX_BYTES - buffer.length)
      const chunk = Buffer.alloc(length)
      const { bytesRead } = await file.read(chunk, 0, length, start - length)
      start -= length
      buffer = Buffer.concat([chunk.subarray(0, bytesRead), buffer])
      // 마지막 줄의 줄바꿈까지 count + 1 개면 count 줄은 온전하다
      if (buffer.filter((byte) => byte === 0x0a).length > count) break
    }
    let text = buffer.toString('utf8')
    // 중간부터 읽었으면 첫 줄은 잘렸을 수 있다 (UTF-8 글자가 반쪽일 수도 있다)
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    const all = text.split('\n')
    if (all.at(-1) === '') all.pop()
    const lines = all.slice(-count).map((line) => line.replace(/\r$/, '').split('\r').at(-1) ?? '')
    return { lines, isTruncated: start > 0 || all.length > count, size }
  } finally {
    await file.close()
  }
}
