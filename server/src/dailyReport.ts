import type { Part, Team, Todo, TodoPriority } from '@pray/host/team'
import type { TeamEvent } from './teamTaskFile.js'
import type { Task, TaskStatus } from './teamState.js'
import type { TaskUsage } from './taskUsage.js'
import type { MemberLookup } from './teamTaskHistory.js'

/**
 * 화면 "Today" 창(오늘 한 일)의 응답을 만드는 순수 함수. 날짜는 이 PC(서버)의 로컬 자정 기준이다 —
 * 다른 PC 의 화면이 자기 시계로 날짜를 정하면 시간대가 달라 하루가 어긋나므로 today·date 를 서버가 준다.
 * 커밋(dayCommits.ts)·토큰(dayUsage.ts)은 부르는 쪽(index.ts)이 읽어 넣는다
 */

/** 오늘부터 며칠 전까지 고를 수 있는지 (task 보관 7일 — teamTaskFile.ts TASK_RETENTION_MS) */
export const DAILY_MAX_DAYS_BACK = 7
/** 지시·결과 첫 줄 글자 수 */
export const DAILY_HEAD_LIMIT = 200

export interface DayRange {
  /** YYYY-MM-DD (로컬) */
  date: string
  /** 그날 로컬 자정 (포함) */
  from: Date
  /** 다음 날 로컬 자정 (제외) */
  to: Date
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 로컬 날짜 YYYY-MM-DD */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 로컬 날짜의 자정. +24h 로 계산하지 않는다 (서머타임이 있는 시간대에서 하루가 23·25시간) */
function localMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0)
}

/** 날짜 하나의 범위 */
export function dayRangeOf(date: Date): DayRange {
  const from = localMidnight(date.getFullYear(), date.getMonth(), date.getDate())
  const to = localMidnight(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return { date: localDateKey(from), from, to }
}

/** 고를 수 있는 가장 앞 날짜 (오늘 - DAILY_MAX_DAYS_BACK) */
export function oldestDateOf(now: Date): string {
  return localDateKey(localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - DAILY_MAX_DAYS_BACK))
}

/**
 * `?date=` 값 → 범위. 빠졌으면 오늘. 꼴이 틀리거나 없는 날짜(2월 30일)·오늘보다 뒤·DAILY_MAX_DAYS_BACK 보다 앞이면 null
 */
export function parseDayParam(value: unknown, now: Date): DayRange | null {
  if (value === undefined) return dayRangeOf(now)
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const from = localMidnight(year, month - 1, day)
  if (from.getFullYear() !== year || from.getMonth() !== month - 1 || from.getDate() !== day) return null
  const key = localDateKey(from)
  if (key > localDateKey(now) || key < oldestDateOf(now)) return null
  return dayRangeOf(from)
}

const isInRange = (iso: string | null, range: DayRange): boolean => {
  if (!iso) return false
  const at = new Date(iso).getTime()
  return at >= range.from.getTime() && at < range.to.getTime()
}

/** 빈 줄이 아닌 첫 줄 (앞뒤 공백 뗌), limit 자에서 자르고 "…". 글이 없으면 null */
export function firstLine(text: string | null, limit = DAILY_HEAD_LIMIT): string | null {
  if (!text) return null
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item !== '')
  if (!line) return null
  return line.length > limit ? `${line.slice(0, limit)}…` : line
}

export interface DailyTask {
  id: string
  partId: string | null
  memberSessionId: string
  memberName: string | null
  memberPosition: string | null
  status: TaskStatus
  isAcknowledged: boolean
  instructionHead: string | null
  resultHead: string | null
  hasError: boolean
  createdAt: string
  finishedAt: string | null
  usage: TaskUsage | null
  model: string | null
}

export interface DailyTodo {
  id: string
  text: string
  priority: TodoPriority | null
  doneAt: string
}

/** 그날 task: 끝난 시각이 그날이면 그날 것, 진행 중이면 지시 시각이 그날일 때. 끝난(또는 지시한) 시각 최근순 */
export function dailyTasksOf(teamId: string, tasks: readonly Task[], range: DayRange, lookup: MemberLookup): DailyTask[] {
  const timeOf = (task: Task) => task.finishedAt ?? task.createdAt
  return tasks
    .filter((task) => task.teamId === teamId && (task.status === 'running' ? isInRange(task.createdAt, range) : isInRange(task.finishedAt, range)))
    .sort((a, b) => (timeOf(a) === timeOf(b) ? 0 : timeOf(a) < timeOf(b) ? 1 : -1))
    .map((task) => {
      const member = lookup(task.memberSessionId)
      return {
        id: task.id,
        partId: task.partId,
        memberSessionId: task.memberSessionId,
        memberName: member?.name ?? null,
        memberPosition: member?.position ?? null,
        status: task.status,
        isAcknowledged: task.isAcknowledged,
        instructionHead: firstLine(task.instruction),
        resultHead: firstLine(task.result),
        hasError: Boolean(task.error),
        createdAt: task.createdAt,
        finishedAt: task.finishedAt,
        usage: task.usage,
        model: task.model,
      }
    })
}

