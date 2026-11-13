import { open, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { TaskUsage } from './taskUsage.js'

/**
 * 오늘 한 일 창의 토큰: 폴더(팀·파트)의 Claude Code 프로젝트 폴더에서 그날 claude 응답의 usage 합을 세션마다 센다.
 * 세는 규칙은 taskUsage.ts 의 taskUsageOf 와 같다 (`type: assistant`, `<synthetic>` 제외, `message.usage` 있음, 같은 message.id 는
 * 마지막 줄 하나) — 다만 사이드체인 줄과 서브에이전트 파일(`<세션ID>/subagents/agent-*.jsonl`)도 그 세션 몫에 넣는다
 * (실제로 쓴 토큰이라서. 그래서 Tasks 창의 task usage 와 기준이 다르다).
 *
 * 파일마다 기억해 두고 늘어난 바이트만 읽는다. 처음 읽을 때는 끝에서 거꾸로 1MB 씩 읽다 그날보다 앞선 응답 줄을 만나면 멈춘다
 * (jsonl 은 시간순으로 덧붙는다 — 큰 파일 앞부분을 해석하지 않게). 한 덩어리마다 비동기 읽기라 이벤트 루프를 오래 막지 않는다
 */

const CHUNK_BYTES = 1024 * 1024
const SYNTHETIC_MODEL = '<synthetic>'
/** 기억하는 파일 수 (넘으면 오래된 것부터 버린다) */
const MAX_CACHED_FILES = 2000
const NEWLINE = 0x0a
/** 한 번에 읽는 파일 수 (덩어리 버퍼가 파일 수만큼 잡히지 않게) */
const FILE_CONCURRENCY = 4

type Tokens = Omit<TaskUsage, 'turns'>

interface FileState {
  /** 여기까지(줄 끝 다음) 읽었다 */
  scanned: number
  /** message.id → 그 응답의 마지막 줄 usage */
  byId: Map<string, Tokens>
  /** id 가 없는 응답 줄 (합과 수) */
  anonymous: Tokens
  anonymousCount: number
  /** 가장 나중 응답 줄의 model */
  model: string | null
}

export interface FileDayUsage {
  usage: TaskUsage | null
  model: string | null
}

const tokenCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
const emptyTokens = (): Tokens => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })

type Parsed = { kind: 'skip' } | { kind: 'before' } | { kind: 'after' } | { kind: 'response'; id: string | null; tokens: Tokens; model: string | null }

/** 한 줄 해석. 응답 줄이 아니면 skip, 범위 앞·뒤 응답이면 before·after */
export function parseUsageLine(line: Buffer | string, from: number, to: number): Parsed {
  if (!line.includes('"assistant"')) return { kind: 'skip' }
  let record: { type?: unknown; timestamp?: unknown; message?: { id?: unknown; model?: unknown; usage?: unknown } }
  try {
    record = JSON.parse(typeof line === 'string' ? line : line.toString('utf8'))
  } catch {
    return { kind: 'skip' }
  }
  if (record.type !== 'assistant') return { kind: 'skip' }
  const at = typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Number.NaN
  if (Number.isNaN(at)) return { kind: 'skip' }
  if (at < from) return { kind: 'before' }
  if (at >= to) return { kind: 'after' }
  const message = record.message
  if (typeof message?.usage !== 'object' || message.usage === null || message.model === SYNTHETIC_MODEL) return { kind: 'skip' }
  const usage = message.usage as Record<string, unknown>
  return {
    kind: 'response',
    id: typeof message.id === 'string' ? message.id : null,
    tokens: {
      inputTokens: tokenCount(usage.input_tokens),
      outputTokens: tokenCount(usage.output_tokens),
      cacheCreationTokens: tokenCount(usage.cache_creation_input_tokens),
      cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
    },
    model: typeof message.model === 'string' ? message.model : null,
  }
}

function addTokens(target: Tokens, tokens: Tokens): void {
  target.inputTokens += tokens.inputTokens
  target.outputTokens += tokens.outputTokens
  target.cacheCreationTokens += tokens.cacheCreationTokens
  target.cacheReadTokens += tokens.cacheReadTokens
}

export function usageOfState(state: FileState): FileDayUsage {
  const sum = { ...state.anonymous }
  for (const tokens of state.byId.values()) addTokens(sum, tokens)
  const turns = state.byId.size + state.anonymousCount
  return turns === 0 ? { usage: null, model: null } : { usage: { ...sum, turns }, model: state.model }
}

const newState = (): FileState => ({ scanned: 0, byId: new Map(), anonymous: emptyTokens(), anonymousCount: 0, model: null })

