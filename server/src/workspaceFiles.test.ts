import { createHash } from 'node:crypto'
import { mkdirSync,mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildFileIndex,
  compareEntries,
  decodeText,
  findFiles,
  isBinaryBuffer,
  isHiddenDir,
  isValidRequestPath,
  languageOf,
  listFolder,
  makeFileIndexCache,
  matchScore,
  readWorkspaceFile,
  resolveWorkspacePath,
} from './workspaceFiles.js'

describe('request path shape', () => {
  it('allows the root only when asked, and plain relative paths', () => {
    expect(isValidRequestPath('', true)).toBe(true)
    expect(isValidRequestPath('', false)).toBe(false)
    expect(isValidRequestPath('web/src/App.tsx', false)).toBe(true)
    expect(isValidRequestPath('../x', false)).toBe(true) // 꼴은 통과. 밖인지는 resolveWorkspacePath 가 본다
  })

  it('rejects NUL, colon (drive letter, alternate stream) and absolute paths', () => {
    for (const path of ['a\0b', 'C:\\Windows\\win.ini', 'C:win.ini', 'a.txt:stream', '/etc/passwd', '\\\\server\\share\\x', '\\Windows']) {
      expect(isValidRequestPath(path, true), path).toBe(false)
    }
  })
})

describe('workspace folder', () => {
  let base: string
  let root: string
  let outside: string

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'jk-workspace-')))
    root = join(base, 'repo')
    outside = join(base, 'outside')
    mkdirSync(join(root, 'src', 'deep'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, '.git'), { recursive: true })
    mkdirSync(join(root, 'Build'), { recursive: true })
    mkdirSync(join(root, 'b'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(root, 'src', 'deep', 'chat.ts'), 'export {}\n')
    writeFileSync(join(root, 'src', 'Chat.tsx'), 'x')
    writeFileSync(join(root, 'file10.txt'), '10')
    writeFileSync(join(root, 'file2.txt'), '2')
    writeFileSync(join(root, 'A.md'), '# a')
    writeFileSync(join(root, 'b', 'build'), 'a file named build is not hidden')
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    // junction 은 관리자 권한 없이 만들 수 있다
    symlinkSync(outside, join(root, 'out-link'), 'junction')
    symlinkSync(join(root, 'src'), join(root, 'src-link'), 'junction')
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('resolves paths inside the root and rejects ones that leave it, including through links', async () => {
    expect(await resolveWorkspacePath(root, '')).toBe(root)
    expect(await resolveWorkspacePath(root, 'src/Chat.tsx')).toBe(join(root, 'src', 'Chat.tsx'))
    expect(await resolveWorkspacePath(root, 'src\\deep\\..\\Chat.tsx')).toBe(join(root, 'src', 'Chat.tsx'))
    expect(await resolveWorkspacePath(root, '../outside/secret.txt')).toBeNull()
    expect(await resolveWorkspacePath(root, '..')).toBeNull()
    expect(await resolveWorkspacePath(root, 'out-link/secret.txt')).toBeNull()
    expect(await resolveWorkspacePath(root, 'missing.txt')).toBeNull()
    expect(await resolveWorkspacePath(root, 'src-link/Chat.tsx')).toBe(join(root, 'src', 'Chat.tsx'))
  })

  it('lists one level: folders first, natural name order, hidden folders and outside links counted', async () => {
    const listing = await listFolder(root, root)
    expect(listing.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'dir:b',
      'dir:src',
      'dir:src-link',
      'file:A.md',
      'file:file2.txt',
      'file:file10.txt',
    ])
    // .git · node_modules · Build(대소문자 무시) · 밖을 가리키는 out-link
    expect(listing.hiddenCount).toBe(4)
    expect(listing.isTruncated).toBe(false)
    expect(listing.entries.find((entry) => entry.name === 'file10.txt')).toMatchObject({ size: 2 })
    expect((await listFolder(root, join(root, 'b'))).entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual(['file:build'])
  })

  it('truncates past the limit after sorting', async () => {
    const listing = await listFolder(root, root, 2)
    expect(listing.entries.map((entry) => entry.name)).toEqual(['b', 'src'])
    expect(listing.isTruncated).toBe(true)
  })

  it('indexes files without hidden folders or links', async () => {
    const index = await buildFileIndex(root)
    expect(index.paths.sort()).toEqual(['A.md', 'b/build', 'file10.txt', 'file2.txt', 'src/Chat.tsx', 'src/deep/chat.ts'])
    expect(index.isPartial).toBe(false)
    const partial = await buildFileIndex(root, { maxFiles: 2 })
    expect(partial.isPartial).toBe(true)
  })

  it('reads text with a sha1 hash and language, and flags binary and large files', async () => {
    const text = await readWorkspaceFile(join(root, 'src', 'deep', 'chat.ts'))
    expect(text).toMatchObject({ kind: 'text', text: 'export {}\n', size: 10, language: 'typescript', encoding: 'utf-8' })
    expect(text.kind === 'text' && text.hash).toBe(createHash('sha1').update('export {}\n').digest('hex'))
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x50, 0x4b, 0x00, 0x01]))
    expect(await readWorkspaceFile(join(root, 'bin.dat'))).toMatchObject({ kind: 'binary', isBinary: true, size: 4 })
    expect(await readWorkspaceFile(join(root, 'file10.txt'), 1)).toMatchObject({ kind: 'too-large', isTooLarge: true, size: 2 })
  })
})

