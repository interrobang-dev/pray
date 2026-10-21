import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TranscriptCache } from './sessions.js'

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
})
