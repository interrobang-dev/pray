import { useEffect, useRef, useState } from 'react'
import {
  clockText,
  commitsNote,
  dayTitle,
  eventsText,
  reportTotalText,
  shiftDate,
  splitTeams,
  teamSummaryText,
  tokenRows,
  type DailyReport,
  type DailyTask,
  type DailyTodo,
  type TeamDaily,
} from './daily'
import { Modal } from './Modal'
import { PositionChip } from './PositionChip'
import { PriorityChip } from './TeamTodosModal'
import { memberNameOf, taskDuration, taskStatusLabel, usageDetailText, usageMetaText, type TaskDetail } from './teamTasks'
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

/**
 * Today 창: 그날(서버 PC 의 자정 기준) 팀마다 커밋·끝난 task·토큰·끝낸 할 일·팀원 들고 남. ‹ › 로 하루씩 (오늘부터 7일 전까지).
 * 폴링하지 않는다 — 열 때·날짜를 바꿀 때·↻ 때만 받는다 (첫 요청이 jsonl 을 읽어 무겁다)
 */
export function DailyModal({ office, focusTeamId, onClose }: Props) {
  // null = 오늘 (서버가 정한다)
  const [date, setDate] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [report, setReport] = useState<DailyReport | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [openTask, setOpenTask] = useState<{ teamId: string; taskId: string } | null>(null)
  const [details, setDetails] = useState<Record<string, TaskDetail | { failure: string }>>({})
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

  const openKey = openTask ? `${openTask.teamId}/${openTask.taskId}` : null
  useEffect(() => {
    if (!openTask) return
    const key = `${openTask.teamId}/${openTask.taskId}`
    let isCurrent = true
    void getJson<{ task: TaskDetail }>(`/api/team/${encodeURIComponent(openTask.teamId)}/tasks/${encodeURIComponent(openTask.taskId)}`).then(({ data, failure: detailFailure }) => {
      if (!isCurrent) return
      setDetails((current) => ({ ...current, [key]: data ? data.task : { failure: detailFailure ?? 'Not found' } }))
    })
    return () => {
      isCurrent = false
    }
  }, [openTask, reloadKey])

  const shownDate = report?.date ?? null
  const today = report?.today ?? null
  const canGoBack = Boolean(report && shownDate && shownDate > report.oldestDate)
  const canGoForward = Boolean(report && shownDate && today && shownDate < today)
  const title = shownDate && today ? dayTitle(shownDate, today) : 'Today'
  const { active, quiet } = report ? splitTeams(report, office) : { active: [], quiet: [] }
  const totalText = report ? reportTotalText(report) : null
  const desk = report?.myDesk.todosDone ?? []
  const now = Date.now()

  const go = (days: number) => {
    if (!shownDate) return
    setOpenTask(null)
    setDate(shiftDate(shownDate, days))
  }
  const partName = (teamId: string, partId: string | null) =>
    partId ? (office.teams.find((team) => team.id === teamId)?.parts.find((part) => part.id === partId)?.name ?? 'Removed part') : null

  function renderTask(team: TeamDaily, task: DailyTask) {
    const key = `${team.teamId}/${task.id}`
    const isOpen = openKey === key
    const detail = details[key]
    const usageText = usageMetaText(task.usage, task.model)
    const part = partName(team.teamId, task.partId)
    const at = task.finishedAt ?? task.createdAt
    return (
      <li key={task.id} className={isOpen ? 'task-row open' : 'task-row'}>
        <button type="button" className="task-summary" aria-expanded={isOpen} onClick={() => setOpenTask(isOpen ? null : { teamId: team.teamId, taskId: task.id })}>
          <span className="task-line">
            <span className={`task-status ${task.status}`}>{taskStatusLabel(task)}</span>
            <span className="task-member">
              <PositionChip position={task.memberPosition} />
              {memberNameOf(task.memberName, task.memberSessionId)}
            </span>
            <span className="task-time" title={formatDateTime(at)}>
              {clockText(at)}
            </span>
          </span>
          {task.instructionHead && <span className="task-instruction">{task.instructionHead}</span>}
          {task.resultHead && <span className="task-instruction daily-result">{task.resultHead}</span>}
          <span className="task-meta">
            <span title={`Assigned ${formatDateTime(task.createdAt)}`}>
              {task.status === 'running' ? 'For ' : 'Took '}
              {taskDuration(task, now)}
            </span>
            {usageText && task.usage && <span title={usageDetailText(task.usage)}>{usageText}</span>}
            {part && <span>Part {part}</span>}
          </span>
        </button>
        {isOpen && (
          <div className="task-detail">
            {!detail ? (
              <div className="task-empty">Loading…</div>
            ) : 'failure' in detail ? (
              <div className="todo-error">{detail.failure}</div>
            ) : (
              <>
                <div className="task-detail-label">Instruction</div>
                <div className="task-text">{detail.instruction}</div>
                {detail.error && (
                  <>
                    <div className="task-detail-label">Error</div>
                    <div className="task-text task-error">{detail.error}</div>
                  </>
                )}
                <div className="task-detail-label">Result</div>
                {detail.result ? (
                  <div className="task-text">{detail.result}</div>
                ) : (
                  <div className="task-empty">{detail.status === 'running' ? 'Not finished yet' : 'No result'}</div>
                )}
              </>
            )}
          </div>
        )}
      </li>
    )
  }

  function renderTodos(todos: DailyTodo[]) {
    return (
      <ul className="daily-list">
        {todos.map((todo) => (
          <li key={todo.id} className="daily-row">
            <span className="daily-time" title={formatDateTime(todo.doneAt)}>
              {clockText(todo.doneAt)}
            </span>
            <span className="daily-text">
              <PriorityChip priority={todo.priority} />
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  function renderTeam(team: TeamDaily) {
    const note = commitsNote(team.commits)
    const tokens = tokenRows(team.tokens)
    const events = eventsText(team.events)
    const summary = teamSummaryText(team)
    const teamCwd = office.teams.find((item) => item.id === team.teamId)?.cwd
    return (
      <section key={team.teamId} className="daily-team" data-daily-team={team.teamId}>
        <div className="daily-team-head" title={teamCwd}>
          <b>{team.name}</b>
          {summary && <span className="daily-team-summary">{summary}</span>}
        </div>
        <div className="daily-label">Commits</div>
        {team.commits.error && <div className="todo-error">{team.commits.error}</div>}
        {note && <div className="daily-note">{note}</div>}
        {team.commits.items.length > 0 && (
          <ul className="daily-list">
            {team.commits.items.map((commit) => {
              const part = partName(team.teamId, commit.partId)
              return (
                <li key={commit.hash} className="daily-row" title={`${commit.hash}\n${commit.authorName} · ${formatDateTime(commit.at)}`}>
                  <span className="daily-time">{clockText(commit.at)}</span>
                  <span className="daily-hash">{commit.shortHash}</span>
                  <span className="daily-text">{commit.subject}</span>
                  {part && <span className="daily-part">Part {part}</span>}
                </li>
              )
            })}
          </ul>
        )}
        {team.commits.isTruncated && <div className="daily-note">Showing the first commits only</div>}
        {team.tasks.length > 0 && (
          <>
            <div className="daily-label">Tasks</div>
            <ul className="tasks-list">{team.tasks.map((task) => renderTask(team, task))}</ul>
          </>
        )}
        {tokens.length > 0 && (
          <>
            <div className="daily-label">Tokens</div>
            <ul className="daily-list">
              {tokens.map((row) => (
                <li key={row.kind} className="daily-row" title={row.title}>
                  <span className="daily-token-kind">{row.label}</span>
                  <span className="daily-text daily-numbers">{row.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {team.todosDone.length > 0 && (
          <>
            <div className="daily-label">Done TODOs</div>
            {renderTodos(team.todosDone)}
          </>
        )}
        {events && (
          <>
            <div className="daily-label">Members</div>
            <div className="daily-note">{events}</div>
          </>
        )}
      </section>
    )
  }

  const isEmpty = report && active.length === 0 && desk.length === 0

  return (
    <Modal title={title} subtitle="Up to 7 days back, by this PC's clock" onClose={onClose} className="daily-modal" hasCloseButton>
      <div className="daily-nav">
        <button type="button" onClick={() => go(-1)} disabled={!canGoBack || isLoading} title="Previous day" aria-label="Previous day">
          ‹
        </button>
        <button type="button" onClick={() => go(1)} disabled={!canGoForward || isLoading} title="Next day" aria-label="Next day">
          ›
        </button>
        <button
          type="button"
          onClick={() => {
            setOpenTask(null)
            setDate(null)
          }}
          disabled={!canGoForward || isLoading}
        >
          Today
        </button>
        <span className="daily-nav-gap" />
        {totalText && <span className="daily-total">{totalText}</span>}
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
            {desk.length > 0 && (
              <section className="daily-team">
                <div className="daily-team-head">
                  <b>My desk</b>
                </div>
                <div className="daily-label">Done TODOs</div>
                {renderTodos(desk)}
              </section>
            )}
            {active.map(renderTeam)}
            {isEmpty && <div className="task-empty">Nothing recorded for this day</div>}
            {quiet.length > 0 && <div className="daily-quiet">No activity: {quiet.map((team) => team.name).join(', ')}</div>}
          </>
        )}
      </div>
    </Modal>
  )
}
