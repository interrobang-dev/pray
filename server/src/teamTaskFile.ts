import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Task, TaskStatus, TaskStore } from './teamState.js'
import type { TaskUsage } from './taskUsage.js'

/** 끝난 task 를 남기는 기간. 지나면 파일과 메모리에서 지운다 */
export const TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** 팀원 운영 기록(spawn·dismiss)을 남기는 기간. 한 줄이 작아 task 보다 길게 둔다 */
export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 팀원 운영 기록 한 줄. 팀원 만들기·정리 기준(문맥 크기·쉰 시간)을 실제 데이터로 맞추려고 남긴다 (분석 화면은 없다).
 * spawn 은 새 세션이라 contextTokens·idleSince 가 늘 null 이고 model·effort 는 팀장이 고른 별칭(빼면 null),
 * dismiss 는 정리 직전 세션 목록 값 (model 은 jsonl 의 전체 이름)
 */
export interface TeamEvent {
  kind: 'spawn' | 'dismiss'
  at: string
  teamId: string
  /** 지휘 단위. null 이면 팀 직속 */
  partId: string | null
  sessionId: string
  position: string | null
  model: string | null
  effort: string | null
  contextTokens: number | null
  idleSince: string | null
}

/** `~/.claude/pray/team-tasks.json` 의 꼴. task 는 넣은 순서(오래된 것 먼저) — latestOf·wait 가 그 순서를 쓴다 */
export interface TeamTaskData {
  version: 1
  tasks: Task[]
  events: TeamEvent[]
}

const TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['running', 'done', 'failed'])

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const USAGE_KEYS = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'turns'] as const

/** 저장된 task 사용량. 칸 하나라도 숫자가 아니면 null */
function usageOrNull(value: unknown): TaskUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!USAGE_KEYS.every((key) => numberOrNull(v[key]) !== null)) return null
  return {
    inputTokens: v.inputTokens as number,
    outputTokens: v.outputTokens as number,
    cacheCreationTokens: v.cacheCreationTokens as number,
    cacheReadTokens: v.cacheReadTokens as number,
    turns: v.turns as number,
  }
}

/** 저장된 task 한 개. 꼴이 틀리면 null (그 항목만 버린다). 나중에 더한 칸이 없는 옛 항목은 null 로 채운다 */
export function parseTask(value: unknown): Task | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.teamId !== 'string' || typeof v.memberSessionId !== 'string') return null
  if (typeof v.instruction !== 'string' || typeof v.createdAt !== 'string') return null
  if (!TASK_STATUSES.has(v.status as TaskStatus)) return null
  return {
    id: v.id,
    teamId: v.teamId,
    partId: stringOrNull(v.partId),
    memberSessionId: v.memberSessionId,
    instruction: v.instruction,
    status: v.status as TaskStatus,
    isAcknowledged: v.isAcknowledged === true,
    result: stringOrNull(v.result),
    error: stringOrNull(v.error),
    createdAt: v.createdAt,
    finishedAt: stringOrNull(v.finishedAt),
    isDelivered: v.isDelivered === true,
    startContextTokens: numberOrNull(v.startContextTokens),
    startIdleSince: stringOrNull(v.startIdleSince),
    endContextTokens: numberOrNull(v.endContextTokens),
    usage: usageOrNull(v.usage),
    model: stringOrNull(v.model),
  }
}

export function parseEvent(value: unknown): TeamEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.kind !== 'spawn' && v.kind !== 'dismiss') return null
  if (typeof v.at !== 'string' || typeof v.teamId !== 'string' || typeof v.sessionId !== 'string') return null
  return {
    kind: v.kind,
    at: v.at,
    teamId: v.teamId,
    partId: stringOrNull(v.partId),
    sessionId: v.sessionId,
    position: stringOrNull(v.position),
    model: stringOrNull(v.model),
    effort: stringOrNull(v.effort),
    contextTokens: numberOrNull(v.contextTokens),
    idleSince: stringOrNull(v.idleSince),
  }
}

