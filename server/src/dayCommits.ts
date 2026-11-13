import { normalizeCwd, type Team } from '@pray/host/team'
import { detectVcs } from './vcs.js'
import { GIT_BASE, run, VcsCommandError } from './workspaceChanges.js'
import { parseLog } from './workspaceHistory.js'

/**
 * 오늘 한 일 창의 커밋: 팀 폴더(와 worktree 파트 폴더)의 git 에서 그날 커밋. 읽기만 한다 — 명령 규칙은 workspaceChanges.ts 의 run·GIT_BASE.
 * HEAD 에서 닿는 커밋 중 그 폴더(`-- .`)를 건드린 것만 (History 탭과 같다). 날짜는 커미터 시각 (`--since`·`--until` 이 보는 값).
 * SVN 은 첫 판에서 보이지 않는다 (svn log 는 사내 서버에 붙어야 해 느리고 사내망 밖에서 실패한다)
 */

export interface DayCommit {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  /** 커미터 시각 ISO */
  at: string
  /** 팀 폴더 HEAD 에서 닿지 않고 worktree 파트 폴더 HEAD 에서만 닿는 커밋이면 그 파트, 아니면 null */
  partId: string | null
}

export interface DayCommits {
  kind: 'git' | 'svn' | 'none'
  /** 최근 것부터 */
  items: DayCommit[]
  /** DAY_COMMIT_LIMIT 에서 잘랐다 */
  isTruncated: boolean
  /** git 실패 (화면에 그대로 보이는 영어). 있으면 그 폴더 커밋은 빠졌다 */
  error: string | null
}

/** 한 폴더에서 받는 최대 커밋 수 */
export const DAY_COMMIT_LIMIT = 200
const LOG_MAX_BYTES = 4 * 1024 * 1024
/** workspaceHistory.ts 의 LOG_FORMAT 과 칸이 같고 날짜만 커미터 시각(%cI) */
const DAY_LOG_FORMAT = '--format=%H%x00%h%x00%s%x00%an%x00%cI%x00%D'
/** 같은 폴더·날짜를 다시 묻지 않는 시간 */
export const DAY_COMMITS_TTL_MS = 60_000

type FolderCommits = { kind: DayCommits['kind']; items: Omit<DayCommit, 'partId'>[]; isTruncated: boolean; error: string | null }

const epoch = (date: Date) => `@${Math.floor(date.getTime() / 1000)}`

/** 커밋이 하나도 없는 저장소 (rev-parse 가 1 로 끝난다) */
async function hasNoCommits(cwd: string): Promise<boolean> {
  try {
    await run('git', [...GIT_BASE, 'rev-parse', '--verify', '--quiet', 'HEAD'], cwd, 1024)
    return false
  } catch (error) {
    return error instanceof VcsCommandError && error.exitCode === 1
  }
}

/** 폴더 하나의 [from, to) 커밋 (커미터 시각) */
export async function listFolderDayCommits(cwd: string, from: Date, to: Date): Promise<FolderCommits> {
  const vcs = detectVcs(cwd)
  if (!vcs || vcs.kind === 'svn') return { kind: vcs ? 'svn' : 'none', items: [], isTruncated: false, error: null }
  const args = [
    ...GIT_BASE,
    'log',
    '-z',
    DAY_LOG_FORMAT,
    '--no-color',
    '--no-show-signature',
    `--since=${epoch(from)}`,
    `--until=${epoch(new Date(to.getTime() - 1000))}`,
    `--max-count=${DAY_COMMIT_LIMIT + 1}`,
    'HEAD',
    '--',
    '.',
  ]
  try {
    const commits = parseLog((await run('git', args, cwd, LOG_MAX_BYTES)).toString('utf8'))
    // --since 는 시계가 어긋난 커밋 몇 개를 지나칠 수 있어 다시 거른다
    const inRange = commits.filter((commit) => {
      const at = new Date(commit.authorDate).getTime()
      return at >= from.getTime() && at < to.getTime()
    })
    return {
      kind: 'git',
      items: inRange.slice(0, DAY_COMMIT_LIMIT).map(({ hash, shortHash, subject, authorName, authorDate }) => ({ hash, shortHash, subject, authorName, at: authorDate })),
      isTruncated: commits.length > DAY_COMMIT_LIMIT,
      error: null,
    }
  } catch (error) {
    if (!(error instanceof VcsCommandError)) throw error
    if (await hasNoCommits(cwd)) return { kind: 'git', items: [], isTruncated: false, error: null }
    return { kind: 'git', items: [], isTruncated: false, error: error.message }
  }
}

