/** 팀 Tasks 창의 응답 타입과 순수 함수. 서버 `server/src/teamTaskHistory.ts` 와 손으로 맞춘다 */
import { contextSizeText } from './contextSize'
import { modelAlias } from './modelSetting'

export type TaskStatus = 'running' | 'done' | 'failed'

/** task 하나가 쓴 토큰 (팀원 jsonl 의 claude 응답 usage 합. 서버 `server/src/taskUsage.ts`) */
export interface TaskUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  /** claude 응답 수 */
  turns: number
}

/** `GET /api/team/:teamId/tasks` 의 task 한 줄 (지시는 앞부분만, 결과 없음) */
export interface TaskHistoryItem {
  id: string
  partId: string | null
  memberSessionId: string
  /** 세션 목록에서 빠진 팀원은 null */
  memberName: string | null
  memberPosition: string | null
  status: TaskStatus
  isAcknowledged: boolean
  createdAt: string
  finishedAt: string | null
  startContextTokens: number | null
  endContextTokens: number | null
  /** 끝난 뒤 서버가 jsonl 에서 더한 값. 진행 중·옛 task·응답이 없으면 null */
  usage: TaskUsage | null
  /** 그 응답들의 마지막 모델 (전체 이름) */
  model: string | null
  instruction: string
  isInstructionClipped: boolean
  error: string | null
  hasResult: boolean
}

/** 팀원 spawn·dismiss 운영 기록 */
export interface TeamEventItem {
  kind: 'spawn' | 'dismiss'
  at: string
  partId: string | null
  sessionId: string
  position: string | null
  model: string | null
  effort: string | null
  contextTokens: number | null
  idleSince: string | null
  memberName: string | null
}

export interface TaskHistory {
  tasks: TaskHistoryItem[]
  events: TeamEventItem[]
}

/** `GET /api/team/:teamId/tasks/:taskId` 의 task 전문 */
export interface TaskDetail extends Omit<TaskHistoryItem, 'isInstructionClipped' | 'hasResult'> {
  result: string | null
}

/** 목록 한 줄: task 와 운영 기록을 시간순(최근 먼저)으로 섞는다 */
export type TimelineRow = { kind: 'task'; at: string; task: TaskHistoryItem } | { kind: 'event'; at: string; event: TeamEventItem }

export function timelineRows(history: TaskHistory): TimelineRow[] {
  const rows: TimelineRow[] = [
    ...history.tasks.map((task): TimelineRow => ({ kind: 'task', at: task.createdAt, task })),
    ...history.events.map((event): TimelineRow => ({ kind: 'event', at: event.at, event })),
  ]
  // 같은 시각이면 운영 기록(spawn)을 그 첫 지시 아래에 둔다 — spawn 기록은 첫 지시보다 먼저 남는다
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const diff = new Date(b.row.at).getTime() - new Date(a.row.at).getTime()
      return diff !== 0 ? diff : a.index - b.index
    })
    .map(({ row }) => row)
}

export function taskStatusLabel(task: Pick<TaskHistoryItem, 'status' | 'isAcknowledged'>): string {
  if (task.status === 'done') return 'Done'
  if (task.status === 'failed') return 'Failed'
  return task.isAcknowledged ? 'Running' : 'Sent'
}

/** 걸린 시간 "45s"·"12m"·"1h 5m"·"2d 3h" */
export function durationText(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
}

/** 지시부터 끝(진행 중이면 지금)까지 */
export function taskDuration(task: Pick<TaskHistoryItem, 'createdAt' | 'finishedAt'>, now: number): string {
  const end = task.finishedAt ? new Date(task.finishedAt).getTime() : now
  return durationText(end - new Date(task.createdAt).getTime())
}

/** 문맥 증가 "12k → 98k". 처음 지시(새 팀원)는 시작이 "new", 끝을 모르면 "?". 둘 다 모르면 null (표시 안 함) */
export function contextGrowthText(start: number | null, end: number | null, isRunning: boolean): string | null {
  if (start === null && end === null) return null
  const from = start === null ? 'new' : contextSizeText(start)
  const to = end === null ? (isRunning ? '…' : '?') : contextSizeText(end)
  return `${from} → ${to}`
}

