import { Worker } from 'node:worker_threads'

/**
 * 세션 작업 폴더(cwd) 전체 내용 찾기 (화면 Files 탭의 Search). 읽기만 한다.
 * 찾기는 worker 스레드(`workspaceSearchWorker.ts`)에서 돌린다 — 사용자 정규식의 파국적 되돌아가기(`(a+)+$` 등)가
 * 서버 이벤트 루프를 멈추지 않게, 시간을 넘기면 worker 를 terminate() 한다. 이 파일의 나머지는 순수 함수다
 */

export interface SearchOptions {
  query: string
  isCaseSensitive: boolean
  isWholeWord: boolean
  isRegex: boolean
}

/** 검색어 길이 상한 */
export const MAX_QUERY_CHARS = 500
/** 맞은 곳 상한 (넘으면 멈추고 isTruncated) */
export const MAX_MATCHES = 2000
/** 요청 전체(파일 목록 받기 포함) 시간 상한 */
export const SEARCH_TIME_LIMIT_MS = 5000
/** 결과 줄 글 길이 상한 (넘는 줄은 첫 맞은 곳 근처로 자른다) */
export const MAX_PREVIEW_CHARS = 300
/** 자른 줄에서 첫 맞은 곳 앞에 남기는 글자 수 */
const PREVIEW_LEAD_CHARS = 40
/** worker 가 스스로 멈추지 못할 때(정규식 한 번이 끝나지 않을 때) 기다려 주는 여유 */
const TERMINATE_GRACE_MS = 300

/** 켜고 끄는 쿼리 값: 없음·`0`·`false` = 끔, `1`·`true` = 켬, 그 밖(배열 포함)은 null */
function parseFlag(value: unknown): boolean | null {
  if (value === undefined || value === '0' || value === 'false') return false
  if (value === '1' || value === 'true') return true
  return null
}

/** `?q=&case=&word=&regex=` → 찾기 옵션. q 는 1~500자 글(공백도 찾는다). 틀리면 영어 문구 */
export function parseSearchQuery(query: Record<string, unknown>): SearchOptions | { message: string } {
  const { q } = query
  if (typeof q !== 'string' || q.length === 0 || q.length > MAX_QUERY_CHARS) return { message: `Query must be 1 to ${MAX_QUERY_CHARS} characters` }
  const isCaseSensitive = parseFlag(query.case)
  const isWholeWord = parseFlag(query.word)
  const isRegex = parseFlag(query.regex)
  if (isCaseSensitive === null || isWholeWord === null || isRegex === null) return { message: 'case, word and regex must be 0 or 1' }
  return { query: q, isCaseSensitive, isWholeWord, isRegex }
}

/** 정규식 문법 오류 (화면에 400 으로) */
export class SearchPatternError extends Error {}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * 검색어 → 정규식 (g·u, 대소문자 무시면 i). 정규식이 아니면 글자 그대로.
 * 낱말 단위는 앞뒤가 글자(모든 언어)·숫자·`_` 가 아닐 때만 — `\b` 는 ASCII 만 알아 한글 낱말 경계를 못 본다
 */
export function buildSearchPattern({ query, isCaseSensitive, isWholeWord, isRegex }: SearchOptions): RegExp {
  const source = isRegex ? query : escapeRegExp(query)
  const wrapped = isWholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source
  try {
    return new RegExp(wrapped, isCaseSensitive ? 'gu' : 'giu')
  } catch (error) {
    throw new SearchPatternError((error as Error).message)
  }
}

/** 한 줄에서 맞은 곳들의 [시작, 끝) (UTF-16 위치). 빈 일치(`^`·`a*` 등)는 세지 않는다. limit 개에서 멈춘다 */
export function findInLine(pattern: RegExp, text: string, limit: number): [number, number][] {
  const ranges: [number, number][] = []
  pattern.lastIndex = 0
  while (ranges.length < limit) {
    const match = pattern.exec(text)
    if (!match) break
    if (match[0].length === 0) {
      if (match.index >= text.length) break
      pattern.lastIndex = match.index + ((text.codePointAt(match.index) ?? 0) > 0xffff ? 2 : 1)
      continue
    }
    ranges.push([match.index, match.index + match[0].length])
  }
  return ranges
}

/** 결과 한 줄. column = text 가 원래 줄의 몇 번째 글자부터인지 (0 이면 줄 처음부터), hasMoreAfter = 줄이 text 뒤로 더 있다 */
export interface LineMatch {
  line: number
  column: number
  text: string
  ranges: [number, number][]
  hasMoreAfter: boolean
}

/** 서로게이트 쌍 가운데를 자르지 않게 위치를 앞으로 당긴다 */
function codePointBoundary(text: string, at: number): number {
  const code = text.charCodeAt(at)
  return at > 0 && at < text.length && code >= 0xdc00 && code <= 0xdfff ? at - 1 : at
}

/**
 * 긴 줄을 첫 맞은 곳이 들어가게 maxChars 자로 자르고 ranges 를 그 안 위치로 옮긴다 (밖은 빼고 걸친 것은 자른다).
 * 첫 맞은 곳 앞에 PREVIEW_LEAD_CHARS 자를 남기고, 맞은 곳이 maxChars 보다 길면 그 시작부터. 줄 끝 가까이면 끝까지 보이게 앞으로 당긴다
 */