/**
 * 폴더별 결과를 TTL 동안 기억하고, 같은 키를 동시에 물으면 도는 것 하나를 같이 쓴다 (키 = 폴더 + 범위).
 * 서버를 다시 켜면 빈다
 */
export function makeDayCommitsCache(options: { ttlMs?: number; list?: typeof listFolderDayCommits; now?: () => number } = {}) {
  const { ttlMs = DAY_COMMITS_TTL_MS, list = listFolderDayCommits, now = Date.now } = options
  const cache = new Map<string, { at: number; promise: Promise<FolderCommits> }>()
  return (cwd: string, from: Date, to: Date): Promise<FolderCommits> => {
    const key = `${normalizeCwd(cwd)}|${from.getTime()}|${to.getTime()}`
    const cached = cache.get(key)
    if (cached && now() - cached.at < ttlMs) return cached.promise
    for (const [oldKey, entry] of cache) if (now() - entry.at >= ttlMs) cache.delete(oldKey)
    const promise = list(cwd, from, to)
    cache.set(key, { at: now(), promise })
    // 실패한 것은 기억하지 않는다
    promise.catch(() => cache.delete(key))
    return promise
  }
}

/**
 * 팀 하나의 그날 커밋: 팀 폴더 HEAD 의 커밋 + worktree 파트 폴더 HEAD 에만 있는 커밋(그 파트로 붙인다), 해시로 겹침을 지운다.
 * 팀 폴더를 먼저 보는 것은 파트 브랜치가 만들 때의 팀 HEAD 를 품고 있어서다 — 파트를 먼저 보면 그 앞의 팀 커밋이 파트 것이 된다.
 * 병합(머지 커밋)으로 팀 HEAD 에 들어간 파트 커밋은 팀 것, squash 병합은 해시가 달라 둘 다 보인다.
 * kind 는 팀 폴더의 것 — 팀 폴더가 git 이 아니면 파트 폴더도 보지 않는다
 */
export async function teamDayCommits(team: Team, from: Date, to: Date, listFolder: (cwd: string, from: Date, to: Date) => Promise<FolderCommits>): Promise<DayCommits> {
  const root = await listFolder(team.cwd, from, to)
  if (root.kind !== 'git') return { kind: root.kind, items: [], isTruncated: false, error: null }
  const parts = team.parts.filter((part) => part.worktree && normalizeCwd(part.worktree.cwd) !== normalizeCwd(team.cwd))
  const partResults = await Promise.all(parts.map(async (part) => ({ part, result: await listFolder(part.worktree!.cwd, from, to) })))
  const seen = new Set<string>()
  const items: DayCommit[] = []
  const errors: string[] = root.error ? [root.error] : []
  let isTruncated = root.isTruncated
  for (const commit of root.items) {
    seen.add(commit.hash)
    items.push({ ...commit, partId: null })
  }
  for (const { part, result } of partResults) {
    if (result.error) errors.push(`Part ${part.name}: ${result.error}`)
    isTruncated ||= result.isTruncated
    for (const commit of result.items) {
      if (seen.has(commit.hash)) continue
      seen.add(commit.hash)
      items.push({ ...commit, partId: part.id })
    }
  }
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return { kind: 'git', items, isTruncated, error: errors.length > 0 ? errors.join('; ') : null }
}
