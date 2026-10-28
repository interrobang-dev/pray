import { useEffect, useRef, useState } from 'react'
import { Segmented } from './Modal'
import { confirmDialog } from './Dialog'
import { formatClock } from './Chat'
import { formatAgo, formatDateTime, type FlowAlarm, type FlowAlarmPage, type FlowStatus } from './types'

type AlarmFilter = 'unread' | 'all'

/** 서버가 키 없음(503)을 알릴 때 패널 안내 */
const KEY_MISSING_MESSAGE = 'No FLOW_API_KEY in ~/.claude/flow-key.env'

/** 알림 시각: "just now"·"3m ago", 그보다 오래면 "10:12", 오늘이 아니면 "10/21 10:12" */
function formatAlarmTime(iso: string | null, now: number): string {
  if (!iso) return ''
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) return formatAgo(iso, now)
  return formatClock(iso)
}

/** 플로우 알림 패널 한 쪽을 받는다. 실패하면 서버 문구 (키 없음은 안내 문구) */
async function fetchAlarms(filter: AlarmFilter, cursor: string | null): Promise<FlowAlarmPage | { error: string }> {
  const query = new URLSearchParams()
  if (filter === 'unread') query.set('readYn', 'N')
  if (cursor) query.set('cursor', cursor)
  try {
    const response = await fetch(`/api/flow/alarms?${query}`)
    if (response.ok) return (await response.json()) as FlowAlarmPage
    if (response.status === 503) return { error: KEY_MISSING_MESSAGE }
    const { message } = (await response.json().catch(() => ({}))) as { message?: string }
    return { error: message ?? `HTTP ${response.status}` }
  } catch {
    return { error: 'Network error' }
  }
}

/** 읽음 처리 요청. 성공하면 서버가 다시 센 FlowStatus, 실패하면 서버 문구 */
async function postRead(path: string): Promise<{ ok: true; status: FlowStatus } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, { method: 'POST' })
    if (response.ok) return { ok: true, status: (await response.json()) as FlowStatus }
    const { message } = (await response.json().catch(() => ({}))) as { message?: string }
    return { ok: false, message: message ?? `HTTP ${response.status}` }
  } catch {
    return { ok: false, message: 'Network error' }
  }
}

/**
 * 오른쪽 패널 자리의 플로우 알림 목록. 안 읽음 | 전체, 50개씩 [더 보기], 항목별 [읽음]·머리의 [전체 읽음].
 * unreadAlarmCount 가 바뀌면(전역 SSE flow) 첫 쪽부터 다시 받는다 — 단 이 패널의 [읽음] 으로 바뀐 것이면 그 항목만 읽음으로 바꾸고 다시 받지 않는다 (더 보기로 받은 쪽·스크롤이 유지되게)
 */
