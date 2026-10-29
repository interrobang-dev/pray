import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitDetail, commitFileDiff, historyFilePath, listHistory, parseLog, parseNameStatus, parseRefs, parseShow, scopeFiles } from './workspaceHistory.js'

const H1 = 'a'.repeat(40)
const H2 = 'b'.repeat(40)

describe('workspaceHistory parsing', () => {
  it('parses refs with HEAD first and drops remote HEAD', () => {
    expect(parseRefs('HEAD -> main, origin/main, origin/HEAD, tag: v1.0')).toEqual({ refs: ['main', 'origin/main', 'tag: v1.0'], isHead: true })
    expect(parseRefs('HEAD, tag: v2')).toEqual({ refs: ['HEAD', 'tag: v2'], isHead: true })
    expect(parseRefs('')).toEqual({ refs: [], isHead: false })
  })

  it('parses NUL separated log records whatever the subject holds', () => {
    const output = [H1, 'aaaaaaa', 'feat: 한글 | %x00 \u001f "quote"', 'Kim', '2026-10-29T10:00:00+09:00', 'HEAD -> main', H2, 'bbbbbbb', '', 'Lee', '2026-10-28T10:00:00+09:00', ''].join('\0') + '\0'
    expect(parseLog(output)).toEqual([
      { hash: H1, shortHash: 'aaaaaaa', subject: 'feat: 한글 | %x00 \u001f "quote"', authorName: 'Kim', authorDate: '2026-10-29T10:00:00+09:00', refs: ['main'], isHead: true },
      { hash: H2, shortHash: 'bbbbbbb', subject: '', authorName: 'Lee', authorDate: '2026-10-28T10:00:00+09:00', refs: [], isHead: false },
    ])
    expect(parseLog('')).toEqual([])
    expect(parseLog('not a hash\0x\0x\0x\0x\0x\0')).toEqual([])
  })

  it('parses show output with a multi-line body and parents', () => {
    const output = [H1, 'aaaaaaa', `${H2} ${'c'.repeat(40)}`, 'Kim', 'k@e.com', '2026-10-29T10:00:00+09:00', 'Merge x', 'line 1\n\nline 3\n\n'].join('\0')
    expect(parseShow(output)).toEqual({
      hash: H1,
      shortHash: 'aaaaaaa',
      subject: 'Merge x',
      body: 'line 1\n\nline 3',
      authorName: 'Kim',
      authorEmail: 'k@e.com',
      authorDate: '2026-10-29T10:00:00+09:00',
      parents: [H2, 'c'.repeat(40)],
    })
    expect(parseShow([H1, 'a', '', 'n', 'e', 'd', 's', ''].join('\0'))?.parents).toEqual([])
  })

  it('parses name-status with renames and copies and scopes to the session folder', () => {
    const output = ['M', 'web/a.ts', 'R087', 'old/x.ts', 'web/x.ts', 'C75', 'web/a.ts', 'web/copy.ts', 'D', 'README.md', 'A', 'web/Z 한글.txt', 'T', 'web/link', ''].join('\0')
    const raw = parseNameStatus(output)
    expect(raw).toEqual([
      { path: 'web/a.ts', status: 'modified', oldPath: null },
      { path: 'web/x.ts', status: 'renamed', oldPath: 'old/x.ts' },
      { path: 'web/copy.ts', status: 'added', oldPath: null },
      { path: 'README.md', status: 'deleted', oldPath: null },
      { path: 'web/Z 한글.txt', status: 'added', oldPath: null },
      { path: 'web/link', status: 'modified', oldPath: null },
    ])
    expect(scopeFiles(raw, 'web')).toEqual({
      files: [
        { path: 'Z 한글.txt', status: 'added', oldPath: null },
        { path: 'a.ts', status: 'modified', oldPath: null },
        { path: 'copy.ts', status: 'added', oldPath: null },
        { path: 'link', status: 'modified', oldPath: null },
        { path: 'x.ts', status: 'renamed', oldPath: '../old/x.ts' },
      ],
      outsideCount: 1,
      isTruncated: false,
    })
    expect(scopeFiles(raw, '').outsideCount).toBe(0)
    // 이름이 cwd 로 시작하기만 하는 형제 폴더는 밖이다
    expect(scopeFiles([{ path: 'webapp/a', status: 'added', oldPath: null }], 'web').outsideCount).toBe(1)
  })

  it('accepts file paths only inside the session folder', () => {
    expect(historyFilePath('web\\src/a.ts')).toBe('web/src/a.ts')
    expect(historyFilePath('../a.ts')).toBeNull()
    expect(historyFilePath('a/./b')).toBeNull()
    expect(historyFilePath('a//b')).toBeNull()
  })
})

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasGit)('workspaceHistory on a real repository', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jk-corp-history-')))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo')
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=Tester', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()

  it('lists, details and diffs commits (first commit, rename, binary, EUC-KR, merge, sub folder)', async () => {
    mkdirSync(join(repo, 'web'), { recursive: true })
    git('init', '-q', '-b', 'main')
    git('config', 'core.autocrlf', 'false')
    expect(await listHistory(repo, { skip: 0, path: null })).toEqual({ kind: 'git', commits: [], hasMore: false, error: null })

    writeFileSync(join(repo, 'top.txt'), 'top\n')
    writeFileSync(join(repo, 'web', 'a.txt'), 'one\ntwo\n')
    git('add', '-A')
    git('commit', '-qm', '첫 커밋')
    const first = git('rev-parse', 'HEAD')

    git('mv', 'web/a.txt', 'web/b.txt')
    writeFileSync(join(repo, 'web', 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    writeFileSync(join(repo, 'web', 'euc.txt'), Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x0a]))
    git('add', '-A')
    git('commit', '-qm', 'rename and binary', '-m', 'body line 1\n\nbody line 3')
    git('tag', 'v1')

    git('checkout', '-qb', 'side')
    writeFileSync(join(repo, 'web', 'side.txt'), 'side\n')
    git('add', '-A')
    git('commit', '-qm', 'side work')
    git('checkout', '-q', 'main')
    writeFileSync(join(repo, 'top.txt'), 'top changed\n')
    git('commit', '-qam', 'outside only')
    git('merge', '-q', '--no-ff', '-m', 'merge side', 'side')

    const all = await listHistory(repo, { skip: 0, path: null })
    expect(all.kind).toBe('git')
    expect(all.commits.map((commit) => commit.subject)).toEqual(['merge side', 'outside only', 'side work', 'rename and binary', '첫 커밋'])
    expect(all.commits[0]).toMatchObject({ refs: ['main'], isHead: true })
    expect(all.commits[3].refs).toEqual(['tag: v1'])
    expect((await listHistory(repo, { skip: 4, path: null })).commits.map((commit) => commit.subject)).toEqual(['첫 커밋'])

    // 하위 폴더를 cwd 로: 그 아래를 건드린 커밋만. 머지는 web 기준으로 side 와 같아 git 기본 단순화로 빠진다
    const web = join(repo, 'web')
    expect((await listHistory(web, { skip: 0, path: null })).commits.map((commit) => commit.subject)).toEqual(['side work', 'rename and binary', '첫 커밋'])
    // 파일별: 이름 바뀌기 전 커밋까지
    expect((await listHistory(web, { skip: 0, path: 'b.txt' })).commits.map((commit) => commit.subject)).toEqual(['rename and binary', '첫 커밋'])

    const root1 = await commitDetail(web, first.slice(0, 7))
    expect(root1).toMatchObject({ hash: first, subject: '첫 커밋', body: '', parents: [], authorEmail: 't@example.com', outsideCount: 1 })
    expect(root1?.files).toEqual([{ path: 'a.txt', status: 'added', oldPath: null }])
    const firstDiff = await commitFileDiff(web, first, 'a.txt')
    expect(firstDiff?.hunks[0].lines.map((line) => `${line.kind}:${line.text}`)).toEqual(['add:one', 'add:two'])

    const second = all.commits[3].hash
    const detail = await commitDetail(web, second)
    expect(detail?.body).toBe('body line 1\n\nbody line 3')
    expect(detail?.files).toEqual([
      { path: 'b.txt', status: 'renamed', oldPath: 'a.txt' },
      { path: 'bin.dat', status: 'added', oldPath: null },
      { path: 'euc.txt', status: 'added', oldPath: null },
    ])
    expect((await commitFileDiff(web, second, 'b.txt'))?.kind).toBe('empty')
    expect((await commitFileDiff(web, second, 'bin.dat'))?.kind).toBe('binary')
    const euc = await commitFileDiff(web, second, 'euc.txt')
    expect(euc).toMatchObject({ kind: 'diff', encoding: 'euc-kr' })
    expect(euc?.hunks[0].lines[0].text).toBe('한글')
    expect(await commitFileDiff(web, second, 'nope.txt')).toBeNull()

    // 머지는 첫 부모 대비 (side 에서 온 파일만)
    const merge = await commitDetail(web, all.commits[0].hash)
    expect(merge?.parents).toHaveLength(2)
    expect(merge?.files).toEqual([{ path: 'side.txt', status: 'added', oldPath: null }])

    expect(await commitDetail(web, 'ffff')).toBeNull()
  })

  it('reports non-git folders', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    expect(await listHistory(plain, { skip: 0, path: null })).toEqual({ kind: 'none', commits: [], hasMore: false, error: null })
    expect(await commitDetail(plain, 'abcd')).toBeNull()
  })
})
