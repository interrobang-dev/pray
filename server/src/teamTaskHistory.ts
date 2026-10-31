import type { TeamEvent } from './teamTaskFile.js'
import type { Task, TaskStatus } from './teamState.js'

/** 목록에 싣는 지시 앞부분 글자 수. 전문은 한 task API 로 받는다 */
export const HISTORY_INSTRUCTION_LIMIT = 300

/** 세션 ID → 화면에 보일 이름·역할. 세션 목록에서 빠진(퇴근 기록이 지워진) 팀원은 없다 */
export type MemberLookup = (sessionId: string) => { name: string; position: string | null } | null

/** Tasks 창 목록의 task 한 줄 (지시는 앞부분만, 결과는 싣지 않는다) */
export interface TaskHistoryItem {
  id: string
  partId: string | null
  memberSessionId: string
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

export interface TeamEventItem extends Omit<TeamEvent, 'teamId'> {
  memberName: string | null
}

export interface TaskHistory {
  /** 최근 지시부터 */
  tasks: TaskHistoryItem[]
  /** 최근 것부터 */
  events: TeamEventItem[]
}

/** Tasks 창 한 task 전문 */
export interface TaskDetail extends Task {
  memberName: string | null
  memberPosition: string | null
}

const newestFirst = <T>(items: readonly T[], timeOf: (item: T) => string): T[] =>
  [...items].sort((a, b) => (timeOf(a) === timeOf(b) ? 0 : timeOf(a) < timeOf(b) ? 1 : -1))

/** 팀 하나(모든 지휘 단위)의 task·운영 기록 목록 (순수). 시각이 같으면 넣은 순서의 뒤쪽이 먼저 */
export function taskHistoryOf(teamId: string, tasks: readonly Task[], events: readonly TeamEvent[], lookup: MemberLookup): TaskHistory {
  const teamTasks = tasks.filter((t) => t.teamId === teamId).reverse()
  const teamEvents = events.filter((e) => e.teamId === teamId).reverse()
  return {
    tasks: newestFirst(teamTasks, (t) => t.createdAt).map((t) => {
      const member = lookup(t.memberSessionId)
      return {
        id: t.id,
        partId: t.partId,
        memberSessionId: t.memberSessionId,
        memberName: member?.name ?? null,
        memberPosition: member?.position ?? null,
        status: t.status,
        isAcknowledged: t.isAcknowledged,
        createdAt: t.createdAt,
        finishedAt: t.finishedAt,
        startContextTokens: t.startContextTokens,
        endContextTokens: t.endContextTokens,
        instruction: t.instruction.slice(0, HISTORY_INSTRUCTION_LIMIT),
        isInstructionClipped: t.instruction.length > HISTORY_INSTRUCTION_LIMIT,
        error: t.error,
        hasResult: t.result !== null && t.result !== '',
      }
    }),
    events: newestFirst(teamEvents, (e) => e.at).map(({ teamId: _teamId, ...event }) => ({
      ...event,
      memberName: lookup(event.sessionId)?.name ?? null,
    })),
  }
}

/** 팀의 task 하나 전문. 다른 팀 task·없는 ID 는 null */
export function taskDetailOf(teamId: string, task: Task | undefined, lookup: MemberLookup): TaskDetail | null {
  if (!task || task.teamId !== teamId) return null
  const member = lookup(task.memberSessionId)
  return { ...task, memberName: member?.name ?? null, memberPosition: member?.position ?? null }
}
