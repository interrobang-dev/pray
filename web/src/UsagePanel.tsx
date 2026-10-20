import { useCallback, useEffect, useState } from 'react'
import type { UsageLimit, UsageResult } from './types'

const POLL_MS = 60_000

function remainingLabel(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((new Date(resetsAt).getTime() - now) / 60_000))
  if (minutes < 60) return `${minutes}분 후 리셋`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 ${minutes % 60}분 후 리셋`
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간 후 리셋`
}

function levelOf(limit: UsageLimit): string {
  if (limit.percent >= 90) return 'danger'
  if (limit.percent >= 70) return 'warn'
  return ''
}

export function UsagePanel() {
  const [result, setResult] = useState<UsageResult | null>(null)
  const [now, setNow] = useState(() => Date.now())

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

  return (
    <div className="usage">
      <div className="usage-title">
        <b>계정 사용량</b>
        {result?.ok && result.usage.plan && <span>{result.usage.plan}&nbsp;</span>}
        <button onClick={load} title="새로 고침">
          ↻
        </button>
      </div>
      {result === null && <span>불러오는 중…</span>}
      {result && !result.ok && <span className="error">{result.reason}</span>}
      {result?.ok &&
        result.usage.limits.map((limit) => (
          <div key={limit.label} className={`usage-limit ${levelOf(limit)}`}>
            <span>
              {limit.label} <b>{limit.percent}%</b>
            </span>
            <span className="reset">{remainingLabel(limit.resetsAt, now)}</span>
            <span className="bar">
              <i style={{ width: `${Math.min(100, limit.percent)}%` }} />
            </span>
          </div>
        ))}
    </div>
  )
}