export function FlowPanel({
  unreadAlarmCount,
  unreadChatCount,
  isNarrow,
  onStatus,
  onClose,
}: {
  unreadAlarmCount: number | null
  unreadChatCount: number | null
  isNarrow: boolean
  /** 읽음 처리 응답의 새 상태. 플로우 줄 숫자를 SSE 를 기다리지 않고 바로 바꾼다 */
  onStatus: (status: FlowStatus) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<AlarmFilter>('unread')
  const [alarms, setAlarms] = useState<FlowAlarm[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  /** 늦게 온 옛 응답(필터를 바꾸기 전 것 등)을 버리기 위한 요청 번호 */
  const requestIdRef = useRef(0)
  /** [읽음] 진행 중인 alarmId */
  const [readingIds, setReadingIds] = useState<Set<string>>(() => new Set())
  /** [읽음] 실패 문구 (alarmId → 서버 문구) */
  const [readErrors, setReadErrors] = useState<Record<string, string>>({})
  const [isReadingAll, setIsReadingAll] = useState(false)
  const [readAllError, setReadAllError] = useState<string | null>(null)
  /**
   * [읽음] 때문에 바뀐 안 읽은 수로는 목록을 다시 받지 않는다. 서버가 읽음 처리 뒤 다시 세어 SSE 를 먼저 보내고 응답하므로
   * 진행 중인 [읽음] 이 있는 동안의 수 변화는 건너뛰고(pendingReadsRef), 응답이 먼저 오면 그 수(ownCountRef)를 건너뛴다
   */
  const pendingReadsRef = useRef(0)
  const ownCountRef = useRef<number | null | undefined>(undefined)
  /** 마지막으로 목록을 받은 보기·새로고침 번호. 이것이 바뀌면 늘 다시 받는다 */
  const loadedRef = useRef<{ filter: AlarmFilter; reloadCount: number } | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const isCountOnly = loadedRef.current?.filter === filter && loadedRef.current.reloadCount === reloadCount
    const isOwnChange = pendingReadsRef.current > 0 || (ownCountRef.current !== undefined && ownCountRef.current === unreadAlarmCount)
    ownCountRef.current = undefined
    if (isCountOnly && isOwnChange) return
    loadedRef.current = { filter, reloadCount }
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    void fetchAlarms(filter, null).then((result) => {
      if (requestId !== requestIdRef.current) return
      setIsLoading(false)
      setNow(Date.now())
      if ('error' in result) {
        setError(result.error)
        setAlarms([])
        setNextCursor(null)
        return
      }
      setError(null)
      setAlarms(result.alarms)
      setNextCursor(result.hasNext ? result.nextCursor : null)
    })
  }, [filter, unreadAlarmCount, reloadCount])

  async function loadMore() {
    if (!nextCursor) return
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    const result = await fetchAlarms(filter, nextCursor)
    if (requestId !== requestIdRef.current) return
    setIsLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    // 쪽을 받는 사이 새 알림이 들어오면 경계가 밀려 같은 알림이 두 번 올 수 있다
    setAlarms((prev) => {
      const ids = new Set(prev.map((alarm) => alarm.alarmId))
      return [...prev, ...result.alarms.filter((alarm) => !ids.has(alarm.alarmId))]
    })
    setNextCursor(result.hasNext ? result.nextCursor : null)
  }

  async function readAlarm(alarmId: string) {
    setReadingIds((prev) => new Set(prev).add(alarmId))
    setReadErrors((prev) => {
      const next = { ...prev }
      delete next[alarmId]
      return next
    })
    pendingReadsRef.current++
    const result = await postRead(`/api/flow/alarms/${encodeURIComponent(alarmId)}/read`)
    pendingReadsRef.current--
    setReadingIds((prev) => {
      const next = new Set(prev)
      next.delete(alarmId)
      return next
    })
    if (!result.ok) {
      setReadErrors((prev) => ({ ...prev, [alarmId]: result.message }))
      return
    }
    setAlarms((prev) => prev.map((alarm) => (alarm.alarmId === alarmId ? { ...alarm, isRead: true } : alarm)))
    // SSE 가 먼저 와 이미 같은 수면 그 렌더에서 다시 받았다 (ref 가 남아 다음 변화를 건너뛰지 않게 두지 않는다)
    if (result.status.unreadAlarmCount !== unreadAlarmCount) ownCountRef.current = result.status.unreadAlarmCount
    onStatus(result.status)
  }

  async function readAll() {
    const isConfirmed = await confirmDialog(`Mark all ${unreadAlarmCount} unread Flow alerts as read? This can't be undone.`, {
      confirmLabel: 'Mark all read',
    })
    if (!isConfirmed) return
    setIsReadingAll(true)
    setReadAllError(null)
    const result = await postRead('/api/flow/alarms/read-all')
    setIsReadingAll(false)
    if (!result.ok) {
      setReadAllError(`Couldn't mark all read: ${result.message}`)
      return
    }
    // 수가 바뀌면 목록을 다시 받는다 (안 읽음 보기는 빈 목록이 된다). 그 전에 보이는 것도 읽음으로
    setAlarms((prev) => prev.map((alarm) => ({ ...alarm, isRead: true })))
    onStatus(result.status)
  }

  const isEmpty = !isLoading && !error && alarms.length === 0

  return (
    <section className="panel flow-panel">
      <div className="panel-header">
        <b>Flow alerts</b>
        {(unreadAlarmCount ?? 0) > 0 && (
          <button className="flow-read-all" onClick={() => void readAll()} disabled={isReadingAll}>
            {isReadingAll ? '…' : 'Mark all read'}
          </button>
        )}
        {/* 폰에서는 패널이 화면 전체라 "뒤로" 가 목록으로 돌아가는 버튼이다 */}
        <button className="close" onClick={onClose} title={isNarrow ? 'Back to list' : 'Close'}>
          {isNarrow ? '←' : '×'}
        </button>
      </div>
      <div className="flow-toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
        />
        <span className={unreadChatCount ? 'flow-chat-count unread' : 'flow-chat-count'} title="The Flow API has no chat messages, so only the count is shown">
          Unread chats {unreadChatCount ?? '…'}
        </span>
        <button className="flow-refresh" onClick={() => setReloadCount((count) => count + 1)} disabled={isLoading} title="Reload">
          ↻
        </button>
      </div>
      {readAllError && (
        <div className="flow-read-error flow-read-all-error" role="alert">
          {readAllError}
        </div>
      )}
      <div className="flow-list">
        {error && <p className="hint flow-error">{error}</p>}
        {isEmpty && <p className="hint">{filter === 'unread' ? 'No unread alerts' : 'No alerts'}</p>}
        {alarms.map((alarm) => (
          <FlowAlarmItem
            key={alarm.alarmId}
            alarm={alarm}
            now={now}
            isReading={readingIds.has(alarm.alarmId)}
            readError={readErrors[alarm.alarmId] ?? null}
            onRead={() => void readAlarm(alarm.alarmId)}
          />
        ))}
        {nextCursor && !error && (
          <button className="flow-more" onClick={() => void loadMore()} disabled={isLoading}>
            {isLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {isLoading && alarms.length === 0 && !error && <p className="hint">Loading…</p>}
      </div>
    </section>
  )
}

/** 알림 한 줄: 안 읽음 점 · 프로젝트 · 배지 · 시각 / 문구 / content 한 줄 / 보낸 사람 · [읽음](안 읽은 것만) / 읽음 실패 문구 */
function FlowAlarmItem({
  alarm,
  now,
  isReading,
  readError,
  onRead,
}: {
  alarm: FlowAlarm
  now: number
  isReading: boolean
  readError: string | null
  onRead: () => void
}) {
  const text = alarm.message ?? alarm.content
  const detail = alarm.message && alarm.content ? alarm.content : null
  return (
    <div className={alarm.isRead ? 'flow-alarm' : 'flow-alarm unread'}>
      <span className="flow-alarm-dot" title={alarm.isRead ? 'Read' : 'Unread'} />
      <div className="flow-alarm-head">
        <span className="flow-alarm-project">{alarm.projectName ?? `Project ${alarm.projectId}`}</span>
        {alarm.isMention && <span className="badge">Mention</span>}
        {alarm.isWorker && <span className="badge">Assigned</span>}
        <span className="flow-alarm-time" title={alarm.registeredAt ? formatDateTime(alarm.registeredAt) : undefined}>
          {formatAlarmTime(alarm.registeredAt, now)}
        </span>
      </div>
      <div className="flow-alarm-text">{text}</div>
      {detail && (
        <div className="flow-alarm-detail" title={detail}>
          {detail}
        </div>
      )}
      <div className="flow-alarm-foot">
        <span className="flow-alarm-from">{alarm.registerName}</span>
        {!alarm.isRead && (
          <button className="flow-read" onClick={onRead} disabled={isReading} title="Mark this alert read in Flow">
            {isReading ? '…' : 'Mark read'}
          </button>
        )}
      </div>
      {readError && (
        <div className="flow-read-error" role="alert">
          Couldn't mark read: {readError}
        </div>
      )}
    </div>
  )
}
