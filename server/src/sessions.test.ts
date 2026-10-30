import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isBusy } from './switchImpact.js'
import type { TurnEndFacts } from './turnEnd.js'
import { summarizeTranscript, type TurnOutcome } from './transcript.js'
import { runningBackgroundTasks, runningShells } from './shells.js'
import { compareByCreatedAt, displayStatus, sessionStatus, TranscriptCache } from './sessions.js'
import type { HookState } from './hookState.js'

const SESSION = 'a56abbde-182b-475e-ab39-c3cf9c7933a7'
const OTHER = 'b71b8d90-4669-4e3c-ac7d-3bb381806d49'
/** 크기·수정 시각이 같은데 내용만 다른 파일을 만들려고 수정 시각을 이 값으로 고정한다 */
const FIXED_TIME = new Date('2026-01-01T00:00:00Z')

function titleLine(title: string): string {
  return `${JSON.stringify({ type: 'ai-title', aiTitle: title })}\n`
}

describe('TranscriptCache', () => {
  let projects: string
  let cache: TranscriptCache

  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'pray-transcripts-'))
    mkdirSync(join(projects, 'D--a'))
    mkdirSync(join(projects, 'D--b'))
    cache = new TranscriptCache(projects)
  })

  afterEach(() => {
    rmSync(projects, { recursive: true, force: true })
  })

  /** 같은 길이의 제목으로 덮어쓰고 수정 시각을 고정한다 — 캐시가 있으면 바뀐 것을 모른다 */
  function writeSameStat(path: string, title: string): void {
    writeFileSync(path, titleLine(title))
    utimesSync(path, FIXED_TIME, FIXED_TIME)
  }

  it('does not re-read a file whose size and mtime are unchanged', async () => {
    const path = join(projects, 'D--b', `${SESSION}.jsonl`)
    writeSameStat(path, 'AAAA')
    expect((await cache.summarize(SESSION))?.title).toBe('AAAA')
    writeSameStat(path, 'BBBB')
    expect((await cache.summarize(SESSION))?.title).toBe('AAAA')
    // 내용 전체를 주는 read 는 캐시한 요약과 상관없이 늘 읽는다
    expect(await cache.read(SESSION)).toBe(titleLine('BBBB'))
  })

  it('re-reads after an append and returns the new summary', async () => {
    const path = join(projects, 'D--a', `${SESSION}.jsonl`)
    writeSameStat(path, 'first')
    expect((await cache.summarize(SESSION))?.title).toBe('first')
    appendFileSync(path, titleLine('second'))
    expect((await cache.summarize(SESSION))?.title).toBe('second')
  })

  it('finds a file created after a lookup that found nothing', async () => {
    expect(await cache.summarize(SESSION)).toBeNull()
    expect(await cache.read(SESSION)).toBeNull()
    writeFileSync(join(projects, 'D--b', `${SESSION}.jsonl`), titleLine('late'))
    expect((await cache.summarize(SESSION))?.title).toBe('late')
  })

  it('looks again when the remembered path is gone', async () => {
    const path = join(projects, 'D--a', `${SESSION}.jsonl`)
    writeSameStat(path, 'AAAA')
    expect((await cache.summarize(SESSION))?.title).toBe('AAAA')
    const moved = join(projects, 'D--b', `${SESSION}.jsonl`)
    renameSync(path, moved)
    writeSameStat(moved, 'BBBB')
    expect((await cache.summarize(SESSION))?.title).toBe('BBBB')
    rmSync(moved)
    expect(await cache.summarize(SESSION)).toBeNull()
    expect(await cache.read(SESSION)).toBeNull()
  })

  it('drops sessions missing from the list', async () => {
    const path = join(projects, 'D--a', `${SESSION}.jsonl`)
    const otherPath = join(projects, 'D--a', `${OTHER}.jsonl`)
    writeSameStat(path, 'AAAA')
    writeSameStat(otherPath, 'AAAA')
    await cache.summarize(SESSION)
    await cache.summarize(OTHER)
    writeSameStat(path, 'BBBB')
    writeSameStat(otherPath, 'BBBB')
    cache.retain(new Set([OTHER]))
    // 지운 세션은 크기·수정 시각이 같아도 다시 읽고, 남긴 세션은 캐시 그대로다
    expect((await cache.summarize(SESSION))?.title).toBe('BBBB')
    expect((await cache.summarize(OTHER))?.title).toBe('AAAA')
  })

  it('keeps running background shells next to the summary and updates them after an append', async () => {
    const path = join(projects, 'D--a', `${SESSION}.jsonl`)
    const input = { command: 'npx vite', run_in_background: true }
    const call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input }] } }
    const text = 'Command running in background with ID: b1. Output is being written to: C:\\t\\b1.output.'
    const result = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] },
      toolUseResult: { backgroundTaskId: 'b1' },
    }
    writeFileSync(path, `${JSON.stringify(call)}\n${JSON.stringify(result)}\n`)
    expect((await cache.analyze(SESSION))?.shells.map((s) => s.id)).toEqual(['b1'])
    expect((await cache.analyze(SESSION))?.backgroundTasks.map((t) => [t.id, t.kind])).toEqual([['b1', 'shell']])
    const done = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'
    appendFileSync(path, `${JSON.stringify({ type: 'user', message: { content: done } })}\n`)
    expect((await cache.analyze(SESSION))?.shells).toEqual([])
    expect((await cache.analyze(SESSION))?.backgroundTasks).toEqual([])
  })
})

