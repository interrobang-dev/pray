/** 팀 Tasks 창의 응답 타입과 순수 함수. 서버 `server/src/teamTaskHistory.ts` 와 손으로 맞춘다 */
import { contextSizeText } from './contextSize'
import { modelAlias } from './modelSetting'

export type TaskStatus = 'running' | 'done' | 'failed'

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
