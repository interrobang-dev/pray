import { posix, win32 } from 'node:path'
import { detectVcs } from './vcs.js'
import {
  decodeDiffOutput,
  GIT_BASE,
  MAX_CHANGED_FILES,
  MAX_DIFF_BYTES,
  parseUnifiedDiff,
  run,
  toSlash,
  VcsCommandError,
  type ChangedFile,
  type ChangeStatus,
  type WorkspaceDiff,
} from './workspaceChanges.js'

/**
 * 세션 작업 폴더(cwd)의 git 커밋 히스토리 (화면 Files 탭의 History). 읽기만 한다 — 명령 규칙(셸 없음·`--`·15초·출력 상한·`--no-optional-locks`·
 * LC_ALL=C)은 workspaceChanges.ts 의 run·GIT_BASE 그대로. git 만이고 SVN·형상관리 없음은 kind 만 알린다.
 * 목록은 cwd 아래를 건드린 커밋만, 경로는 cwd 상대(구분자 `/`)
 */

export interface HistoryCommit {
  hash: string
  shortHash: string
  /** 첫 줄 (여러 줄 제목은 git 이 공백으로 잇는다) */
  subject: string
  authorName: string
  /** ISO 8601 (작성자 시각대 그대로) */
  authorDate: string
  /** 브랜치·태그 (`HEAD -> main` 은 main 으로 맨 앞, 태그는 `tag: v1`, 원격의 `origin/HEAD` 는 뺀다) */
  refs: string[]
  /** 지금 HEAD 가 가리키는 커밋 */
  isHead: boolean
}

export type WorkspaceHistory =
  | { kind: 'none' | 'svn'; commits: []; hasMore: false; error: null }
  | {
      kind: 'git'
      commits: HistoryCommit[]
      /** 다음 쪽이 있다 (skip + HISTORY_PAGE_SIZE 로 다시 받는다) */
      hasMore: boolean
      /** 명령을 못 돌렸거나 실패 (화면에 그대로 보이는 영어 문구). 있으면 commits 는 비었다 */
      error: string | null
    }

export interface CommitDetail {
  hash: string
  shortHash: string
  subject: string
  /** 제목 뒤 본문 (없으면 빈 글) */
  body: string
  authorName: string
  authorEmail: string
  authorDate: string
  /** 부모 커밋 전체 해시. 0개 = 첫 커밋, 2개 이상 = 머지 (파일·diff 는 첫 부모 대비) */
  parents: string[]
  /** cwd 아래 바뀐 파일 (경로순). status 는 Changes 와 같은 이름 (복사는 added, 형식 바뀜은 modified) */
  files: ChangedFile[]
  /** cwd 밖이라 뺀 파일 수 */
  outsideCount: number
  /** MAX_CHANGED_FILES 에서 잘랐다 */
  isTruncated: boolean
}

/** 한 번에 주는 커밋 수 */
export const HISTORY_PAGE_SIZE = 50
/** rev 꼴: 4~64자 hex (짧은 해시·SHA-1·SHA-256) */
export const REV_PATTERN = /^[0-9a-f]{4,64}$/i
const LOG_MAX_BYTES = 4 * 1024 * 1024
const FILES_MAX_BYTES = 32 * 1024 * 1024
/** 목록 한 커밋의 칸 수 (LOG_FORMAT) */
const LOG_FIELDS = 6
// 칸은 NUL 로 나누고 -z 가 커밋 사이에도 NUL 을 넣는다 — 제목·이름에 어떤 글자가 와도 NUL 은 못 들어 칸 수로 끊는다
const LOG_FORMAT = '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%D'
const SHOW_FORMAT = '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b'
const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/** `%D` (`HEAD -> main, origin/main, origin/HEAD, tag: v1`) → refs·isHead */
export function parseRefs(decoration: string): { refs: string[]; isHead: boolean } {
  let isHead = false
  const refs: string[] = []
  for (const part of decoration.split(', ')) {
    const ref = part.trim()
    if (!ref) continue
    if (ref.startsWith('HEAD -> ')) {
      isHead = true
      refs.unshift(ref.slice('HEAD -> '.length))
    } else if (ref === 'HEAD') {
      // detached HEAD
      isHead = true
      refs.unshift('HEAD')
    } else if (!ref.endsWith('/HEAD')) {
      refs.push(ref)
    }
  }
  return { refs, isHead }
}

