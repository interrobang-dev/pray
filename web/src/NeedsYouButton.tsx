import { useEffect, useRef, useState, type ReactNode } from 'react'
import { needsYouSessions } from './needsYou'
import { PositionChip } from './PositionChip'
import { nameOf, positionOf } from './sessionPosition'
import { useDismiss } from './Shells'
import { formatAgo, formatDateTime, statusLabel, type Session, type Team } from './types'

interface Props {
  sessions: Session[]
  teams: Team[]
  now: number
  /** 목록 세션 줄과 같은 아바타(머리 그림·상태 테두리) */
  renderAvatar: (session: Session) => ReactNode
  /** 목록에서 세션 줄을 누른 것과 같게 연다 (selectSession + 사무실 포커스) */
  onSelect: (sessionId: string) => void
}

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
 * 목록 툴바의 "Needs you" 버튼 + 개수 배지와, 누르면 툴바 바로 아래에 붙는 창 (근무 중인 승인 대기·내 차례·끝남 세션. 규칙 needsYou.ts).
 * 다시 누르기·바깥 클릭·Esc 로 닫히고, 줄을 누르면 그 세션을 열고 닫는다. 0 이면 배지 없이 흐린 비활성 버튼
 */
export function NeedsYouButton({ sessions, teams, now, renderAvatar, onSelect }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const rows = needsYouSessions(sessions, now)
  const isShown = isOpen && rows.length > 0
  useDismiss(isShown, rootRef, toggleRef, setIsOpen)

  // 열어 둔 사이 모두 빠지면 닫는다 (다시 생겼을 때 저절로 열리지 않게)
  useEffect(() => {
    if (rows.length === 0) setIsOpen(false)
  }, [rows.length])

  const teamNames = new Map(teams.map((team) => [team.id, team.name]))
  const hasApproval = rows.some((session) => session.status === 'needs-approval')
  return (
    <div className="needs-you" ref={rootRef}>
      <button
        ref={toggleRef}
        className="needs-you-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={rows.length === 0}
        aria-expanded={isShown}
        aria-controls="needs-you-popover"
        title="Needs you"
        aria-label="Needs you"
      >
        <NeedsYouIcon />
        {rows.length > 0 && <span className={hasApproval ? 'needs-you-count urgent' : 'needs-you-count'}>{rows.length}</span>}
      </button>
      {isShown && (
        <div id="needs-you-popover" className="needs-you-popover" role="dialog" aria-label="Needs you">
          <div className="needs-you-head">Needs you</div>
          {rows.map((session) => {
            const iso = session.turnEndedAt ?? session.lastAt
            const place = (session.teamId ? teamNames.get(session.teamId) : undefined) ?? 'Focus Zone'
            return (
              <button
                key={session.id}
                className="needs-you-row"
                onClick={() => {
                  setIsOpen(false)
                  onSelect(session.id)
                }}
              >
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
        </div>
      )}
    </div>
  )
}