/** 덧붙여 읽기 시험용 jsonl: 한국어·이모지(멀티바이트)·백그라운드 shell·MCP·에이전트·끝 알림·프로세스 경계·압축·스트리밍 조각 */
function sampleJsonl(): string {
  const lines: unknown[] = [
    { type: 'ai-title', aiTitle: '긴 한국어 제목 🙂' },
    { type: 'user', timestamp: '2026-10-30T01:00:00Z', message: { role: 'user', content: '안녕하세요 — 서버를 띄워 줘' } },
    {
      type: 'assistant',
      timestamp: '2026-10-30T01:00:01Z',
      message: {
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npx vite', description: '개발 서버 띄우기', run_in_background: true } }],
      },
    },
    {
      type: 'user',
      timestamp: '2026-10-30T01:00:02Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Command running in background with ID: b1. Output is being written to: C:\\t\\b1.output' }] },
      toolUseResult: { backgroundTaskId: 'b1' },
    },
    {
      type: 'assistant',
      timestamp: '2026-10-30T01:00:03Z',
      message: {
        model: 'claude-opus-5-5',
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'm1', name: 'mcp__pray__team_wait', input: {} },
          { type: 'tool_use', id: 'a1', name: 'Agent', input: {} },
        ],
      },
    },
    {
      type: 'user',
      timestamp: '2026-10-30T01:02:03Z',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'm1', content: 'MCP tool "pray/team_wait" is still running after 120s. It was moved to the background as task w1 and keeps running' },
        ],
      },
    },
    {
      type: 'user',
      timestamp: '2026-10-30T01:02:04Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: '에이전트 시작 g1' }] },
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'g1' },
    },
    {
      type: 'assistant',
      timestamp: '2026-10-30T01:02:05Z',
      perTurnEffort: 'high',
      message: {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, cache_read_input_tokens: 1000 },
        content: [{ type: 'text', text: '띄웠습니다. 다음은 무엇을 할까요? 🚀' }],
      },
    },
    { type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>' },
    { type: 'user', timestamp: '2026-10-30T01:03:00Z', message: { content: '<task-notification>\n<task-id>g1</task-id>\n<status>completed</status>\n</task-notification>' } },
    { type: 'cost-state', timestamp: '2026-10-30T01:04:00Z' },
    { type: 'user', timestamp: '2026-10-30T02:00:00Z', message: { role: 'user', content: '다시 이어서 — 한글 ✓' } },
    { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-30T02:00:01Z' },
    { type: 'assistant', timestamp: '2026-10-30T02:00:02Z', message: { model: 'claude-haiku-5-5', stop_reason: null, content: [{ type: 'text', text: '조각 응답' }] } },
  ]
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n{"broken\n`
}

/** 내용 전체를 한 번에 해석한 결과 (TranscriptCache.analyze 와 같아야 한다) */
function analyzeWhole(jsonl: string) {
  return { summary: summarizeTranscript(jsonl), shells: runningShells(jsonl), backgroundTasks: runningBackgroundTasks(jsonl) }
}

describe('TranscriptCache appends', () => {
  let projects: string
  let path: string

  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'pray-transcripts-'))
    mkdirSync(join(projects, 'D--a'))
    path = join(projects, 'D--a', `${SESSION}.jsonl`)
  })

  afterEach(() => {
    rmSync(projects, { recursive: true, force: true })
  })

  /** bytes 를 cuts 위치에서 잘라 덧붙여 가며 매번 analyze 가 지금까지 내용을 한 번에 해석한 것과 같은지 본다 */
  async function expectSameAsWhole(cache: TranscriptCache, bytes: Buffer, cuts: number[]): Promise<void> {
    writeFileSync(path, '')
    let written = 0
    for (const cut of [...cuts, bytes.length]) {
      appendFileSync(path, bytes.subarray(written, cut))
      written = cut
      expect(await cache.analyze(SESSION)).toEqual(analyzeWhole(bytes.subarray(0, cut).toString('utf8')))
    }
  }

  it('matches a whole read when the file grows a few bytes at a time, cutting lines and multibyte characters', async () => {
    const bytes = Buffer.from(sampleJsonl())
    const cuts = Array.from({ length: Math.floor(bytes.length / 7) }, (_, index) => (index + 1) * 7)
    // 읽는 조각(5바이트)보다 긴 줄도 이어 붙여 읽는다
    await expectSameAsWhole(new TranscriptCache(projects, 5), bytes, cuts)
  })

  it('matches a whole read when cut right inside multibyte characters and at line ends', async () => {
    const text = sampleJsonl()
    const bytes = Buffer.from(text)
    const insideCharacters = ['안', '🙂', '—', '✓', '🚀'].flatMap((character) => {
      const start = Buffer.byteLength(text.slice(0, text.indexOf(character)))
      return Array.from({ length: Buffer.byteLength(character) - 1 }, (_, offset) => start + offset + 1)
    })
    const lineEnds = [...text.matchAll(/\n/g)].map((match) => Buffer.byteLength(text.slice(0, match.index)) + 1)
    await expectSameAsWhole(new TranscriptCache(projects), bytes, [...insideCharacters, ...lineEnds].sort((a, b) => a - b))
  })

  it('reads only the appended bytes when the bytes before the last end are unchanged', async () => {
    const cache = new TranscriptCache(projects)
    const padLine = `{"pad":"${'x'.repeat(400)}"}\n`
    writeFileSync(path, `${titleLine('AAAA')}${padLine}`)
    expect((await cache.summarize(SESSION))?.title).toBe('AAAA')
    // 앞 줄을 같은 길이로 바꾸고 덧붙인다 — 덧붙은 것만 읽으므로 바뀐 앞 줄은 모른다 (jsonl 은 덧붙기만 한다)
    const appended = `${JSON.stringify({ type: 'user', timestamp: '2026-10-30T03:00:00Z', message: { content: 'hi' } })}\n`
    writeFileSync(path, `${titleLine('BBBB')}${padLine}${appended}`)
    const summary = await cache.summarize(SESSION)
    expect(summary?.title).toBe('AAAA')
    expect(summary?.lastAt).toBe('2026-10-30T03:00:00Z')
  })

  it('reads from the start when the file shrank', async () => {
    const cache = new TranscriptCache(projects)
    const text = sampleJsonl()
    writeFileSync(path, text)
    expect(await cache.analyze(SESSION)).toEqual(analyzeWhole(text))
    const shorter = titleLine('짧은 파일')
    writeFileSync(path, shorter)
    expect(await cache.analyze(SESSION)).toEqual(analyzeWhole(shorter))
  })

  it('reads from the start when the bytes before the last end changed (another file)', async () => {
    const cache = new TranscriptCache(projects)
    writeFileSync(path, titleLine('first'))
    expect((await cache.summarize(SESSION))?.title).toBe('first')
    const other = sampleJsonl()
    writeFileSync(path, other)
    expect(await cache.analyze(SESSION)).toEqual(analyzeWhole(other))
  })

  it('applies appended lines once when two reads run at the same time', async () => {
    const cache = new TranscriptCache(projects)
    const bytes = Buffer.from(sampleJsonl())
    const half = bytes.indexOf('\n', bytes.length / 2) + 1
    writeFileSync(path, bytes.subarray(0, half))
    await cache.analyze(SESSION)
    appendFileSync(path, bytes.subarray(half))
    const [first, second] = await Promise.all([cache.analyze(SESSION), cache.analyze(SESSION)])
    expect(first).toEqual(analyzeWhole(bytes.toString('utf8')))
    expect(second).toEqual(first)
  })

  it('does not change a result it gave earlier when later lines end running tasks', async () => {
    const cache = new TranscriptCache(projects)
    const text = sampleJsonl()
    const beforeNotification = text.indexOf('{"type":"queue-operation"')
    writeFileSync(path, text.slice(0, beforeNotification))
    const earlier = await cache.analyze(SESSION)
    expect(earlier?.backgroundTasks.map((task) => task.id)).toEqual(['b1', 'w1', 'g1'])
    const snapshot = structuredClone(earlier)
    appendFileSync(path, text.slice(beforeNotification))
    expect((await cache.analyze(SESSION))?.backgroundTasks).toEqual([])
    expect(earlier).toEqual(snapshot)
  })
})

