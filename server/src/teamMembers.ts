import type { Session, SessionStatus } from './types.js'

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
    lastAssistantText: session.lastAssistantText,
    pendingTool: session.pendingTool,
  }
}
