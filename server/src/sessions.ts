import { readdir, readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AskQuestion, HookStatus, Session, SessionStatus, Shell } from './types.js'
import type { HookState } from './hookState.js'
import { summarizeTranscript, type TranscriptSummary, type TurnOutcome } from './transcript.js'
import { hasWakingTask, runningBackgroundTasks, runningShells, type BackgroundTask } from './shells.js'
import { turnEndStatus, type TurnEndFacts } from './turnEnd.js'
import { readLiveSessions, type LiveSession } from './liveSessions.js'
import { modelSettingOf } from './memberModel.js'
import { partOfSession, roleOf, teamOf, type Team } from '@jk-corp/host/team'
import type { OffDutyRecord, SessionCharacter, SessionGender, WebSessionRecord } from '@jk-corp/host/hq'

const claudeDir = join(homedir(), '.claude')
export const projectsDir = join(claudeDir, 'projects')
const sessionsDir = join(claudeDir, 'sessions')

/** jsonl 한 번 읽어 세션 목록에 쓰는 것: 요약, 지금 도는 백그라운드 shell(Session.shells)과 백그라운드 작업 전부(shell·MCP·에이전트, waiting 판정) */
export interface TranscriptAnalysis {
  summary: TranscriptSummary
  shells: Shell[]
  backgroundTasks: BackgroundTask[]
}

interface CachedSummary extends TranscriptAnalysis {
  size: number
  mtimeMs: number
}

/**
 * 세션 jsonl 의 경로와 요약·백그라운드 shell 을 서버 메모리에 둔다. 세션 목록은 5초마다 다시 만드는데
 * 끝난 세션의 파일은 바뀌지 않으므로, 크기·수정 시각이 그대로면 다시 읽지 않고 재사용한다
 */
export class TranscriptCache {
  private readonly projectsDir: string
  /** 세션 ID → jsonl 경로. 찾은 것만 둔다 (새 세션은 잠시 뒤 파일이 생긴다) */
  private readonly paths = new Map<string, string>()
  /** jsonl 경로 → 읽기 직전의 크기·수정 시각과 그때의 요약·shell */
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

  /** jsonl 경로와 지금 크기·수정 시각 (내용은 읽지 않는다). 없으면 null */
  async file(sessionId: string): Promise<{ path: string; size: number; mtimeMs: number } | null> {
    const found = await this.locate(sessionId)
    return found && { path: found.path, size: found.stats.size, mtimeMs: found.stats.mtimeMs }
  }

  async summarize(sessionId: string): Promise<TranscriptSummary | null> {
    return (await this.analyze(sessionId))?.summary ?? null
  }

