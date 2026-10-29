import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createWorktree,
  markFolderTrusted,
  parseWorktreeList,
  removeWorktree,
  trustKey,
  withTrust,
  worktreePath,
  worktreeSlug,
} from './worktree.js'

describe('worktree', () => {
  it('slug keeps ascii letters, digits and hyphens, else falls back to part id', () => {
    expect(worktreeSlug('API Server', 'p1')).toBe('api-server')
    expect(worktreeSlug('웹 v2!', 'p1')).toBe('v2')
    expect(worktreeSlug('문서', 'p1')).toBe('p1')
  })

  it('path is a sibling folder of the repo with forward slashes', () => {
    expect(worktreePath('D:/workspace/@private/jk-corp', 'api')).toBe('D:/workspace/@private/jk-corp.worktrees/api')
    expect(worktreePath('D:\\workspace\\foo\\', 'web')).toBe('D:/workspace/foo.worktrees/web')
  })

  it('trust adds only the folder key and keeps the rest', () => {
    const before = JSON.stringify({ numStartups: 3, projects: { 'D:/a': { hasTrustDialogAccepted: true, allowedTools: ['x'] } } })
    const after = JSON.parse(withTrust(before, 'D:/a.worktrees/api')!)
    expect(after.numStartups).toBe(3)
    expect(after.projects['D:/a']).toEqual({ hasTrustDialogAccepted: true, allowedTools: ['x'] })
    expect(after.projects['D:/a.worktrees/api']).toEqual({ hasTrustDialogAccepted: true })
    expect(JSON.parse(withTrust('{}', 'D:/b')!).projects).toEqual({ 'D:/b': { hasTrustDialogAccepted: true } })
  })

  it('trust refuses unparsable files', () => {
    expect(withTrust('{ broken', 'D:/a')).toBeNull()
    expect(withTrust('null', 'D:/a')).toBeNull()
  })

  it('trust returns the text as is when the folder is already trusted', () => {
    const before = '{"projects":{"D:/a":{"hasTrustDialogAccepted":true}}}'
    expect(withTrust(before, 'D:/a')).toBe(before)
  })
})

describe('session folder trust', () => {
  // 실제 ~/.claude.json 대신 임시 폴더의 파일을 쓴다
  const root = mkdtempSync(join(tmpdir(), 'pray-trust-'))
  const folder = join(root, 'MixedCase')
  mkdirSync(folder)
  const claudeJsonPath = join(root, '.claude.json')
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('key is the real path with drive letter upper case, disk case and forward slashes, whatever the input looks like', () => {
    const key = trustKey(folder)!
    expect(key).toMatch(/^[A-Z]:\//)
    expect(key).not.toContain('\\')
    expect(key.endsWith('/MixedCase')).toBe(true)
    expect(trustKey(folder.toLowerCase())).toBe(key)
    expect(trustKey(`${folder.toLowerCase().replace(/\\/g, '/')}/`)).toBe(key)
    expect(trustKey(join(folder, '..', 'MixedCase'))).toBe(key)
    expect(trustKey(join(root, 'missing'))).toBeNull()
  })

  it('writes the key once and does not touch the file when it is already trusted', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({ numStartups: 3, projects: { 'D:/other': { allowedTools: ['x'] } } }))
    expect(markFolderTrusted(folder.toLowerCase(), claudeJsonPath)).toBe(true)
    const written = readFileSync(claudeJsonPath, 'utf8')
    expect(JSON.parse(written)).toEqual({
      numStartups: 3,
      projects: { 'D:/other': { allowedTools: ['x'] }, [trustKey(folder)!]: { hasTrustDialogAccepted: true } },
    })

    // 한 줄로 다시 쓴 파일: 다시 쓰면 들여쓰기가 생기므로 글이 같으면 쓰지 않은 것이다
    const compact = JSON.stringify(JSON.parse(written))
    writeFileSync(claudeJsonPath, compact)
    expect(markFolderTrusted(folder, claudeJsonPath)).toBe(true)
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe(compact)
  })

  it('reports failure on a broken file and records nothing for a missing folder', () => {
    writeFileSync(claudeJsonPath, '{ broken')
    expect(markFolderTrusted(folder, claudeJsonPath)).toBe(false)
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe('{ broken')
    writeFileSync(claudeJsonPath, '{}')
    expect(markFolderTrusted(join(root, 'missing'), claudeJsonPath)).toBeNull()
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe('{}')
  })
})