/** `git log -z` + LOG_FORMAT 출력 → 커밋. 해시 꼴이 아닌 칸에서 멈춘다 (어긋난 출력을 엉뚱하게 읽지 않게) */
export function parseLog(output: string): HistoryCommit[] {
  const fields = output.split('\0')
  const commits: HistoryCommit[] = []
  for (let i = 0; i + LOG_FIELDS <= fields.length; i += LOG_FIELDS) {
    const [hash, shortHash, subject, authorName, authorDate, decoration] = fields.slice(i, i + LOG_FIELDS)
    // 커밋 사이 구분 NUL 뒤에 오는 줄바꿈(tformat)을 떼고 본다
    const cleanHash = hash.replace(/^\n/, '')
    if (!HASH.test(cleanHash)) break
    commits.push({ hash: cleanHash, shortHash, subject, authorName, authorDate, ...parseRefs(decoration) })
  }
  return commits
}

/** `git show -s` + SHOW_FORMAT 출력 → 파일 빼고 커밋 정보. 본문은 마지막 칸이라 NUL 말고는 무엇이든 든다 */
export function parseShow(output: string): Omit<CommitDetail, 'files' | 'outsideCount' | 'isTruncated'> | null {
  const [hash, shortHash, parents, authorName, authorEmail, authorDate, subject, ...rest] = output.split('\0')
  if (!HASH.test(hash ?? '')) return null
  return {
    hash,
    shortHash,
    subject,
    body: rest.join('\0').replace(/\s+$/, ''),
    authorName,
    authorEmail,
    authorDate,
    parents: parents ? parents.split(' ') : [],
  }
}

/** diff-tree 상태 글자 → Changes 의 이름. 복사(C)는 added, 형식 바뀜(T)·그 밖은 modified */
function statusOf(letter: string): ChangeStatus {
  if (letter === 'A' || letter === 'C') return 'added'
  if (letter === 'D') return 'deleted'
  if (letter === 'R') return 'renamed'
  return 'modified'
}

/** `git diff-tree -r -z --name-status` 출력 → 저장소 루트 상대 경로의 바뀐 파일. 이름 바뀜·복사(R100·C75)는 옛 경로·새 경로 두 칸 */
export function parseNameStatus(output: string): { path: string; status: ChangeStatus; oldPath: string | null }[] {
  const tokens = output.split('\0')
  const files: { path: string; status: ChangeStatus; oldPath: string | null }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const letter = tokens[i][0]
    if (!letter || !/^[A-Z]/.test(tokens[i])) continue
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[++i] ?? ''
      const path = tokens[++i] ?? ''
      files.push({ path, status: statusOf(letter), oldPath: letter === 'R' ? oldPath : null })
    } else {
      files.push({ path: tokens[++i] ?? '', status: statusOf(letter), oldPath: null })
    }
  }
  return files
}

/**
 * 저장소 루트 상대 바뀐 파일 → cwd 상대 (prefix = cwd 의 루트 상대 경로, 루트면 빈 글). 새 경로가 cwd 밖이면 빼고 센다.
 * 옛 경로가 밖이면 `../` 로 시작한다 (Changes 와 같다). 경로순, MAX_CHANGED_FILES 에서 자른다
 */
