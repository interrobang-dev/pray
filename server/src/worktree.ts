import { execFile } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix } from 'node:path'
import { promisify } from 'node:util'
import { normalizeCwd } from '@jk-corp/host/team'

const run = promisify(execFile)

/** cwd 에서 git 명령. 0 이 아니면 execFile 오류로 던진다 (code = 종료 코드, stderr) */
function git(cwd: string, args: string[]) {
  return run('git', ['-C', cwd, ...args])
}

function stderrOf(error: unknown): string {
  return (error as { stderr?: string }).stderr?.trim() || (error as Error).message
}

/** 종료 코드 1 을 "아니오" 로 쓰는 git 질의 (show-ref --verify·merge-base --is-ancestor). 그 밖의 실패는 던진다 */
async function gitYesNo(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args)
    return true
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false
    throw error
  }
}

/** 파트 이름의 영문·숫자·하이픈만 남긴다. 비면 fallback (파트 ID) */
export function worktreeSlug(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || fallback
}

/** 저장소 옆 형제 폴더 `<부모>/<저장소>.worktrees/<슬러그>`. git 이 주는 `/` 경로 그대로 쓴다 (~/.claude.json 키와 같은 모양) */
export function worktreePath(repoTop: string, slug: string): string {
  const top = repoTop.replace(/\\/g, '/').replace(/\/+$/, '')
  return posix.join(posix.dirname(top), `${posix.basename(top)}.worktrees`, slug)
}

export class WorktreeError extends Error {
  constructor(
    message: string,
    /** 400 = 팀 폴더가 git 저장소가 아님, 409 = 만들 수 없음 (남의 폴더·다른 파트가 씀·git 실패) 또는 상태를 못 읽어 아무것도 안 지움 */
    readonly status: 400 | 409,
  ) {
    super(message)
  }
}

export interface ListedWorktree {
  path: string
  /** refs/heads/ 를 뗀 브랜치 이름. detached·bare 면 null */
  branch: string | null
}

