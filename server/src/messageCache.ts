import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { buildMessages, MessageLineParser, parseInstructionLog, type ChatMessage, type InstructionRecord } from './messages.js'

/**
 * 대화 API(`GET /api/sessions/:id/messages`) 의 서버 캐시와 버전.
 * 일하는 세션은 몇 초마다 jsonl 이 덧붙고 화면은 그때마다 대화를 다시 받는다. 큰 세션은 jsonl 이 100MB 를 넘어
 * 전체를 읽고 해석하는 데 1초 가까이 걸려서, 덧붙은 바이트만 읽어 해석하고(TranscriptMessageCache) 화면이 가진 버전과
 * 비교해 처음 달라진 자리부터만 보낸다(MessageVersions)
 */

/** 덧붙은 것만 읽을 때 앞부분이 그대로인지 보려고 같이 다시 읽는, 지난번에 넣은 끝 바로 앞 바이트 수 */
const GUARD_BYTES = 256
const NEWLINE = 0x0a

interface ParsedTranscript {
  size: number
  mtimeMs: number
  /** 끝난 줄(줄바꿈까지)만 parser 에 넣은 바이트 수. 그 뒤(덜 쓰였을 수 있는 마지막 줄)는 매번 다시 읽는다 */
  committedBytes: number
  /** committedBytes 바로 앞 최대 GUARD_BYTES 바이트 (복사본) */
  guard: Buffer
  parser: MessageLineParser
  messages: ChatMessage[]
}

/** path 의 [start, end) 바이트. 파일이 그보다 짧으면 있는 만큼 */
async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const buffer = Buffer.alloc(end - start)
  const handle = await open(path, 'r')
  try {
    let filled = 0
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled)
      if (bytesRead === 0) break
      filled += bytesRead
    }
    return buffer.subarray(0, filled)
  } finally {
    await handle.close()
  }
}

/**
 * jsonl 경로 → 해석한 메시지 (parseMessages 와 같은 결과). 크기·수정 시각이 그대로면 그 결과 그대로(같은 객체),
 * 커졌고 지난번 끝 바로 앞 바이트(GUARD_BYTES)가 그대로면 덧붙은 바이트만 읽어 줄 단계(MessageLineParser)에 넣고 뒷단계(buildMessages)만 다시 한다.
 * 줄어들었거나 앞이 바뀌었으면 처음부터 읽는다. 덜 쓰인 마지막 줄은 넣지 않고 그때그때 peek 로 해석한다 (전체를 split 한 것과 같다).
 * 크기·수정 시각이 같은데 내용만 바뀐 파일은 모른다 (jsonl 은 덧붙기만 한다). 최근에 쓴 maxEntries 개 파일만 둔다
 */
export class TranscriptMessageCache {
  private readonly entries = new Map<string, ParsedTranscript>()
  private readonly maxEntries: number

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries
  }

  /** size·mtimeMs 는 읽기 직전 stat 값이고 그 크기까지만 읽는다 (그 뒤 덧붙은 것은 다음 번에). 파일을 못 읽으면 null */
  async read(path: string, size: number, mtimeMs: number): Promise<ChatMessage[] | null> {
    const cached = this.entries.get(path)
    // 해석 중 예외가 나도 반쯤 바뀐 것이 남지 않게 먼저 뺀다
    this.entries.delete(path)
    const entry = await this.update(path, size, mtimeMs, cached)
    if (!entry) return null
    this.entries.set(path, entry)
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break
      this.entries.delete(oldest)
    }
    return entry.messages
  }

  private async update(path: string, size: number, mtimeMs: number, cached: ParsedTranscript | undefined): Promise<ParsedTranscript | null> {
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached
    if (cached && size >= cached.committedBytes) {
      const start = cached.committedBytes - cached.guard.length
      const bytes = await readRange(path, start, size).catch(() => null)
      if (!bytes) return null
      if (bytes.length === size - start && bytes.subarray(0, cached.guard.length).equals(cached.guard)) {
        return append(cached, bytes, cached.guard.length, size, mtimeMs)
      }
    }
    const bytes = await readRange(path, 0, size).catch(() => null)
    if (!bytes) return null
    const fresh: ParsedTranscript = { size, mtimeMs, committedBytes: 0, guard: Buffer.alloc(0), parser: new MessageLineParser(), messages: [] }
    return append(fresh, bytes, 0, size, mtimeMs)
  }
}

/** bytes[from..] 이 entry.committedBytes 부터 덧붙은 바이트다 (bytes 앞부분은 guard). 끝난 줄을 넣고 마지막 줄은 peek 로 해석해 메시지를 다시 만든다 */
function append(entry: ParsedTranscript, bytes: Buffer, from: number, size: number, mtimeMs: number): ParsedTranscript {
  const lastNewline = bytes.lastIndexOf(NEWLINE)
  let tailStart = from
  if (lastNewline >= from) {
    // 줄바꿈은 UTF-8 여러 바이트 글자 안에 나오지 않아 줄 경계로 잘라 풀어도 전체를 푼 것과 같다
    for (const line of bytes.toString('utf8', from, lastNewline).split('\n')) entry.parser.push(line)
    entry.committedBytes += lastNewline + 1 - from
    tailStart = lastNewline + 1
    // 복사한다 (subarray 는 읽은 버퍼 전체를 붙잡는다)
    entry.guard = Buffer.from(bytes.subarray(Math.max(0, tailStart - GUARD_BYTES), tailStart))
  }
  const tail = entry.parser.peek(bytes.toString('utf8', tailStart))
  entry.messages = buildMessages(tail ? [...entry.parser.lines, tail] : entry.parser.lines)
  entry.size = size
  entry.mtimeMs = mtimeMs
  return entry
}

