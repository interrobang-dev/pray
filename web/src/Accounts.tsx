import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { accountName, accountTitle, isLoginOver, planLabel, reloginLabel } from './accountLabels'
import { Modal } from './Modal'
import type { Account, AccountsResponse } from './types'

type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string; data: unknown }

/** 계정 API 요청. 실패면 상태 코드와 서버 문구 (없으면 HTTP 코드, 서버에 못 닿으면 "Network error"), 해석한 본문 */
async function request<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const response = await fetch(
      path,
      body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    )
    const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)
    if (response.ok) return { ok: true, data: data as T }
    const message = (data as { message?: unknown } | null)?.message
    return { ok: false, status: response.status, message: typeof message === 'string' ? message : `HTTP ${response.status}`, data }
  } catch {
    return { ok: false, status: 0, message: 'Network error', data: null }
  }
}

/** 진행 중인 계정 동작. 하나가 도는 동안 다른 버튼도 막는다 (전환 중 삭제 같은 것이 섞이지 않게) */
type Busy = { id: string; action: 'switch' | 'remove' | 'logout' | 'restart' }

/**
 * 사용량 상세 창 아래 계정 목록. 창을 열 때(마운트)·`version` 이 바뀔 때(추가 모달 성공)·동작 뒤에 목록을 다시 받는다.
 * 지금 계정은 [Log out], 나머지는 [Switch]·[Remove]. 실패는 그 줄 아래 빨강 (서버 문구)
 */
