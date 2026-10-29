import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createFolder,
  folderNameError,
  folderState,
  gitInitRejection,
  isSystemFolderName,
  listDrives,
  listSubfolders,
  normalizeFolderPath,
  parentFolderOf,
  runGitInit,
  teamNameMap,
  visibleFolderNames,
} from './folderPicker.js'

describe('normalizeFolderPath', () => {
  it('accepts drive paths and normalizes them', () => {
    expect(normalizeFolderPath('d:/workspace/foo/')).toBe('D:\\workspace\\foo')
    expect(normalizeFolderPath('D:\\workspace\\.\\a\\..\\foo\\\\')).toBe('D:\\workspace\\foo')
    expect(normalizeFolderPath('c:')).toBe('C:\\')
    expect(normalizeFolderPath('C:\\')).toBe('C:\\')
    expect(normalizeFolderPath('C:/')).toBe('C:\\')
  })

  it('rejects relative, UNC, device and malformed paths', () => {
    for (const raw of ['', 'foo', '\\foo', '/foo', 'C:foo', '\\\\server\\share', '\\\\?\\C:\\x', 'D:\\a\0b', 'D:\\a\nb', 'D:\\a:stream', 'D:\\a?b', 'D:\\a*', 'D:\\"a"', 'x'.repeat(1001)]) {
      expect(normalizeFolderPath(raw), raw).toBeNull()
    }
    expect(normalizeFolderPath(['D:\\a'])).toBeNull()
    expect(normalizeFolderPath(undefined)).toBeNull()
  })
})

describe('parentFolderOf', () => {
  it('goes up, and a drive root goes to the drive list', () => {
    expect(parentFolderOf('D:\\workspace\\foo')).toBe('D:\\workspace')
    expect(parentFolderOf('D:\\workspace')).toBe('D:\\')
    expect(parentFolderOf('D:\\')).toBe('')
  })
})

describe('folderNameError', () => {
  it('accepts ordinary names', () => {
    for (const name of ['foo', 'my app', '한글 폴더', '.claude', 'a.b', ' lead', 'console', 'com10', 'nul-x']) expect(folderNameError(name), name).toBeNull()
  })

  it('rejects empty, invalid characters, dots, trailing dot or space and device names', () => {
    for (const name of ['', 'a/b', 'a\\b', 'a:b', 'a*', 'a?', 'a"b', 'a<b', 'a>b', 'a|b', 'a\tb', 'a\0', '.', '..', 'foo.', 'foo ', '   ', 'CON', 'con', 'nul.txt', 'Com1', 'LPT9', 'com¹', 'aux .txt', 'x'.repeat(256)]) {
      expect(folderNameError(name), JSON.stringify(name)).not.toBeNull()
    }
    expect(folderNameError(undefined)).toBe('Enter a folder name')
    expect(folderNameError(3)).toBe('Enter a folder name')
  })
})

describe('isSystemFolderName', () => {
  it('hides recycle bin and volume information by name', () => {
    expect(isSystemFolderName('$Recycle.Bin')).toBe(true)
    expect(isSystemFolderName('System Volume Information')).toBe(true)
    expect(isSystemFolderName('Windows')).toBe(false)
  })
})

describe('gitInitRejection', () => {
  const ok = { isLocal: true, folder: 'D:\\new', state: 'folder' as const, hasGroup: true, hasTeam: false, vcs: null }

  it('passes a local, existing folder outside a repository', () => {
    expect(gitInitRejection(ok)).toBeNull()
  })

  it('rejects another PC first', () => {
    expect(gitInitRejection({ ...ok, isLocal: false, folder: null, state: 'missing', hasTeam: true })?.status).toBe(403)
  })

  it('checks the folder, then the team, then the repository', () => {
    expect(gitInitRejection({ ...ok, folder: null })?.status).toBe(400)
    expect(gitInitRejection({ ...ok, state: 'missing', hasTeam: true })?.status).toBe(404)
    expect(gitInitRejection({ ...ok, state: 'not-folder' })?.status).toBe(400)
    expect(gitInitRejection({ ...ok, hasGroup: false, hasTeam: true })).toEqual({ status: 400, message: 'Group not found' })
    expect(gitInitRejection({ ...ok, hasTeam: true, vcs: { kind: 'git', root: 'D:\\' } })).toEqual({ status: 409, message: 'A team for this folder already exists: D:\\new' })
    expect(gitInitRejection({ ...ok, vcs: { kind: 'svn', root: 'D:\\' } })).toEqual({ status: 409, message: 'Already inside an SVN repository: D:\\' })
  })
})

