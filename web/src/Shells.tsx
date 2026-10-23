import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { formatSize } from './Files'
import { Modal } from './Modal'
import type { Office, Session, Shell, ShellOutput, Team } from './types'

/** 출력은 마지막 이 줄 수만 받는다 (서버 최대) */
const OUTPUT_LINES = 200

/** 이 폭 이하는 폰 화면. App.tsx 의 NARROW_QUERY·style.css 의 @media 와 같은 값 */
const NARROW_QUERY = '(max-width: 768px)'

/** 출력에 섞인 터미널 제어 문자(색·커서 CSI, 창 제목 OSC). 글자로 보이면 읽기 어려워 지운다 */
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/** 상태 표시줄 창에서 고른 shell. App 이 그 세션 Chat 의 ShellsButton 에 넘기고, ShellsButton 이 한 번 처리한 뒤 onRequestHandled 를 부른다 */
export interface ShellRequest {
  /** 같은 shell 을 다시 골라도 새 요청이 되게 */
  id: number
  /** 그 사이 끝나 목록에서 빠졌어도 모달에 "Ended" 로 보이게 shell 전체를 넘긴다 */
  shell: Shell
}

/** 상태 표시줄 창의 한 줄: 그룹·팀·파트 머리 또는 shell. 왼쪽 목록처럼 그룹 → 팀 → 파트로 묶는다 */
export type ShellLine =
  | { kind: 'group' | 'team' | 'part'; key: string; name: string }
  | { kind: 'shell'; key: string; sessionId: string; shell: Shell; depth: 'lobby' | 'team' | 'part' }

