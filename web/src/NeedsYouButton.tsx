import type { ReactNode } from 'react'
import { needsYouSessions } from './needsYou'
import { PositionChip } from './PositionChip'
import { nameOf, positionOf } from './sessionPosition'
import { formatAgo, formatDateTime, statusLabel, type Session, type Team } from './types'

/**
 * 사이드바 탭 줄의 "Needs you" 탭 + 개수 배지(승인 대기가 있으면 빨강). 누르면 사이드바가 Needs you 보기로 바뀐다(App 의 sidebarView).
 * 탭이라 0 이어도 눌린다 (보기에 "Nothing needs you")
 */
export function NeedsYouTab({ sessions, now, isSelected, onSelect }: { sessions: Session[]; now: number; isSelected: boolean; onSelect: () => void }) {
  const rows = needsYouSessions(sessions, now)
  const hasApproval = rows.some((session) => session.status === 'needs-approval')
  return (
    <button className="side-tab" role="tab" aria-selected={isSelected} onClick={onSelect}>
      Needs you
      {rows.length > 0 && <span className={hasApproval ? 'needs-you-count urgent' : 'needs-you-count'}>{rows.length}</span>}
    </button>
  )
}

interface ViewProps {
  sessions: Session[]
  teams: Team[]
  now: number
  /** 목록 세션 줄과 같은 아바타(머리 그림·상태 테두리) */
  renderAvatar: (session: Session) => ReactNode
  /** 목록에서 세션 줄을 누른 것과 같게 연다 (selectSession + 사무실 포커스) */
  onSelect: (sessionId: string) => void
}

/**
 * 사이드바 Needs you 보기 (근무 중인 승인 대기·내 차례·끝남 세션. 규칙 needsYou.ts). 세션 목록 자리를 다 쓴다.
 * 줄을 누르면 그 세션을 열고 보기는 그대로라 차례로 처리할 수 있다. 다 빠져도 닫지 않고 빈 줄을 보인다
 */
export function NeedsYouView({ sessions, teams, now, renderAvatar, onSelect }: ViewProps) {
  const rows = needsYouSessions(sessions, now)
  const teamNames = new Map(teams.map((team) => [team.id, team.name]))
  return (
    <section className="side-view" aria-label="Needs you">
      {rows.length === 0 && <p className="side-view-empty">Nothing needs you</p>}
      {rows.map((session) => {
        const iso = session.turnEndedAt ?? session.lastAt
        const place = (session.teamId ? teamNames.get(session.teamId) : undefined) ?? 'Focus Zone'
        return (
          <button key={session.id} className="needs-you-row" onClick={() => onSelect(session.id)}>
            {renderAvatar(session)}
            <span className="needs-you-name">
              <PositionChip position={positionOf(session)} />
              {nameOf(session)}
            </span>
            <span className="needs-you-time" title={iso ? formatDateTime(iso) : undefined}>
              {iso ? formatAgo(iso, now) : ''}
            </span>
            <span className="needs-you-meta">
              {place} · {statusLabel[session.status]}
            </span>
          </button>
        )
      })}
    </section>
  )
}
