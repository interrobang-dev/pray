import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

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
    /** 400 = 팀 폴더가 git 저장소가 아님, 409 = git worktree add 실패 (폴더·브랜치가 이미 있음 등) */
    readonly status: 400 | 409,
  ) {
    super(message)
  }
}

/** 팀 폴더 저장소의 현재 HEAD 기준으로 worktree 와 브랜치 `part/<슬러그>` 를 만든다 */
export async function createWorktree(teamCwd: string, slug: string): Promise<{ cwd: string; branch: string }> {
  let repoTop: string
  try {
    repoTop = (await run('git', ['-C', teamCwd, 'rev-parse', '--show-toplevel'])).stdout.trim()
  } catch {
    throw new WorktreeError(`팀 폴더가 git 저장소가 아니라 worktree 를 만들 수 없음: ${teamCwd}`, 400)
  }
  const cwd = worktreePath(repoTop, slug)
  const branch = `part/${slug}`
  try {
    await run('git', ['-C', teamCwd, 'worktree', 'add', cwd, '-b', branch])
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new WorktreeError(stderr || (error as Error).message, 409)
  }
  return { cwd, branch }
}

/** ~/.claude.json 텍스트에 그 폴더의 신뢰 표시를 넣은 새 텍스트. 파싱할 수 없으면 null */
export function withTrust(claudeJson: string, folder: string): string | null {
  let parsed: { projects?: Record<string, Record<string, unknown>> }
  try {
    parsed = JSON.parse(claudeJson)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const projects = parsed.projects ?? {}
  projects[folder] = { ...projects[folder], hasTrustDialogAccepted: true }
  return JSON.stringify({ ...parsed, projects }, null, 2)
}

/**
 * 새 worktree 에서 claude 의 신뢰 확인 창(기본 선택 "No, exit")이 뜨지 않게 ~/.claude.json 에 신뢰 표시를 남긴다.
 * Claude Code 가 이 파일을 수시로 다시 쓰므로 읽은 직후 그 키 하나만 바꿔 바로 쓴다. 실패하면 경고만 (사용자가 터미널에서 허용)
 */
export function markTrusted(folder: string, claudeJsonPath = posix.join(homedir().replace(/\\/g, '/'), '.claude.json')): boolean {
  try {
    const next = withTrust(readFileSync(claudeJsonPath, 'utf8'), folder)
    if (next === null) {
      console.warn(`~/.claude.json 을 해석할 수 없어 신뢰 표시를 못 남김: ${folder}`)
      return false
    }
    writeFileSync(claudeJsonPath, next)
    return true
  } catch (error) {
    console.warn(`신뢰 표시 기록 실패: ${folder}`, error)
    return false
  }
}