describe('displayStatus', () => {
  const hook = (status: HookState['status'], statusBeforeEnd: HookState['statusBeforeEnd'] = null): HookState => ({
    status,
    cwd: 'D:/x',
    lastAssistantText: '마지막 말',
    pendingTool: null,
    updatedAt: '2026-10-22T00:00:00.000Z',
    workingSince: null,
    statusBeforeEnd,
    lastPromptAt: null,
    isInterrupted: false,
  })

  it('shows a present session that ended before resume as my-turn or idle', () => {
    expect(displayStatus(hook('ended', 'my-turn'), 'present')).toBe('my-turn')
    expect(displayStatus(hook('ended', 'working'), 'present')).toBe('idle')
    expect(displayStatus(hook('ended', 'needs-approval'), 'present')).toBe('idle')
    expect(displayStatus(hook('ended', null), 'present')).toBe('idle')
  })

  it('keeps the hook status for break and off sessions and for other statuses', () => {
    expect(displayStatus(hook('ended', 'my-turn'), 'break')).toBe('ended')
    expect(displayStatus(hook('ended', 'my-turn'), 'off')).toBe('ended')
    expect(displayStatus(hook('working'), 'present')).toBe('working')
    expect(displayStatus(undefined, 'present')).toBe('unknown')
  })
})