export function scopeFiles(raw: { path: string; status: ChangeStatus; oldPath: string | null }[], prefix: string): { files: ChangedFile[]; outsideCount: number; isTruncated: boolean } {
  const inside = (path: string) => !prefix || path.startsWith(`${prefix}/`)
  const fromCwd = (path: string) => (prefix ? posix.relative(prefix, path) : path)
  const scoped: ChangedFile[] = []
  let outsideCount = 0
  for (const file of raw) {
    if (!inside(file.path)) {
      outsideCount++
      continue
    }
    scoped.push({ path: fromCwd(file.path), status: file.status, oldPath: file.oldPath === null ? null : fromCwd(file.oldPath) })
  }
  scoped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files: scoped.slice(0, MAX_CHANGED_FILES), outsideCount, isTruncated: scoped.length > MAX_CHANGED_FILES }
}

/** 파일별 히스토리의 path 꼴: cwd 상대, `..`·`.` 칸 없음 (지운 파일도 받으려고 파일이 있는지는 보지 않는다). `\` 는 `/` 로 */
export function historyFilePath(path: string): string | null {
  const slashed = toSlash(path)
  const parts = slashed.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return slashed
}

function gitRoot(cwd: string): string | null {
  const vcs = detectVcs(cwd)
  return vcs?.kind === 'git' ? vcs.root : null
}

/** 커밋이 하나도 없는 저장소인지 (log 가 실패했을 때만 본다) */
async function hasNoCommits(cwd: string): Promise<boolean> {
  try {
    await run('git', [...GIT_BASE, 'rev-parse', '--verify', '--quiet', 'HEAD'], cwd, 1024)
    return false
  } catch (error) {
    return error instanceof VcsCommandError && error.exitCode === 1
  }
}

/**
 * cwd 아래를 건드린 커밋 (HEAD 에서 거슬러, 새것부터) 한 쪽. path 가 있으면 그 파일만 `--follow`(이름 바뀌기 전 커밋까지).
 * 명령 실패는 error 로 (커밋이 없는 저장소는 빈 목록)
 */
export async function listHistory(cwd: string, options: { skip: number; path: string | null }): Promise<WorkspaceHistory> {
  const vcs = detectVcs(cwd)
  if (!vcs || vcs.kind === 'svn') return { kind: vcs ? 'svn' : 'none', commits: [], hasMore: false, error: null }
  const args = [
    ...GIT_BASE,
    'log',
    '-z',
    LOG_FORMAT,
    '--no-color',
    '--no-show-signature',
    `--max-count=${HISTORY_PAGE_SIZE + 1}`,
    `--skip=${options.skip}`,
    ...(options.path ? ['--follow', '--', options.path] : ['--', '.']),
  ]
  try {
    const commits = parseLog((await run('git', args, cwd, LOG_MAX_BYTES)).toString('utf8'))
    return { kind: 'git', commits: commits.slice(0, HISTORY_PAGE_SIZE), hasMore: commits.length > HISTORY_PAGE_SIZE, error: null }
  } catch (error) {
    if (!(error instanceof VcsCommandError)) throw error
    if (await hasNoCommits(cwd)) return { kind: 'git', commits: [], hasMore: false, error: null }
    const message = (error as VcsCommandError & { code?: string }).code === 'too-large' ? 'History too large to list' : error.message
    return { kind: 'git', commits: [], hasMore: false, error: message }
  }
}