/** 세션 목록에서 빠진 팀원은 ID 앞 8자리 */
export function memberNameOf(name: string | null, sessionId: string): string {
  return name ?? `Member ${sessionId.slice(0, 8)}`
}

/** 운영 기록 한 줄의 뒤쪽 글 "sonnet · high" / "143k · idle 1h 12m" (dismiss 시각 기준 쉰 시간) */
export function eventDetailText(event: TeamEventItem): string {
  const parts: string[] = []
  // spawn 은 별칭(sonnet), dismiss 는 전체 이름(claude-sonnet-5-5)이라 별칭으로 맞춘다
  if (event.model) parts.push(modelAlias(event.model) ?? event.model)
  if (event.effort) parts.push(event.effort)
  if (event.kind === 'dismiss') {
    if (event.contextTokens !== null) parts.push(contextSizeText(event.contextTokens))
    if (event.idleSince) parts.push(`idle ${durationText(new Date(event.at).getTime() - new Date(event.idleSince).getTime())}`)
  }
  return parts.join(' · ')
}

/** 읽은 입력 전부 (캐시 쓰기·읽기 포함) */
const inputTotalOf = (usage: TaskUsage) => usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens

/** task 줄 meta "Opus · 48k out · 1.2M in" (in = input + cache write + cache read). usage 가 없으면 null */
export function usageMetaText(usage: TaskUsage | null, model: string | null): string | null {
  if (!usage) return null
  const alias = modelAlias(model)
  const name = alias ? alias[0].toUpperCase() + alias.slice(1) : model
  const parts = [`${contextSizeText(usage.outputTokens)} out`, `${contextSizeText(inputTotalOf(usage))} in`]
  return (name ? [name, ...parts] : parts).join(' · ')
}

const count = (value: number) => value.toLocaleString('en-US')

/** 네 값과 응답 수 "Input 12,345 · Cache write 1,234 · Cache read 1,200,000 · Output 48,000 · 7 responses" */
export function usageDetailText(usage: TaskUsage): string {
  return [
    `Input ${count(usage.inputTokens)}`,
    `Cache write ${count(usage.cacheCreationTokens)}`,
    `Cache read ${count(usage.cacheReadTokens)}`,
    `Output ${count(usage.outputTokens)}`,
    `${count(usage.turns)} ${usage.turns === 1 ? 'response' : 'responses'}`,
  ].join(' · ')
}

/** 끝난 task 의 usage 합 (진행 중은 빼고, usage 가 없는 끝난 task 는 수만) */
export interface UsageTotal {
  usage: TaskUsage
  withUsage: number
  withoutUsage: number
}

export function usageTotalOf(tasks: readonly Pick<TaskHistoryItem, 'status' | 'usage'>[]): UsageTotal {
  const usage: TaskUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0 }
  let withUsage = 0
  let withoutUsage = 0
  for (const task of tasks) {
    if (task.status === 'running') continue
    if (!task.usage) {
      withoutUsage++
      continue
    }
    withUsage++
    usage.inputTokens += task.usage.inputTokens
    usage.outputTokens += task.usage.outputTokens
    usage.cacheCreationTokens += task.usage.cacheCreationTokens
    usage.cacheReadTokens += task.usage.cacheReadTokens
    usage.turns += task.usage.turns
  }
  return { usage, withUsage, withoutUsage }
}

/** 7일 합계 "12 tasks · 320k out · 9.8M in (3 without usage)". 끝난 task 가 없으면 null */
export function usageTotalText(total: UsageTotal): string | null {
  const { usage, withUsage, withoutUsage } = total
  if (withUsage === 0) return withoutUsage === 0 ? null : `${withoutUsage} ${withoutUsage === 1 ? 'task' : 'tasks'} without usage`
  const text = `${withUsage} ${withUsage === 1 ? 'task' : 'tasks'} · ${contextSizeText(usage.outputTokens)} out · ${contextSizeText(inputTotalOf(usage))} in`
  return withoutUsage === 0 ? text : `${text} (${withoutUsage} without usage)`
}
