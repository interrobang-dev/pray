import { open } from 'node:fs/promises'
import type { Shell } from './types.js'
import { parseRecord } from './transcript.js'

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
 * 백그라운드 작업 하나 (판정용). shell = Bash·PowerShell(Session.shells 에도 나간다), mcp = 시간이 오래 걸려 백그라운드로 넘어간 MCP 호출
 * (예: 팀장의 team_wait), agent = 백그라운드 에이전트 (Agent run_in_background, SendMessage 로 다시 깨운 것)
 */
export interface BackgroundTask {
  id: string
  kind: 'shell' | 'mcp' | 'agent'
  isRunning: boolean
}

/** MCP 호출이 백그라운드로 넘어갔을 때 Claude Code 가 그 도구 결과 글로 넣는 꼴 (실측 2.1.305: 120초 넘게 걸린 jk_wait) */
const MCP_BACKGROUND = /^MCP tool "[^"]+" is still running after \d+s\. It was moved to the background as task ([A-Za-z0-9_-]+) /

/**
 * jsonl → 이 세션에서 백그라운드로 돈 작업들 (시작 순). shell 은 ShellRecord(명령·출력 경로 포함)를 같이 둔다.
 * 시작: shell 은 Bash·PowerShell 결과의 toolUseResult.backgroundTaskId (run_in_background 로 띄운 것과 시간 초과로 백그라운드로 넘어간 것
 * "moved to the background" 둘 다), MCP 는 mcp__ 도구 결과 글 "MCP tool "<서버>/<도구>" is still running after Ns. It was moved to the background as task <id> …",
 * 에이전트는 toolUseResult 의 isAsync·status async_launched·agentId 와 SendMessage 결과의 resumedAgentId (멈춘 에이전트를 다시 깨운다).
 * 끝: 상태가 있는 task-notification(completed·failed·killed·stopped. task-id 가 위 ID 들과 같다), 성공한 TaskStop·KillShell,
 * 프로세스 경계 cost-state (Claude Code 프로세스가 세션을 떠날 때 남긴다. 그 프로세스가 띄운 작업은 같이 죽었다 — messages.ts 의 대기열 규칙과 같은 이유).
 * 사이드체인·메타 줄은 뺀다. 모니터(Monitor)는 끝 알림에 상태가 없어(만료도 상태 없는 이벤트) 넣지 않는다.
 * 줄 단위로 이어서 만드는 중간 상태가 BackgroundState 다 (큰 jsonl 은 덧붙은 줄만 applyBackgroundRecord 로 넣는다 — sessions.ts 의 TranscriptCache)
 */
export interface BackgroundState {
  tasks: Map<string, BackgroundTask>
  shells: Map<string, ShellRecord>
  /** shell 도구 호출 (tool_use ID → 시작 정보). 결과가 백그라운드 시작이면 shell 이 된다 */
  shellCalls: Map<string, Omit<Shell, 'id'>>
  /** MCP 도구 호출 (tool_use ID). 결과가 백그라운드로 넘어간 글이면 작업이 된다 */
  mcpCalls: Set<string>
  /** 멈추기 도구 호출 (tool_use ID → 멈출 작업 ID) */
  stopCalls: Map<string, string>
}

export function newBackgroundState(): BackgroundState {
  return { tasks: new Map(), shells: new Map(), shellCalls: new Map(), mcpCalls: new Set(), stopCalls: new Map() }
}

/** 상태 복사본 (덜 쓰인 마지막 줄을 넣어 볼 때 원래 상태를 남긴다). 작업·shell 은 isRunning 을 바꾸므로 객체도 복사한다 */
export function copyBackgroundState(state: BackgroundState): BackgroundState {
  return {
    tasks: new Map([...state.tasks].map(([id, task]) => [id, { ...task }])),
    shells: new Map([...state.shells].map(([id, shell]) => [id, { ...shell }])),
    shellCalls: new Map(state.shellCalls),
    mcpCalls: new Set(state.mcpCalls),
    stopCalls: new Map(state.stopCalls),
  }
}

function begin(state: BackgroundState, id: string, kind: BackgroundTask['kind']): void {
  // 같은 ID 로 다시 시작하면(에이전트 다시 깨우기) 시작 순서를 새로 한다
  state.tasks.delete(id)
  state.tasks.set(id, { id, kind, isRunning: true })
}

function end(state: BackgroundState, id: string): void {
  const task = state.tasks.get(id)
  if (task) task.isRunning = false
  const shell = state.shells.get(id)
  if (shell) shell.isRunning = false
}

