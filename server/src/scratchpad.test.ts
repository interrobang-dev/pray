import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attachmentFileName,
  contentTypeOf,
  findScratchpad,
  isInside,
  isSafeRelativePath,
  isSessionId,
  listScratchpad,
  resolveScratchpadDir,
  resolveScratchpadFile,
  resolveSessionTempFile,
  safeAttachmentName,
  saveAttachment,
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

  it('resolves folders inside (empty path is the scratchpad itself) and rejects files and escapes', async () => {
    const real = (await findScratchpad(SESSION, base))!
    expect(await resolveScratchpadDir(real, '')).toBe(real)
    expect(await resolveScratchpadDir(real, 'shots/deep')).toBe(join(real, 'shots', 'deep'))
    const rejected = [
      '..',
      '../../' + OTHER + '/scratchpad',
      outside,
      'note.md',
      'missing',
      '.',
      'shots:hidden',
    ]
    for (const path of rejected) expect(await resolveScratchpadDir(real, path), path).toBeNull()
    if (hasJunction) expect(await resolveScratchpadDir(real, 'escape')).toBeNull()
  })

  it('rejects paths that leave through a junction', async () => {
    if (!hasJunction) return
    const real = (await findScratchpad(SESSION, base))!
    expect(await resolveScratchpadFile(real, 'escape/secret.txt')).toBeNull()
  })
})

describe('attachment names', () => {
  it('keeps the last path segment and drops traversal', () => {
    expect(safeAttachmentName('../x')).toBe('x')
    expect(safeAttachmentName('a/b')).toBe('b')
    expect(safeAttachmentName('..\\..\\Windows\\win.ini')).toBe('win.ini')
    expect(safeAttachmentName('C:\\Users\\me\\report.pdf')).toBe('report.pdf')
    expect(safeAttachmentName('dir/')).toBe('attachment')
  })

  it('replaces control and Windows-reserved characters, strips trailing dots and spaces', () => {
    expect(safeAttachmentName('a\0b\nc\x7f.txt')).toBe('a_b_c_.txt')
    expect(safeAttachmentName('C:x.txt')).toBe('C_x.txt')
    expect(safeAttachmentName('a.txt:stream')).toBe('a.txt_stream')
    expect(safeAttachmentName('<a>|"b"?*.md')).toBe('_a___b___.md')
    expect(safeAttachmentName('  notes.txt. . ')).toBe('notes.txt')
    expect(safeAttachmentName('.env')).toBe('.env')
  })

  it('uses the default name when nothing is left', () => {
    for (const raw of ['', '   ', '.', '..', '...', '../..', '/']) expect(safeAttachmentName(raw), raw).toBe('attachment')
  })

  it('keeps Korean names and normalizes decomposed (macOS) Hangul to NFC', () => {
    expect(safeAttachmentName('회의 메모.png')).toBe('회의 메모.png')
    expect(safeAttachmentName('회의'.normalize('NFD') + '.png')).toBe('회의.png')
  })

  it('cuts long names to 80 characters keeping the extension', () => {
    const cut = safeAttachmentName('가'.repeat(300) + '.png')
    expect(Array.from(cut)).toHaveLength(80)
    expect(cut).toBe('가'.repeat(76) + '.png')
    // 너무 긴 "확장자" 는 확장자로 보지 않는다
    expect(safeAttachmentName('a.' + 'b'.repeat(200))).toBe('a.' + 'b'.repeat(78))
    // 서로게이트 쌍(이모지)을 반으로 자르지 않는다
    expect(safeAttachmentName('😀'.repeat(100))).toBe('😀'.repeat(80))
  })

  it('prefixes local date-time and puts the counter after it', () => {
    const at = new Date(2026, 9, 22, 9, 5, 7)
    expect(attachmentFileName('a.png', at)).toBe('20261022-090507-a.png')
    expect(attachmentFileName('a.png', at, 2)).toBe('20261022-090507-2-a.png')
    // 장치 이름(nul·con)도 접두사가 붙어 보통 이름이 된다
    expect(attachmentFileName(safeAttachmentName('nul.txt'), at)).toBe('20261022-090507-nul.txt')
  })
})

