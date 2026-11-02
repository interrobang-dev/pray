import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { PositionChip } from './PositionChip'
import { contextSizeOf } from './contextSize'
import { formatAgo, formatDateTime, type Team } from './types'
import {
  contextGrowthText,
  eventDetailText,
  memberNameOf,
  taskDuration,
  taskStatusLabel,
  timelineRows,
  usageDetailText,
  usageMetaText,
  usageTotalOf,
  usageTotalText,
  type TaskDetail,
  type TaskHistory,
  type TaskHistoryItem,
  type TeamEventItem,
} from './teamTasks'

/** 열려 있는 동안 목록을 다시 받는 간격. task 는 SSE 가 없다 */
const REFRESH_MS = 10_000

interface Props {
  team: Team
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

/** 팀 Tasks 창: 팀장·파트장이 팀원에게 준 task(최근 7일)와 팀원 spawn·dismiss 기록(30일)을 최근순으로. 줄을 누르면 지시·결과 전문 */
export function TeamTasksModal({ team, onClose }: Props) {
  const [history, setHistory] = useState<TaskHistory | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TaskDetail | { failure: string }>>({})
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let isCurrent = true
    const load = async () => {
      const { data, failure: loadFailure } = await getJson<TaskHistory>(`/api/team/${encodeURIComponent(team.id)}/tasks`)
      if (!isCurrent) return
      setNow(Date.now())
      setFailure(loadFailure)
      if (data) setHistory(data)
    }
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      isCurrent = false
      window.clearInterval(timer)
    }
  }, [team.id])

  // 펼친 task 의 전문. 진행 중이던 것이 끝나면(목록의 상태가 바뀌면) 다시 받는다
  const openTask = history?.tasks.find((task) => task.id === openId)
  const openStatus = openTask?.status
  useEffect(() => {
    if (!openId) return
    let isCurrent = true
    void getJson<{ task: TaskDetail }>(`/api/team/${encodeURIComponent(team.id)}/tasks/${encodeURIComponent(openId)}`).then(({ data, failure: detailFailure }) => {
      if (!isCurrent) return
      setDetails((current) => ({ ...current, [openId]: data ? data.task : { failure: detailFailure ?? 'Not found' } }))
    })
    return () => {
      isCurrent = false
    }
  }, [team.id, openId, openStatus])

  const partName = (partId: string | null) => (partId ? (team.parts.find((part) => part.id === partId)?.name ?? 'Removed part') : null)
  const rows = history ? timelineRows(history) : []
  const total = history ? usageTotalOf(history.tasks) : null
  const totalText = total ? usageTotalText(total) : null

  function renderTask(task: TaskHistoryItem) {
    const isOpen = openId === task.id
    const growth = contextGrowthText(task.startContextTokens, task.endContextTokens, task.status === 'running')
    const endSize = contextSizeOf(task.endContextTokens)
    const part = partName(task.partId)
    const usageText = usageMetaText(task.usage, task.model)
    const detail = details[task.id]
    return (
      <li key={`task-${task.id}`} className={isOpen ? 'task-row open' : 'task-row'}>
        <button type="button" className="task-summary" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : task.id)}>
          <span className="task-line">
            <span className={`task-status ${task.status}`}>{taskStatusLabel(task)}</span>
            <span className="task-member">
              <PositionChip position={task.memberPosition} />
              {memberNameOf(task.memberName, task.memberSessionId)}
            </span>
            <span className="task-time" title={formatDateTime(task.createdAt)}>
              {formatAgo(task.createdAt, now)}
            </span>
          </span>
          <span className="task-instruction">{task.instruction}</span>
          <span className="task-meta">
            <span title={task.finishedAt ? `Finished ${formatDateTime(task.finishedAt)}` : undefined}>
              {task.status === 'running' ? 'For ' : 'Took '}
              {taskDuration(task, now)}
            </span>
            {growth && (
              <span className={endSize ? `context-size ${endSize.level}` : 'context-size'} title={endSize ? endSize.title : undefined}>
                Context {growth}
              </span>
            )}
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
                {detail.usage && (
                  <>
                    <div className="task-detail-label">Usage</div>
                    <div className="task-usage">{[detail.model, usageDetailText(detail.usage)].filter(Boolean).join(' · ')}</div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </li>
    )
  }

  function renderEvent(event: TeamEventItem, index: number) {
    const detail = eventDetailText(event)
    const part = partName(event.partId)
    return (
      <li key={`event-${event.at}-${event.sessionId}-${index}`} className="task-event">
        <span className={`task-event-kind ${event.kind}`}>{event.kind === 'spawn' ? 'Joined' : 'Released'}</span>
        <span className="task-member">
          <PositionChip position={event.position} />
          {memberNameOf(event.memberName, event.sessionId)}
        </span>
        <span className="task-event-detail">{[detail, part ? `Part ${part}` : ''].filter(Boolean).join(' · ')}</span>
        <span className="task-time" title={formatDateTime(event.at)}>
          {formatAgo(event.at, now)}
        </span>
      </li>
    )
  }

  return (
    <Modal title={`Tasks · ${team.name}`} subtitle="Tasks from the last 7 days, members from the last 30" onClose={onClose} className="tasks-modal" hasCloseButton>
      {totalText && total && (
        <div className="tasks-total" title={total.withUsage > 0 ? usageDetailText(total.usage) : undefined}>
          {totalText}
        </div>
      )}
      {failure && <div className="todo-error">{failure}</div>}
      <div className="tasks-scroll">
        {!history ? (
          !failure && <div className="task-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="task-empty">No tasks</div>
        ) : (
          <ul className="tasks-list">{rows.map((row, index) => (row.kind === 'task' ? renderTask(row.task) : renderEvent(row.event, index)))}</ul>
        )}
      </div>
    </Modal>
  )
}
