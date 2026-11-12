import type { ReactNode } from 'react'
import { needsYouSessions } from './needsYou'
import { PositionChip } from './PositionChip'
import { nameOf, positionOf } from './sessionPosition'
import { formatAgo, formatDateTime, statusLabel, type Session, type Team } from './types'

/** 툴바 Needs you 아이콘: 종 */
function NeedsYouIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
      <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.25 1.25H2.75z" />
      <path d="M6.5 14.25a1.5 1.5 0 0 0 3 0" />
    </svg>
  )
}

/**
 * 목록 툴바의 "Needs you" 버튼 + 개수 배지. 누르면 사이드바가 Needs you 보기로 바뀌고(App 의 sidebarView), 다시 누르면 세션 목록으로 돌아간다.
 * 0 이고 보기가 닫혀 있으면 배지 없이 흐린 비활성 버튼 (보기가 열려 있으면 돌아가기용으로 눌린다)
 */
export function NeedsYouButton({ sessions, now, isActive, onToggle }: { sessions: Session[]; now: number; isActive: boolean; onToggle: () => void }) {
  const rows = needsYouSessions(sessions, now)
  const hasApproval = rows.some((session) => session.status === 'needs-approval')
  return (
    <button
      className="needs-you-toggle"
      onClick={onToggle}
      disabled={rows.length === 0 && !isActive}
      aria-pressed={isActive}
      title="Needs you"
      aria-label="Needs you"
    >
      <NeedsYouIcon />
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
  /** 세션 목록으로 돌아간다 */
  onClose: () => void
}

/**
 * 사이드바 Needs you 보기 (근무 중인 승인 대기·내 차례·끝남 세션. 규칙 needsYou.ts). 세션 목록 자리를 다 쓴다.
 * 줄을 누르면 그 세션을 열고 보기는 그대로라 차례로 처리할 수 있다. 다 빠져도 닫지 않고 빈 줄을 보인다
 */
export function NeedsYouView({ sessions, teams, now, renderAvatar, onSelect, onClose }: ViewProps) {
  const rows = needsYouSessions(sessions, now)
  const teamNames = new Map(teams.map((team) => [team.id, team.name]))
  return (
    <section className="side-view" aria-label="Needs you">
      <SideViewHead title="Needs you" count={rows.length} onClose={onClose} />
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

/** 사이드바 보기 머리줄: ← (세션 목록으로) · 제목 · 개수 (All TODOs 보기도 쓴다) */
export function SideViewHead({ title, count, onClose }: { title: string; count: number; onClose: () => void }) {
  return (
    <div className="side-view-head">
      <button className="side-view-back" onClick={onClose} title="Back to sessions" aria-label="Back to sessions">
        ←
      </button>
      <span className="side-view-title">{title}</span>
      <span className="side-view-count">{count}</span>
    </div>
  )
}