  async analyze(sessionId: string): Promise<TranscriptAnalysis | null> {
    const found = await this.locate(sessionId)
    if (!found) return null
    const { size, mtimeMs } = found.stats
    const cached = this.summaries.get(found.path)
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached
    let jsonl: string
    try {
      jsonl = await readFile(found.path, 'utf8')
    } catch {
      this.forget(sessionId)
      return null
    }
    // stat 을 읽기 전에 했으므로 그 사이 덧붙은 내용은 다음 번에 크기가 달라 다시 읽는다
    const analysis: CachedSummary = {
      size,
      mtimeMs,
      summary: summarizeTranscript(jsonl),
      shells: runningShells(jsonl),
      backgroundTasks: runningBackgroundTasks(jsonl),
    }
    this.summaries.set(found.path, analysis)
    return analysis
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

/** jsonl 경로와 크기·수정 시각 (같은 경로 캐시로 찾는다). 없으면 null */
export async function findTranscriptFile(sessionId: string): Promise<{ path: string; size: number; mtimeMs: number } | null> {
  return transcripts.file(sessionId)
}

/** 세션 목록과 같은 캐시의 요약 (stat 이 같으면 다시 읽지 않는다). jsonl 이 없으면 null */
export async function findTranscriptSummary(sessionId: string): Promise<TranscriptSummary | null> {
  return transcripts.summarize(sessionId)
}

/** 세션 목록과 같은 캐시의 분석 (요약·shell·백그라운드 작업). jsonl 이 없으면 null */
export async function findTranscriptAnalysis(sessionId: string): Promise<TranscriptAnalysis | null> {
  return transcripts.analyze(sessionId)
}

/** 살아 있는 pid 기록 (cwd 포함). 없으면 undefined */
export async function findLiveSession(sessionId: string): Promise<LiveSession | undefined> {
  return (await readLiveSessions(sessionsDir)).find((s) => s.sessionId === sessionId)
}

/** pid 기록이 살아 있는 세션인지. 근무 판정은 이것 또는 호스트 목록 (listSessions 의 attendance 와 같은 기준) */
export async function isLiveSession(sessionId: string): Promise<boolean> {
  return (await readLiveSessions(sessionsDir)).some((s) => s.sessionId === sessionId)
}

/**
 * 훅 상태로 본 상태. 호스트 재시작 때 claude 가 끝나며 SessionEnd 가 오는데 --resume 으로 다시 떠도 SessionStart 훅이 오지 않아
 * 근무 중인데 ended 로 남는다. 그래서 근무 중인 ended 는 끝나기 직전이 my-turn 이면 my-turn, 아니면 idle 로 보인다
 * (working·needs-approval 은 프로세스와 함께 사라졌다). 휴식·퇴근은 훅 상태 그대로
 */
export function displayStatus(hook: HookState | undefined, attendance: Session['attendance']): HookStatus {
  if (!hook) return 'unknown'
  if (attendance !== 'present' || hook.status !== 'ended') return hook.status
  return hook.statusBeforeEnd === 'my-turn' ? 'my-turn' : 'idle'
}

/**
 * 세션 목록의 표시 상태 (Session.status). displayStatus 가 my-turn 인 근무 중 세션만 waiting·done·my-turn 으로 가른다 (turnEnd.ts).
 * 휴식·퇴근과 그 밖의 상태는 displayStatus 그대로.
 * 근무 중인데 훅 상태로 차례를 알 수 없으면(훅 없음·unknown, 또는 ended 인데 끝나기 직전이 my-turn 이 아님 — 서버·호스트 재시작) jsonl 의 마지막 차례(turn)로 다시 만든다:
 * ended → 마지막 말로 turnEnd 규칙, interrupted·cut → my-turn, in-progress → 훅을 모르면 working(프로세스가 살아 있다. 다음 훅이 고친다)·재시작 뒤 ended 면 my-turn(프로세스가 죽었다 다시 떠 차례가 끊겼다),
 * none → 지금대로(unknown·idle). 훅 상태가 있는 평소 경우는 그대로다
 */
export function sessionStatus(
  hook: HookState | undefined,
  attendance: Session['attendance'],
  facts: () => Omit<TurnEndFacts, 'lastPromptAt' | 'isInterrupted'>,
  turn: TurnOutcome | null = null,
): SessionStatus {
  if (attendance === 'present' && turn && turn.kind !== 'none') {
    const isHookUnknown = !hook || hook.status === 'unknown'
    const isRestarted = hook?.status === 'ended' && hook.statusBeforeEnd !== 'my-turn'
    if (isHookUnknown || isRestarted) {
      if (turn.kind === 'ended') {
        return turnEndStatus({ ...facts(), lastAssistantText: turn.text, lastPromptAt: hook?.lastPromptAt ?? null, isInterrupted: false })
      }
      if (turn.kind === 'in-progress' && isHookUnknown) return 'working'
      return 'my-turn'
    }
  }
  const status = displayStatus(hook, attendance)
  if (status !== 'my-turn' || attendance !== 'present' || !hook) return status
  return turnEndStatus({ ...facts(), lastPromptAt: hook.lastPromptAt, isInterrupted: hook.isInterrupted })
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
  /** hq.json webSessions. 프로세스가 없으면 휴식 */
  recorded: WebSessionRecord[] = [],
  /** hq.json offDuty (퇴근) */
  offDuty: OffDutyRecord[] = [],
  /** hq.json characters (사용자가 고른 도트 인물) */
  characters: Record<string, SessionCharacter> = {},
  /** hq.json genders (서버가 이름을 지은 세션의 성별) */
  genders: Record<string, SessionGender> = {},
  /** hq.json positions (세션 역할) */
  positions: Record<string, string> = {},
  /** 팀원 세션의 가장 최근 task (teamState). 표시 상태 done 판정용 */
  latestTaskOf: (sessionId: string) => TurnEndFacts['latestTask'] = () => null,
): Promise<Session[]> {
  const live = await readLiveSessions(sessionsDir)
  const recordedById = new Map(recorded.map((r) => [r.sessionId, r]))
  const offDutyById = new Map(offDuty.map((r) => [r.sessionId, r]))
  // 훅 상태만 있는 세션(끝난 외부 세션 등)은 넣지 않는다. 훅 상태는 상태 표시용
  const ids = new Set<string>([
    ...live.map((s) => s.sessionId),
    ...webSessions.keys(),
    ...recordedById.keys(),
    ...offDutyById.keys(),
  ])
  transcripts.retain(ids)

  const sessions = await Promise.all(
    [...ids].map(async (id): Promise<Session> => {
      const liveEntry = live.find((s) => s.sessionId === id)
      const hook = hookStates.get(id)
      const analysis = await transcripts.analyze(id)
      const transcript = analysis?.summary
      // 근무가 이긴다 (터미널에서 직접 resume 한 퇴근 세션은 근무 중인 외부 세션)
      const attendance = liveEntry || webSessions.has(id) ? 'present' : recordedById.has(id) ? 'break' : 'off'
      const record = recordedById.get(id) ?? offDutyById.get(id)
      const cwd =
        attendance === 'present' ? (liveEntry?.cwd ?? hook?.cwd ?? webSessions.get(id) ?? '') : (record?.cwd ?? '')
      const isWeb = webSessions.has(id) || attendance !== 'present'
      const off = attendance === 'off' ? offDutyById.get(id) : undefined
      const team = teamOf(cwd, teams)
      const part = partOfSession(id, cwd, team)
      const heldQuestions = questions.get(id)
      const role = roleOf(id, isWeb, team, part)
      const lastAssistantText = hook?.lastAssistantText ?? transcript?.lastAssistantText ?? null
      return {
        id,
        cwd,
        name: names[id] ?? null,
        position: positions[id] ?? null,
        character: characters[id] ?? null,
        gender: genders[id] ?? null,
        title: transcript?.title ?? null,
        createdAt: record?.createdAt || (transcript?.startedAt ?? null),
        status: sessionStatus(hook, attendance, () => ({
          hasRunningBackground: hasWakingTask(analysis?.backgroundTasks ?? []),
          latestTask: role === 'member' ? latestTaskOf(id) : null,
          lastAssistantText,
        }), transcript?.turn ?? null),
        kind: isWeb ? 'web' : 'external',
        attendance,
        isAlive: attendance === 'present',
        offDuty: off ? { endedAt: off.endedAt, reason: off.reason, exitCode: off.exitCode } : null,
        lastAt: transcript?.lastAt ?? hook?.updatedAt ?? null,
        turnEndedAt: transcript?.turnEndedAt ?? null,
        lastAssistantText,
        model: transcript?.model ?? null,
        effort: transcript?.effort ?? null,
        modelSetting: isWeb ? modelSettingOf(record?.extraArgs ?? []) : null,
        contextTokens: transcript?.contextTokens ?? null,
        pendingTool: hook?.pendingTool ?? null,
        workingSince: hook?.workingSince ?? null,
        teamId: team?.id ?? null,
        partId: part?.id ?? null,
        role,
        question: heldQuestions ? { questions: heldQuestions } : null,
        suggestion: isWeb ? (suggestions.get(id) ?? null) : null,
        // 프로세스가 없으면(휴식·퇴근) 그 프로세스가 띄운 shell 도 없다
        shells: attendance === 'present' ? (analysis?.shells ?? []) : [],
      }
    }),
  )
  return sessions.sort(compareByCreatedAt)
}

/** 시각 문자열 → ms. 비었거나 해석이 안 되면 null */
function createdAtMs(createdAt: string | null): number | null {
  if (!createdAt) return null
  const ms = Date.parse(createdAt)
  return Number.isNaN(ms) ? null : ms
}

/**
 * 세션 목록 순서: 생성 시각 오름차순(오래된 것 먼저), 모르는 것은 맨 뒤, 같으면 id 오름차순.
 * 문자열이 아니라 시각으로 비교한다 (밀리초 유무·Z/오프셋이 다른 ISO 도 맞게)
 */
export function compareByCreatedAt(a: Pick<Session, 'id' | 'createdAt'>, b: Pick<Session, 'id' | 'createdAt'>): number {
  const aMs = createdAtMs(a.createdAt)
  const bMs = createdAtMs(b.createdAt)
  if (aMs !== bMs) {
    if (aMs === null) return 1
    if (bMs === null) return -1
    return aMs - bMs
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