/** rev → 전체 해시. 없거나 짧은 해시가 여럿에 맞으면 null (rev-parse 가 1·128 로 끝난다). 그 밖 실패는 던진다 */
async function resolveCommit(root: string, rev: string): Promise<string | null> {
  try {
    const hash = (await run('git', [...GIT_BASE, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`], root, 1024)).toString('utf8').trim()
    return HASH.test(hash) ? hash : null
  } catch (error) {
    if (error instanceof VcsCommandError && error.exitCode !== null) return null
    throw error
  }
}

/** 커밋은 바뀌지 않아 상세를 기억한다 (저장소 루트 + 해시, 최근 MAX_CACHED_DETAILS 개) */
const MAX_CACHED_DETAILS = 64
const detailCache = new Map<string, CommitDetail>()

/**
 * 커밋 하나의 정보와 cwd 아래 바뀐 파일 (첫 부모 대비, 첫 커밋은 빈 트리 대비, 이름 바뀜 찾기 `-M`).
 * git 저장소가 아니거나 커밋이 없으면 null. 명령 실패는 VcsCommandError
 */
export async function commitDetail(cwd: string, rev: string): Promise<CommitDetail | null> {
  const root = gitRoot(cwd)
  if (!root) return null
  const hash = await resolveCommit(root, rev)
  if (!hash) return null
  const prefix = toSlash(win32.relative(root, cwd))
  const key = `${root.toLowerCase()}|${prefix}|${hash}`
  const cached = detailCache.get(key)
  if (cached) return cached
  const info = parseShow((await run('git', [...GIT_BASE, 'show', '-s', '--no-color', '--no-show-signature', SHOW_FORMAT, hash, '--'], root, FILES_MAX_BYTES)).toString('utf8'))
  if (!info) return null
  const base = info.parents.length === 0 ? ['--root', hash] : [info.parents[0], hash]
  const nameStatus = await run('git', [...GIT_BASE, 'diff-tree', '--no-commit-id', '-r', '-z', '--name-status', '-M', '--no-ext-diff', '--no-textconv', ...base, '--'], root, FILES_MAX_BYTES)
  const detail: CommitDetail = { ...info, ...scopeFiles(parseNameStatus(nameStatus.toString('utf8')), prefix) }
  detailCache.set(key, detail)
  while (detailCache.size > MAX_CACHED_DETAILS) detailCache.delete(detailCache.keys().next().value as string)
  return detail
}

/**
 * 커밋의 파일 하나 diff (Changes diff 와 같은 꼴). 그 커밋의 cwd 아래 파일 목록에 없으면 null.
 * 첫 부모(첫 커밋은 빈 트리) 대비, 사용자 diff 설정(외부 도구·textconv·색·접두)을 끈다
 */
export async function commitFileDiff(cwd: string, rev: string, path: string): Promise<WorkspaceDiff | null> {
  const detail = await commitDetail(cwd, rev)
  const file = detail?.files.find((candidate) => candidate.path === path)
  const root = gitRoot(cwd)
  if (!detail || !file || !root) return null
  const prefix = toSlash(win32.relative(root, cwd))
  const fromRoot = (cwdPath: string) => (prefix ? posix.join(prefix, cwdPath) : cwdPath)
  const base = { path: file.path, status: file.status, oldPath: file.oldPath, hunks: [], encoding: null, hasPropertyChanges: false }
  const range = detail.parents.length === 0 ? ['--root', detail.hash] : [detail.parents[0], detail.hash]
  let output: Buffer
  try {
    output = await run(
      'git',
      [
        ...GIT_BASE,
        'diff-tree',
        '--no-commit-id',
        '-p',
        '-r',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--unified=3',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        file.oldPath ? '-M' : '--no-renames',
        ...range,
        '--',
        ...(file.oldPath ? [fromRoot(file.oldPath), fromRoot(file.path)] : [fromRoot(file.path)]),
      ],
      root,
      MAX_DIFF_BYTES,
    )
  } catch (error) {
    if ((error as { code?: string }).code === 'too-large') return { ...base, kind: 'too-large' }
    throw error
  }
  const { lines, eucKrLines } = decodeDiffOutput(output)
  const parsed = parseUnifiedDiff(lines, eucKrLines)
  if (parsed.isBinary) return { ...base, kind: 'binary' }
  if (parsed.hunks.length === 0) return { ...base, kind: 'empty' }
  return { ...base, kind: 'diff', hunks: parsed.hunks, encoding: parsed.isEucKr ? 'euc-kr' : 'utf-8' }
}