/** 시작부터 지금까지 "45s"·"3m 12s"·"2h 5m"·"1d 3h". 대화 탭 작업 중 표시기(Chat.tsx)도 쓴다 */
export function formatElapsed(startedAt: string, now: number): string {
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

/** 켜져 있는 동안 1초마다 바뀌는 현재 시각. 경과 시간은 모달·창이 열려 있을 때만 보여 그때만 타이머를 돌린다 */
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

/** "Last 200 lines · 12.3 KB" (앞이 잘렸을 때) · "3 lines · 120 B" */
function outputMeta(output: ShellOutput): string {
  const count = output.lines.length
  const lines = `${count} line${count === 1 ? '' : 's'}`
  return `${output.isTruncated ? `Last ${lines}` : lines} · ${formatSize(output.size)}`
}

/** 모달을 처음 열 때 고를 shell. 폰은 Files 처럼 목록부터 보여 주려고 고르지 않는다 */
interface OpenedModal {
  selectedId: string | null
  /** 상태 표시줄에서 고른 shell 이 그 사이 끝나 목록에 없으면 처음부터 "Ended" 로 넣는다 */
  ended: Shell[]
}

/**
 * 대화 오른쪽 아래 버튼 묶음의 동그란 ">_" 버튼 (폴더 버튼 바로 위, "↓" 아래). 그 세션에 실행 중인 shell 이 있을 때만 보이고, 오른쪽 위에 개수.
 * 누르면 작업 파일 탐색기와 같은 모양의 모달. 상태 표시줄 창에서 온 request 는 그 shell 을 고른 채 모달을 연다.
 * shell 이 없어도 마운트해 두어 request 를 처리하고, 열어 둔 모달은 shell 이 다 끝나도 닫지 않는다. 세션이 바뀌면 Chat 이 key 로 새로 만든다
 */
export function ShellsButton({
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
  const [opened, setOpened] = useState<OpenedModal | null>(null)

  useEffect(() => {
    if (!request) return
    onRequestHandled()
    const isRunning = shells.some((shell) => shell.id === request.shell.id)
    setOpened({ selectedId: request.shell.id, ended: isRunning ? [] : [request.shell] })
  }, [request, shells, onRequestHandled])

  function open() {
    setOpened({ selectedId: window.matchMedia(NARROW_QUERY).matches ? null : (shells[0]?.id ?? null), ended: [] })
  }

  const label = `실행 중인 shell ${shells.length}개`
  return (
    <>
      {shells.length > 0 && (
        <button type="button" className="shells-button" onClick={open} title={label} aria-label={label}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M5 7.5 9.5 12 5 16.5M12 17h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="shells-button-count" aria-hidden="true">
            {shells.length}
          </span>
        </button>
      )}
      {opened && <ShellsModal sessionId={sessionId} shells={shells} opened={opened} onClose={() => setOpened(null)} />}
    </>
  )
}

/**
 * 탐색기 모양의 모달 (Files 모달의 틀·스타일을 같이 쓴다): 왼쪽 shell 목록(명령·설명·경과 시간), 오른쪽 고른 shell 의 출력 마지막 200줄.
 * 열어 둔 사이 끝나 목록에서 빠진 shell 은 닫을 때까지 목록 끝에 "Ended" 로 남기고 출력도 볼 수 있다 (서버가 끝난 shell 출력도 준다).
 * 폰은 화면 전체에 목록 → 출력 → ← 로 오간다
 */
function ShellsModal({ sessionId, shells, opened, onClose }: { sessionId: string; shells: Shell[]; opened: OpenedModal; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(opened.selectedId)
  const [ended, setEnded] = useState(opened.ended)
  const previousRef = useRef(shells)
  const now = useSecondTick(true)

  useEffect(() => {
    const gone = previousRef.current.filter((previous) => !shells.some((shell) => shell.id === previous.id))
    previousRef.current = shells
    if (gone.length > 0) setEnded((prev) => [...prev.filter((shell) => !gone.some((item) => item.id === shell.id)), ...gone])
  }, [shells])

  const endedShells = ended.filter((shell) => !shells.some((item) => item.id === shell.id))
  const items = [...shells.map((shell) => ({ shell, isEnded: false })), ...endedShells.map((shell) => ({ shell, isEnded: true }))]
  const selected = items.find((item) => item.shell.id === selectedId) ?? null

  return (
    <Modal title="실행 중인 shell" onClose={onClose} className={`files-modal shells-modal${selected ? ' has-preview' : ''}`}>
      <div className="files-toolbar">
        <span className="shells-summary">
          {shells.length} running{endedShells.length > 0 && ` · ${endedShells.length} ended`}
        </span>
        <button type="button" className="files-icon-button" onClick={onClose} title="닫기 (Esc)" aria-label="닫기">
          ×
        </button>
      </div>
      <div className="files-body">
        <div className="files-list">
          {items.map(({ shell, isEnded }) => (
            <button
              key={shell.id}
              type="button"
              className={['files-item', 'shells-item', shell.id === selectedId ? 'selected' : '', isEnded ? 'ended' : ''].join(' ')}
              onClick={() => setSelectedId(shell.id)}
            >
              <span className="shell-command" title={shell.command}>
                {shell.command}
              </span>
              <span className="shell-time">{isEnded ? 'Ended' : formatElapsed(shell.startedAt, now)}</span>
              {shell.description && (
                <span className="shell-description" title={shell.description}>
                  {shell.description}
                </span>
              )}
            </button>
          ))}
          {items.length === 0 && <p className="hint">No running shells</p>}
        </div>
        <div className="files-preview">
          {selected ? (
            <ShellOutputView
              key={selected.shell.id}
              sessionId={sessionId}
              shell={selected.shell}
              isEnded={selected.isEnded}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <p className="hint">Select a shell to see its output</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

/**
 * 고른 shell 의 출력 마지막 200줄 (고정폭, 긴 줄은 접는다). 열 때·↻·shell 이 끝났을 때 받고(끝난 순간의 마지막 출력을 보이려고),
 * 받을 때마다 맨 아래로 스크롤한다. 다시 받는 동안 앞 출력을 그대로 두고, 고른 것을 바꾸면 받던 요청을 멈춘다
 */
function ShellOutputView({ sessionId, shell, isEnded, onBack }: { sessionId: string; shell: Shell; isEnded: boolean; onBack: () => void }) {
  const [output, setOutput] = useState<ShellOutput | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadCount, setReloadCount] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setErrorMessage(null)
    void fetchOutput(sessionId, shell.id, controller.signal).then((result) => {
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
    // isEnded: 끝난 순간 한 번 더 받는다
  }, [sessionId, shell.id, reloadCount, isEnded])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [output])

  return (
    <>
      <div className="files-preview-head">
        <button type="button" className="files-back" onClick={onBack} title="목록으로" aria-label="목록으로">
          ←
        </button>
        <div className="files-preview-title">
          <b className="shell-command" title={shell.command}>
            {shell.command}
          </b>
          {errorMessage ? (
            <span className="files-item-meta shells-output-error" role="alert">
              {errorMessage}
            </span>
          ) : (
            <span className="files-item-meta">
              {output ? outputMeta(output) : isLoading ? 'Loading…' : null}
              {isEnded && ' · Ended'}
            </span>
          )}
        </div>
        <button
          type="button"
          className="files-icon-button"
          onClick={() => setReloadCount((prev) => prev + 1)}
          disabled={isLoading}
          title="Reload output"
          aria-label="Reload output"
        >
          ↻
        </button>
      </div>
      <div ref={bodyRef} className="files-preview-body shells-output">
        {output &&
          (output.lines.length > 0 ? (
            <pre>{output.lines.map((line) => line.replace(ANSI_PATTERN, '')).join('\n')}</pre>
          ) : (
            <p className="hint">No output yet</p>
          ))}
      </div>
    </>
  )
}

/**
 * 상태 표시줄 창의 줄: 실행 중인 shell 을 왼쪽 목록처럼 그룹 → 팀 → 파트로 묶는다 (세션 이름 없이).
 * 순서는 목록과 같은 hq 배열 순(그룹 → 그 그룹의 팀 → 팀 직속 → 파트), 그룹이 지워진 팀은 그룹 머리 없이 그 뒤, 팀 없는 세션은 맨 끝 "로비".
 * 한 묶음 안의 shell 은 시작 순. 팀을 가리키는데 그 팀이 office 에 없는 세션(목록에도 안 보인다)도 shell 이 숨지 않게 로비에 넣는다
 */
export function shellLines(office: Office, sessions: Session[]): ShellLine[] {
  const running = sessions.filter((session) => (session.shells?.length ?? 0) > 0)
  const shellsOf = (members: Session[], depth: 'lobby' | 'team' | 'part'): ShellLine[] =>
    members
      .flatMap((session) => (session.shells ?? []).map((shell) => ({ sessionId: session.id, shell })))
      .sort((a, b) => a.shell.startedAt.localeCompare(b.shell.startedAt))
      .map(({ sessionId, shell }) => ({ kind: 'shell', key: `${sessionId}:${shell.id}`, sessionId, shell, depth }))
  const teamLines = (team: Team): ShellLine[] => {
    const members = running.filter((session) => session.teamId === team.id)
    if (members.length === 0) return []
    const parts = team.parts.flatMap((part): ShellLine[] => {
      const partShells = shellsOf(
        members.filter((session) => session.partId === part.id),
        'part',
      )
      return partShells.length > 0 ? [{ kind: 'part', key: `part:${part.id}`, name: part.name }, ...partShells] : []
    })
    const direct = members.filter((session) => !team.parts.some((part) => part.id === session.partId))
    return [{ kind: 'team', key: `team:${team.id}`, name: team.name }, ...shellsOf(direct, 'team'), ...parts]
  }

  const groupLines = office.groups.flatMap((group): ShellLine[] => {
    const lines = office.teams.filter((team) => team.groupId === group.id).flatMap(teamLines)
    return lines.length > 0 ? [{ kind: 'group', key: `group:${group.id}`, name: group.name }, ...lines] : []
  })
  const orphanLines = office.teams.filter((team) => !office.groups.some((group) => group.id === team.groupId)).flatMap(teamLines)
  const lobbyShells = shellsOf(
    running.filter((session) => !office.teams.some((team) => team.id === session.teamId)),
    'lobby',
  )
  const lobbyLines: ShellLine[] = lobbyShells.length > 0 ? [{ kind: 'group', key: 'lobby', name: '로비' }, ...lobbyShells] : []
  return [...groupLines, ...orphanLines, ...lobbyLines]
}

/**
 * 상태 표시줄의 "Shells N" (N = 모든 세션의 실행 중인 shell 합. 0 이면 흐리고 누를 수 없다).
 * 누르면 바로 위에 그룹 → 팀 → 파트로 묶은 shell 목록(명령·경과 시간)이 뜨고, 줄을 누르면 onOpen 으로 그 세션 대화의 shell 모달을 그 shell 을 고른 채 연다.
 * 다시 누름·바깥 클릭·Esc 로 닫힌다 (UsagePanel 과 같은 방식)
 */
export function ShellsStatus({ lines, onOpen }: { lines: ShellLine[]; onOpen: (sessionId: string, shell: Shell) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const count = lines.filter((line) => line.kind === 'shell').length
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
          {lines.map((line) =>
            line.kind === 'shell' ? (
              <button
                key={line.key}
                className={`shells-popover-row ${line.depth}`}
                title={line.shell.command}
                onClick={() => {
                  setIsOpen(false)
                  onOpen(line.sessionId, line.shell)
                }}
              >
                <span className="shell-command">{line.shell.command}</span>
                <span className="shell-time">{formatElapsed(line.shell.startedAt, now)}</span>
              </button>
            ) : (
              <div key={line.key} className={`shells-popover-${line.kind}`} title={line.name}>
                {line.name}
              </div>
            ),
          )}
        </div>
      )}
    </span>
  )
}