/** 끝에서 거꾸로 [0, end) 를 읽어 범위 안 응답을 넣는다. 범위 앞 응답 줄을 만나면 멈춘다. 처음 본 줄(= 그 응답의 마지막 줄)이 이긴다 */
async function scanBackward(path: string, end: number, from: number, to: number, state: FileState): Promise<void> {
  const handle = await open(path, 'r')
  try {
    let position = end
    let carry: Buffer = Buffer.alloc(0)
    while (position > 0) {
      const start = Math.max(0, position - CHUNK_BYTES)
      const chunk = Buffer.alloc(position - start)
      await handle.read(chunk, 0, chunk.length, start)
      position = start
      const buffer = carry.length > 0 ? Buffer.concat([chunk, carry]) : chunk
      // 맨 앞 조각은 줄 중간일 수 있어 다음 덩어리로 넘긴다 (파일 처음이면 그대로 한 줄)
      let lineEnd = buffer.length
      let index = buffer.lastIndexOf(NEWLINE, lineEnd - 1)
      while (index >= 0) {
        if (applyBackward(buffer.subarray(index + 1, lineEnd), from, to, state)) return
        lineEnd = index
        index = lineEnd > 0 ? buffer.lastIndexOf(NEWLINE, lineEnd - 1) : -1
      }
      carry = buffer.subarray(0, lineEnd)
      if (position === 0 && carry.length > 0) applyBackward(carry, from, to, state)
    }
  } finally {
    await handle.close()
  }
}

/** 거꾸로 읽은 한 줄. 멈출 때(범위 앞 응답) true */
function applyBackward(line: Buffer, from: number, to: number, state: FileState): boolean {
  if (line.length === 0) return false
  const parsed = parseUsageLine(line, from, to)
  if (parsed.kind === 'before') return true
  if (parsed.kind !== 'response') return false
  if (parsed.id !== null) {
    if (state.byId.has(parsed.id)) return false
    state.byId.set(parsed.id, parsed.tokens)
  } else {
    addTokens(state.anonymous, parsed.tokens)
    state.anonymousCount++
  }
  // 거꾸로라 처음 본 응답이 가장 나중 것
  if (state.model === null && parsed.model !== null) state.model = parsed.model
  return false
}

/** [start, size) 를 앞으로 읽어 완전한 줄만 넣는다 (나중 줄이 같은 id 를 덮는다). 읽은 끝(마지막 줄바꿈 다음)을 준다 */
async function scanForward(path: string, start: number, size: number, from: number, to: number, state: FileState): Promise<number> {
  const handle = await open(path, 'r')
  try {
    let position = start
    let carry: Buffer = Buffer.alloc(0)
    let scanned = start
    while (position < size) {
      const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - position))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      const buffer = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead)
      const bufferStart = position - carry.length
      position += bytesRead
      let lineStart = 0
      let index = buffer.indexOf(NEWLINE, lineStart)
      while (index >= 0) {
        const parsed = parseUsageLine(buffer.subarray(lineStart, index), from, to)
        if (parsed.kind === 'response') {
          if (parsed.id !== null) state.byId.set(parsed.id, parsed.tokens)
          else {
            addTokens(state.anonymous, parsed.tokens)
            state.anonymousCount++
          }
          if (parsed.model !== null) state.model = parsed.model
        }
        lineStart = index + 1
        scanned = bufferStart + lineStart
        index = buffer.indexOf(NEWLINE, lineStart)
      }
      carry = buffer.subarray(lineStart)
    }
    return scanned
  } finally {
    await handle.close()
  }
}

/** 파일의 마지막 줄바꿈 다음 위치 (쓰는 중인 끝 줄은 뺀다). 줄바꿈이 없으면 0 */
async function lastLineEnd(path: string, size: number): Promise<number> {
  const handle = await open(path, 'r')
  try {
    let position = size
    while (position > 0) {
      const start = Math.max(0, position - 64 * 1024)
      const chunk = Buffer.alloc(position - start)
      await handle.read(chunk, 0, chunk.length, start)
      const index = chunk.lastIndexOf(NEWLINE)
      if (index >= 0) return start + index + 1
      position = start
    }
    return 0
  } finally {
    await handle.close()
  }
}

/**
 * 파일별 그날 사용량 읽기. 같은 파일·범위는 늘어난 바이트만 읽고, 파일이 줄었으면(다시 쓰임) 처음부터, 같은 키를 동시에 부르면
 * 도는 것 하나를 같이 쓴다. 서버를 다시 켜면 빈다
 */
