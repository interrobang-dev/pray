import type { Task } from './teamState.js'
import type { Session, SessionStatus } from './types.js'

/** team_status 에 싣는 긴 글(지시·결과·마지막 말)의 앞부분 글자 수. 전문은 team_wait(그 taskId)로 받는다 */
export const STATUS_TEXT_LIMIT = 200
/** team_status 에 싣는 끝났고 결과를 가져간 task 수 (최근 것부터) */
export const STATUS_DELIVERED_TASK_LIMIT = 5

/** 앞 limit 자 + "…". 짧으면 그대로 */
export function clipStatusText(text: string | null, limit = STATUS_TEXT_LIMIT): string | null {
  if (text === null || text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/**
 * team_status 의 tasks (순수). 진행 중과 결과를 아직 안 가져간 task 는 다 싣고, 끝났고 가져간 것은 최근 STATUS_DELIVERED_TASK_LIMIT 개만.
 * 순서는 그대로(오래된 것 먼저)이고 instruction·result 는 앞부분만. 팀장이 부를 때마다 7일치 전문이 문맥에 들어가지 않게
 */
export function teamStatusTasks(tasks: readonly Task[]): Task[] {
  const delivered = tasks.filter((t) => t.status !== 'running' && t.isDelivered)
  const keptDelivered = new Set(delivered.slice(-STATUS_DELIVERED_TASK_LIMIT))
  return tasks
    .filter((t) => t.status === 'running' || !t.isDelivered || keptDelivered.has(t))
    .map((t) => ({ ...t, instruction: clipStatusText(t.instruction) ?? '', result: clipStatusText(t.result) }))
}

/** team_status(`GET /api/team/:teamId`)의 팀원 한 명. 팀장·파트장이 재사용·정리를 판단하는 값만 싣는다 */
export interface TeamMember {
  sessionId: string
  name: string
  position: string | null
  kind: Session['kind']
  role: Session['role']
  status: SessionStatus
  isAlive: boolean
  /** 마지막 claude 응답 기준 (jsonl). 대화가 아직 없으면 null */
  model: string | null
  effort: string | null
  /** 지금 문맥 크기 = 마지막 주 대화 claude 응답 usage 의 input + cache_read + cache_creation. 응답이 없거나 압축 직후면 null */
  contextTokens: number | null
  /** 쉬기 시작한 시각 (마지막 대화 줄 시각 turnEndedAt). 일하는 중(working·needs-approval·waiting)이거나 대화가 없으면 null */
  idleSince: string | null
  /** 마지막 claude 말의 앞 STATUS_TEXT_LIMIT 자 */
  lastAssistantText: string | null
  pendingTool: string | null
}

/** 차례가 아직 안 끝난 표시 상태. waiting 은 백그라운드 작업이 끝나면 claude 가 깨어 이어서 일한다 */
const BUSY_STATUSES: ReadonlySet<SessionStatus> = new Set(['working', 'needs-approval', 'waiting'])

export function idleSinceOf(status: SessionStatus, turnEndedAt: string | null): string | null {
  return BUSY_STATUSES.has(status) ? null : turnEndedAt
}

export function teamMemberOf(session: Session): TeamMember {
  return {
    sessionId: session.id,
    name: session.name ?? session.title ?? session.id.slice(0, 8),
    position: session.position,
    kind: session.kind,
    role: session.role,
    status: session.status,
    isAlive: session.isAlive,
    model: session.model,
    effort: session.effort,
    contextTokens: session.contextTokens,
    idleSince: idleSinceOf(session.status, session.turnEndedAt),
    lastAssistantText: clipStatusText(session.lastAssistantText),
    pendingTool: session.pendingTool,
  }
}
