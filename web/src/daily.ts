/** Today 창(오늘 한 일)의 응답 타입과 순수 함수. 서버 `server/src/dailyReport.ts`·`dayCommits.ts` 와 손으로 맞춘다 */
import { contextSizeText } from './contextSize'
import { usageMetaText, type TaskStatus, type TaskUsage } from './teamTasks'
import { teamsInListOrder } from './teamTodos'
import type { Office, TodoPriority } from './types'

export interface DayCommit {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  /** 커미터 시각 ISO */
  at: string
  /** 팀 폴더 HEAD 에 없고 그 worktree 파트에만 있는 커밋이면 그 파트 */
  partId: string | null
}

export interface DayCommits {
  kind: 'git' | 'svn' | 'none'
  items: DayCommit[]
  isTruncated: boolean
  error: string | null
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
  sessions: DailySessionTokens[]
}

export interface DailyTodo {
  id: string
  text: string
  priority: TodoPriority | null
  doneAt: string
}

export interface TeamDaily {
  teamId: string
  name: string
  commits: DayCommits
  tasks: DailyTask[]
  tokens: DailyTokens
  todosDone: DailyTodo[]
  events: { joined: number; released: number }
}

/** `GET /api/daily?date=` */
export interface DailyReport {
  /** 이 PC(서버) 의 오늘 YYYY-MM-DD */
  today: string
  /** 고를 수 있는 가장 앞 날짜 */
  oldestDate: string
  date: string
  /** 그날 서버 PC 로컬 자정 ISO */
  from: string
  /** 다음 날 자정 ISO */
  to: string
  myDesk: { todosDone: DailyTodo[] }
  teams: TeamDaily[]
}

/** YYYY-MM-DD 를 days 만큼 옮긴다 (보는 PC 의 시간대와 무관하게 날짜 숫자만) */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

const dayLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}

/** 창 제목 "Today · Thu, Nov 13" / "Yesterday · Wed, Nov 12" / "Mon, Nov 10" */
export function dayTitle(date: string, today: string): string {
  if (date === today) return `Today · ${dayLabel(date)}`
  if (date === shiftDate(today, -1)) return `Yesterday · ${dayLabel(date)}`
  return dayLabel(date)
}

/** 그날 한 일이 있는 팀인지 (커밋·커밋 오류·task·토큰·끝낸 할 일·팀원 들고 남) */
export function hasActivity(team: TeamDaily): boolean {
  return (
    team.commits.items.length > 0 ||
    team.commits.error !== null ||
    team.tasks.length > 0 ||
    team.tokens.sessions.length > 0 ||
    team.todosDone.length > 0 ||
    team.events.joined + team.events.released > 0
  )
}