/** 파일 글 → 내용. 해석이 안 되거나 꼴이 틀리면 던진다 (항목 하나가 틀린 것은 그 항목만 버린다) */
export function parseTeamTaskData(text: string): TeamTaskData {
  const raw = JSON.parse(text) as unknown
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { tasks?: unknown }).tasks)) {
    throw new Error('tasks 배열이 없음')
  }
  const { tasks, events } = raw as { tasks: unknown[]; events?: unknown }
  return {
    version: 1,
    tasks: tasks.map(parseTask).filter((task): task is Task => task !== null),
    events: Array.isArray(events) ? events.map(parseEvent).filter((event): event is TeamEvent => event !== null) : [],
  }
}

/** 지난 기록 빼기 (경계 시각은 남긴다) */
export function pruneEvents(events: readonly TeamEvent[], now: Date, retentionMs: number): TeamEvent[] {
  const limit = now.getTime() - retentionMs
  return events.filter((event) => !(new Date(event.at).getTime() < limit))
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

/** hq.ts 의 writeHq 와 같은 방식: 같은 폴더 임시 파일에 다 쓴 뒤 바꿔 끼운다 (Windows 의 잠김은 50ms 간격 5번까지) */
export function writeTeamTaskFile(path: string, data: TeamTaskData): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(data) + '\n')
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tempPath, path)
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS)
      }
    }
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

/**
 * 파일 → 내용. 없으면 빈 내용. 못 읽거나 깨졌으면 빈 내용과 경고를 주고, 깨진 파일은 `<이름>.broken-<시각>` 으로 옮겨 둔다
 * (다음 저장이 덮어써 흔적이 사라지지 않게. 옮기기도 실패하면 그대로 둔다 — 다음 저장이 덮어쓴다). 던지지 않는다
 */
export function readTeamTaskFile(path: string, now: Date = new Date()): { data: TeamTaskData; warning: string | null } {
  const empty: TeamTaskData = { version: 1, tasks: [], events: [] }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { data: empty, warning: null }
    return { data: empty, warning: `팀 task 파일을 못 읽어 빈 상태로 시작 (${path}): ${error}` }
  }
  try {
    return { data: parseTeamTaskData(text), warning: null }
  } catch (error) {
    const brokenPath = `${path}.broken-${now.toISOString().replace(/[:.]/g, '-')}`
    let moved = ''
    try {
      renameSync(path, brokenPath)
      moved = `, ${brokenPath} 로 옮김`
    } catch {
      // 옮기지 못하면 다음 저장이 덮어쓴다
    }
    return { data: empty, warning: `팀 task 파일이 깨져 빈 상태로 시작 (${path}${moved}): ${error}` }
  }
}

/**
 * 팀 task 와 운영 기록을 `~/.claude/pray/team-tasks.json` 에 둔다 (hq.json 과 따로 — 서버만 쓴다).
 * 저장은 TaskStore 의 onChange 와 기록을 더할 때마다 파일 전체를 다시 쓰고, 그때 보관 기간이 지난 것을 지운다.
 * load·save·record 는 던지지 않는다 (훅·타이머·호스트 이벤트에서 불린다). 실패 로그는 실패·복구로 바뀔 때만 한 줄
 */
export class TeamTaskLog {
  private events: TeamEvent[] = []
  private isFailing = false

  constructor(
    private readonly path: string,
    private readonly store: TaskStore,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (line: string) => void = (line) => console.error(line),
  ) {}

  /** 서버 시작 때 한 번. 파일의 task 를 store 에 되살린다 */
  load(): void {
    const { data, warning } = readTeamTaskFile(this.path, this.now())
    if (warning) this.log(warning)
    this.store.restore(data.tasks)
    this.events = data.events
    this.store.prune(TASK_RETENTION_MS)
    this.events = pruneEvents(this.events, this.now(), EVENT_RETENTION_MS)
  }

  listEvents(): TeamEvent[] {
    return [...this.events]
  }

  record(event: Omit<TeamEvent, 'at'>): void {
    this.events.push({ at: this.now().toISOString(), ...event })
    this.save()
  }

  save(): void {
    try {
      this.store.prune(TASK_RETENTION_MS)
      this.events = pruneEvents(this.events, this.now(), EVENT_RETENTION_MS)
      writeTeamTaskFile(this.path, { version: 1, tasks: this.store.list(), events: this.events })
      if (this.isFailing) this.log(`팀 task 파일 저장 복구 (${this.path})`)
      this.isFailing = false
    } catch (error) {
      if (!this.isFailing) this.log(`팀 task 파일 저장 실패 (${this.path}): ${error}`)
      this.isFailing = true
    }
  }
}
