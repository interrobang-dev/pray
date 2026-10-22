import { useCallback, useEffect, useRef, useState } from 'react'
import type { UsageLimit, UsageResult } from './types'

const POLL_MS = 60_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 리셋까지 남은 시간 "Resets in 56m"·"Resets in 2h 13m"·"Resets in 4d 12h" (상태 표시줄 툴팁·상세 창) */
function remainingLabel(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((new Date(resetsAt).getTime() - now) / 60_000))
  if (minutes < 60) return `Resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Resets in ${hours}h ${minutes % 60}m`
  return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** 리셋 시각을 이 PC 시각으로 (예: "Resets Sat, Oct 24, 14:00"). 상세 창 한도 줄의 툴팁 */
function resetAtLabel(resetsAt: string): string {
  const date = new Date(resetsAt)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `Resets ${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${time}`
}

/** 서버가 사용량을 받아 온 시각 "Updated just now"·"Updated 3m ago"·"Updated 2h ago" */
function fetchedLabel(fetchedAt: string, now: number): string {
  const minutes = Math.floor((now - new Date(fetchedAt).getTime()) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes}m ago`
  if (minutes < 1440) return `Updated ${Math.floor(minutes / 60)}h ago`
  return `Updated ${Math.floor(minutes / 1440)}d ago`
}

/** 상세 창의 한도 이름. 서버는 한도 종류와 모델 이름만 주고 이름은 화면이 정한다 */
function longNameOf(limit: UsageLimit): string {
  if (limit.kind === 'session') return 'Session'
  if (limit.kind === 'weekly_all') return 'Weekly'
  if (limit.model) return limit.model
  return limit.label
}

/** 요금제 표시 "max" → "Max" */
function planLabel(plan: string): string {
  return `${plan[0].toUpperCase()}${plan.slice(1)}`
}

/** 상세 창 머리의 Claude 별 (주황 빛살 12개, 긴 것·짧은 것 번갈아) */
function ClaudeMark() {
  return (
    <svg className="usage-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * Math.PI) / 6
        const outer = i % 2 === 0 ? 10.5 : 8
        return (
          <line
            key={i}
            x1={12 + 2.5 * Math.cos(angle)}
            y1={12 + 2.5 * Math.sin(angle)}
            x2={12 + outer * Math.cos(angle)}
            y2={12 + outer * Math.sin(angle)}
          />
        )
      })}
    </svg>
  )
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

  // 상세 창은 다시 누름·바깥 클릭·Esc 로 닫는다. 상태 표시줄 ↻ 는 이 안이라 눌러도 창이 그대로다
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
    // 열 때 "Updated 3m ago"·리셋까지 남은 시간을 지금 기준으로 다시 잰다
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
        <div id="usage-popover" className="usage-popover" role="dialog" aria-label="Claude usage">
          <div className="usage-head">
            <div className="usage-title">
              <ClaudeMark />
              <b>Claude</b>
            </div>
            {result?.ok && <div className="usage-sub">{fetchedLabel(result.usage.fetchedAt, now)}</div>}
          </div>
          {result === null && <p className="usage-note">Loading…</p>}
          {result && !result.ok && <p className="usage-note error">{result.reason}</p>}
          {result?.ok && (
            <div className="usage-rows">
              {result.usage.limits.map((limit) => {
                const remaining = remainingOf(limit)
                const name = longNameOf(limit)
                const hasReset = !Number.isNaN(Date.parse(limit.resetsAt))
                return (
                  <div key={limit.label} className={`usage-row ${levelOf(remaining)}`}>
                    <b className="usage-name">{name}</b>
                    <div className="usage-bar" role="progressbar" aria-label={`${name} remaining`} aria-valuenow={remaining} aria-valuemin={0} aria-valuemax={100}>
                      <span style={{ width: `${remaining}%` }} />
                    </div>
                    <div className="usage-meta" title={hasReset ? resetAtLabel(limit.resetsAt) : undefined}>
                      <span className="usage-left">{remaining}% left</span>
                      {hasReset && <span>{remainingLabel(limit.resetsAt, now)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {result?.ok && <UsageAccount email={result.usage.email ?? null} plan={result.usage.plan} />}
        </div>
      )}
    </div>
  )
}

/** 상세 창 아래 계정 구역: 로그인된 이메일과 오른쪽 요금제. 이메일이 없으면 요금제만, 둘 다 없으면 구역이 없다 */
function UsageAccount({ email, plan }: { email: string | null; plan: string | null }) {
  const planText = plan ? planLabel(plan) : null
  if (!email && !planText) return null
  return (
    <div className="usage-account">
      <div className="usage-account-label">Claude Account</div>
      <div className="usage-account-line">
        {email ? (
          <>
            <span className="usage-email" title={email}>
              {email}
            </span>
            {planText && <span className="usage-plan">{planText}</span>}
          </>
        ) : (
          <span className="usage-email">{planText}</span>
        )}
      </div>
    </div>
  )
}
