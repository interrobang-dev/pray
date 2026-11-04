import { open, readdir, readFile, stat, type FileHandle } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { AskQuestion, HookStatus, Session, SessionStatus, Shell } from './types.js'
import type { HookState } from './hookState.js'
import {
  applyTranscriptRecord,
  copyTranscriptState,
  newTranscriptState,
  parseRecord,
  summaryOf,
  type TranscriptState,
  type TranscriptSummary,
  type TurnOutcome,
} from './transcript.js'
import {
  applyBackgroundRecord,
  copyBackgroundState,
  hasWakingTask,
  newBackgroundState,
  runningBackgroundTasksOf,
  runningShellsOf,
  type BackgroundState,
  type BackgroundTask,
} from './shells.js'
import { turnEndStatus, type TurnEndFacts } from './turnEnd.js'
import { readLiveSessions, type LiveSession } from './liveSessions.js'
import { modelSettingOf } from './memberModel.js'
import { partOfSession, roleOf, teamOf, type Team } from '@pray/host/team'
import type { OffDutyRecord, SessionCharacter, SessionGender, WebSessionRecord } from '@pray/host/hq'

const claudeDir = join(homedir(), '.claude')
export const projectsDir = join(claudeDir, 'projects')
const sessionsDir = join(claudeDir, 'sessions')

/** jsonl 한 번 읽어 세션 목록에 쓰는 것: 요약, 지금 도는 백그라운드 shell(Session.shells)과 백그라운드 작업 전부(shell·MCP·에이전트, waiting 판정) */
export interface TranscriptAnalysis {
  summary: TranscriptSummary
  shells: Shell[]
  backgroundTasks: BackgroundTask[]
}

/** 덧붙은 것만 읽을 때 앞부분이 그대로인지(다른 파일로 바뀌지 않았는지) 보려고 같이 다시 읽는, 지난번에 넣은 끝 바로 앞 바이트 수 */
const GUARD_BYTES = 256
/** 한 번에 읽는 바이트. 조각 사이에 이벤트 루프가 돈다 (처음 읽는 큰 jsonl 이 다른 요청을 오래 막지 않게) */
const READ_CHUNK_BYTES = 4 * 1024 * 1024
const NEWLINE = 0x0a

interface CachedSummary {
  /** 읽기 직전 stat 값 (파일이 읽는 사이 줄었으면 실제로 읽은 끝) */
  size: number
  mtimeMs: number
  /** 끝난 줄(줄바꿈까지)만 상태에 넣은 바이트 수. 그 뒤(덜 쓰였을 수 있는 마지막 줄)는 다음 번에 다시 읽는다 */
  committedBytes: number
  /** committedBytes 바로 앞 최대 GUARD_BYTES 바이트 (복사본) */
  guard: Buffer
  transcript: TranscriptState
  background: BackgroundState
  analysis: TranscriptAnalysis
}

/** 파일의 [start, end) 를 조각으로 읽어 끝난 줄마다 onLine. 반환: 마지막 줄바꿈 다음 위치와 그 뒤 남은 바이트, 실제로 읽은 끝 */
async function readLines(
  handle: FileHandle,
  start: number,
  end: number,
  chunkBytes: number,
  onLine: (line: string) => void,
): Promise<{ committedBytes: number; tail: Buffer; readEnd: number }> {
  let position = start
  /** 아직 줄바꿈을 못 본 앞 조각들 (한 줄이 조각보다 길 수 있다) */
  let pending: Buffer[] = []
  let committedBytes = start
  while (position < end) {
    const chunk = Buffer.alloc(Math.min(chunkBytes, end - position))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
    if (bytesRead === 0) break
    const bytes = chunk.subarray(0, bytesRead)
    position += bytesRead
    const lastNewline = bytes.lastIndexOf(NEWLINE)
    if (lastNewline < 0) {
      pending.push(bytes)
      continue
    }
    // 줄바꿈은 UTF-8 여러 바이트 글자 안에 나오지 않아 줄바꿈 바이트로 잘라 풀면 글자가 깨지지 않는다
    const lines = Buffer.concat([...pending, bytes.subarray(0, lastNewline)]).toString('utf8')
    for (const line of lines.split('\n')) onLine(line)
    committedBytes = position - bytesRead + lastNewline + 1
    pending = [Buffer.from(bytes.subarray(lastNewline + 1))]
  }
  return { committedBytes, tail: Buffer.concat(pending), readEnd: position }
}

/**
 * 세션 jsonl 의 경로와 요약·백그라운드 shell 을 서버 메모리에 둔다. 세션 목록은 5초마다 다시 만드는데
 * 끝난 세션의 파일은 바뀌지 않으므로, 크기·수정 시각이 그대로면 다시 읽지 않고 재사용한다.
 * 일하는 세션의 jsonl 은 계속 덧붙고 수백 MB 가 되기도 해서, 커졌고 지난번 끝 바로 앞 바이트(GUARD_BYTES)가 그대로면
 * 덧붙은 바이트만 읽어 줄 단위 중간 상태(TranscriptState·BackgroundState)에 이어서 넣는다. 줄었거나 앞이 바뀌었으면 처음부터 읽는다.
 * 덜 쓰인 마지막 줄은 상태에 넣지 않고, 해석이 되면 상태 복사본에 넣어 결과만 만든다 (전체를 한 번에 해석한 것과 같다).
 * 크기·수정 시각이 같은데 내용만 바뀐 파일은 모른다 (jsonl 은 덧붙기만 한다)
 */
