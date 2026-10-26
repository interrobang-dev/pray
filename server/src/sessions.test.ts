import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareByCreatedAt, displayStatus, TranscriptCache } from './sessions.js'
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
    projects = mkdtempSync(join(tmpdir(), 'jk-corp-transcripts-'))
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
    const done = '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'
    appendFileSync(path, `${JSON.stringify({ type: 'user', message: { content: done } })}\n`)
    expect((await cache.analyze(SESSION))?.shells).toEqual([])
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