export function makeDayUsageReader() {
  const states = new Map<string, FileState>()
  const running = new Map<string, Promise<FileDayUsage>>()

  async function read(path: string, size: number, from: number, to: number): Promise<FileDayUsage> {
    const key = `${path}|${from}|${to}`
    let state = states.get(key)
    if (state && size < state.scanned) state = undefined
    if (!state) {
      state = newState()
      const end = await lastLineEnd(path, size)
      await scanBackward(path, end, from, to, state)
      state.scanned = end
    } else if (size > state.scanned) {
      state.scanned = await scanForward(path, state.scanned, size, from, to, state)
    }
    states.delete(key)
    states.set(key, state)
    while (states.size > MAX_CACHED_FILES) states.delete(states.keys().next().value!)
    return usageOfState(state)
  }

  return (path: string, size: number, from: number, to: number): Promise<FileDayUsage> => {
    const key = `${path}|${from}|${to}`
    const current = running.get(key)
    if (current) return current
    const promise = read(path, size, from, to).finally(() => running.delete(key))
    running.set(key, promise)
    return promise
  }
}

export type DayUsageReader = ReturnType<typeof makeDayUsageReader>

/** jsonl 하나 (세션 ID·경로·크기) */
interface SessionFile {
  sessionId: string
  path: string
  size: number
  isSubagent: boolean
}

/** 프로젝트 폴더에서 수정 시각이 from 이후인 세션 jsonl 과 그 세션의 서브에이전트 jsonl. 폴더가 없으면 빈 목록 */
export async function dayFilesOf(projectDir: string, from: number): Promise<SessionFile[]> {
  let names: string[]
  try {
    names = await readdir(projectDir)
  } catch {
    return []
  }
  const files: SessionFile[] = []
  await Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map(async (name) => {
        const path = join(projectDir, name)
        const info = await stat(path).catch(() => null)
        if (!info || !info.isFile() || info.mtimeMs < from) return
        const sessionId = basename(name, '.jsonl')
        files.push({ sessionId, path, size: info.size, isSubagent: false })
        // 서브에이전트가 돌았으면 부모 jsonl 도 그 사이 바뀌었으니 바뀐 세션의 하위 폴더만 본다
        const subagentDir = join(projectDir, sessionId, 'subagents')
        const subNames = await readdir(subagentDir).catch(() => [] as string[])
        await Promise.all(
          subNames
            .filter((subName) => subName.endsWith('.jsonl'))
            .map(async (subName) => {
              const subPath = join(subagentDir, subName)
              const subInfo = await stat(subPath).catch(() => null)
              if (subInfo && subInfo.isFile() && subInfo.mtimeMs >= from) files.push({ sessionId, path: subPath, size: subInfo.size, isSubagent: true })
            }),
        )
      }),
  )
  return files
}

/**
 * 프로젝트 폴더들의 그날 사용량을 세션마다 더한다 (서브에이전트 파일은 그 세션 몫). model 은 세션 jsonl 의 것.
 * 못 읽은 파일은 건너뛴다 (지워지는 중 등)
 */
export async function dayUsageOfDirs(projectDirs: readonly string[], from: number, to: number, reader: DayUsageReader): Promise<Map<string, { usage: TaskUsage; model: string | null }>> {
  const files = (await Promise.all([...new Set(projectDirs)].map((dir) => dayFilesOf(dir, from)))).flat()
  const results: { file: SessionFile; result: FileDayUsage | null }[] = []
  let next = 0
  const work = async () => {
    while (next < files.length) {
      const file = files[next++]
      results.push({ file, result: await reader(file.path, file.size, from, to).catch(() => null) })
    }
  }
  await Promise.all(Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, work))
  // 세션 jsonl 을 서브에이전트보다 먼저 더해 model 을 세션 것으로 둔다
  results.sort((a, b) => Number(a.file.isSubagent) - Number(b.file.isSubagent))
  const bySession = new Map<string, { usage: TaskUsage; model: string | null }>()
  for (const { file, result } of results) {
    if (!result?.usage) continue
    const current = bySession.get(file.sessionId)
    const usage = current
      ? {
          inputTokens: current.usage.inputTokens + result.usage.inputTokens,
          outputTokens: current.usage.outputTokens + result.usage.outputTokens,
          cacheCreationTokens: current.usage.cacheCreationTokens + result.usage.cacheCreationTokens,
          cacheReadTokens: current.usage.cacheReadTokens + result.usage.cacheReadTokens,
          turns: current.usage.turns + result.usage.turns,
        }
      : result.usage
    const model = file.isSubagent ? (current?.model ?? null) : result.model
    bySession.set(file.sessionId, { usage, model })
  }
  return bySession
}