export class TranscriptCache {
  private readonly projectsDir: string
  /** 세션 ID → jsonl 경로. 찾은 것만 둔다 (새 세션은 잠시 뒤 파일이 생긴다) */
  private readonly paths = new Map<string, string>()
  /** jsonl 경로 → 읽기 직전의 크기·수정 시각과 그때까지의 중간 상태·결과 */
  private readonly summaries = new Map<string, CachedSummary>()
  /** jsonl 경로 → 읽는 중인 작업. 같은 파일을 동시에 읽으면 같은 줄이 상태에 두 번 들어가서 끝나기를 기다린다 */
  private readonly updating = new Map<string, Promise<unknown>>()

  private readonly readChunkBytes: number

  /** readChunkBytes 는 테스트가 줄보다 작은 조각을 시험하려고 준다 */
  constructor(projectsDir: string, readChunkBytes = READ_CHUNK_BYTES) {
    this.projectsDir = projectsDir
    this.readChunkBytes = readChunkBytes
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
    const { path } = found
    const { size, mtimeMs } = found.stats
    const cached = this.summaries.get(path)
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.analysis
    const running = this.updating.get(path)
    if (running) {
      await running
      return this.analyze(sessionId)
    }
    // 읽다 실패해도 반쯤 바뀐 상태가 남지 않게 먼저 뺀다
    this.summaries.delete(path)
    const update = this.update(path, size, mtimeMs, cached)
    this.updating.set(path, update)
    let entry: CachedSummary
    try {
      entry = await update
    } catch {
      this.forget(sessionId)
      return null
    } finally {
      this.updating.delete(path)
    }
    // 읽는 사이 retain 이 지운 세션이면 두지 않는다 (경로 Map 에 없으면 다시 지울 길이 없다)
    if (this.paths.get(sessionId) === path) this.summaries.set(path, entry)
    return entry.analysis
  }

  /** stat 크기까지 읽어 상태를 만든다. cached 를 이어 쓸 수 있으면 덧붙은 것만 읽는다. 읽기 실패는 던진다 */
  private async update(path: string, size: number, mtimeMs: number, cached: CachedSummary | undefined): Promise<CachedSummary> {
    const handle = await open(path, 'r')
    try {
      if (cached && size >= cached.committedBytes) {
        const guard = Buffer.alloc(cached.guard.length)
        const { bytesRead } = await handle.read(guard, 0, guard.length, cached.committedBytes - guard.length)
        if (bytesRead === guard.length && guard.equals(cached.guard)) return await this.append(handle, cached, size, mtimeMs)
      }
      const fresh: CachedSummary = {
        size: 0,
        mtimeMs: 0,
        committedBytes: 0,
        guard: Buffer.alloc(0),
        transcript: newTranscriptState(),
        background: newBackgroundState(),
        analysis: { summary: summaryOf(newTranscriptState()), shells: [], backgroundTasks: [] },
      }
      return await this.append(handle, fresh, size, mtimeMs)
    } finally {
      await handle.close()
    }
  }

  /** entry.committedBytes 부터 size 까지 읽어 끝난 줄은 상태에 넣고, 덜 쓰인 마지막 줄은 복사본에만 넣어 결과를 만든다 */
  private async append(handle: FileHandle, entry: CachedSummary, size: number, mtimeMs: number): Promise<CachedSummary> {
    const { transcript, background } = entry
    const { committedBytes, tail, readEnd } = await readLines(handle, entry.committedBytes, size, this.readChunkBytes, (line) => {
      const record = parseRecord(line)
      if (!record) return
      applyTranscriptRecord(transcript, record)
      applyBackgroundRecord(background, record)
    })
    if (committedBytes > entry.committedBytes) {
      const guard = Buffer.alloc(Math.min(GUARD_BYTES, committedBytes))
      const { bytesRead } = await handle.read(guard, 0, guard.length, committedBytes - guard.length)
      entry.guard = guard.subarray(0, bytesRead)
    }
    entry.committedBytes = committedBytes
    const lastRecord = parseRecord(tail.toString('utf8'))
    let finalTranscript = transcript
    let finalBackground = background
    if (lastRecord) {
      finalTranscript = copyTranscriptState(transcript)
      finalBackground = copyBackgroundState(background)
      applyTranscriptRecord(finalTranscript, lastRecord)
      applyBackgroundRecord(finalBackground, lastRecord)
    }
    entry.analysis = {
      summary: summaryOf(finalTranscript),
      shells: runningShellsOf(finalBackground),
      backgroundTasks: runningBackgroundTasksOf(finalBackground),
    }
    // 읽는 사이 파일이 줄었으면 실제로 읽은 끝을 크기로 둔다 (다음 번에 크기가 달라 다시 본다)
    entry.size = readEnd
    entry.mtimeMs = mtimeMs
    return entry
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
  /** hq.json characters (사용자가 고른 도트 인물·자동 배정) */
  characters: Record<string, SessionCharacter> = {},
  /** hq.json genders (서버가 이름을 지은 세션의 성별) */
  genders: Record<string, SessionGender> = {},
  /** hq.json positions (세션 역할) */
  positions: Record<string, string> = {},
  /** 팀원 세션의 가장 최근 task (teamState). 표시 상태 done 판정용 */
  latestTaskOf: (sessionId: string) => TurnEndFacts['latestTask'] = () => null,
  /** 인계 중이면 직전 지시자 이름 (index.ts 의 handoffState) */
  handoverOf: (sessionId: string) => Session['handover'] = () => null,
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
        turnUsage: transcript?.turnUsage ?? null,
        pendingTool: hook?.pendingTool ?? null,
        workingSince: hook?.workingSince ?? null,
        teamId: team?.id ?? null,
        partId: part?.id ?? null,
        role,
        question: heldQuestions ? { questions: heldQuestions } : null,
        suggestion: isWeb ? (suggestions.get(id) ?? null) : null,
        handover: handoverOf(id),
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