export function previewLine(text: string, ranges: [number, number][], maxChars = MAX_PREVIEW_CHARS): Omit<LineMatch, 'line'> {
  if (text.length <= maxChars) return { column: 0, text, ranges, hasMoreAfter: false }
  const [firstStart, firstEnd] = ranges[0] ?? [0, 0]
  let start = Math.max(0, firstStart - PREVIEW_LEAD_CHARS)
  if (firstEnd - start > maxChars) start = firstStart
  if (start + maxChars > text.length) start = Math.max(0, text.length - maxChars)
  start = codePointBoundary(text, start)
  const end = codePointBoundary(text, Math.min(text.length, start + maxChars))
  const shown = ranges
    .filter(([from, to]) => from < end && to > start)
    .map(([from, to]): [number, number] => [Math.max(from, start) - start, Math.min(to, end) - start])
  return { column: start, text: text.slice(start, end), ranges: shown, hasMoreAfter: end < text.length }
}

/** 몇 줄마다 시간을 볼지 */
const STOP_CHECK_LINES = 256

/**
 * 파일 글 하나에서 찾기. 줄은 `\n` 으로 나누고 CR 은 지운다 (화면 코드 보기의 줄 번호·글과 같다).
 * maxMatches 개에서 멈추고, shouldStop 이 참이면(시간 상한) 거기까지만 — isStopped. matchCount 는 자른 줄 밖에서 맞은 것도 센 수
 */
export function searchText(
  text: string,
  pattern: RegExp,
  maxMatches: number,
  shouldStop: () => boolean = () => false,
): { lines: LineMatch[]; matchCount: number; isStopped: boolean } {
  const lines: LineMatch[] = []
  let matchCount = 0
  let lineStart = 0
  for (let number = 1; lineStart <= text.length && matchCount < maxMatches; number++) {
    if (number % STOP_CHECK_LINES === 0 && shouldStop()) return { lines, matchCount, isStopped: true }
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const raw = text.slice(lineStart, lineEnd)
    const line = raw.includes('\r') ? raw.replace(/\r/g, '') : raw
    const ranges = findInLine(pattern, line, maxMatches - matchCount)
    if (ranges.length > 0) {
      matchCount += ranges.length
      lines.push({ line: number, ...previewLine(line, ranges) })
    }
    if (newline === -1) break
    lineStart = newline + 1
  }
  return { lines, matchCount, isStopped: false }
}

export interface SearchFileResult {
  path: string
  matchCount: number
  matches: LineMatch[]
}

/** worker 에 넘기는 일 */
export interface SearchJob {
  root: string
  paths: string[]
  options: SearchOptions
  maxMatches: number
  /** worker 가 스스로 멈추는 시간 (파일 사이·줄 사이에서 본다) */
  timeLimitMs: number
}

/** worker → 서버 메시지 */
export type SearchWorkerMessage =
  | { type: 'file'; file: SearchFileResult; searchedFileCount: number }
  | { type: 'progress'; searchedFileCount: number }
  | { type: 'done'; searchedFileCount: number; isTruncated: boolean }

export interface SearchRunResult {
  files: SearchFileResult[]
  matchCount: number
  searchedFileCount: number
  /** 맞은 곳 상한·시간 상한에 걸려 멈췄다 */
  isTruncated: boolean
  /** signal 로 멈췄다 (같은 세션의 새 검색·요청 끊김) */
  isCancelled: boolean
}

const fileCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** 결과 파일 순서: 경로순 (훑기는 얕은 폴더부터라 그대로 두면 폴더가 섞인다) */
export function sortSearchFiles(files: SearchFileResult[]): SearchFileResult[] {
  return [...files].sort((a, b) => fileCollator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * worker 스레드로 찾기. job.timeLimitMs 에 worker 가 스스로 멈추고, 정규식 한 번이 끝나지 않아 못 멈추면 조금 더 기다린 뒤 terminate() 한다.
 * 그때까지 worker 가 보낸 파일 결과는 남긴다 (isTruncated). signal 이 끊으면 바로 terminate() 하고 isCancelled.
 * worker 파일은 이 파일 옆의 .ts 다 — 서버는 늘 tsx(`node --import tsx`·`tsx watch`)로 돌고 Worker 는 그 execArgv 를 물려받는다
 */
export function runSearchWorker(job: SearchJob, signal?: AbortSignal): Promise<SearchRunResult> {
  return new Promise((resolve, reject) => {
    const files: SearchFileResult[] = []
    let matchCount = 0
    let searchedFileCount = 0
    let isSettled = false
    const worker = new Worker(new URL('./workspaceSearchWorker.ts', import.meta.url), { workerData: job })
    const settle = (result: { isTruncated: boolean; isCancelled: boolean } | Error) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      void worker.terminate()
      if (result instanceof Error) reject(result)
      else resolve({ files: sortSearchFiles(files), matchCount, searchedFileCount, ...result })
    }
    const onAbort = () => settle({ isTruncated: true, isCancelled: true })
    const timer = setTimeout(() => settle({ isTruncated: true, isCancelled: false }), job.timeLimitMs + TERMINATE_GRACE_MS)
    worker.on('message', (message: SearchWorkerMessage) => {
      if (isSettled) return
      searchedFileCount = message.searchedFileCount
      if (message.type === 'file') {
        files.push(message.file)
        matchCount += message.file.matchCount
      } else if (message.type === 'done') {
        settle({ isTruncated: message.isTruncated, isCancelled: false })
      }
    })
    worker.on('error', (error) => settle(error))
    worker.on('exit', (code) => settle(new Error(`Search worker exited (code ${code})`)))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort)
  })
}
