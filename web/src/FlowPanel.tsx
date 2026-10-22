import { useEffect, useRef, useState } from 'react'
import { Segmented } from './Modal'
import { formatClock } from './Chat'
import type { FlowAlarm, FlowAlarmPage } from './types'

type AlarmFilter = 'unread' | 'all'

/** 서버가 키 없음(503)을 알릴 때 패널 안내 */
const KEY_MISSING_MESSAGE = '~/.claude/flow-key.env 에 FLOW_API_KEY 가 없습니다'

/** 알림 시각: "방금"·"3분 전", 그보다 오래면 "10:12", 오늘이 아니면 "10/21 10:12" */
function formatAlarmTime(iso: string | null, now: number): string {
  if (!iso) return ''
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
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
    return { error: '네트워크 오류' }
  }
}

/**
 * 오른쪽 패널 자리의 플로우 알림 목록 (읽기만). 안 읽음 | 전체, 50개씩 [더 보기].
 * unreadAlarmCount 가 바뀌면(전역 SSE flow) 첫 쪽부터 다시 받는다
 */
export function FlowPanel({
  unreadAlarmCount,
  unreadChatCount,
  isNarrow,
  onClose,
}: {
  unreadAlarmCount: number | null
  unreadChatCount: number | null
  isNarrow: boolean
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

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
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

  const isEmpty = !isLoading && !error && alarms.length === 0

  return (
    <section className="panel flow-panel">
      <div className="panel-header">
        <b>Flow 알림</b>
        {/* 폰에서는 패널이 화면 전체라 "뒤로" 가 목록으로 돌아가는 버튼이다 */}
        <button className="close" onClick={onClose} title={isNarrow ? '목록으로' : '닫기'}>
          {isNarrow ? '←' : '×'}
        </button>
      </div>
      <div className="flow-toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'unread', label: '안 읽음' },
            { value: 'all', label: '전체' },
          ]}
        />
        <span className={unreadChatCount ? 'flow-chat-count unread' : 'flow-chat-count'} title="채팅 내용은 플로우 공식 API 에 없어 수만 보인다">
          채팅 안 읽음 {unreadChatCount ?? '…'}
        </span>
        <button className="flow-refresh" onClick={() => setReloadCount((count) => count + 1)} disabled={isLoading} title="새로고침">
          ↻
        </button>
      </div>
      <div className="flow-list">
        {error && <p className="hint flow-error">{error}</p>}
        {isEmpty && <p className="hint">{filter === 'unread' ? '안 읽은 알림이 없습니다' : '알림이 없습니다'}</p>}
        {alarms.map((alarm) => (
          <FlowAlarmItem key={alarm.alarmId} alarm={alarm} now={now} />
        ))}
        {nextCursor && !error && (
          <button className="flow-more" onClick={() => void loadMore()} disabled={isLoading}>
            {isLoading ? '불러오는 중…' : '더 보기'}
          </button>
        )}
        {isLoading && alarms.length === 0 && !error && <p className="hint">불러오는 중…</p>}
      </div>
    </section>
  )
}

/** 알림 한 줄: 안 읽음 점 · 프로젝트 · 배지 · 시각 / 문구 / content 한 줄 / 보낸 사람 */
function FlowAlarmItem({ alarm, now }: { alarm: FlowAlarm; now: number }) {
  const text = alarm.message ?? alarm.content
  const detail = alarm.message && alarm.content ? alarm.content : null
  return (
    <div className={alarm.isRead ? 'flow-alarm' : 'flow-alarm unread'}>
      <span className="flow-alarm-dot" title={alarm.isRead ? '읽음' : '안 읽음'} />
      <div className="flow-alarm-head">
        <span className="flow-alarm-project">{alarm.projectName ?? `프로젝트 ${alarm.projectId}`}</span>
        {alarm.isMention && <span className="badge">멘션</span>}
        {alarm.isWorker && <span className="badge">담당</span>}
        <span className="flow-alarm-time" title={alarm.registeredAt ? new Date(alarm.registeredAt).toLocaleString('ko-KR') : undefined}>
          {formatAlarmTime(alarm.registeredAt, now)}
        </span>
      </div>
      <div className="flow-alarm-text">{text}</div>
      {detail && (
        <div className="flow-alarm-detail" title={detail}>
          {detail}
        </div>
      )}
      <div className="flow-alarm-from">{alarm.registerName}</div>
    </div>
  )
}
