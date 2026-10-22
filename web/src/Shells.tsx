import { useEffect, useRef, useState, type RefObject } from 'react'
import { formatSize } from './Files'
import type { Shell, ShellOutput } from './types'

/** 출력은 마지막 이 줄 수만 받는다 */
const OUTPUT_LINES = 20

/** 출력에 섞인 터미널 제어 문자(색·커서 CSI, 창 제목 OSC). 글자로 보이면 읽기 어려워 지운다 */
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/** 상태 표시줄 창에서 고른 shell. App 이 그 세션 패널의 ShellsBar 에 넘기고, ShellsBar 가 한 번 처리한 뒤 onRequestHandled 를 부른다 */
export interface ShellRequest {
  /** 같은 shell 을 다시 골라도 새 요청이 되게 */
  id: number
  shellId: string
}

/** 상태 표시줄 창의 세션 하나: 이름과 그 세션의 실행 중인 shell */
export interface SessionShells {
  sessionId: string
  name: string
  shells: Shell[]
}

/** 시작부터 지금까지 "45s"·"3m 12s"·"2h 5m"·"1d 3h" */
function formatElapsed(startedAt: string, now: number): string {
  const started = Date.parse(startedAt)
  if (Number.isNaN(started)) return '-'
  const seconds = Math.floor(Math.max(0, now - started) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** 켜져 있는 동안 1초마다 바뀌는 현재 시각. 경과 시간은 목록·창이 열려 있을 때만 보여 그때만 타이머를 돌린다 */
function useSecondTick(isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isActive) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isActive])
  return now
}

/** 열려 있으면 바깥 클릭·Esc 로 닫는다 (UsagePanel 과 같은 방식). Esc 때 포커스가 안쪽이었으면 여는 버튼으로 돌린다 */
function useDismiss(
  isOpen: boolean,
  rootRef: RefObject<HTMLElement | null>,
  toggleRef: RefObject<HTMLButtonElement | null>,
  setIsOpen: (isOpen: boolean) => void,
) {
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
  }, [isOpen, rootRef, toggleRef, setIsOpen])
}

async function fetchOutput(sessionId: string, shellId: string, signal: AbortSignal): Promise<{ output: ShellOutput } | { errorMessage: string } | null> {
  try {
    const response = await fetch(`/api/sessions/${sessionId}/shells/${encodeURIComponent(shellId)}/output?lines=${OUTPUT_LINES}`, {
      signal,
      cache: 'no-store',
    })
    if (response.ok) return { output: (await response.json()) as ShellOutput }
    const { message } = (await response.json().catch(() => ({}))) as { message?: string }
    return { errorMessage: message ?? `HTTP ${response.status}` }
  } catch {
    return signal.aborted ? null : { errorMessage: 'Network error' }
  }
}

/** "Last 20 lines · 12.3 KB" (앞이 잘렸을 때) · "3 lines · 120 B" */
function outputMeta(output: ShellOutput): string {
  const count = output.lines.length
  const lines = `${count} line${count === 1 ? '' : 's'}`
  return `${output.isTruncated ? `Last ${lines}` : lines} · ${formatSize(output.size)}`
}

/** 펼친 shell 의 출력 끝부분. 펼칠 때 받고 ↻ 로 다시 받는다 (다시 받는 동안 앞 출력을 그대로 둔다). 접으면 받던 요청을 멈춘다 */
function ShellOutputView({ sessionId, shellId }: { sessionId: string; shellId: string }) {
  const [output, setOutput] = useState<ShellOutput | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setErrorMessage(null)
    void fetchOutput(sessionId, shellId, controller.signal).then((result) => {
      if (!result) return
      setIsLoading(false)
      if ('output' in result) {
        setOutput(result.output)
      } else {
        setOutput(null)
        setErrorMessage(result.errorMessage)
      }
    })
    return () => controller.abort()
  }, [sessionId, shellId, reloadCount])

  return (
    <div className="shell-output">
      <div className="shell-output-head">
        {errorMessage ? (
          <span className="shell-output-error" role="alert">
            {errorMessage}
          </span>
        ) : (
          <span>{output ? outputMeta(output) : isLoading ? 'Loading…' : null}</span>
        )}
        <button onClick={() => setReloadCount((prev) => prev + 1)} disabled={isLoading} title="Reload output" aria-label="Reload output">
          ↻
        </button>
      </div>
      {output && (output.lines.length > 0 ? <pre>{output.lines.map((line) => line.replace(ANSI_PATTERN, '')).join('\n')}</pre> : <p className="shell-output-empty">No output yet</p>)}
    </div>
  )
}

