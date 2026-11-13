import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  commitsNote,
  dailyStats,
  dayTitle,
  hasTimedActivity,
  heatLevel,
  hourCountOf,
  hourTitle,
  nowShare,
  outputShare,
  outputText,
  shiftDate,
  splitTeams,
  teamCountsText,
  teamsByOutput,
  teamTimeline,
  tokenTitle,
  visibleCommits,
  type DailyReport,
  type TeamDaily,
} from './daily'
import { contextSizeText } from './contextSize'
import { Modal } from './Modal'
import { usageMetaText } from './teamTasks'
import { formatDateTime, type Office } from './types'

/** 툴바 Today 아이콘: 달력 + 체크 */
function DailyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M6 10l1.5 1.5L10.5 8.5" />
    </svg>
  )
}

/** 목록 툴바의 Today 줄 (모든 팀의 그날 한 일 창) */
export function DailyButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="toolbar-row" onClick={onOpen} title="Today's work">
      <DailyIcon />
      Today
    </button>
  )
}

interface Props {
  office: Office
  /** 팀 ⋯ 메뉴로 열었으면 그 팀 칸까지 스크롤한다 */
  focusTeamId: string | null
  onClose: () => void
}

/** 응답 본문 또는 실패 문구 (서버 message, 없으면 HTTP 코드, 닿지 못하면 "Network error") */
async function getJson<T>(url: string): Promise<{ data: T | null; failure: string | null }> {
  try {
    const response = await fetch(url)
    const data = (await response.json().catch(() => null)) as (T & { message?: string }) | null
    if (!response.ok) return { data: null, failure: data?.message ?? `HTTP ${response.status}` }
    return { data, failure: null }
  } catch {
    return { data: null, failure: 'Network error' }
  }
}

const AXIS_HOURS = [0, 6, 12, 18, 24]

/**
 * Today 창: 그날(서버 PC 의 자정 기준) 한 일을 숫자 칸 넷 · 팀별 시간대 타임라인 · 팀별 출력 토큰 막대와 커밋 제목으로.
 * ‹ › 로 하루씩 (오늘부터 7일 전까지). 폴링하지 않는다 — 열 때·날짜를 바꿀 때·↻ 때만 받는다 (첫 요청이 jsonl 을 읽어 무겁다)
 */