describe('worktree list parsing', () => {
  it('reads path and branch per block, null branch for detached and bare, CRLF too', () => {
    const porcelain = [
      'worktree D:/r',
      'HEAD 1111',
      'branch refs/heads/main',
      '',
      'worktree D:/r.worktrees/api',
      'HEAD 2222',
      'branch refs/heads/part/api',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree D:/r.worktrees/x',
      'HEAD 3333',
      'detached',
      '',
      'worktree D:/bare.git',
      'bare',
      '',
    ].join('\r\n')
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: 'D:/r', branch: 'main' },
      { path: 'D:/r.worktrees/api', branch: 'part/api' },
      { path: 'D:/r.worktrees/x', branch: null },
      { path: 'D:/bare.git', branch: null },
    ])
  })
})

describe('part worktrees on a real git repo', () => {
  // 저장소마다 <root>/<이름>, worktree 는 그 옆 <root>/<이름>.worktrees/<슬러그>
  const root = mkdtempSync(join(tmpdir(), 'pray-wt-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim()
  const hasBranch = (repo: string, branch: string) => git(repo, 'branch', '--list', branch) !== ''
  const worktreeCount = (repo: string) => parseWorktreeList(git(repo, 'worktree', 'list', '--porcelain')).length
  let repoCount = 0
  function makeRepo(): string {
    const repo = join(root, `repo${++repoCount}`)
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    // 시험하는 함수의 git 도 같은 설정을 읽게 저장소 설정으로 (전역 autocrlf 가 줄바꿈 경고를 낸다)
    git(repo, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '-m', 'init')
    return repo
  }
  const folderOf = (repo: string, slug: string) => `${repo.replace(/\\/g, '/')}.worktrees/${slug}`

  it('creates a new worktree and branch from HEAD when neither exists', async () => {
    const repo = makeRepo()
    const created = await createWorktree(repo, 'api')
    expect(created).toEqual({ cwd: folderOf(repo, 'api'), branch: 'part/api', isLinked: false })
    expect(git(created.cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('part/api')
  })

  it('links an existing worktree of this repo with its own branch, creating nothing', async () => {
    const repo = makeRepo()
    git(repo, 'worktree', 'add', '-q', folderOf(repo, 'web'), '-b', 'feature-web')
    expect(await createWorktree(repo, 'web')).toEqual({ cwd: folderOf(repo, 'web'), branch: 'feature-web', isLinked: true })
    expect(hasBranch(repo, 'part/web')).toBe(false)
    expect(worktreeCount(repo)).toBe(2)
  })

  it('checks out an existing part branch into a new folder (no -b)', async () => {
    const repo = makeRepo()
    git(repo, 'branch', 'part/docs')
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    git(repo, 'add', 'b.txt')
    git(repo, 'commit', '-q', '-m', 'after branch')
    const linked = await createWorktree(repo, 'docs')
    expect(linked).toEqual({ cwd: folderOf(repo, 'docs'), branch: 'part/docs', isLinked: true })
    // 지금 HEAD 가 아니라 그 브랜치를 꺼냈다
    expect(existsSync(join(linked.cwd, 'b.txt'))).toBe(false)
  })

  it('clears a registration whose folder was deleted, then uses the branch', async () => {
    const repo = makeRepo()
    git(repo, 'worktree', 'add', '-q', folderOf(repo, 'qa'), '-b', 'part/qa')
    rmSync(folderOf(repo, 'qa'), { recursive: true, force: true })
    expect(await createWorktree(repo, 'qa')).toEqual({ cwd: folderOf(repo, 'qa'), branch: 'part/qa', isLinked: true })
    expect(existsSync(join(folderOf(repo, 'qa'), 'a.txt'))).toBe(true)
  })

  it('refuses a folder that is not a worktree of this repo, a detached worktree, a folder another part uses and a non-repo', async () => {
    const repo = makeRepo()
    mkdirSync(folderOf(repo, 'plain'), { recursive: true })
    await expect(createWorktree(repo, 'plain')).rejects.toMatchObject({ status: 409 })
    const other = makeRepo()
    git(other, 'worktree', 'add', '-q', folderOf(repo, 'foreign'), '-b', 'part/foreign')
    await expect(createWorktree(repo, 'foreign')).rejects.toMatchObject({ status: 409 })
    git(repo, 'worktree', 'add', '-q', '--detach', folderOf(repo, 'detached'))
    await expect(createWorktree(repo, 'detached')).rejects.toMatchObject({ status: 409 })
    await expect(createWorktree(repo, 'taken', [folderOf(repo, 'TAKEN').replace(/\//g, '\\')])).rejects.toMatchObject({ status: 409 })
    expect(existsSync(folderOf(repo, 'taken'))).toBe(false)
    expect(hasBranch(repo, 'part/taken')).toBe(false)
    const notRepo = join(root, 'not-a-repo')
    mkdirSync(notRepo)
    await expect(createWorktree(notRepo, 'x')).rejects.toMatchObject({ status: 400 })
    expect(hasBranch(repo, 'part/plain') || hasBranch(repo, 'part/detached')).toBe(false)
  })

  it('removes a merged worktree and its branch with -d', async () => {
    const repo = makeRepo()
    const worktree = await createWorktree(repo, 'merged')
    expect(await removeWorktree(repo, worktree, null)).toEqual({ outcome: 'removed', folder: 'removed', branch: 'deleted' })
    expect(existsSync(worktree.cwd)).toBe(false)
    expect(hasBranch(repo, 'part/merged')).toBe(false)
    expect(worktreeCount(repo)).toBe(1)
  })

  it('stops on an unmerged branch without a choice, then deletes (-D) or keeps it', async () => {
    const repo = makeRepo()
    const first = await createWorktree(repo, 'one')
    const second = await createWorktree(repo, 'two')
    for (const worktree of [first, second]) git(worktree.cwd, 'commit', '-q', '--allow-empty', '-m', 'work')
    expect(await removeWorktree(repo, first, null)).toEqual({ outcome: 'branch-unmerged' })
    expect(existsSync(first.cwd)).toBe(true)
    expect(hasBranch(repo, 'part/one')).toBe(true)
    expect(await removeWorktree(repo, first, 'delete')).toEqual({ outcome: 'removed', folder: 'removed', branch: 'deleted' })
    expect(hasBranch(repo, 'part/one')).toBe(false)
    expect(await removeWorktree(repo, second, 'keep')).toEqual({ outcome: 'removed', folder: 'removed', branch: 'kept' })
    expect(existsSync(second.cwd)).toBe(false)
    expect(hasBranch(repo, 'part/two')).toBe(true)
  })

  it('refuses uncommitted changes, including untracked files, and deletes nothing', async () => {
    const repo = makeRepo()
    const worktree = await createWorktree(repo, 'dirty')
    writeFileSync(join(worktree.cwd, 'a.txt'), 'changed\n')
    expect(await removeWorktree(repo, worktree, 'delete')).toEqual({ outcome: 'dirty' })
    git(worktree.cwd, 'checkout', '--', 'a.txt')
    writeFileSync(join(worktree.cwd, 'new.txt'), 'new\n')
    expect(await removeWorktree(repo, worktree, 'delete')).toEqual({ outcome: 'dirty' })
    expect(existsSync(join(worktree.cwd, 'new.txt'))).toBe(true)
    expect(hasBranch(repo, 'part/dirty')).toBe(true)
  })

  it('handles a deleted folder, a folder that is no longer a worktree and a missing branch', async () => {
    const repo = makeRepo()
    const gone = await createWorktree(repo, 'gone')
    rmSync(gone.cwd, { recursive: true, force: true })
    expect(await removeWorktree(repo, gone, null)).toEqual({ outcome: 'removed', folder: 'missing', branch: 'deleted' })
    expect(worktreeCount(repo)).toBe(1)

    const left = await createWorktree(repo, 'left')
    git(repo, 'worktree', 'remove', left.cwd)
    mkdirSync(left.cwd)
    writeFileSync(join(left.cwd, 'keep.txt'), 'not ours\n')
    git(repo, 'branch', '-D', 'part/left')
    expect(await removeWorktree(repo, left, null)).toEqual({ outcome: 'removed', folder: 'not-worktree', branch: 'missing' })
    expect(existsSync(join(left.cwd, 'keep.txt'))).toBe(true)
  })

  it('throws 409 without deleting anything when git cannot read the repo', async () => {
    const notRepo = join(root, 'not-a-repo-2')
    mkdirSync(notRepo)
    await expect(removeWorktree(notRepo, { cwd: join(notRepo, 'x'), branch: 'part/x' }, 'delete')).rejects.toMatchObject({ status: 409 })
  })

  it.runIf(process.platform === 'win32')('reports a half-done removal when a process works in a subfolder', async () => {
    const repo = makeRepo()
    const worktree = await createWorktree(repo, 'busy')
    mkdirSync(join(worktree.cwd, 'sub'))
    // 그 폴더를 현재 폴더로 쥔 프로세스: Windows 는 폴더를 못 지운다
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { cwd: join(worktree.cwd, 'sub'), stdio: 'ignore' })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))
      const removal = await removeWorktree(repo, worktree, null)
      expect(removal).toMatchObject({ outcome: 'failed', isWorktreeGone: true })
      expect(worktreeCount(repo)).toBe(1)
      // 멈춘 데서 끝낸다: 브랜치는 남는다
      expect(hasBranch(repo, 'part/busy')).toBe(true)
    } finally {
      holder.kill()
    }
  })
})
