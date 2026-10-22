import { useCallback, useEffect, useRef, useState } from 'react'
import type { UsageLimit, UsageResult } from './types'

const POLL_MS = 60_000
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function remainingLabel(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((new Date(resetsAt).getTime() - now) / 60_000))
  if (minutes < 60) return `${minutes}분 후 리셋`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 ${minutes % 60}분 후 리셋`
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간 후 리셋`
}

/** 리셋 시각을 이 PC 시각으로 (예: "10/24 (토) 14:00") */
function resetAtLabel(resetsAt: string): string {
  const date = new Date(resetsAt)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAYS[date.getDay()]}) ${time}`
}

function fetchedLabel(fetchedAt: string, now: number): string {
  const minutes = Math.floor((now - new Date(fetchedAt).getTime()) / 60_000)
  if (minutes < 1) return '방금 갱신'
  if (minutes < 60) return `${minutes}분 전 갱신`
  return `${Math.floor(minutes / 60)}시간 전 갱신`
}

/** 상세 창의 긴 이름. 서버는 한도 종류와 모델 이름만 주고 이름은 화면이 정한다 */
function longNameOf(limit: UsageLimit): string {
  if (limit.kind === 'session') return '5시간'
  if (limit.kind === 'weekly_all') return '주간 전체'
  if (limit.model) return `주간 · ${limit.model}`
  return limit.label
}

/** 서버는 사용률을 주고, 화면은 남은 비율로 보여 준다 */
function remainingOf(limit: UsageLimit): number {
  return Math.max(0, 100 - limit.percent)
}

function levelOf(remaining: number): string {
  if (remaining <= 10) return 'danger'
  if (remaining <= 30) return 'warn'
  return ''
}

export function UsagePanel() {
  const [result, setResult] = useState<UsageResult | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/usage')
      setResult(response.ok ? await response.json() : { ok: false, reason: `HTTP ${response.status}` })
    } catch {
      setResult({ ok: false, reason: '서버 연결 실패' })
    }
    setNow(Date.now())
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // 상세 창은 다시 누름·바깥 클릭·Esc 로 닫는다. ↻ 는 이 안이라 눌러도 창이 그대로다
  useEffect(() => {
    if (!isOpen) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      if (rootRef.current?.contains(document.activeElement)) toggleRef.current?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  function toggle() {
    // 열 때 "n분 전 갱신"·리셋까지 남은 시간을 지금 기준으로 다시 잰다
    setNow(Date.now())
    setIsOpen((prev) => !prev)
  }

  return (
    <div className="usage" ref={rootRef}>
      <button ref={toggleRef} className="usage-toggle" onClick={toggle} aria-expanded={isOpen} aria-controls="usage-popover">
        <span className="usage-prefix">Remaining</span>
        {result === null && <span>불러오는 중…</span>}
        {result && !result.ok && <span className="error">{result.reason}</span>}
        {result?.ok &&
          result.usage.limits.map((limit, index) => {
            const remaining = remainingOf(limit)
            return (
              <span key={limit.label} className={`usage-limit ${levelOf(remaining)}`} title={remainingLabel(limit.resetsAt, now)}>
                {index > 0 && <i>·</i>}
                {limit.label} <b>{remaining}%</b>
              </span>
            )
          })}
      </button>
      <button className="usage-refresh" onClick={load} title="새로 고침">
        ↻
      </button>
      {isOpen && (
        <div id="usage-popover" className="usage-popover" role="dialog" aria-label="계정 사용량">
          {result === null && <p className="usage-note">불러오는 중…</p>}
          {result && !result.ok && <p className="usage-note error">{result.reason}</p>}
          {result?.ok &&
            result.usage.limits.map((limit) => {
              const remaining = remainingOf(limit)
              const name = longNameOf(limit)
              return (
                <div key={limit.label} className={`usage-row ${levelOf(remaining)}`}>
                  <div className="usage-row-head">
                    <b>{name}</b>
                    <span>
                      {remaining}% 남음 (사용 {limit.percent}%)
                    </span>
                  </div>
                  <div className="usage-bar" role="progressbar" aria-label={`${name} 남은 비율`} aria-valuenow={remaining} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${remaining}%` }} />
                  </div>
                  {!Number.isNaN(Date.parse(limit.resetsAt)) && (
                    <div className="usage-reset">
                      {remainingLabel(limit.resetsAt, now)} · {resetAtLabel(limit.resetsAt)}
                    </div>
                  )}
                </div>
              )
            })}
          <div className="usage-popover-foot">
            {result?.ok && (
              <span>{[result.usage.plan && `요금제 ${result.usage.plan}`, fetchedLabel(result.usage.fetchedAt, now)].filter(Boolean).join(' · ')}</span>
            )}
            <button onClick={load} title="새로 고침">
              ↻
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
