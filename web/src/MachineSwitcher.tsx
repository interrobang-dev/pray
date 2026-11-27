import { useCallback, useEffect, useRef, useState } from 'react'
import { machineRows, parseMachines, selfMachine, shortcutIndexOf, shortcutLabel, shortcutMachines, type Machine, type MachinesResponse } from './machines'
import { useDismiss } from './Shells'
import { alertDialog } from './Dialog'
import { resumeUrlOf } from './sessionLink'

/**
 * GET /api/machines 를 받아 둔다 (처음 뜰 때 한 번, 그 뒤는 refresh 를 부를 때 — PC 메뉴·커맨드 팔레트를 열 때).
 * 404(옛 서버)·JSON 이 아님·꼴이 틀림이면 null(칩을 숨긴다). 네트워크 오류는 앞 값을 그대로 둔다 (열어 둔 메뉴가 잠깐 끊김에 사라지지 않게)
 */
export function useMachines(): { machines: MachinesResponse | null; refresh: () => void } {
  const [machines, setMachines] = useState<MachinesResponse | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current
    void (async () => {
      try {
        const response = await fetch('/api/machines', { cache: 'no-store' })
        const parsed = response.ok ? parseMachines(await response.json().catch(() => null)) : null
        if (requestId === requestIdRef.current) setMachines(parsed)
      } catch {
        // 네트워크 오류: 앞 값 그대로
      }
    })()
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { machines, refresh }
}

/** 옮겨 가는 동안 덮개를 두는 최대 시간. 넘으면 덮개를 지우고 알린다 (덮개만 남아 멈춘 화면이 되지 않게) */
const SWITCH_TIMEOUT_MS = 15_000

let switchingCover: { element: HTMLElement; timer: number } | null = null

function removeSwitchingCover() {
  if (!switchingCover) return
  window.clearTimeout(switchingCover.timer)
  switchingCover.element.remove()
  switchingCover = null
}

// 뒤로 가기로 돌아오면 브라우저가 이 페이지를 덮개째 되살릴 수 있다 (bfcache)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) removeSwitchingCover()
})

/**
 * 다른 PC 의 Pray 로 옮겨 간다. 트레이 창에서도 같은 창이 그 주소로 간다 (트레이 쪽 허용은 desktop 이 한다).
 * 상대가 응답할 때까지 화면 전체 덮개 "Switching to home…" 를 둔다 — 메뉴·Shift+F·커맨드 팔레트가 모두 여기를 거쳐서
 * React 밖에서 body 에 직접 붙인다. 새 페이지가 뜨면 함께 사라진다. 주소에 `#resume` 을 붙여 그 PC 에서 마지막에 연 세션을 되살리게 한다 (App.tsx)
 */
export function openMachine(machine: Machine) {
  if (!machine.url) return
  removeSwitchingCover()
  const element = document.createElement('div')
  element.className = 'switching-overlay'
  element.setAttribute('role', 'status')
  const card = document.createElement('div')
  card.className = 'switching-card'
  const spinner = document.createElement('span')
  spinner.className = 'reconnect-spinner'
  spinner.setAttribute('aria-hidden', 'true')
  const text = document.createElement('span')
  text.className = 'switching-text'
  const title = document.createElement('b')
  title.textContent = `Switching to ${machine.name}…`
  const address = document.createElement('span')
  address.className = 'switching-address'
  address.textContent = new URL(machine.url).host
  text.append(title, address)
  card.append(spinner, text)
  element.append(card)
  document.body.append(element)
  const timer = window.setTimeout(() => {
    removeSwitchingCover()
    void alertDialog(`Couldn't reach ${machine.name}. Check that Pray is running there.`)
  }, SWITCH_TIMEOUT_MS)
  switchingCover = { element, timer }
  window.location.assign(resumeUrlOf(machine.url))
}

