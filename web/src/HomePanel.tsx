import type { ReactNode } from 'react'
import { greetingOf, lastActivityOf, recentSessions, TEAM_CHIP_LIMIT } from './home'
import { PositionChip } from './PositionChip'
import { nameOf, positionOf } from './sessionPosition'
import { attendanceOf, formatAgo, formatDateTime, type Session, type Team } from './types'

interface Props {
  sessions: Session[]
  /** 목록 순서 그대로 (hq.json teams 배열) */
  teams: Team[]
  now: number
  isHostReachable: boolean
  /** 목록 세션 줄과 같은 아바타(머리 그림·상태 테두리) */
  renderAvatar: (session: Session) => ReactNode
  /** 목록 아바타 툴팁과 같은 상태 글자 ("Working"·"Break"·"Off duty"…) */
  stateLabelOf: (session: Session) => string
  onSelect: (sessionId: string) => void
  /** teamId null = Focus Zone */
  onNewSession: (teamId: string | null) => void
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/**
 * 사무실을 숨기고 세션을 안 골랐을 때 그 자리의 첫 화면 (Claude·Gemini 첫 화면 꼴): 인사말 → 새 세션 카드·팀 칩 → 최근 세션.
 * 최근 세션은 마지막 대화 순이라 왼쪽 목록(생성순)과 순서가 다르다
 */
export function HomePanel({ sessions, teams, now, isHostReachable, renderAvatar, stateLabelOf, onSelect, onNewSession }: Props) {
  const recent = recentSessions(sessions)
  const teamNames = new Map(teams.map((team) => [team.id, team.name]))
  const chips = teams.slice(0, TEAM_CHIP_LIMIT)
  const hostTitle = isHostReachable ? undefined : 'Session host disconnected'
  return (
    <div className="home">
      <div className="home-column">
        <div className="home-greeting">
          <img className="home-logo" src="/logo.svg" width={32} height={32} alt="" />
          <div>
            <h2>{greetingOf(new Date(now).getHours())}</h2>
            <p className="home-tagline">Do your best. Then pray.</p>
          </div>
        </div>

        <button type="button" className="home-new" onClick={() => onNewSession(null)} disabled={!isHostReachable} title={hostTitle}>
          <span className="home-new-icon">
            <PlusIcon />
          </span>
          <span className="home-new-label">New session</span>
          <span className="home-new-place">Focus Zone</span>
        </button>
        {chips.length > 0 && (
          <div className="home-chips" aria-label="New session in a team">
            {chips.map((team) => (
              <button
                type="button"
                key={team.id}
                className="home-chip"
                onClick={() => onNewSession(team.id)}
                disabled={!isHostReachable}
                title={hostTitle ?? `New session in ${team.name}`}
              >
                {team.name}
              </button>
            ))}
          </div>
        )}

        <h3 className="home-heading">Recent</h3>
        {recent.length === 0 ? (
          <p className="home-empty">No sessions yet</p>
        ) : (
          <ul className="home-recent">
            {recent.map((session) => {
              const at = lastActivityOf(session)
              const iso = at === null ? null : new Date(at).toISOString()
              const teamName = session.teamId ? teamNames.get(session.teamId) : undefined
              const place = teamName ?? 'Focus Zone'
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    className={['home-row', attendanceOf(session) === 'off' ? 'dead' : ''].join(' ')}
                    onClick={() => onSelect(session.id)}
                  >
                    {renderAvatar(session)}
                    <span className="home-row-name">
                      <PositionChip position={positionOf(session)} />
                      {nameOf(session)}
                    </span>
                    <span className="home-row-meta">
                      {place} · {stateLabelOf(session)}
                    </span>
                    <span className="home-row-time" title={iso ? formatDateTime(iso) : undefined}>
                      {iso ? formatAgo(iso, now) : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