/** 줄 하나를 상태에 넣는다. 규칙은 위 */
export function applyBackgroundRecord(state: BackgroundState, record: Record<string, unknown>): void {
  if (record.isSidechain || record.isMeta) return
  const timestamp = typeof record.timestamp === 'string' ? record.timestamp : ''
  if (record.type === 'cost-state') {
    for (const id of state.tasks.keys()) end(state, id)
    state.shellCalls.clear()
    state.mcpCalls.clear()
    state.stopCalls.clear()
    return
  }
  for (const id of endedTaskIds(deliveredText(record))) end(state, id)

  const content = (record.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return
  for (const block of content as Block[]) {
    if (record.type === 'assistant' && block.type === 'tool_use' && block.id && block.name) {
      const input = block.input ?? {}
      if (SHELL_TOOLS.has(block.name) && typeof input.command === 'string') {
        const description = typeof input.description === 'string' && input.description.trim() ? input.description : null
        state.shellCalls.set(block.id, { command: input.command, description, startedAt: timestamp })
      }
      if (block.name.startsWith('mcp__')) state.mcpCalls.add(block.id)
      const stopId = input.task_id ?? input.shell_id
      if (STOP_TOOLS.has(block.name) && typeof stopId === 'string') state.stopCalls.set(block.id, stopId)
    }
    if (record.type !== 'user' || block.type !== 'tool_result' || !block.tool_use_id) continue
    const text = resultText(block.content)
    const toolUseResult = record.toolUseResult as Record<string, unknown> | undefined
    const call = state.shellCalls.get(block.tool_use_id)
    if (call) {
      state.shellCalls.delete(block.tool_use_id)
      const id = toolUseResult?.backgroundTaskId
      // 한 줄에 결과가 여럿이어도 이 결과의 것인지 글로 한 번 더 맞춘다
      if (typeof id !== 'string' || !id || !text.includes(id)) continue
      const outputPath = text.match(new RegExp(`Output is being written to: (.+?[\\\\/]${escapeRegExp(id)}\\.output)`))?.[1] ?? null
      begin(state, id, 'shell')
      state.shells.set(id, { ...call, id, outputPath, isRunning: true })
    }
    if (state.mcpCalls.delete(block.tool_use_id)) {
      const id = text.match(MCP_BACKGROUND)?.[1]
      if (id) begin(state, id, 'mcp')
    }
    // 에이전트 결과는 한 줄에 하나뿐이지만 shell 처럼 글로 한 번 더 맞춘다
    const agentId = toolUseResult?.agentId
    if (toolUseResult?.isAsync === true && toolUseResult.status === 'async_launched' && typeof agentId === 'string' && agentId && text.includes(agentId)) {
      begin(state, agentId, 'agent')
    }
    const resumedId = toolUseResult?.resumedAgentId
    if (typeof resumedId === 'string' && resumedId && text.includes(resumedId)) begin(state, resumedId, 'agent')
    const stopId = state.stopCalls.get(block.tool_use_id)
    if (stopId !== undefined) {
      state.stopCalls.delete(block.tool_use_id)
      if (block.is_error !== true && !text.startsWith('<tool_use_error>')) end(state, stopId)
    }
  }
}

function scanBackground(jsonl: string): BackgroundState {
  const state = newBackgroundState()
  for (const line of jsonl.split('\n')) {
    const record = parseRecord(line)
    if (record) applyBackgroundRecord(state, record)
  }
  return state
}

/** 상태의 shell 들 (시작 순, 복사본) */
function shellsOf(state: BackgroundState): ShellRecord[] {
  return [...state.shells.values()].map((shell) => ({ ...shell }))
}

/** 상태에서 지금 도는 shell (Session.shells 꼴) */
export function runningShellsOf(state: BackgroundState): Shell[] {
  return [...state.shells.values()]
    .filter((shell) => shell.isRunning)
    .map(({ id, command, description, startedAt }) => ({ id, command, description, startedAt }))
}

/** 상태에서 지금 도는 백그라운드 작업 (시작 순, 복사본 — 상태의 객체는 다음 줄에 isRunning 이 바뀐다) */
export function runningBackgroundTasksOf(state: BackgroundState): BackgroundTask[] {
  return [...state.tasks.values()].filter((task) => task.isRunning).map((task) => ({ ...task }))
}

/** jsonl → 이 세션에서 백그라운드로 돈 shell 들 (시작 순). 규칙은 scanBackground. 백그라운드 에이전트·모니터·MCP 호출은 shell 이 아니라 빠진다 */
export function parseShells(jsonl: string): ShellRecord[] {
  return shellsOf(scanBackground(jsonl))
}

/** 지금 도는 shell (Session.shells 꼴). 근무 중인 세션에만 쓴다 — 프로세스가 없으면 shell 도 없다 */
export function runningShells(jsonl: string): Shell[] {
  // 백그라운드 shell 이 한 번도 없던 jsonl 은 다시 해석하지 않는다 (세션 목록이 5초마다 돈다)
  if (!jsonl.includes('backgroundTaskId')) return []
  return runningShellsOf(scanBackground(jsonl))
}

/**
 * 지금 도는 백그라운드 작업 전부 (shell·MCP·에이전트, 시작 순). 표시 상태 waiting 판정과 모델 변경 409 에 쓴다.
 * 근무 중인 세션에만 쓴다 — 프로세스가 없으면 작업도 없다
 */
export function runningBackgroundTasks(jsonl: string): BackgroundTask[] {
  // 백그라운드 작업이 한 번도 없던 jsonl 은 다시 해석하지 않는다
  if (!/backgroundTaskId|moved to the background as task|async_launched|resumedAgentId/.test(jsonl)) return []
  return runningBackgroundTasksOf(scanBackground(jsonl))
}

/**
 * 표시 상태 waiting 인지: 끝나면 결과를 들고 claude 를 깨우는 작업(MCP 호출·에이전트)이 도는지.
 * shell 은 뺀다 — dev 서버처럼 끝나지 않는 shell 이 많아 세션이 내내 waiting 으로 보였다 (shell 은 Shells 표시로 본다)
 */
export function hasWakingTask(tasks: BackgroundTask[]): boolean {
  return tasks.some((task) => task.kind !== 'shell')
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
