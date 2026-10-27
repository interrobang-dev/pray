import type { Session } from './types.js'

/**
 * 계정 전환 전 영향 (순수). 프롬프트 캐시는 조직마다 따로라 전환하면 깨진다 — 캐시가 아직 살아 있을 세션은
 * 다음 차례에 문맥 전체를 새 계정으로 다시 캐시에 쓴다 (평소 한 차례의 수십 배 비용·한도)
 */

/** 차례가 끝난 지 이 시간 안이면 캐시가 살아 있다고 본다 (Claude Code 가 쓰는 1시간 캐시. 정확히 60분이면 이미 만료) */
export const RECENT_TURN_MS = 60 * 60_000

export interface ImpactSession {
  id: string
  /** 목록과 같은 이름 (name → title → ID 앞 8자리) */
  name: string
  kind: 'web' | 'external'
  status: Session['status']
  /** 차례가 끝난 뒤(turnEndedAt) 지난 분, 내림. 모르면 null */
  minutesSinceTurn: number | null
  /** 다음 차례에 다시 읽을 문맥 크기 (마지막 claude 응답 usage). 모르면 null */
  contextTokens: number | null
}

export interface SwitchImpact {
  /** 캐시가 깨질 세션: 근무 중이고 바쁘거나(isBusy) 차례가 끝난 지 60분 안 */
  recentSessions: ImpactSession[]
  /** recentSessions 의 contextTokens 합 (null 은 0) */
  totalContextTokens: number
  /** 근무 중이고 바쁜(작업 중·승인 대기·백그라운드 작업 대기) 세션 (웹·외부) */
  busySessions: ImpactSession[]
}

export type ImpactCandidate = Pick<Session, 'id' | 'name' | 'title' | 'kind' | 'status' | 'attendance' | 'turnEndedAt'> & {
  contextTokens: number | null
}

/**
 * 근무 중이고 바쁜지: 차례가 진행 중(작업 중·승인 대기)이거나 백그라운드 작업을 기다린다(waiting). 전환하면 다음 걸음에 문맥을 다시 읽고,
 * 호스트를 재시작하면 claude 와 같이 백그라운드 작업도 끊긴다
 */
export function isBusy(session: Pick<Session, 'attendance' | 'status'>): boolean {
  const { status } = session
  return session.attendance === 'present' && (status === 'working' || status === 'needs-approval' || status === 'waiting')
}

/** 전환 응답의 hasBusyWebSessions */
export function hasBusyWebSessions(sessions: Pick<Session, 'kind' | 'attendance' | 'status'>[]): boolean {
  return sessions.some((session) => session.kind === 'web' && isBusy(session))
}

/** turnEndedAt 부터 now 까지 지난 ms. 모르거나 해석이 안 되면 null, 미래 시각(시계 차이)은 0 */
function elapsedMs(turnEndedAt: string | null, now: number): number | null {
  if (turnEndedAt === null) return null
  const at = Date.parse(turnEndedAt)
  return Number.isNaN(at) ? null : Math.max(0, now - at)
}

function toImpactSession(candidate: ImpactCandidate, elapsed: number | null): ImpactSession {
  return {
    id: candidate.id,
    name: candidate.name ?? candidate.title ?? candidate.id.slice(0, 8),
    kind: candidate.kind,
    status: candidate.status,
    minutesSinceTurn: elapsed === null ? null : Math.floor(elapsed / 60_000),
    contextTokens: candidate.contextTokens,
  }
}

/** contextTokens 큰 순 (null 은 뒤), 같으면 id 순 */
function byContextTokens(a: ImpactSession, b: ImpactSession): number {
  const difference = (b.contextTokens ?? -1) - (a.contextTokens ?? -1)
  return difference !== 0 ? difference : a.id.localeCompare(b.id)
}

export function switchImpact(candidates: ImpactCandidate[], now: number): SwitchImpact {
  const recentSessions: ImpactSession[] = []
  const busySessions: ImpactSession[] = []
  for (const candidate of candidates) {
    if (candidate.attendance !== 'present') continue
    const elapsed = elapsedMs(candidate.turnEndedAt, now)
    const isRecent = elapsed !== null && elapsed < RECENT_TURN_MS
    const isCandidateBusy = isBusy(candidate)
    if (!isRecent && !isCandidateBusy) continue
    const session = toImpactSession(candidate, elapsed)
    recentSessions.push(session)
    if (isCandidateBusy) busySessions.push(session)
  }
  recentSessions.sort(byContextTokens)
  busySessions.sort(byContextTokens)
  return {
    recentSessions,
    totalContextTokens: recentSessions.reduce((sum, session) => sum + (session.contextTokens ?? 0), 0),
    busySessions,
  }
}