/** 목록 순서(그룹 → 팀)대로 한 일이 있는 팀과 없는 팀. office 에 없는 팀(그사이 지워짐)은 뒤에 응답 순서로 */
export function splitTeams(report: DailyReport, office: Office): { active: TeamDaily[]; quiet: TeamDaily[] } {
  const order = new Map(teamsInListOrder(office).map((team, index) => [team.id, index]))
  const sorted = report.teams
    .map((team, index) => ({ team, rank: order.get(team.teamId) ?? order.size + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ team }) => team)
  return { active: sorted.filter(hasActivity), quiet: sorted.filter((team) => !hasActivity(team)) }
}

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`

export function addUsage(target: TaskUsage | null, usage: TaskUsage | null): TaskUsage | null {
  if (!usage) return target
  if (!target) return { ...usage }
  return {
    inputTokens: target.inputTokens + usage.inputTokens,
    outputTokens: target.outputTokens + usage.outputTokens,
    cacheCreationTokens: target.cacheCreationTokens + usage.cacheCreationTokens,
    cacheReadTokens: target.cacheReadTokens + usage.cacheReadTokens,
    turns: target.turns + usage.turns,
  }
}

/** 팀 하나의 토큰 합 (리드 + 팀원 + 그 밖) */
export function teamTokenTotal(team: TeamDaily): TaskUsage | null {
  return addUsage(addUsage(addUsage(null, team.tokens.lead), team.tokens.members), team.tokens.other)
}

const outputOf = (team: TeamDaily) => teamTokenTotal(team)?.outputTokens ?? 0

/** 끝난 task (진행 중 빼고) */
const finishedCount = (team: TeamDaily) => team.tasks.filter((task) => task.status !== 'running').length

export interface DailyStats {
  commits: number
  /** 끝난 task 수 */
  tasks: number
  /** 모든 팀 토큰 합 (null = 토큰 없음) */
  usage: TaskUsage | null
  /** 한 일이 있는 팀 수 */
  teams: number
}

/** 맨 위 숫자 칸 넷 */
export function dailyStats(report: DailyReport): DailyStats {
  return {
    commits: report.teams.reduce((sum, team) => sum + team.commits.items.length, 0),
    tasks: report.teams.reduce((sum, team) => sum + finishedCount(team), 0),
    usage: report.teams.reduce<TaskUsage | null>((sum, team) => addUsage(sum, teamTokenTotal(team)), null),
    teams: report.teams.filter(hasActivity).length,
  }
}

/** Teams 칸 순서: 출력 토큰 많은 순, 같으면 받은 순서(목록 순서) 그대로 */
export function teamsByOutput(teams: readonly TeamDaily[]): TeamDaily[] {
  return teams
    .map((team, index) => ({ team, index, output: outputOf(team) }))
    .sort((a, b) => b.output - a.output || a.index - b.index)
    .map(({ team }) => team)
}

/** 팀 줄 회색 "9 commits · 15 tasks · 2 TODOs done" (없는 것은 뺀다) */
export function teamCountsText(team: TeamDaily): string {
  return [
    ...(team.commits.items.length > 0 ? [plural(team.commits.items.length, 'commit')] : []),
    ...(finishedCount(team) > 0 ? [plural(finishedCount(team), 'task')] : []),
    ...(team.todosDone.length > 0 ? [`${plural(team.todosDone.length, 'TODO')} done`] : []),
  ].join(' · ')
}

/** 커밋 칸 대신 보일 회색 한 줄. SVN 만 ("SVN commits aren't shown") */
export function commitsNote(commits: DayCommits): string | null {
  return commits.items.length === 0 && commits.kind === 'svn' ? "SVN commits aren't shown" : null
}

const TOKEN_LABELS: Record<TokenKind, string> = { lead: 'Lead', member: 'Members', other: 'Other' }

/** 토큰 막대 title: 합 한 줄 + 합이 있는 갈래만 Lead → Members → Other ("Members (2): 2k out · 100 in · 90% cached") */
export function tokenTitle(team: TeamDaily): string {
  const total = teamTokenTotal(team)
  if (!total) return 'No tokens'
  const rows: { kind: TokenKind; usage: TaskUsage | null }[] = [
    { kind: 'lead', usage: team.tokens.lead },
    { kind: 'member', usage: team.tokens.members },
    { kind: 'other', usage: team.tokens.other },
  ]
  const lines = rows.flatMap(({ kind, usage }) => {
    if (!usage) return []
    const count = team.tokens.sessions.filter((session) => session.kind === kind).length
    return [`${TOKEN_LABELS[kind]}${count > 1 ? ` (${count})` : ''}: ${usageMetaText(usage, null)}`]
  })
  return [`Total: ${usageMetaText(total, null)}`, ...lines].join('\n')
}

/** 팀 줄 오른쪽 출력 토큰 "820k" (없으면 null) */
export function outputText(team: TeamDaily): string | null {
  const output = outputOf(team)
  return output > 0 ? contextSizeText(output) : null
}

/** 막대 길이 0~1 (그날 가장 많이 쓴 팀 = 1) */
export function outputShare(team: TeamDaily, teams: readonly TeamDaily[]): number {
  const max = Math.max(0, ...teams.map(outputOf))
  return max > 0 ? outputOf(team) / max : 0
}

export const COMMIT_PREVIEW = 3

/** 팀 줄 아래 커밋 제목: 접혀 있으면 앞 3개와 숨은 수 */
export function visibleCommits(items: readonly DayCommit[], isExpanded: boolean): { shown: DayCommit[]; hiddenCount: number } {
  if (isExpanded || items.length <= COMMIT_PREVIEW) return { shown: [...items], hiddenCount: 0 }
  return { shown: items.slice(0, COMMIT_PREVIEW), hiddenCount: items.length - COMMIT_PREVIEW }
}

const HOUR_MS = 3_600_000

export interface HourBucket {
  /** 그 시간에 한 번이라도 돌던 task 수 */
  tasks: number
  commits: number
}

export interface TeamTimeline {
  hours: HourBucket[]
  /** 커밋 시각의 하루 안 자리 0~1 */
  commitMarks: number[]
}

/** 하루의 시간 칸 수 (보통 24. 서머타임이 있는 시간대면 23·25) */
export function hourCountOf(report: Pick<DailyReport, 'from' | 'to'>): number {
  return Math.max(1, Math.round((Date.parse(report.to) - Date.parse(report.from)) / HOUR_MS))
}

/**
 * 팀 한 줄의 시간대별 묶음. task 는 지시 시각 ~ 끝난 시각(진행 중이면 지금, 하루 끝을 넘지 않게)과 겹치는 시간마다 1,
 * 커밋은 그 시각의 시간 칸에 1. 하루 밖은 하루 끝에 맞춘다
 */
export function teamTimeline(team: TeamDaily, report: Pick<DailyReport, 'from' | 'to'>, now: number): TeamTimeline {
  const from = Date.parse(report.from)
  const to = Date.parse(report.to)
  const hourCount = hourCountOf(report)
  const hours: HourBucket[] = Array.from({ length: hourCount }, () => ({ tasks: 0, commits: 0 }))
  const hourOf = (time: number) => Math.min(hourCount - 1, Math.max(0, Math.floor((time - from) / HOUR_MS)))
  for (const task of team.tasks) {
    const start = Math.max(from, Date.parse(task.createdAt))
    const end = Math.min(to, task.finishedAt ? Date.parse(task.finishedAt) : Math.min(now, to))
    if (Number.isNaN(start) || Number.isNaN(end) || start >= to || end < from) continue
    const first = hourOf(start)
    // 끝이 칸 경계에 딱 맞으면 그 다음 칸은 넣지 않는다
    const last = Math.max(first, Math.min(hourCount - 1, Math.ceil((end - from) / HOUR_MS) - 1))
    for (let hour = first; hour <= last; hour++) hours[hour].tasks++
  }
  const commitMarks: number[] = []
  for (const commit of team.commits.items) {
    const at = Date.parse(commit.at)
    if (Number.isNaN(at) || at < from || at >= to) continue
    hours[hourOf(at)].commits++
    commitMarks.push((at - from) / (to - from))
  }
  return { hours, commitMarks }
}

/** 타임라인에 줄이 있는 팀 (task·커밋처럼 시각이 있는 것이 있을 때만) */
export function hasTimedActivity(team: TeamDaily): boolean {
  return team.tasks.length > 0 || team.commits.items.length > 0
}

/** 칸 진하기 단계 0~4 (돌던 task 0·1·2·3·4+) */
export function heatLevel(taskCount: number): number {
  return Math.min(4, Math.max(0, taskCount))
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/** 칸 title "14:00–15:00 · 3 tasks · 2 commits" (시각은 그날 자정부터 센 서버 PC 시각) */
export function hourTitle(hour: number, bucket: HourBucket): string {
  return [
    `${hourLabel(hour)}–${hourLabel(hour + 1)}`,
    ...(bucket.tasks > 0 ? [plural(bucket.tasks, 'task')] : []),
    ...(bucket.commits > 0 ? [plural(bucket.commits, 'commit')] : []),
  ].join(' · ')
}

/** 지금 시각 선 자리 0~1. 오늘이 아니거나 하루 밖이면 null */
export function nowShare(report: Pick<DailyReport, 'date' | 'today' | 'from' | 'to'>, now: number): number | null {
  if (report.date !== report.today) return null
  const from = Date.parse(report.from)
  const to = Date.parse(report.to)
  if (!(now >= from && now < to)) return null
  return (now - from) / (to - from)
}