/**
 * 패널 헤더 아래 "Shells 2 ▾" 줄 (세션에 실행 중인 shell 이 있을 때만). 누르면 그 아래로 목록이 대화 위에 떠서 펼쳐진다 — 대화 칸 크기를 바꾸지 않으려고.
 * 줄마다 명령(말줄임, 전체는 툴팁)·경과 시간·설명이고, 누르면 그 아래에 출력 끝부분 (한 번에 하나). 다시 누름·바깥 클릭·Esc 로 닫는다.
 * shell 이 없어도 마운트해 두어 상태 표시줄 창에서 온 request 를 처리한다 (그 사이 끝났으면 목록만 열거나 아무것도 안 한다)
 */
export function ShellsBar({
  sessionId,
  shells,
  request,
  onRequestHandled,
}: {
  sessionId: string
  shells: Shell[]
  request: ShellRequest | null
  onRequestHandled: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const isShown = isOpen && shells.length > 0
  const now = useSecondTick(isShown)
  useDismiss(isShown, rootRef, toggleRef, setIsOpen)

  useEffect(() => {
    if (!request) return
    onRequestHandled()
    if (shells.length === 0) return
    setIsOpen(true)
    setExpandedId(shells.some((shell) => shell.id === request.shellId) ? request.shellId : null)
  }, [request, shells, onRequestHandled])

  // 상태 표시줄 창에서 고른 shell 이 목록 아래쪽이면 보이게 스크롤한다
  useEffect(() => {
    if (!isShown || !expandedId) return
    listRef.current?.querySelector(`[data-shell-id="${CSS.escape(expandedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [isShown, expandedId, request])

  if (shells.length === 0) return null
  return (
    <div className="shells" ref={rootRef}>
      <button
        ref={toggleRef}
        className="shells-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isShown}
        aria-controls="shells-list"
        title="Running background shells"
      >
        Shells <b>{shells.length}</b> {isShown ? '▴' : '▾'}
      </button>
      {isShown && (
        <div id="shells-list" className="shells-list" ref={listRef}>
          {shells.map((shell) => {
            const isExpanded = shell.id === expandedId
            return (
              <div key={shell.id} className="shell" data-shell-id={shell.id}>
                <button className="shell-row" onClick={() => setExpandedId(isExpanded ? null : shell.id)} aria-expanded={isExpanded}>
                  <span className="shell-command" title={shell.command}>
                    {shell.command}
                  </span>
                  <span className="shell-time">{formatElapsed(shell.startedAt, now)}</span>
                  {shell.description && (
                    <span className="shell-description" title={shell.description}>
                      {shell.description}
                    </span>
                  )}
                </button>
                {isExpanded && <ShellOutputView sessionId={sessionId} shellId={shell.id} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 상태 표시줄의 "Shells N" (N = 모든 세션의 실행 중인 shell 합. 0 이면 흐리고 누를 수 없다).
 * 누르면 바로 위에 세션 이름별로 묶은 shell 목록(명령·경과 시간)이 뜨고, 줄을 누르면 onOpen 으로 그 세션 패널의 그 shell 출력을 연다.
 * 다시 누름·바깥 클릭·Esc 로 닫힌다 (UsagePanel 과 같은 방식)
 */
export function ShellsStatus({ groups, onOpen }: { groups: SessionShells[]; onOpen: (sessionId: string, shellId: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const count = groups.reduce((sum, group) => sum + group.shells.length, 0)
  const isShown = isOpen && count > 0
  const now = useSecondTick(isShown)
  useDismiss(isShown, rootRef, toggleRef, setIsOpen)

  // 열어 둔 사이 모두 끝나면 닫는다 (다시 생겼을 때 저절로 열리지 않게)
  useEffect(() => {
    if (count === 0) setIsOpen(false)
  }, [count])

  return (
    <span className="shells-status" ref={rootRef}>
      <button
        ref={toggleRef}
        className="shells-status-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={count === 0}
        aria-expanded={isShown}
        aria-controls="shells-popover"
        title={count === 0 ? 'No running shells' : 'Running background shells'}
      >
        Shells <b>{count}</b>
      </button>
      {isShown && (
        <div id="shells-popover" className="shells-popover" role="dialog" aria-label="Running shells">
          <div className="shells-popover-head">Running shells</div>
          {groups.map((group) => (
            <div key={group.sessionId} className="shells-group">
              <div className="shells-group-name" title={group.name}>
                {group.name}
              </div>
              {group.shells.map((shell) => (
                <button
                  key={shell.id}
                  className="shells-popover-row"
                  title={shell.command}
                  onClick={() => {
                    setIsOpen(false)
                    onOpen(group.sessionId, shell.id)
                  }}
                >
                  <span className="shell-command">{shell.command}</span>
                  <span className="shell-time">{formatElapsed(shell.startedAt, now)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