export function DailyModal({ office, focusTeamId, onClose }: Props) {
  // null = 오늘 (서버가 정한다)
  const [date, setDate] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedTeamIds, setExpandedTeamIds] = useState<ReadonlySet<string>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  useEffect(() => {
    let isCurrent = true
    setIsLoading(true)
    void getJson<DailyReport>(date ? `/api/daily?date=${encodeURIComponent(date)}` : '/api/daily').then(({ data, failure: loadFailure }) => {
      if (!isCurrent) return
      setIsLoading(false)
      // 이 API 가 없는 옛 서버는 화면 대체 경로로 index.html 을 200 으로 준다 (JSON 이 아니라 data null)
      const isOldServer = !loadFailure && !Array.isArray(data?.teams)
      setFailure(isOldServer ? 'The server is older than this page — restart the server to see this' : loadFailure)
      if (data && !isOldServer) setReport(data)
    })
    return () => {
      isCurrent = false
    }
  }, [date, reloadKey])

  // 팀 ⋯ 메뉴로 열었으면 처음 받은 뒤 한 번 그 팀 칸으로
  useEffect(() => {
    if (!report || !focusTeamId || hasScrolledRef.current) return
    hasScrolledRef.current = true
    const container = scrollRef.current
    const target = container?.querySelector<HTMLElement>(`[data-daily-team="${CSS.escape(focusTeamId)}"]`)
    if (container && target) container.scrollTo({ top: target.offsetTop - container.offsetTop })
  }, [report, focusTeamId])

  const shownDate = report?.date ?? null
  const today = report?.today ?? null
  const canGoBack = Boolean(report && shownDate && shownDate > report.oldestDate)
  const canGoForward = Boolean(report && shownDate && today && shownDate < today)
  const title = shownDate && today ? dayTitle(shownDate, today) : 'Today'
  const { active, quiet } = report ? splitTeams(report, office) : { active: [], quiet: [] }
  const ranked = teamsByOutput(active)
  const timed = ranked.filter(hasTimedActivity)
  const desk = report?.myDesk.todosDone ?? []
  const now = Date.now()
  const nowAt = report ? nowShare(report, now) : null

  const changeDate = (next: string | null) => {
    setExpandedTeamIds(new Set())
    scrollRef.current?.scrollTo({ top: 0 })
    setDate(next)
  }
  const toggleExpanded = (teamId: string) =>
    setExpandedTeamIds((current) => {
      const next = new Set(current)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  const partName = (teamId: string, partId: string | null) =>
    partId ? (office.teams.find((team) => team.id === teamId)?.parts.find((part) => part.id === partId)?.name ?? 'Removed part') : null

  function renderStats(currentReport: DailyReport) {
    const stats = dailyStats(currentReport)
    const tiles: { label: string; value: string; title?: string }[] = [
      { label: stats.commits === 1 ? 'commit' : 'commits', value: String(stats.commits) },
      { label: stats.tasks === 1 ? 'task done' : 'tasks done', value: String(stats.tasks) },
      { label: 'tokens out', value: contextSizeText(stats.usage?.outputTokens ?? 0), title: usageMetaText(stats.usage, null) ?? undefined },
      { label: stats.teams === 1 ? 'team' : 'teams', value: String(stats.teams) },
    ]
    return (
      <div className="daily-stats">
        {tiles.map((tile) => (
          <div key={tile.label} className="daily-stat" title={tile.title}>
            <b>{tile.value}</b>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>
    )
  }

  function renderLane(currentReport: DailyReport, team: TeamDaily) {
    const line = teamTimeline(team, currentReport, now)
    return (
      <div key={team.teamId} className="daily-lane">
        <span className="daily-lane-name">{team.name}</span>
        <div className="daily-track">
          <div className="daily-hours" style={{ '--hour-count': line.hours.length } as CSSProperties}>
            {line.hours.map((bucket, hour) => (
              <div key={hour} className="daily-hour" data-level={heatLevel(bucket.tasks)} title={`${team.name}\n${hourTitle(hour, bucket)}`} />
            ))}
          </div>
          {line.commitMarks.map((share, index) => (
            <span key={index} className="daily-commit-tick" style={{ left: `${share * 100}%` }} />
          ))}
          {nowAt !== null && <span className="daily-now" style={{ left: `${nowAt * 100}%` }} />}
        </div>
      </div>
    )
  }

  function renderTimeline(currentReport: DailyReport) {
    const hourCount = hourCountOf(currentReport)
    return (
      <section className="daily-section">
        <div className="daily-section-head">
          <b>Activity</b>
          <span className="daily-legend" aria-hidden="true">
            <span>Tasks running 1</span>
            {[1, 2, 3, 4].map((level) => (
              <span key={level} className="daily-legend-cell" data-level={level} />
            ))}
            <span>4+</span>
            <span className="daily-legend-tick" />
            <span>Commit</span>
            {nowAt !== null && (
              <>
                <span className="daily-legend-now" />
                <span>Now</span>
              </>
            )}
          </span>
        </div>
        <div className="daily-timeline">
          {timed.map((team) => renderLane(currentReport, team))}
          <div className="daily-lane daily-axis-row" aria-hidden="true">
            <span className="daily-lane-name" />
            <div className="daily-axis">
              {AXIS_HOURS.filter((hour) => hour <= hourCount).map((hour) => (
                <span key={hour} style={{ left: `${(hour / hourCount) * 100}%` }}>
                  {String(hour).padStart(2, '0')}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderTeam(team: TeamDaily) {
    const counts = teamCountsText(team)
    const output = outputText(team)
    const note = commitsNote(team.commits)
    const isExpanded = expandedTeamIds.has(team.teamId)
    const { shown, hiddenCount } = visibleCommits(team.commits.items, isExpanded)
    const teamCwd = office.teams.find((item) => item.id === team.teamId)?.cwd
    return (
      <li key={team.teamId} className="daily-team" data-daily-team={team.teamId}>
        <div className="daily-team-head">
          <b title={teamCwd}>{team.name}</b>
          {counts && <span className="daily-team-counts">{counts}</span>}
          <span className="daily-team-output">{output ? `${output} out` : ''}</span>
        </div>
        <div className="daily-bar" title={tokenTitle(team)}>
          <span className="daily-bar-fill" style={{ width: `${outputShare(team, ranked) * 100}%` }} />
        </div>
        {team.commits.error && <div className="todo-error">{team.commits.error}</div>}
        {note && <div className="daily-note">{note}</div>}
        {shown.length > 0 && (
          <ul className="daily-commits">
            {shown.map((commit) => {
              const part = partName(team.teamId, commit.partId)
              return (
                <li key={commit.hash} title={[commit.hash, `${commit.authorName} · ${formatDateTime(commit.at)}`, ...(part ? [`Part ${part}`] : [])].join('\n')}>
                  {commit.subject}
                </li>
              )
            })}
          </ul>
        )}
        {hiddenCount > 0 && (
          <button type="button" className="daily-more" onClick={() => toggleExpanded(team.teamId)}>
            +{hiddenCount} more
          </button>
        )}
        {isExpanded && (
          <>
            {team.commits.isTruncated && <div className="daily-note">Showing the first commits only</div>}
            <button type="button" className="daily-more" onClick={() => toggleExpanded(team.teamId)}>
              Show less
            </button>
          </>
        )}
      </li>
    )
  }

  const isEmpty = report && active.length === 0 && desk.length === 0

  return (
    <Modal title={title} subtitle="Up to 7 days back, by this PC's clock" onClose={onClose} className="daily-modal" hasCloseButton>
      <div className="daily-nav">
        <button type="button" onClick={() => shownDate && changeDate(shiftDate(shownDate, -1))} disabled={!canGoBack || isLoading} title="Previous day" aria-label="Previous day">
          ‹
        </button>
        <button type="button" onClick={() => shownDate && changeDate(shiftDate(shownDate, 1))} disabled={!canGoForward || isLoading} title="Next day" aria-label="Next day">
          ›
        </button>
        <button type="button" onClick={() => changeDate(null)} disabled={!canGoForward || isLoading}>
          Today
        </button>
        <span className="daily-nav-gap" />
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={isLoading} title="Refresh" aria-label="Refresh">
          ↻
        </button>
      </div>
      {failure && <div className="todo-error">{failure}</div>}
      <div className="daily-scroll" ref={scrollRef}>
        {!report ? (
          !failure && <div className="task-empty">Loading…</div>
        ) : (
          <>
            {renderStats(report)}
            {isEmpty && <div className="task-empty">Nothing recorded for this day</div>}
            {timed.length > 0 && renderTimeline(report)}
            {ranked.length > 0 && (
              <section className="daily-section">
                <div className="daily-section-head">
                  <b>Teams</b>
                </div>
                <ul className="daily-teams">{ranked.map(renderTeam)}</ul>
              </section>
            )}
            {(desk.length > 0 || quiet.length > 0) && (
              <div className="daily-quiet">
                {desk.length > 0 && <div>My desk: {desk.length === 1 ? '1 TODO' : `${desk.length} TODOs`} done</div>}
                {quiet.length > 0 && <div>No activity: {quiet.map((team) => team.name).join(', ')}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
