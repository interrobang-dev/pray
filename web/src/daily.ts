/** Today 창(오늘 한 일)의 응답 타입과 순수 함수. 서버 `server/src/dailyReport.ts`·`dayCommits.ts` 와 손으로 맞춘다 */
import { contextSizeText } from './contextSize'
import { usageDetailText, usageMetaText, type TaskStatus, type TaskUsage } from './teamTasks'
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
  from: string
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

/** 줄 앞 시각 "09:05" (보는 PC 의 시각) */
export function clockText(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
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

/** 끝난 task (진행 중 빼고) */
const finishedCount = (team: TeamDaily) => team.tasks.filter((task) => task.status !== 'running').length

/** 창 맨 위 합계 "14 commits · 23 tasks · 1.3M out · 381M in · 97% cached". 한 일이 하나도 없으면 null */
export function reportTotalText(report: DailyReport): string | null {
  const commits = report.teams.reduce((sum, team) => sum + team.commits.items.length, 0)
  const tasks = report.teams.reduce((sum, team) => sum + finishedCount(team), 0)
  const tokens = report.teams.reduce<TaskUsage | null>((sum, team) => addUsage(sum, teamTokenTotal(team)), null)
  const parts = [...(commits > 0 ? [plural(commits, 'commit')] : []), ...(tasks > 0 ? [plural(tasks, 'task')] : [])]
  const usage = usageMetaText(tokens, null)
  if (usage) parts.push(usage)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 팀 머리줄 회색 "3 commits · 5 tasks · 120k out" */
export function teamSummaryText(team: TeamDaily): string {
  const total = teamTokenTotal(team)
  return [
    ...(team.commits.items.length > 0 ? [plural(team.commits.items.length, 'commit')] : []),
    ...(finishedCount(team) > 0 ? [plural(finishedCount(team), 'task')] : []),
    ...(total ? [`${contextSizeText(total.outputTokens)} out`] : []),
  ].join(' · ')
}

/** 커밋 칸이 비었을 때의 회색 한 줄. 커밋이 있으면 null */
export function commitsNote(commits: DayCommits): string | null {
  if (commits.items.length > 0) return null
  if (commits.kind === 'svn') return "SVN commits aren't shown"
  if (commits.kind === 'none') return null
  if (commits.error) return null
  return 'No commits'
}

export const TOKEN_LABELS: Record<TokenKind, string> = { lead: 'Lead', member: 'Members', other: 'Other' }

/** Tokens 칸 줄: 합이 있는 갈래만 Lead → Members → Other. title 은 네 값 + 세션별 줄 */
export function tokenRows(tokens: DailyTokens): { kind: TokenKind; label: string; text: string; title: string }[] {
  const rows: { kind: TokenKind; usage: TaskUsage | null }[] = [
    { kind: 'lead', usage: tokens.lead },
    { kind: 'member', usage: tokens.members },
    { kind: 'other', usage: tokens.other },
  ]
  return rows.flatMap(({ kind, usage }) => {
    if (!usage) return []
    const sessions = tokens.sessions.filter((session) => session.kind === kind)
    const lines = sessions.map((session) => `${sessionLabel(session)}: ${usageMetaText(session.usage, session.model)}`)
    return [{ kind, label: `${TOKEN_LABELS[kind]}${sessions.length > 1 ? ` (${sessions.length})` : ''}`, text: usageMetaText(usage, null) ?? '', title: [usageDetailText(usage), ...lines].join('\n') }]
  })
}

/** 세션 이름 (역할이 있으면 "[FE] Jisoo"), 목록에서 빠진 세션은 ID 앞 8자리 */
export function sessionLabel(session: Pick<DailySessionTokens, 'name' | 'position' | 'sessionId'>): string {
  const name = session.name ?? session.sessionId.slice(0, 8)
  return session.position ? `[${session.position}] ${name}` : name
}

/** 팀원 들고 남 "Joined 2 · Released 1". 둘 다 0 이면 null */
export function eventsText(events: TeamDaily['events']): string | null {
  const parts = [...(events.joined > 0 ? [`Joined ${events.joined}`] : []), ...(events.released > 0 ? [`Released ${events.released}`] : [])]
  return parts.length > 0 ? parts.join(' · ') : null
}