/**
 * 상태 표시줄 맨 왼쪽의 지금 PC 칩 "office" + PC 목록 메뉴 (상태 표시줄 바로 위에 뜬다).
 * Tailscale 이 ready 가 아니거나 API 가 없으면 아무것도 그리지 않는다. 메뉴를 열 때 목록을 다시 받는다.
 * 줄: 온라인 점 · 이름 · hostName · 단축키, 지금 PC 는 ✓, 옮겨 갈 수 없는 PC 는 흐리게 + 이유 (machines.ts). 바깥 클릭·Esc 로 닫는다 (Esc 는 칩으로 포커스를 돌린다).
 * Shift+F1·F2… 는 그 번호의 PC 로 바로 옮겨 간다 (shortcutMachines. 지금 PC 번호는 아무 일 없음)
 */
export function MachineSwitcher({ machines, onRefresh }: { machines: MachinesResponse | null; onRefresh: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  // 상태 표시줄이 overflow: hidden 이라 메뉴는 fixed. 칩 왼쪽 끝에 맞춘다 (폰은 CSS 가 화면 폭으로)
  const [anchorLeft, setAnchorLeft] = useState(6)
  const rootRef = useRef<HTMLSpanElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const self = selfMachine(machines)
  const isShown = isOpen && self !== null
  useDismiss(isShown, rootRef, toggleRef, setIsOpen)

  // 창 전체 캡처 단계에서 받아 터미널 탭(xterm)에서도 된다. 번호가 있는 키만 가로챈다. 앱 안 대화 창이 떠 있으면 건드리지 않는다
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const index = shortcutIndexOf(event)
      if (index === null || document.querySelector('.dialog-overlay')) return
      const target = shortcutMachines(machines)[index]
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      if (!target.isSelf) openMachine(target)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [machines])

  if (!self) return null
  const rows = machineRows(machines)
  const selfShortcut = shortcutLabel(machines, self)

  function toggle() {
    if (isOpen) {
      setIsOpen(false)
      return
    }
    const rect = toggleRef.current?.getBoundingClientRect()
    if (rect) setAnchorLeft(Math.max(6, Math.round(rect.left)))
    onRefresh()
    setIsOpen(true)
  }

  return (
    <span className="machine-switcher" ref={rootRef}>
      <button
        ref={toggleRef}
        className="machine-chip"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isShown}
        aria-controls="machine-menu"
        title={selfShortcut ? `This PC · ${self.hostName} · ${selfShortcut}` : `This PC · ${self.hostName}`}
      >
        <span className="machine-chip-name">{self.name}</span>
      </button>
      {isShown && (
        <div id="machine-menu" className="machine-menu" role="menu" aria-label="Switch PC" style={{ left: anchorLeft }}>
          <div className="machine-menu-head">Switch PC</div>
          {rows.map((row) => {
            const { machine } = row
            const shortcut = shortcutLabel(machines, machine)
            const content = (
              <>
                <span className={machine.isOnline ? 'dot on' : 'dot'} aria-hidden="true" />
                <span className="machine-row-text">
                  <span className="machine-row-name">{machine.name}</span>
                  <span className="machine-row-host">{machine.hostName}</span>
                </span>
                {shortcut && <kbd className="machine-row-key">{shortcut}</kbd>}
                {row.isCurrent ? (
                  <span className="machine-row-check" aria-label="Current PC">
                    ✓
                  </span>
                ) : (
                  row.disabledReason && <span className="machine-row-reason">{row.disabledReason}</span>
                )}
              </>
            )
            if (row.isCurrent) {
              return (
                <div key={machine.name} className="machine-row current" role="menuitem" aria-disabled="true" aria-current="true" title={`This PC · ${machine.hostName}`}>
                  {content}
                </div>
              )
            }
            return (
              <button
                key={machine.name}
                className="machine-row"
                role="menuitem"
                disabled={row.disabledReason !== null}
                title={row.disabledReason ?? `Open Pray on ${machine.name}`}
                onClick={() => {
                  setIsOpen(false)
                  openMachine(machine)
                }}
              >
                {content}
              </button>
            )
          })}
          {rows.length === 1 && <div className="machine-menu-empty">No other PCs on Tailscale</div>}
        </div>
      )}
    </span>
  )
}