describe('sessionStatus', () => {
  const hook = (status: HookState['status'], statusBeforeEnd: HookState['statusBeforeEnd'] = null): HookState => ({
    status,
    cwd: 'D:/x',
    lastAssistantText: '끝냈습니다.',
    pendingTool: null,
    updatedAt: '2026-10-22T00:00:00.000Z',
    workingSince: null,
    statusBeforeEnd,
    lastPromptAt: null,
    isInterrupted: false,
  })
  const facts = (overrides: { hasRunningBackground?: boolean; lastAssistantText?: string | null } = {}) => () => ({
    hasRunningBackground: false,
    latestTask: null,
    lastAssistantText: '끝냈습니다.',
    ...overrides,
  })

  it('splits a present my-turn session, including one that ended before resume', () => {
    expect(sessionStatus(hook('my-turn'), 'present', facts())).toBe('done')
    expect(sessionStatus(hook('my-turn'), 'present', facts({ hasRunningBackground: true }))).toBe('waiting')
    expect(sessionStatus(hook('my-turn'), 'present', facts({ lastAssistantText: '어느 쪽으로 할까요?' }))).toBe('my-turn')
    expect(sessionStatus(hook('ended', 'my-turn'), 'present', facts())).toBe('done')
    expect(sessionStatus({ ...hook('my-turn'), isInterrupted: true }, 'present', facts())).toBe('my-turn')
  })

  it('leaves other statuses, break and off sessions as displayStatus shows them', () => {
    const noFacts = () => {
      throw new Error('should not be called')
    }
    expect(sessionStatus(hook('working'), 'present', noFacts)).toBe('working')
    expect(sessionStatus(hook('ended', 'working'), 'present', noFacts)).toBe('idle')
    expect(sessionStatus(hook('my-turn'), 'break', noFacts)).toBe('my-turn')
    expect(sessionStatus(hook('ended', 'my-turn'), 'off', noFacts)).toBe('ended')
    expect(sessionStatus(undefined, 'present', noFacts)).toBe('unknown')
  })
})

