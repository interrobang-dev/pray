import { contextLevel } from './contextSize'
import type { Session, Team } from './types'

/**
 * 패널 머리 "Hand over" 를 보일 지휘 단위 (팀장 교대 지름길). 없으면 null.
 * 문맥 크기가 경고 단계(contextSize.ts 의 15만 이상)이고, 이 세션이 지금도 그 팀·파트의 지시자(leadSessionId)일 때.
 * 근무 여부는 보지 않는다 — 근무 중이면 창의 Start 가 옛 지시자를 끝내고 띄우고(서버 replacesLead), 이미 끝났어도 같은 버튼으로 연다
 */
export function handOverUnit(session: Pick<Session, 'id' | 'role' | 'teamId' | 'partId' | 'contextTokens'>, teams: readonly Team[]): { teamId: string; partId: string | null } | null {
  if (session.role !== 'lead' || !session.teamId) return null
  if (typeof session.contextTokens !== 'number' || contextLevel(session.contextTokens) !== 'warn') return null
  const team = teams.find((t) => t.id === session.teamId)
  if (!team) return null
  const part = session.partId ? team.parts.find((p) => p.id === session.partId) : undefined
  if (session.partId && !part) return null
  const leadSessionId = part ? part.leadSessionId : team.leadSessionId
  if (leadSessionId !== session.id) return null
  return { teamId: team.id, partId: part ? part.id : null }
}