describe('content checks', () => {
  it('treats NUL bytes as binary', () => {
    expect(isBinaryBuffer(Buffer.from('plain text\n'))).toBe(false)
    expect(isBinaryBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(true)
  })

  it('decodes UTF-8, strips a BOM and falls back to EUC-KR', () => {
    expect(decodeText(Buffer.from('한글 ok', 'utf8'))).toEqual({ text: '한글 ok', encoding: 'utf-8' })
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ text: 'a', encoding: 'utf-8-bom' })
    // "한글" in EUC-KR
    expect(decodeText(Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]))).toEqual({ text: '한글', encoding: 'euc-kr' })
  })

  it('maps extensions and file names to highlight.js languages', () => {
    expect(languageOf('web/src/App.tsx')).toBe('typescript')
    expect(languageOf('Program.CS')).toBe('csharp')
    expect(languageOf('Makefile')).toBe('makefile')
    expect(languageOf('notes.txt')).toBeNull()
  })

  it('hides folders by name regardless of case', () => {
    expect(isHiddenDir('node_modules')).toBe(true)
    expect(isHiddenDir('.GIT')).toBe(true)
    expect(isHiddenDir('src')).toBe(false)
  })

  it('sorts folders before files and numbers by value', () => {
    const names = [
      { name: 'b.txt', kind: 'file' as const },
      { name: 'z', kind: 'dir' as const },
      { name: 'a10', kind: 'file' as const },
      { name: 'a2', kind: 'file' as const },
      { name: 'A1', kind: 'file' as const },
    ]
    expect(names.sort(compareEntries).map((entry) => entry.name)).toEqual(['z', 'A1', 'a2', 'a10', 'b.txt'])
  })
})

describe('quick find', () => {
  const paths = ['web/src/Chat.tsx', 'web/src/chatRows.ts', 'server/src/messages.ts', 'docs/chat/notes.md', 'web/src/Composer.tsx', 'chat']

  it('scores exact name, prefix, name, path, then letters in order', () => {
    expect(matchScore('chat', 'chat')).toBe(0)
    expect(matchScore('web/src/Chat.tsx', 'chat')).toBe(1)
    expect(matchScore('web/src/myChat.ts', 'chat')).toBe(2)
    expect(matchScore('docs/chat/notes.md', 'chat')).toBe(3)
    expect(matchScore('web/src/Composer.tsx', 'cmps')).toBe(4)
    expect(matchScore('web/src/Composer.tsx', 'wsrc')).toBe(5)
    expect(matchScore('web/src/Composer.tsx', 'xyz')).toBeNull()
    expect(matchScore('web/src/Composer.tsx', '   ')).toBeNull()
  })

  it('needs every space-separated word somewhere in the path', () => {
    expect(matchScore('web/src/Chat.tsx', 'web chat')).toBe(3)
    expect(matchScore('server/src/messages.ts', 'web chat')).toBeNull()
  })

  it('orders by score, then shorter path, and caps the results', () => {
    expect(findFiles(paths, 'chat')).toEqual({ paths: ['chat', 'web/src/Chat.tsx', 'web/src/chatRows.ts', 'docs/chat/notes.md'], total: 4 })
    expect(findFiles(paths, 'chat', 2)).toEqual({ paths: ['chat', 'web/src/Chat.tsx'], total: 4 })
  })

  it('caches an index per root for the ttl and shares a build in progress', async () => {
    let builds = 0
    let clock = 0
    const indexOf = makeFileIndexCache({
      ttlMs: 1000,
      maxRoots: 2,
      now: () => clock,
      build: async () => ({ paths: [`build ${++builds}`], isPartial: false, elapsedMs: 0 }),
    })
    const [first, second] = await Promise.all([indexOf('C:\\Repo'), indexOf('c:\\repo')])
    expect(first).toBe(second)
    expect(builds).toBe(1)
    clock = 999
    await indexOf('C:\\Repo')
    expect(builds).toBe(1)
    clock = 1000
    await indexOf('C:\\Repo')
    expect(builds).toBe(2)
  })
})