describe('folders on disk', () => {
  const base = mkdtempSync(join(tmpdir(), 'jk-folder-picker-'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))
  const root = win32.normalize(base)

  it('lists only folders, sorted by name, with vcs and team name', async () => {
    for (const name of ['b10', 'b2', 'A', 'repo', 'svn', '$junk', 'team']) mkdirSync(join(root, name))
    mkdirSync(join(root, 'repo', '.git'))
    mkdirSync(join(root, 'svn', '.svn'))
    writeFileSync(join(root, 'file.txt'), 'x')
    const teams = teamNameMap([{ name: 'My team', cwd: join(root, 'team').replaceAll('\\', '/').toLowerCase() + '/' }])
    const listing = await listSubfolders(root, teams)
    expect(listing.entries.map((entry) => entry.name)).toEqual(['A', 'b2', 'b10', 'repo', 'svn', 'team'])
    expect(listing.entries.find((entry) => entry.name === 'repo')).toEqual({ name: 'repo', path: win32.join(root, 'repo'), vcs: 'git', teamName: null })
    expect(listing.entries.find((entry) => entry.name === 'svn')?.vcs).toBe('svn')
    expect(listing.entries.find((entry) => entry.name === 'team')?.teamName).toBe('My team')
    expect(listing.hiddenCount).toBe(1)
    expect(listing.isTruncated).toBe(false)
  })

  it('hides folders with the hidden attribute', async () => {
    const folder = join(root, 'attr')
    mkdirSync(join(folder, 'shown'), { recursive: true })
    mkdirSync(join(folder, 'secret'))
    execFileSync('attrib', ['+h', join(folder, 'secret')])
    expect([...((await visibleFolderNames(folder)) ?? [])]).toEqual(['shown'])
    const listing = await listSubfolders(folder, new Map())
    expect(listing.entries.map((entry) => entry.name)).toEqual(['shown'])
    expect(listing.hiddenCount).toBe(1)
    // 보이는 폴더가 없으면 dir 이 종료 코드 1 — 빈 집합
    expect(await visibleFolderNames(join(folder, 'shown'))).toEqual(new Set())
  })

  it('falls back to name rules when attributes are unknown, and truncates at the limit', async () => {
    const listing = await listSubfolders(root, new Map(), { limit: 2, visibleNames: async () => null })
    expect(listing.entries.map((entry) => entry.name)).toEqual(['A', 'attr'])
    expect(listing.isTruncated).toBe(true)
  })

  it('lists existing drives only', async () => {
    const drives = await listDrives(new Map())
    expect(drives.some((drive) => drive.path === win32.parse(root).root)).toBe(true)
    for (const drive of drives) expect(drive.path).toMatch(/^[A-Z]:\\$/)
  })

  it('creates one folder, refuses existing ones and missing parents', async () => {
    const created = await createFolder(root, '새 폴더')
    expect(created).toBe(win32.join(root, '새 폴더'))
    expect(await folderState(created)).toBe('folder')
    await expect(createFolder(root, '새 폴더')).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(createFolder(root, 'FILE.TXT')).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(createFolder(join(root, 'missing'), 'x')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(existsSync(join(root, 'missing'))).toBe(false)
    expect(await folderState(join(root, 'file.txt'))).toBe('not-folder')
    expect(await folderState(join(root, 'missing'))).toBe('missing')
  })

  it('git init creates a repository on main', async () => {
    const folder = join(root, 'init')
    mkdirSync(folder)
    await runGitInit(folder)
    expect(readFileSync(join(folder, '.git', 'HEAD'), 'utf8').trim()).toBe('ref: refs/heads/main')
  })
})