export function Accounts({ version, onAdd, onUsageChange }: { version: number; onAdd: () => void; onUsageChange: () => Promise<void> }) {
  const [list, setList] = useState<AccountsResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<Busy | null>(null)
  /** 계정 ID → 마지막 동작의 실패 문구 */
  const [errors, setErrors] = useState<Record<string, string>>({})
  /** 늦게 온 옛 목록 응답을 버리기 위한 요청 번호 */
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const result = await request<AccountsResponse>('/api/accounts', 'GET')
    if (requestId !== requestIdRef.current) return
    setNow(Date.now())
    if (result.ok && Array.isArray(result.data?.accounts)) {
      setList(result.data)
      setLoadError(null)
      return
    }
    setList(null)
    setLoadError(result.ok ? 'Unexpected response' : result.message)
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  function setError(id: string, message: string | null) {
    setErrors((prev) => {
      const next = { ...prev }
      if (message === null) delete next[id]
      else next[id] = message
      return next
    })
  }

  async function switchTo(account: Account) {
    if (!confirm(`Switch to ${accountName(account)}? Every claude on this PC (terminal and IDE too) will use this account.`)) return
    setError(account.id, null)
    setBusy({ id: account.id, action: 'switch' })
    const result = await request<{ account: Account }>(`/api/accounts/${encodeURIComponent(account.id)}/switch`, 'POST', {})
    setBusy(null)
    if (!result.ok) {
      setError(account.id, result.message)
      await load()
      return
    }
    await Promise.all([load(), onUsageChange()])
    if (!confirm('Restart host now? Web sessions reconnect with the new account.')) return
    setBusy({ id: account.id, action: 'restart' })
    const restart = await request<unknown>('/api/host/restart', 'POST', {})
    setBusy(null)
    if (!restart.ok) setError(account.id, `Couldn't restart host: ${restart.message}`)
  }

  async function remove(account: Account) {
    if (!confirm(`Remove ${accountName(account)}? Its sign-in on this PC is revoked. To use it again, add it again.`)) return
    setError(account.id, null)
    setBusy({ id: account.id, action: 'remove' })
    const result = await request<unknown>(`/api/accounts/${encodeURIComponent(account.id)}`, 'DELETE')
    setBusy(null)
    if (!result.ok) setError(account.id, result.message)
    await load()
  }

  async function logOut(account: Account) {
    if (
      !confirm(
        `Log out ${accountName(account)}? Every claude on this PC (terminal, IDE and web sessions) is logged out and this account leaves the list. To use claude again, you have to sign in again.`,
      )
    )
      return
    setError(account.id, null)
    setBusy({ id: account.id, action: 'logout' })
    const result = await request<unknown>('/api/accounts/logout', 'POST', {})
    setBusy(null)
    if (!result.ok) setError(account.id, result.message)
    await Promise.all([load(), onUsageChange()])
  }

  /** 진행 중인 그 버튼만 "…" */
  function label(account: Account, action: Busy['action'], text: string): string {
    return busy?.id === account.id && busy.action === action ? '…' : text
  }

  return (
    <div className="accounts">
      <div className="usage-account-label">Claude accounts</div>
      {list === null && loadError === null && <p className="usage-note">Loading…</p>}
      {loadError !== null && <p className="usage-note error">Couldn't load accounts: {loadError}</p>}
      {list && list.accounts.length === 0 && <p className="usage-note account-empty">No saved accounts</p>}
      {list && list.accounts.length > 0 && (
        <ul className="account-list">
          {list.accounts.map((account) => {
            const relogin = reloginLabel(account.refreshExpiresAt, now)
            const error = errors[account.id]
            return (
              <li key={account.id} className={account.isActive ? 'account-row is-active' : 'account-row'}>
                <div className="account-line">
                  <span className="account-email" title={accountTitle(account)}>
                    {accountName(account)}
                  </span>
                  {account.plan && <span className="account-plan">{planLabel(account.plan)}</span>}
                </div>
                <div className="account-line">
                  <span className="account-status">
                    {account.isActive && <span className="account-active">Active</span>}
                    {relogin && (
                      <span className={`account-relogin ${relogin.level}`} title={relogin.title}>
                        {relogin.text}
                      </span>
                    )}
                  </span>
                  <span className="account-actions">
                    {account.isActive ? (
                      <button className="danger" onClick={() => void logOut(account)} disabled={busy !== null}>
                        {label(account, 'logout', 'Log out')}
                      </button>
                    ) : (
                      <>
                        <button onClick={() => void switchTo(account)} disabled={busy !== null}>
                          {label(account, 'switch', 'Switch')}
                        </button>
                        <button className="danger" onClick={() => void remove(account)} disabled={busy !== null}>
                          {label(account, 'remove', 'Remove')}
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {error && <div className="account-error">{error}</div>}
              </li>
            )
          })}
        </ul>
      )}
      <button className="account-add" onClick={onAdd} disabled={busy !== null}>
        + Add account
      </button>
    </div>
  )
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'start-failed'; message: string }
  | { kind: 'ready'; url: string; error: string | null }
  | { kind: 'signing-in'; url: string }
  /** 로그인이 끝나 다시 시작해야 한다 (만료·claude 가 코드를 거절함·시간 초과) */
  | { kind: 'ended'; message: string }
  | { kind: 'added'; account: Account }

/** 진행 중인 로그인 취소. 결과는 기다리지 않는다 (이미 끝났거나 만료됐으면 서버가 404) */
function cancelLogin(loginId: string) {
  void fetch(`/api/accounts/login/${encodeURIComponent(loginId)}`, { method: 'DELETE' }).catch(() => {})
}

/**
 * 계정 추가: 열면 로그인을 시작하고(POST /api/accounts/login) → 로그인 페이지 링크 → 받은 코드를 붙여 넣어 [Sign in].
 * 실패하면 로그인이 끝났는지(`isLoginOver`: 404·500·400 의 isLoginEnded)에 따라 서버 문구 + [Start again], 아니면 입력칸에 서버 문구를 두고 다시 넣는다.
 * 새 계정은 전환하지 않는다.
 * 닫으면(×·Esc·바깥 클릭·Cancel) 진행 중인 로그인을 취소한다 — 시작 요청이 아직 안 끝났으면 받은 뒤에 취소한다
 */
export function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [code, setCode] = useState('')
  /** 서버에 살아 있는 로그인. 성공하거나 로그인이 끝나면 null (취소할 것 없음) */
  const loginIdRef = useRef<string | null>(null)
  const isClosedRef = useRef(false)
  /** StrictMode(dev)가 effect 를 두 번 돌려도 로그인은 한 번만 시작한다 (두 번째는 서버가 409) */
  const isStartedRef = useRef(false)

  const start = useCallback(async () => {
    setPhase({ kind: 'starting' })
    setCode('')
    const result = await request<{ loginId: string; url: string }>('/api/accounts/login', 'POST', {})
    if (isClosedRef.current) {
      if (result.ok) cancelLogin(result.data.loginId)
      return
    }
    if (!result.ok) {
      setPhase({ kind: 'start-failed', message: result.message })
      return
    }
    loginIdRef.current = result.data.loginId
    setPhase({ kind: 'ready', url: result.data.url, error: null })
  }, [])

  useEffect(() => {
    if (isStartedRef.current) return
    isStartedRef.current = true
    void start()
  }, [start])

  function close() {
    isClosedRef.current = true
    if (loginIdRef.current) cancelLogin(loginIdRef.current)
    loginIdRef.current = null
    onClose()
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const loginId = loginIdRef.current
    if (phase.kind !== 'ready' || !loginId || !code.trim()) return
    const { url } = phase
    setPhase({ kind: 'signing-in', url })
    const result = await request<{ account: Account }>(`/api/accounts/login/${encodeURIComponent(loginId)}/code`, 'POST', { code: code.trim() })
    if (result.ok) {
      loginIdRef.current = null
      onAdded()
      if (!isClosedRef.current) setPhase({ kind: 'added', account: result.data.account })
      return
    }
    if (isClosedRef.current) return
    if (isLoginOver(result.status, result.data)) {
      loginIdRef.current = null
      setPhase({ kind: 'ended', message: result.status === 404 ? 'Sign-in expired, start again' : result.message })
      return
    }
    setPhase({ kind: 'ready', url, error: result.message })
  }

  return (
    <Modal title="Add Claude account" onClose={close} className="account-modal" hasCloseButton>
      {phase.kind === 'starting' && <p className="account-modal-note">Starting…</p>}
      {phase.kind === 'start-failed' && (
        <div className="create">
          <p className="account-modal-note error">Couldn't start sign-in: {phase.message}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void start()}>
              Try again
            </button>
            <button type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {(phase.kind === 'ready' || phase.kind === 'signing-in') && (
        <form className="create" onSubmit={signIn}>
          <div className="account-step">
            <b>1. Sign in</b>
            <a className="account-signin-link" href={phase.url} target="_blank" rel="noopener noreferrer">
              Open sign-in page ↗
            </a>
            <span className="form-hint">Any browser on any PC works, not only this one.</span>
          </div>
          <div className="account-step">
            <b>2. Paste the code</b>
            <span className="form-hint">After you sign in, the page shows a code. Copy all of it.</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="code#state"
              aria-label="Sign-in code"
              autoComplete="off"
              spellCheck={false}
              disabled={phase.kind === 'signing-in'}
              autoFocus
            />
            {phase.kind === 'ready' && phase.error && <span className="account-modal-note error">{phase.error}</span>}
            {phase.kind === 'signing-in' && <span className="form-hint">This can take up to 30 seconds.</span>}
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={phase.kind === 'signing-in' || !code.trim()}>
              {phase.kind === 'signing-in' ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {phase.kind === 'ended' && (
        <div className="create">
          <p className="account-modal-note error">{phase.message}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void start()}>
              Start again
            </button>
            <button type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {phase.kind === 'added' && (
        <div className="create">
          <p className="account-modal-note">
            Added <b>{accountName(phase.account)}</b>
          </p>
          <span className="form-hint">It isn't active yet. To use it, press Switch in the account list.</span>
          <div className="actions">
            <button type="button" className="primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
