import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  contentTypeOf,
  findScratchpad,
  isInside,
  isSafeRelativePath,
  isSessionId,
  listScratchpad,
  resolveScratchpadFile,
} from './scratchpad.js'

const SESSION = 'a56abbde-182b-475e-ab39-c3cf9c7933a7'
const OTHER = 'b71b8d90-4669-4e3c-ac7d-3bb381806d49'

describe('scratchpad path checks', () => {
  it('accepts only uuid session ids', () => {
    expect(isSessionId(SESSION)).toBe(true)
    expect(isSessionId('..')).toBe(false)
    expect(isSessionId(`${SESSION}/..`)).toBe(false)
    expect(isSessionId('a56abbde')).toBe(false)
  })

  it('rejects empty, NUL, colon (drive letter, alternate stream) and absolute paths', () => {
    expect(isSafeRelativePath('shots/a.png')).toBe(true)
    expect(isSafeRelativePath('..\\..\\x')).toBe(true) // 꼴은 통과. 밖으로 나가는지는 resolveScratchpadFile 이 본다
    for (const path of ['', 'a\0b', 'C:\\Windows\\win.ini', 'C:win.ini', 'a.txt:stream', '/etc/passwd', '\\\\server\\share\\x', '\\Windows']) {
      expect(isSafeRelativePath(path), path).toBe(false)
    }
  })

  it('isInside excludes the root itself, parents and siblings with the same prefix', () => {
    expect(isInside('C:\\t\\pad', 'C:\\t\\pad\\a\\b.txt')).toBe(true)
    expect(isInside('C:\\t\\pad', 'c:\\T\\PAD\\a.txt')).toBe(true)
    expect(isInside('C:\\t\\pad', 'C:\\t\\pad')).toBe(false)
    expect(isInside('C:\\t\\pad', 'C:\\t\\pad2\\a.txt')).toBe(false)
    expect(isInside('C:\\t\\pad', 'C:\\t\\a.txt')).toBe(false)
    expect(isInside('C:\\t\\pad', 'D:\\t\\pad\\a.txt')).toBe(false)
    expect(isInside('C:\\t\\pad', 'C:\\t\\pad\\..foo')).toBe(true)
  })

  it('maps extensions to content types and marks script-capable ones', () => {
    expect(contentTypeOf('a.PNG')).toEqual({ type: 'image/png', isActive: false })
    expect(contentTypeOf('a.ts')).toEqual({ type: 'text/plain; charset=utf-8', isActive: false })
    expect(contentTypeOf('a.html')).toEqual({ type: 'text/html; charset=utf-8', isActive: true })
    expect(contentTypeOf('a.svg').isActive).toBe(true)
    expect(contentTypeOf('a.xml').isActive).toBe(true)
    expect(contentTypeOf('a.pdf')).toEqual({ type: 'application/pdf', isActive: false })
    expect(contentTypeOf('a.exe')).toEqual({ type: 'application/octet-stream', isActive: false })
    expect(contentTypeOf('Makefile')).toEqual({ type: 'application/octet-stream', isActive: false })
  })
})

describe('scratchpad on disk', () => {
  // <base>/proj/<SESSION>/scratchpad, 옆 세션 <base>/proj/<OTHER>/scratchpad, base 밖 <outside>
  let base: string
  let outside: string
  let pad: string
  let hasJunction = true

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'jk-scratch-test-'))
    outside = mkdtempSync(join(tmpdir(), 'jk-scratch-outside-'))
    pad = join(base, 'proj', SESSION, 'scratchpad')
    mkdirSync(join(pad, 'shots', 'deep'), { recursive: true })
    mkdirSync(join(base, 'proj', OTHER, 'scratchpad'), { recursive: true })
    writeFileSync(join(pad, 'note.md'), '# 메모')
    writeFileSync(join(pad, 'shots', 'a.png'), 'png')
    writeFileSync(join(pad, 'shots', 'deep', 'b.txt'), 'deep')
    writeFileSync(join(base, 'proj', OTHER, 'scratchpad', 'secret.txt'), 'other session')
    writeFileSync(join(outside, 'secret.txt'), 'outside')
    try {
      // junction 은 Windows 에서 관리자 권한 없이 만들 수 있다
      symlinkSync(outside, join(pad, 'escape'), 'junction')
    } catch {
      hasJunction = false
    }
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('finds the session scratchpad by id and nothing for unknown or malformed ids', async () => {
    expect(await findScratchpad(SESSION, base)).toMatch(/scratchpad$/)
    expect(await findScratchpad('00000000-0000-0000-0000-000000000000', base)).toBeNull()
    expect(await findScratchpad('..', base)).toBeNull()
  })

  it('lists files shallow-first with forward slashes, skips junctions, stops at the limit', async () => {
    const real = (await findScratchpad(SESSION, base))!
    const { files, isTruncated } = await listScratchpad(real)
    expect(files.map((f) => f.path)).toEqual(['note.md', 'shots/a.png', 'shots/deep/b.txt'])
    expect(isTruncated).toBe(false)
    expect(files[0]).toMatchObject({ size: 8 })
    expect(Date.parse(files[0].modifiedAt)).not.toBeNaN()
    expect(await listScratchpad(real, 2)).toEqual({ files: files.slice(0, 2), isTruncated: true })
  })

  it('resolves files inside and rejects escapes', async () => {
    const real = (await findScratchpad(SESSION, base))!
    expect(await resolveScratchpadFile(real, 'shots/deep/b.txt')).toBe(join(real, 'shots', 'deep', 'b.txt'))
    expect(await resolveScratchpadFile(real, 'shots\\a.png')).toBe(join(real, 'shots', 'a.png'))
    const rejected = [
      '..\\..\\..\\secret.txt',
      '../../' + OTHER + '/scratchpad/secret.txt',
      join(outside, 'secret.txt'),
      'shots/../../scratchpad2/x',
      'missing.txt',
      'shots',
      '.',
      'note.md:hidden',
    ]
    for (const path of rejected) expect(await resolveScratchpadFile(real, path), path).toBeNull()
  })

  it('rejects paths that leave through a junction', async () => {
    if (!hasJunction) return
    const real = (await findScratchpad(SESSION, base))!
    expect(await resolveScratchpadFile(real, 'escape/secret.txt')).toBeNull()
  })
})