describe('sessionStatus from the transcript turn', () => {
  const hook = (status: HookState['status'], statusBeforeEnd: HookState['statusBeforeEnd'] = null): HookState => ({
    status,
    cwd: 'D:/x',
    lastAssistantText: '훅의 말',
    pendingTool: null,
    updatedAt: '2026-10-22T00:00:00.000Z',
    workingSince: null,
    statusBeforeEnd,
    lastPromptAt: null,
    isInterrupted: false,
  })
  const facts = (overrides: { hasRunningBackground?: boolean; latestTask?: TurnEndFacts['latestTask'] } = {}) => () => ({
    hasRunningBackground: false,
    latestTask: null,
    lastAssistantText: '훅의 말',
    ...overrides,
  })
  const turn = (kind: TurnOutcome['kind'], text: string | null = null): TurnOutcome => ({ kind, text })
  const ended = turn('ended', '끝냈습니다.')
  const status = (h: HookState | undefined, t: TurnOutcome | null, f = facts()) => sessionStatus(h, 'present', f, t)

  describe.each([
    ['no hook state', undefined],
    ['unknown', hook('unknown')],
  ])('%s', (_name, h) => {
    it('applies the turnEnd rules to the transcript text when the turn ended', () => {
      expect(status(h, ended)).toBe('done')
      expect(status(h, turn('ended', '어느 쪽으로 할까요?'))).toBe('my-turn')
      expect(status(h, turn('ended', null))).toBe('my-turn')
      expect(status(h, ended, facts({ hasRunningBackground: true }))).toBe('waiting')
      expect(status(h, ended, facts({ latestTask: { status: 'done', finishedAt: '2026-10-22T00:00:00.000Z' } }))).toBe('done')
    })

    it('shows interrupted and cut turns as my-turn, a turn in progress as working, no conversation as before', () => {
      expect(status(h, turn('interrupted'))).toBe('my-turn')
      expect(status(h, turn('cut'))).toBe('my-turn')
      expect(status(h, turn('in-progress'))).toBe('working')
      expect(status(h, turn('none'))).toBe('unknown')
      expect(status(h, null)).toBe('unknown')
    })
  })

  describe.each([
    ['null', null],
    ['unknown', 'unknown'],
    ['idle', 'idle'],
    ['working', 'working'],
    ['needs-approval', 'needs-approval'],
  ] as const)('ended after a restart, statusBeforeEnd %s', (_name, before) => {
    const h = hook('ended', before)
    it('applies the turnEnd rules when the turn ended', () => {
      expect(status(h, ended)).toBe('done')
      expect(status(h, turn('ended', '진행할까요?'))).toBe('my-turn')
      expect(status(h, ended, facts({ hasRunningBackground: true }))).toBe('waiting')
    })

    it('shows a turn the restart cut off as my-turn, and no conversation as idle', () => {
      expect(status(h, turn('interrupted'))).toBe('my-turn')
      expect(status(h, turn('cut'))).toBe('my-turn')
      expect(status(h, turn('in-progress'))).toBe('my-turn')
      expect(status(h, turn('none'))).toBe('idle')
      expect(status(h, null)).toBe('idle')
    })
  })

  it('keeps the existing path for ended with statusBeforeEnd my-turn (hook text, not the transcript)', () => {
    expect(status(hook('ended', 'my-turn'), turn('cut'))).toBe('done')
    expect(status(hook('ended', 'my-turn'), ended, facts())).toBe('done')
  })

  it('does not use the transcript when the hook state is a normal one, nor for break and off sessions', () => {
    expect(status(hook('working'), turn('ended', '끝'))).toBe('working')
    expect(status(hook('idle'), turn('cut'))).toBe('idle')
    expect(status(hook('needs-approval'), ended)).toBe('needs-approval')
    expect(status(hook('my-turn'), turn('cut'))).toBe('done')
    expect(sessionStatus(undefined, 'break', facts(), turn('cut'))).toBe('unknown')
    expect(sessionStatus(hook('ended'), 'off', facts(), turn('cut'))).toBe('ended')
  })

  it('makes a session whose transcript says it is working busy', () => {
    expect(isBusy({ attendance: 'present', status: status(undefined, turn('in-progress')) })).toBe(true)
    expect(isBusy({ attendance: 'present', status: status(hook('ended'), turn('in-progress')) })).toBe(false)
  })
})

describe('compareByCreatedAt', () => {
  const sort = (items: { id: string; createdAt: string | null }[]) => [...items].sort(compareByCreatedAt).map((item) => item.id)

  it('puts older sessions first', () => {
    expect(
      sort([
        { id: 'c', createdAt: '2026-10-22T00:00:00.000Z' },
        { id: 'a', createdAt: '2026-10-20T00:00:00.000Z' },
        { id: 'b', createdAt: '2026-10-21T00:00:00.000Z' },
      ]),
    ).toEqual(['a', 'b', 'c'])
  })

  it('puts unknown and unparsable times last', () => {
    expect(
      sort([
        { id: 'a', createdAt: null },
        { id: 'b', createdAt: 'nope' },
        { id: 'c', createdAt: '' },
        { id: 'd', createdAt: '2026-10-20T00:00:00Z' },
      ]),
    ).toEqual(['d', 'a', 'b', 'c'])
  })

  it('breaks ties by id', () => {
    expect(
      sort([
        { id: 'b', createdAt: '2026-10-20T00:00:00Z' },
        { id: 'a', createdAt: '2026-10-20T00:00:00.000Z' },
      ]),
    ).toEqual(['a', 'b'])
  })

  it('compares as times, not strings (milliseconds and offsets)', () => {
    expect(
      sort([
        { id: 'late', createdAt: '2026-10-20T00:00:00.500Z' },
        { id: 'early', createdAt: '2026-10-20T00:00:00Z' },
        { id: 'offset', createdAt: '2026-10-20T09:00:00.200+09:00' },
      ]),
    ).toEqual(['early', 'offset', 'late'])
  })
})
