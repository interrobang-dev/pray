import { readdir, readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AskQuestion, Session } from './types.js'
import type { HookState } from './hookState.js'
import { summarizeTranscript, type TranscriptSummary } from './transcript.js'
import { readLiveSessions } from './liveSessions.js'
import { partOfSession, roleOf, teamOf, type Team } from '@jk-corp/host/team'

const claudeDir = join(homedir(), '.claude')
export const projectsDir = join(claudeDir, 'projects')
const sessionsDir = join(claudeDir, 'sessions')

interface CachedSummary {
  size: number
  mtimeMs: number
  summary: TranscriptSummary
}

/**
 * 세션 jsonl 의 경로와 요약을 서버 메모리에 둔다. 세션 목록은 5초마다 다시 만드는데
 * 끝난 세션의 파일은 바뀌지 않으므로, 크기·수정 시각이 그대로면 다시 읽지 않고 요약을 재사용한다
 */
export class TranscriptCache {
  private readonly projectsDir: string
  /** 세션 ID → jsonl 경로. 찾은 것만 둔다 (새 세션은 잠시 뒤 파일이 생긴다) */
  private readonly paths = new Map<string, string>()
  /** jsonl 경로 → 읽기 직전의 크기·수정 시각과 그때의 요약 */
  private readonly summaries = new Map<string, CachedSummary>()

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir
  }

  /** 파일 내용 전체. 없으면 null */
  async read(sessionId: string): Promise<string | null> {
    const found = await this.locate(sessionId)
    if (!found) return null
    try {
      return await readFile(found.path, 'utf8')
    } catch {
      this.forget(sessionId)
      return null
    }
  }

  async summarize(sessionId: string): Promise<TranscriptSummary | null> {
    const found = await this.locate(sessionId)
    if (!found) return null
    const { size, mtimeMs } = found.stats
    const cached = this.summaries.get(found.path)
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.summary
    let jsonl: string
    try {
      jsonl = await readFile(found.path, 'utf8')
    } catch {
      this.forget(sessionId)
      return null
    }
    // stat 을 읽기 전에 했으므로 그 사이 덧붙은 내용은 다음 번에 크기가 달라 다시 읽는다
    const summary = summarizeTranscript(jsonl)
    this.summaries.set(found.path, { size, mtimeMs, summary })
    return summary
  }

  /** ids 에 없는 세션의 캐시를 지운다 (메모리가 계속 늘지 않게) */
  retain(ids: ReadonlySet<string>): void {
    for (const sessionId of this.paths.keys()) {
      if (!ids.has(sessionId)) this.forget(sessionId)
    }
  }

  private forget(sessionId: string): void {
    const path = this.paths.get(sessionId)
    if (path === undefined) return
    this.summaries.delete(path)
    this.paths.delete(sessionId)
  }

  /** 기억한 경로를 stat 하고, 실패하면(이동·삭제) 잊고 projects 아래 폴더를 다시 훑는다 */
  private async locate(sessionId: string): Promise<{ path: string; stats: Stats } | null> {
    const cachedPath = this.paths.get(sessionId)
    if (cachedPath !== undefined) {
      try {
        return { path: cachedPath, stats: await stat(cachedPath) }
      } catch {
        this.forget(sessionId)
      }
    }
    let projectNames: string[]
    try {
      projectNames = await readdir(this.projectsDir)
    } catch {
      return null
    }
    for (const projectName of projectNames) {
      const path = join(this.projectsDir, projectName, `${sessionId}.jsonl`)
      try {
        const stats = await stat(path)
        this.paths.set(sessionId, path)
        return { path, stats }
      } catch {
        continue
      }
    }
    return null
  }
}

const transcripts = new TranscriptCache(projectsDir)

export async function findTranscript(sessionId: string): Promise<string | null> {
  return transcripts.read(sessionId)
}

export async function listSessions(
  hookStates: Map<string, HookState>,
  webSessions: Map<string, string>,
  teams: Team[] = [],
  names: Record<string, string> = {},
  /** 서버가 붙잡고 있는 AskUserQuestion (세션 ID → 질문) */
  questions: ReadonlyMap<string, AskQuestion[]> = new Map(),
  /** mod 가 POST /api/hook/suggestion 으로 보낸 입력칸 제안 (세션 ID → 글) */
  suggestions: ReadonlyMap<string, string> = new Map(),
): Promise<Session[]> {
  const live = await readLiveSessions(sessionsDir)
  const ids = new Set<string>([...live.map((s) => s.sessionId), ...hookStates.keys(), ...webSessions.keys()])
  transcripts.retain(ids)

  const sessions = await Promise.all(
    [...ids].map(async (id): Promise<Session> => {
      const liveEntry = live.find((s) => s.sessionId === id)
      const hook = hookStates.get(id)
      const transcript = await transcripts.summarize(id)
      const cwd = liveEntry?.cwd ?? hook?.cwd ?? webSessions.get(id) ?? ''
      const isWeb = webSessions.has(id)
      const team = teamOf(cwd, teams)
      const part = partOfSession(id, cwd, team)
      const heldQuestions = questions.get(id)
      return {
        id,
        cwd,
        name: names[id] ?? null,
        title: transcript?.title ?? null,
        status: hook?.status ?? 'unknown',
        kind: isWeb ? 'web' : 'external',
        isAlive: liveEntry !== undefined || webSessions.has(id),
        lastAt: transcript?.lastAt ?? hook?.updatedAt ?? null,
        lastAssistantText: hook?.lastAssistantText ?? transcript?.lastAssistantText ?? null,
        model: transcript?.model ?? null,
        effort: transcript?.effort ?? null,
        pendingTool: hook?.pendingTool ?? null,
        workingSince: hook?.workingSince ?? null,
        teamId: team?.id ?? null,
        partId: part?.id ?? null,
        role: roleOf(id, isWeb, team, part),
        question: heldQuestions ? { questions: heldQuestions } : null,
        suggestion: isWeb ? (suggestions.get(id) ?? null) : null,
      }
    }),
  )
  return sessions.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}