/** 그날 끝낸 할 일 (끝낸 시각 최근순). 지운 완료(Clear done)는 없다 */
export function dailyTodosOf(todos: readonly Todo[], range: DayRange): DailyTodo[] {
  return todos
    .filter((todo) => todo.isDone && isInRange(todo.doneAt, range))
    .map((todo) => ({ id: todo.id, text: todo.text, priority: todo.priority ?? null, doneAt: todo.doneAt! }))
    .sort((a, b) => (a.doneAt === b.doneAt ? 0 : a.doneAt < b.doneAt ? 1 : -1))
}

/** 그날 팀원 spawn(Joined)·dismiss(Released) 수 */
export function dailyEventsOf(teamId: string, events: readonly TeamEvent[], range: DayRange): { joined: number; released: number } {
  const dayEvents = events.filter((event) => event.teamId === teamId && isInRange(event.at, range))
  return { joined: dayEvents.filter((event) => event.kind === 'spawn').length, released: dayEvents.filter((event) => event.kind === 'dismiss').length }
}

// ---------- 토큰 ----------

export type TokenKind = 'lead' | 'member' | 'other'

export interface DailySessionTokens {
  sessionId: string
  name: string | null
  position: string | null
  kind: TokenKind
  usage: TaskUsage
  model: string | null
}

export interface DailyTokens {
  lead: TaskUsage | null
  members: TaskUsage | null
  other: TaskUsage | null
  /** 세션마다 (출력 많은 순) */
  sessions: DailySessionTokens[]
}

/** 리드·팀원을 가르는 데 쓰는 것 */
export interface TokenKindContext {
  /** 지금 팀장·파트장 + 웹 기록(근무·휴식·퇴근)의 extraArgs 에 `--mcp-config` 가 있는 세션 (Hand over 로 끝난 옛 리드 포함) */
  leadIds: ReadonlySet<string>
  /** 세션 목록의 role member + 이 팀 task·운영 기록에 나온 세션 */
  memberIds: ReadonlySet<string>
}

export function tokenKindOf(sessionId: string, context: TokenKindContext): TokenKind {
  if (context.leadIds.has(sessionId)) return 'lead'
  if (context.memberIds.has(sessionId)) return 'member'
  return 'other'
}

/** 팀(과 파트)의 리드 ID: 지금 지시자 + 그 팀 폴더·파트 폴더의 웹 기록 중 리드 인자(`--mcp-config`)로 띄운 세션 */
export function leadIdsOf(team: Team, records: readonly { sessionId: string; cwd: string; extraArgs?: string[] }[], isTeamCwd: (cwd: string) => boolean): Set<string> {
  const ids = new Set<string>()
  if (team.leadSessionId) ids.add(team.leadSessionId)
  for (const part of team.parts as Part[]) if (part.leadSessionId) ids.add(part.leadSessionId)
  for (const record of records) if (isTeamCwd(record.cwd) && record.extraArgs?.includes('--mcp-config')) ids.add(record.sessionId)
  return ids
}

export function addUsage(target: TaskUsage | null, usage: TaskUsage): TaskUsage {
  if (!target) return { ...usage }
  return {
    inputTokens: target.inputTokens + usage.inputTokens,
    outputTokens: target.outputTokens + usage.outputTokens,
    cacheCreationTokens: target.cacheCreationTokens + usage.cacheCreationTokens,
    cacheReadTokens: target.cacheReadTokens + usage.cacheReadTokens,
    turns: target.turns + usage.turns,
  }
}

/** 세션별 사용량 → 리드·팀원·그 밖 합과 세션 줄 */
export function dailyTokensOf(
  bySession: ReadonlyMap<string, { usage: TaskUsage; model: string | null }>,
  context: TokenKindContext,
  lookup: MemberLookup,
): DailyTokens {
  const tokens: DailyTokens = { lead: null, members: null, other: null, sessions: [] }
  for (const [sessionId, { usage, model }] of bySession) {
    const kind = tokenKindOf(sessionId, context)
    if (kind === 'lead') tokens.lead = addUsage(tokens.lead, usage)
    else if (kind === 'member') tokens.members = addUsage(tokens.members, usage)
    else tokens.other = addUsage(tokens.other, usage)
    const member = lookup(sessionId)
    tokens.sessions.push({ sessionId, name: member?.name ?? null, position: member?.position ?? null, kind, usage, model })
  }
  tokens.sessions.sort((a, b) => b.usage.outputTokens - a.usage.outputTokens || (a.sessionId < b.sessionId ? -1 : 1))
  return tokens
}
