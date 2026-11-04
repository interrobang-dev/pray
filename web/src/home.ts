/** 사무실을 숨기고 세션을 안 골랐을 때의 첫 화면 (HomePanel.tsx) 순수 함수 */
import type { Session } from './types'

/** 최근 세션 줄 수 */
export const RECENT_LIMIT = 8
/** New session 아래 팀 칩 수 */
export const TEAM_CHIP_LIMIT = 6

/** 최근에 대화한 시각: 마지막 대화 줄(turnEndedAt) → 마지막 줄(lastAt). 모르면 null */
export function lastActivityOf(session: Pick<Session, 'turnEndedAt' | 'lastAt'>): number | null {
  const iso = session.turnEndedAt ?? session.lastAt
  if (!iso) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

/** 최근에 대화한 순으로 limit 개. 시각을 모르는 세션은 뒤, 같으면 원래 순서(서버 = 생성순) */
export function recentSessions<T extends Pick<Session, 'turnEndedAt' | 'lastAt'>>(sessions: readonly T[], limit = RECENT_LIMIT): T[] {
  return sessions
    .map((session, index) => ({ session, index, at: lastActivityOf(session) }))
    .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.index - b.index)
    .slice(0, limit)
    .map(({ session }) => session)
}

/** 이 PC 시각의 인사말 */
export function greetingOf(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