describe('saving attachments', () => {
  let base: string
  let outside: string

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'jk-attach-test-'))
    outside = mkdtempSync(join(tmpdir(), 'jk-attach-outside-'))
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('creates attachments/, never overwrites, and the files list shows them', async () => {
    const pad = join(base, 'p1', SESSION, 'scratchpad')
    mkdirSync(pad, { recursive: true })
    const real = (await findScratchpad(SESSION, base))!
    const at = new Date(2026, 9, 22, 9, 5, 7)
    const first = await saveAttachment(real, '../보고서.pdf', Buffer.from('one'), at)
    const name = '20261022-090507-보고서.pdf'
    expect(first).toEqual({ path: join(real, 'attachments', name), name, size: 3 })
    const second = await saveAttachment(real, '보고서.pdf', Buffer.from('two!'), at)
    expect(second.name).toBe('20261022-090507-2-보고서.pdf')
    expect(readFileSync(first.path, 'utf8')).toBe('one')
    expect(readFileSync(second.path, 'utf8')).toBe('two!')
    expect((await saveAttachment(real, '', Buffer.alloc(0), at)).size).toBe(0)
    const { files } = await listScratchpad(real)
    expect(files.map((f) => f.path).sort()).toEqual([
      'attachments/20261022-090507-2-보고서.pdf',
      'attachments/20261022-090507-attachment',
      'attachments/20261022-090507-보고서.pdf',
    ])
    expect(await resolveScratchpadFile(real, `attachments/${first.name}`)).toBe(first.path)
  })

  it('refuses an attachments junction that leads outside the scratchpad', async () => {
    const pad = join(base, 'p2', OTHER, 'scratchpad')
    mkdirSync(pad, { recursive: true })
    try {
      symlinkSync(outside, join(pad, 'attachments'), 'junction')
    } catch {
      return
    }
    await expect(saveAttachment(pad, 'a.txt', Buffer.from('x'))).rejects.toThrow()
    expect(existsSync(join(outside, 'a.txt'))).toBe(false)
  })
})

describe('session temp files (background shell output)', () => {
  // <base>/proj/<SESSION>/tasks/b1.output, 옆 세션 <base>/proj/<OTHER>/tasks/b2.output, base 밖 <outside>
  let base: string
  let outside: string
  let hasJunction = true

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'jk-session-temp-'))
    outside = mkdtempSync(join(tmpdir(), 'jk-session-outside-'))
    mkdirSync(join(base, 'proj', SESSION, 'tasks'), { recursive: true })
    mkdirSync(join(base, 'proj', OTHER, 'tasks'), { recursive: true })
    writeFileSync(join(base, 'proj', SESSION, 'tasks', 'b1.output'), 'one')
    writeFileSync(join(base, 'proj', OTHER, 'tasks', 'b2.output'), 'other')
    writeFileSync(join(base, 'proj', 'loose.output'), 'not in a session folder')
    writeFileSync(join(outside, 'secret.output'), 'outside')
    try {
      symlinkSync(outside, join(base, 'proj', SESSION, 'escape'), 'junction')
    } catch {
      hasJunction = false
    }
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('accepts only files inside that session folder, by real path', async () => {
    const own = join(base, 'proj', SESSION, 'tasks', 'b1.output')
    expect(await resolveSessionTempFile(SESSION, own, base)).toMatch(/b1\.output$/)
    expect(await resolveSessionTempFile(SESSION.toUpperCase(), own.toLowerCase(), base)).toMatch(/b1\.output$/i)
    const rejected = [
      join(base, 'proj', OTHER, 'tasks', 'b2.output'),
      join(base, 'proj', 'loose.output'),
      join(outside, 'secret.output'),
      join(base, 'proj', SESSION, 'tasks', '..', '..', OTHER, 'tasks', 'b2.output'),
      join(base, 'proj', SESSION, 'tasks', 'missing.output'),
      join(base, 'proj', SESSION, 'tasks'),
      'proj/' + SESSION + '/tasks/b1.output',
    ]
    for (const path of rejected) expect(await resolveSessionTempFile(SESSION, path, base), path).toBeNull()
    expect(await resolveSessionTempFile('..', own, base)).toBeNull()
  })

  it('rejects a path that leaves through a junction', async () => {
    if (!hasJunction) return
    expect(await resolveSessionTempFile(SESSION, join(base, 'proj', SESSION, 'escape', 'secret.output'), base)).toBeNull()
  })
})