/** 메시지 → JSON 글. 같은 객체는 한 번만 만든다 (해석 캐시는 jsonl 이 그대로면 같은 객체를 준다) */
const jsonByMessage = new WeakMap<ChatMessage, string>()

/** 메시지마다 JSON 글. `[${jsons.join(',')}]` 이 JSON.stringify(messages) 와 같다 */
export function messageJsons(messages: readonly ChatMessage[]): string[] {
  return messages.map((message) => {
    let json = jsonByMessage.get(message)
    if (json === undefined) {
      json = JSON.stringify(message)
      jsonByMessage.set(message, json)
    }
    return json
  })
}

/** 메시지 목록의 버전: 응답 내용의 sha1. 내용이 같으면 서버를 다시 켜도 같다 (JSON 객체는 스스로 끝이 정해져 ',' 로 이어도 겹치지 않는다) */
export function versionOf(jsons: readonly string[]): string {
  const hash = createHash('sha1')
  for (const json of jsons) hash.update(json).update(',')
  return hash.digest('hex')
}

/** 두 목록에서 처음 달라진 자리. 하나가 다른 하나의 앞부분이면 짧은 쪽 길이 */
export function firstDifference(previous: readonly string[], next: readonly string[]): number {
  const length = Math.min(previous.length, next.length)
  for (let index = 0; index < length; index++) {
    if (previous[index] !== next[index]) return index
  }
  return length
}

interface Version {
  version: string
  jsons: string[]
}

/**
 * 세션마다 최근에 보낸 메시지 목록 버전들 (최근 maxVersions 개, 최근에 쓴 maxSessions 개 세션).
 * 화면이 가진 버전(since)을 알면 그 목록과 지금 목록에서 처음 달라진 자리를 준다. 앞 메시지도 바뀔 수 있어
 * (도구 결과가 앞의 도구 호출에 붙음, 대기 표시, 지시 from, message.id 로 합쳐지는 assistant) "마지막 ID 뒤" 가 아니라 글 비교다.
 * 같은 글은 앞 버전의 문자열을 다시 써서 버전이 여럿이어도 메모리는 대략 한 벌이다
 */
export class MessageVersions {
  private readonly sessions = new Map<string, Version[]>()
  private readonly maxSessions: number
  private readonly maxVersions: number

  constructor(maxSessions: number, maxVersions: number) {
    this.maxSessions = maxSessions
    this.maxVersions = maxVersions
  }

  /** 지금 목록을 기록하고 그 버전을 준다. fromIndex = since 버전 목록과 처음 달라진 자리, since 가 없거나 모르는 버전이면 0 */
  update(sessionId: string, jsons: string[], since: string | null): { version: string; fromIndex: number } {
    const version = versionOf(jsons)
    const history = this.sessions.get(sessionId) ?? []
    // 기록하며 밀려나기 전에 찾는다
    const base = since === null ? undefined : history.find((entry) => entry.version === since)
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, history)
    for (const oldest of this.sessions.keys()) {
      if (this.sessions.size <= this.maxSessions) break
      this.sessions.delete(oldest)
    }
    const known = history.findIndex((entry) => entry.version === version)
    if (known >= 0) {
      history.push(...history.splice(known, 1))
    } else {
      const latest = history.at(-1)?.jsons ?? []
      history.push({ version, jsons: jsons.map((json, index) => (latest[index] === json ? latest[index] : json)) })
      if (history.length > this.maxVersions) history.shift()
    }
    return { version, fromIndex: base ? firstDifference(base.jsons, jsons) : 0 }
  }
}

/** instructions.jsonl 을 크기·수정 시각이 같으면 다시 읽지 않는다. 세션별로 고른 기록(parseInstructionLog)도 같이 둔다 */
export class InstructionLogCache {
  private readonly path: string
  private file: { size: number; mtimeMs: number; text: string; bySession: Map<string, InstructionRecord[]> } | null = null

  constructor(path: string) {
    this.path = path
  }

  /** 그 세션이 받은 지시. 파일이 없거나 못 읽으면 [] */
  async recordsOf(sessionId: string): Promise<InstructionRecord[]> {
    let stats: { size: number; mtimeMs: number }
    try {
      stats = await stat(this.path)
    } catch {
      this.file = null
      return []
    }
    if (!this.file || this.file.size !== stats.size || this.file.mtimeMs !== stats.mtimeMs) {
      // stat 을 읽기 전에 했으므로 그 사이 덧붙은 것은 다음 번에 크기가 달라 다시 읽는다
      const text = await readFile(this.path, 'utf8').catch(() => null)
      this.file = text === null ? null : { size: stats.size, mtimeMs: stats.mtimeMs, text, bySession: new Map() }
      if (!this.file) return []
    }
    let records = this.file.bySession.get(sessionId)
    if (!records) {
      records = parseInstructionLog(this.file.text, sessionId)
      this.file.bySession.set(sessionId, records)
    }
    return records
  }
}