/** `git worktree list --porcelain` 출력 → 항목들 (빈 줄로 나뉜 덩어리마다 `worktree <경로>`, `branch refs/heads/<이름>`) */
export function parseWorktreeList(porcelain: string): ListedWorktree[] {
  const worktrees: ListedWorktree[] = []
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!path) continue
    const ref = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
    worktrees.push({ path, branch: ref ? ref.replace(/^refs\/heads\//, '') : null })
  }
  return worktrees
}

/** 그 폴더가 이 저장소의 worktree 로 등록돼 있으면 그 항목 (폴더가 지워졌어도 등록은 남아 있을 수 있다) */
async function findWorktree(repoCwd: string, folder: string): Promise<ListedWorktree | undefined> {
  const key = normalizeCwd(folder)
  const listed = parseWorktreeList((await git(repoCwd, ['worktree', 'list', '--porcelain'])).stdout)
  return listed.find((worktree) => normalizeCwd(worktree.path) === key)
}

/**
 * 팀 폴더 저장소 옆 `<저장소>.worktrees/<슬러그>` 를 파트 폴더로 준비한다 (isLinked = 이미 있던 worktree·브랜치를 씀).
 * 이미 이 저장소의 worktree 면 새로 만들지 않고 그 폴더·브랜치로, 브랜치 `part/<슬러그>` 만 있으면 그 브랜치로 폴더를 만들고,
 * 둘 다 없으면 현재 HEAD 기준으로 새 브랜치와 함께 만든다. 폴더는 있는데 이 저장소의 worktree 가 아니면 409.
 * 등록만 남고 폴더가 없는 worktree 는 등록을 지운 뒤(`worktree remove`, 그 항목만) 브랜치만 있는 경우로 간다.
 * takenFolders = 다른 파트가 쓰는 worktree 폴더 (두 파트가 한 폴더를 쓰면 폴더로 정하는 소속이 깨진다)
 */
export async function createWorktree(
  teamCwd: string,
  slug: string,
  takenFolders: string[] = [],
): Promise<{ cwd: string; branch: string; isLinked: boolean }> {
  let repoTop: string
  try {
    repoTop = (await git(teamCwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
  } catch {
    throw new WorktreeError(`팀 폴더가 git 저장소가 아니라 worktree 를 만들 수 없음: ${teamCwd}`, 400)
  }
  const cwd = worktreePath(repoTop, slug)
  if (takenFolders.some((folder) => normalizeCwd(folder) === normalizeCwd(cwd))) {
    throw new WorktreeError(`다른 파트가 이미 쓰는 worktree 폴더: ${cwd}`, 409)
  }
  const branch = `part/${slug}`
  try {
    const listed = await findWorktree(teamCwd, cwd)
    if (listed && existsSync(cwd)) {
      if (!listed.branch) throw new WorktreeError(`이미 있는 worktree 가 브랜치 없이(detached) 체크아웃돼 있어 연결하지 않음: ${cwd}`, 409)
      return { cwd, branch: listed.branch, isLinked: true }
    }
    if (listed) await git(teamCwd, ['worktree', 'remove', cwd])
    else if (existsSync(cwd)) throw new WorktreeError(`폴더가 이미 있지만 이 저장소의 worktree 가 아님: ${cwd}`, 409)
    const hasBranch = await gitYesNo(teamCwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    await git(teamCwd, hasBranch ? ['worktree', 'add', cwd, branch] : ['worktree', 'add', cwd, '-b', branch])
    return { cwd, branch, isLinked: hasBranch }
  } catch (error) {
    if (error instanceof WorktreeError) throw error
    throw new WorktreeError(stderrOf(error), 409)
  }
}

/** 파트 삭제 때 병합 안 된 브랜치를 어떻게 할지 (요청의 ?branch=). null = 아직 안 정함 */
export type BranchChoice = 'delete' | 'keep' | null

export type WorktreeRemoval =
  /** 커밋하지 않은 변경(추적 안 하는 파일 포함)이 있어 아무것도 안 지움 */
  | { outcome: 'dirty' }
  /** 브랜치가 HEAD 에 병합되지 않았는데 선택이 없어 아무것도 안 지움 */
  | { outcome: 'branch-unmerged' }
  /**
   * 다 했다. folder: removed = 지움, missing = 이미 없었음(등록만 지움), not-worktree = 이 저장소의 worktree 가 아니라 건드리지 않음.
   * branch: deleted·kept·missing(이미 없었음)
   */
  | { outcome: 'removed'; folder: 'removed' | 'missing' | 'not-worktree'; branch: 'deleted' | 'kept' | 'missing' }
  /** 지우던 중 git 실패. message = 한 일과 실패. isWorktreeGone = worktree 는 없어졌다 (파트 기록도 지울 것) */
  | { outcome: 'failed'; message: string; isWorktreeGone: boolean }

/**
 * 파트의 worktree 폴더와 브랜치를 지운다. 먼저 상태만 보고(커밋 안 한 변경·병합 여부) 걸리면 아무것도 안 지운다.
 * 병합된 브랜치는 `-d`, 병합 안 된 것은 choice 가 delete 면 `-D`, keep 이면 남긴다 (keep 이면 병합됐어도 남긴다).
 * 상태를 못 읽으면 WorktreeError(409) — 아무것도 안 지웠다. repoCwd = 팀 폴더 (그 HEAD 에 병합됐는지 본다)
 */
export async function removeWorktree(
  repoCwd: string,
  worktree: { cwd: string; branch: string },
  choice: BranchChoice,
): Promise<WorktreeRemoval> {
  const { cwd, branch } = worktree
  const isFolderPresent = existsSync(cwd)
  let listed: ListedWorktree | undefined
  let hasBranch: boolean
  let isMerged: boolean
  try {
    listed = await findWorktree(repoCwd, cwd)
    if (listed && isFolderPresent && (await git(cwd, ['status', '--porcelain'])).stdout.trim()) return { outcome: 'dirty' }
    hasBranch = await gitYesNo(repoCwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    isMerged = hasBranch && (await gitYesNo(repoCwd, ['merge-base', '--is-ancestor', branch, 'HEAD']))
  } catch (error) {
    throw new WorktreeError(`git 으로 worktree 상태를 읽지 못해 아무것도 지우지 않음: ${stderrOf(error)}`, 409)
  }
  if (hasBranch && !isMerged && choice === null) return { outcome: 'branch-unmerged' }

  let folder: 'removed' | 'missing' | 'not-worktree' = isFolderPresent ? 'not-worktree' : 'missing'
  if (listed) {
    try {
      // 폴더가 이미 없으면 등록만 지운다
      await git(repoCwd, ['worktree', 'remove', cwd])
      folder = isFolderPresent ? 'removed' : 'missing'
    } catch (error) {
      // 지우기 전에 거절하면(잠김 등) 등록이 남는다. 지우다 실패하면(Windows 에서 그 폴더를 쓰는 프로세스) 파일·등록은 지워지고 폴더만 남는다
      const isWorktreeGone = (await findWorktree(repoCwd, cwd).catch(() => listed)) === undefined || !existsSync(join(cwd, '.git'))
      const message = isWorktreeGone
        ? `worktree 를 지웠지만 폴더가 남음 (${stderrOf(error)})${hasBranch ? `. 브랜치 ${branch} 는 남김` : ''}`
        : `worktree 를 지우지 못해 아무것도 지우지 않음: ${stderrOf(error)}`
      return { outcome: 'failed', message, isWorktreeGone }
    }
  }
  const folderDone = folder === 'removed' ? 'worktree 폴더를 지웠지만' : folder === 'missing' ? 'worktree 폴더는 이미 없었고' : 'worktree 가 아닌 폴더는 남겼고'
  if (!hasBranch) return { outcome: 'removed', folder, branch: 'missing' }
  if (choice === 'keep') return { outcome: 'removed', folder, branch: 'kept' }
  try {
    await git(repoCwd, ['branch', isMerged ? '-d' : '-D', branch])
  } catch (error) {
    return { outcome: 'failed', message: `${folderDone} 브랜치 ${branch} 를 지우지 못함: ${stderrOf(error)}`, isWorktreeGone: true }
  }
  return { outcome: 'removed', folder, branch: 'deleted' }
}

/** ~/.claude.json 텍스트에 그 폴더의 신뢰 표시를 넣은 새 텍스트. 이미 신뢰면 받은 텍스트 그대로, 파싱할 수 없으면 null */
export function withTrust(claudeJson: string, folder: string): string | null {
  let parsed: { projects?: Record<string, Record<string, unknown>> }
  try {
    parsed = JSON.parse(claudeJson)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const projects = parsed.projects ?? {}
  if (projects[folder]?.hasTrustDialogAccepted === true) return claudeJson
  projects[folder] = { ...projects[folder], hasTrustDialogAccepted: true }
  return JSON.stringify({ ...parsed, projects }, null, 2)
}

/**
 * claude 의 신뢰 확인 창(기본 선택 "No, exit")이 뜨지 않게 ~/.claude.json 에 그 폴더 키의 신뢰 표시를 남긴다.
 * Claude Code 가 이 파일을 수시로 다시 쓰므로 이미 신뢰면 쓰지 않고, 쓸 때는 읽은 직후 그 키 하나만 바꿔 바로 쓴다.
 * 실패하면 경고만 (사용자가 터미널에서 허용)
 */
export function markTrusted(folder: string, claudeJsonPath = posix.join(homedir().replace(/\\/g, '/'), '.claude.json')): boolean {
  try {
    const current = readFileSync(claudeJsonPath, 'utf8')
    const next = withTrust(current, folder)
    if (next === null) {
      console.warn(`~/.claude.json 을 해석할 수 없어 신뢰 표시를 못 남김: ${folder}`)
      return false
    }
    if (next !== current) writeFileSync(claudeJsonPath, next)
    return true
  } catch (error) {
    console.warn(`신뢰 표시 기록 실패: ${folder}`, error)
    return false
  }
}

/**
 * Claude Code 가 ~/.claude.json projects 에 쓰는 폴더 키: 실제 경로(드라이브 대문자·디스크의 대소문자)에 구분자 `/`
 * (예: `D:/workspace/@private/jk-corp`). `d:\workspace\...` 처럼 와도 같은 키가 된다. 폴더가 없으면 null
 */
export function trustKey(folder: string): string | null {
  try {
    return realpathSync.native(folder).replace(/\\/g, '/')
  } catch {
    return null
  }
}

/**
 * 웹에서 새로 띄우는 세션의 폴더를 신뢰로 기록한다 (확인 창을 아무도 안 누르면 기본 선택 "No, exit" 로 세션이 꺼진다).
 * true = 기록함 또는 이미 신뢰, false = 기록 실패 (화면이 경고), null = 폴더가 없어 기록 안 함 (spawn 이 실패하는 기존 흐름)
 */
export function markFolderTrusted(folder: string, claudeJsonPath?: string): boolean | null {
  const key = trustKey(folder)
  return key === null ? null : markTrusted(key, claudeJsonPath)
}
