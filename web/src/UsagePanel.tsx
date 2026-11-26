import { useCallback, useEffect, useRef, useState } from 'react'
import { Accounts, AddAccountModal } from './Accounts'
import type { UsageLimit, UsageResult } from './types'

const POLL_MS = 60_000
/** 손으로 누른 ↻ 가 도는 최소 시간. 서버 60초 캐시 안이면 응답이 바로 와서 이게 없으면 돌지 않는다 */
const REFRESH_SPIN_MIN_MS = 600
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

/** 상세 창 머리의 Claude 로고 (Simple Icons 의 claude.svg 경로, CC0. 색 --claude-mark) */
const CLAUDE_MARK_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'

function ClaudeMark() {
  return (
    <svg className="usage-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={CLAUDE_MARK_PATH} />
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
  /** 계정 추가 모달. 상세 창은 연 채로 두고 모달이 위에 뜬다 */
  /** 띄운 로그인 창의 제목 (계정 추가·지금 계정 다시 로그인). null 이면 안 떴다 */
  const [loginTitle, setLoginTitle] = useState<string | null>(null)
  const isAddingAccount = loginTitle !== null
  /** 계정 추가에 성공할 때마다 늘려 계정 목록이 다시 받게 한다 */
  const [accountsVersion, setAccountsVersion] = useState(0)
  /** 계정 전환 확인 모달 (Accounts 가 .usage 안으로 띄운다). 상세 창은 연 채로 둔다 */
  const [isSwitchOpen, setIsSwitchOpen] = useState(false)
  /** .usage. 계정 모달을 이 안(상세 창 밖)에 띄우므로 Accounts 에도 넘긴다 */
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /** 손으로 누른 새로고침이 도는 중 (폴링·계정 전환 뒤 다시 받기는 돌지 않는다) */
  const [isRefreshing, setIsRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/usage')
      setResult(response.ok ? await response.json() : { ok: false, reason: `HTTP ${response.status}` })
    } catch {
      setResult({ ok: false, reason: "Can't reach the server" })
    }
    setNow(Date.now())
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // 상세 창은 다시 누름·바깥 클릭·Esc 로 닫는다. 상태 표시줄 ↻ 와 계정 추가·전환 모달은 이 안(DOM)이라 눌러도 창이 그대로다.
  // 모달이 떠 있는 동안 Esc 는 모달만 닫는다
  useEffect(() => {
    if (!isOpen) return
    const onDown = (event: MouseEvent) => {
      // 모달 바깥(오버레이)을 누르면 React 가 이 리스너보다 먼저 모달을 지워 target 이 DOM 에서 빠진다. 그래서 contains 가 아니라 눌린 때의 이벤트 경로로 본다
      if (rootElement && !event.composedPath().includes(rootElement)) setIsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isAddingAccount || isSwitchOpen) return
      setIsOpen(false)
      if (rootElement?.contains(document.activeElement)) toggleRef.current?.focus()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, isAddingAccount, isSwitchOpen, rootElement])

  async function refresh() {
    if (isRefreshing) return
    setIsRefreshing(true)
    await Promise.all([load(), new Promise((resolve) => setTimeout(resolve, REFRESH_SPIN_MIN_MS))])
    setIsRefreshing(false)
  }

  function toggle() {
    // 열 때 "Updated 3m ago"·리셋까지 남은 시간을 지금 기준으로 다시 잰다
    setNow(Date.now())
    setIsOpen((prev) => !prev)
  }

  return (
    <div className="usage" ref={setRootElement}>
      <button ref={toggleRef} className="usage-toggle" onClick={toggle} aria-expanded={isOpen} aria-controls="usage-popover">
        <span className="usage-prefix">Remaining</span>
        {result === null && <span>Loading…</span>}
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
      <button className={isRefreshing ? 'usage-refresh is-spinning' : 'usage-refresh'} onClick={() => void refresh()} title="Refresh">
        <span className="restart-glyph">↻</span>
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
          <Accounts
            version={accountsVersion}
            onAdd={() => setLoginTitle('Add Claude account')}
            onSignInAgain={() => setLoginTitle('Sign in to Claude')}
            onUsageChange={load}
            modalRoot={rootElement}
            onSwitchOpenChange={setIsSwitchOpen}
          />
        </div>
      )}
      {/* 상세 창 밖(쌓임 맥락 밖)이지만 .usage 안이라 모달 클릭이 상세 창의 바깥 클릭이 되지 않는다 */}
      {loginTitle !== null && (
        <AddAccountModal
          title={loginTitle}
          onClose={() => setLoginTitle(null)}
          onAdded={() => {
            setAccountsVersion((version) => version + 1)
            void load()
          }}
        />
      )}
    </div>
  )
}
