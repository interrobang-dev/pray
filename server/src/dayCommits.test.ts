import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Team } from '@pray/host/team'
import { listFolderDayCommits, makeDayCommitsCache, teamDayCommits } from './dayCommits.js'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pray-day-commits-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const DAY = new Date(2026, 10, 13)
const NEXT = new Date(2026, 10, 14)

function git(cwd: string, args: string[], when?: Date) {
  const env = when ? { ...process.env, GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() } : process.env
  return execFileSync('git', ['-c', 'user.name=Kim', '-c', 'user.email=k@e.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, env }).toString('utf8').trim()
}

function commit(cwd: string, file: string, subject: string, when: Date) {
  writeFileSync(join(cwd, file), `${subject}\n`)
  git(cwd, ['add', '--', file])
  git(cwd, ['commit', '-q', '-m', subject], when)
}

describe.skipIf(!hasGit)('dayCommits (실제 git)', () => {
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'sub'), { recursive: true })
  git(repo, ['init', '-q', '-b', 'main'])

  it('커밋이 없는 저장소는 빈 목록, 형상관리가 없으면 none', async () => {
    expect(await listFolderDayCommits(repo, DAY, NEXT)).toEqual({ kind: 'git', items: [], isTruncated: false, error: null })
    const plain = join(root, 'plain')
    mkdirSync(plain)
    expect((await listFolderDayCommits(plain, DAY, NEXT)).kind).toBe('none')
    const svn = join(root, 'svn')
    mkdirSync(join(svn, '.svn'), { recursive: true })
    expect((await listFolderDayCommits(svn, DAY, NEXT)).kind).toBe('svn')
  })

  it('그날 커밋만, 최근 것부터, 하위 폴더는 그 폴더를 건드린 것만', async () => {
    commit(repo, 'a.txt', 'yesterday', new Date(2026, 10, 12, 23, 59))
    commit(repo, 'b.txt', 'morning 한글', new Date(2026, 10, 13, 0, 0, 1))
    commit(join(repo, 'sub'), 'c.txt', 'sub work', new Date(2026, 10, 13, 12))
    commit(repo, 'd.txt', 'tomorrow', new Date(2026, 10, 14, 0, 0, 1))
    const day = await listFolderDayCommits(repo, DAY, NEXT)
    expect(day.items.map((item) => item.subject)).toEqual(['sub work', 'morning 한글'])
    expect(day.items[0]).toMatchObject({ authorName: 'Kim' })
    expect(new Date(day.items[0].at).getTime()).toBe(new Date(2026, 10, 13, 12).getTime())
    expect((await listFolderDayCommits(join(repo, 'sub'), DAY, NEXT)).items.map((item) => item.subject)).toEqual(['sub work'])
  })

  it('worktree 파트: 팀 HEAD 에 없는 커밋만 그 파트로', async () => {
    const worktree = join(root, 'repo.worktrees', 'api')
    git(repo, ['worktree', 'add', '-q', '-b', 'part/api', worktree])
    commit(worktree, 'e.txt', 'part work', new Date(2026, 10, 13, 13))
    const team = { id: 't', name: 'T', cwd: repo, parts: [{ id: 'p1', name: 'API', worktree: { cwd: worktree, branch: 'part/api' }, createdAt: '' }] } as unknown as Team
    const result = await teamDayCommits(team, DAY, NEXT, listFolderDayCommits)
    expect(result.kind).toBe('git')
    expect(result.items.map((item) => [item.subject, item.partId])).toEqual([
      ['part work', 'p1'],
      ['sub work', null],
      ['morning 한글', null],
    ])
  })
})

describe('teamDayCommits·캐시', () => {
  it('팀 폴더가 git 이 아니면 파트를 보지 않는다', async () => {
    const calls: string[] = []
    const team = { cwd: 'D:\\svn', parts: [{ id: 'p', name: 'P', worktree: { cwd: 'D:\\wt', branch: 'b' }, createdAt: '' }] } as unknown as Team
    const result = await teamDayCommits(team, DAY, NEXT, async (cwd) => {
      calls.push(cwd)
      return { kind: 'svn', items: [], isTruncated: false, error: null }
    })
    expect(result).toEqual({ kind: 'svn', items: [], isTruncated: false, error: null })
    expect(calls).toEqual(['D:\\svn'])
  })

  it('파트 오류는 이름을 붙여 잇는다', async () => {
    const team = { cwd: 'D:\\repo', parts: [{ id: 'p', name: 'API', worktree: { cwd: 'D:\\wt', branch: 'b' }, createdAt: '' }] } as unknown as Team
    const result = await teamDayCommits(team, DAY, NEXT, async (cwd) =>
      cwd === 'D:\\repo' ? { kind: 'git', items: [], isTruncated: false, error: null } : { kind: 'git', items: [], isTruncated: true, error: 'git log failed' },
    )
    expect(result).toMatchObject({ isTruncated: true, error: 'Part API: git log failed' })
  })

  it('같은 폴더·범위는 TTL 동안 한 번, 동시 요청도 하나', async () => {
    let clock = 0
    let count = 0
    const cached = makeDayCommitsCache({
      ttlMs: 1000,
      now: () => clock,
      list: async () => {
        count++
        return { kind: 'git', items: [], isTruncated: false, error: null }
      },
    })
    await Promise.all([cached('D:\\A', DAY, NEXT), cached('d:/a/', DAY, NEXT)])
    expect(count).toBe(1)
    clock = 999
    await cached('D:\\A', DAY, NEXT)
    expect(count).toBe(1)
    clock = 1000
    await cached('D:\\A', DAY, NEXT)
    expect(count).toBe(2)
    await cached('D:\\A', new Date(2026, 10, 12), DAY)
    expect(count).toBe(3)
  })
})
