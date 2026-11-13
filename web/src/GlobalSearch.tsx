import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { firstSelectable, isSelectable, moveSelection, searchGroups, type SearchItem } from './globalSearchItems'
import { lastActivityOf } from './home'
import { PositionChip } from './PositionChip'
import { formatDue } from './reminders'
import { nameOf, positionOf } from './sessionPosition'
import { PriorityChip } from './TeamTodosModal'
import { priorityOf } from './teamTodos'
import { attendanceOf, formatAgo, formatDateTime, type Office, type Session } from './types'

interface Props {
  sessions: Session[]
  office: Office
  now: number
  isHostReachable: boolean
  isNarrow: boolean
  isOfficeHidden: boolean
  /** 목록 세션 줄과 같은 아바타(머리 그림·상태 테두리) */
  renderAvatar: (session: Session) => ReactNode
  /** 목록 아바타 툴팁·첫 화면과 같은 상태 글자 ("Working"·"Break"·"Off duty"…) */
  stateLabelOf: (session: Session) => string
  onClose: () => void
  /** 고른 줄을 연다. 창은 이미 닫힌다 (onClose 다음에 부른다) */
  onPick: (item: SearchItem) => void
}

const LIST_ID = 'global-search-list'

/**
 * Ctrl+K 글로벌 검색 창 (명령 팔레트): 화면 가운데 위 입력칸 + 묶음별 결과 (규칙 globalSearchItems.ts).
 * ↑↓(끝에서 돈다)·마우스 올리기로 고르고 Enter·클릭으로 연 뒤 닫는다. Esc·바깥 클릭으로 닫는다 (Esc 는 window 캡처에서 전파를 멈춘다).
 * 닫으면 열 때 포커스 요소로 돌린다 — 고른 줄을 열기 전에 돌려, 그 동작이 여는 창(TODO·Reminders 등)의 입력칸 포커스를 빼앗지 않는다
 */
export function GlobalSearch({ sessions, office, now, isHostReachable, isNarrow, isOfficeHidden, renderAvatar, stateLabelOf, onClose, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const previousFocusRef = useRef<Element | null>(document.activeElement)
  const isFinishedRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const groups = useMemo(
    () => searchGroups({ sessions, office, now, isHostReachable, isNarrow, isOfficeHidden }, query),
    [sessions, office, now, isHostReachable, isNarrow, isOfficeHidden, query],
  )
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups])
  // 세션 목록 SSE 로 줄이 바뀌어도 고른 줄은 키로 남는다. 없어지면 첫 줄
  const keptIndex = selectedKey === null ? -1 : items.findIndex((item) => item.key === selectedKey && isSelectable(item))
  const selectedIndex = keptIndex >= 0 ? keptIndex : firstSelectable(items)
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null
  const teamNames = new Map(office.teams.map((team) => [team.id, team.name]))

  function restoreFocus() {
    const previous = previousFocusRef.current
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
  }

  function finish(item?: SearchItem) {
    if (isFinishedRef.current) return
    isFinishedRef.current = true
    restoreFocus()
    onClose()
    if (item) onPick(item)
  }

  // 열 때 입력칸에 포커스, Ctrl+K 로 App 이 닫으면 포커스를 돌린다.
  // autoFocus 가 아니라 effect 인 것은 StrictMode 의 두 번 마운트에서 cleanup 이 돌린 포커스를 다시 가져오려고
  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (!isFinishedRef.current) restoreFocus()
    }
  }, [])

  // Esc: 밑의 메뉴·사용량 창·대화 중지 같은 다른 Esc 리스너가 반응하지 않게 캡처에서 멈춘다
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      event.stopPropagation()
      finishRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // 고른 줄이 목록 안에 보이게 목록만 스크롤한다 (scrollIntoView 는 조상까지 움직일 수 있다)
  useLayoutEffect(() => {
    const list = listRef.current
    const row = selected ? list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected.key)}"]`) : null
    if (!list || !row) return
    const listRect = list.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    // 묶음 첫 줄이면 묶음 머리까지 보이게
    const head = row.previousElementSibling?.classList.contains('search-group-title') ? (row.previousElementSibling as HTMLElement) : null
    const top = head ? head.getBoundingClientRect().top : rowRect.top
    if (top < listRect.top) list.scrollTop -= listRect.top - top
    else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom
  }, [selected])

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter·↑↓ 는 조합 확정 키라 무시한다
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = moveSelection(items, selectedIndex, event.key === 'ArrowDown' ? 1 : -1)
      if (next >= 0) setSelectedKey(items[next].key)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (selected) finish(selected)
    }
  }

  function renderRow(item: SearchItem): ReactNode {
    switch (item.kind) {
      case 'session': {
        const { session } = item
        const at = lastActivityOf(session)
        const iso = at === null ? null : new Date(at).toISOString()
        const place = (session.teamId ? teamNames.get(session.teamId) : undefined) ?? 'Focus Zone'
        return (
          <>
            {renderAvatar(session)}
            <span className="search-row-name">
              <PositionChip position={positionOf(session)} />
              {nameOf(session)}
            </span>
            <span className="search-row-meta">
              {place} · {stateLabelOf(session)}
            </span>
            <span className="search-row-end" title={iso ? formatDateTime(iso) : undefined}>
              {iso ? formatAgo(iso, now) : ''}
            </span>
          </>
        )
      }
      case 'team':
        return (
          <>
            <span className="search-row-name">{item.team.name}</span>
            <span className="search-row-meta">{item.team.cwd}</span>
            <span className="search-row-end">{item.presentCount} on duty</span>
          </>
        )
      case 'group':
        return (
          <>
            <span className="search-row-name">{item.group.name}</span>
            <span className="search-row-meta" />
            <span className="search-row-end">
              {item.teamCount} {item.teamCount === 1 ? 'team' : 'teams'}
            </span>
          </>
        )
      case 'todo':
        return (
          <>
            <PriorityChip priority={priorityOf(item.todo)} />
            <span className="search-row-text" title={item.todo.text}>
              {item.todo.text}
            </span>
            <span className="search-row-end">{item.placeName}</span>
          </>
        )
      case 'reminder':
        return (
          <>
            <span className="search-row-text" title={item.reminder.text}>
              {item.reminder.text}
            </span>
            <span className="search-row-end">{formatDue(item.reminder.at, now)}</span>
          </>
        )
      case 'command':
        return <span className="search-row-text">{item.label}</span>
    }
  }

  return (
    <div
      className="modal-overlay search-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finish()
      }}
    >
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-input-row">
          <svg className="search-input-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="6.8" cy="6.8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
            <path d="M10 10l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
          <input
            className="search-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedKey(null)
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search sessions, teams, TODOs, commands"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-activedescendant={selected ? `search-option-${selectedIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
            ref={inputRef}
          />
        </div>
        <div className="search-list" id={LIST_ID} role="listbox" aria-label="Results" ref={listRef}>
          {items.length === 0 && <p className="search-empty">No results</p>}
          {groups.map((group) => (
            <div key={group.key} className="search-group" role="group" aria-label={group.title}>
              <div className="search-group-title" aria-hidden="true">
                {group.title}
              </div>
              {group.items.map((item) => {
                const index = items.indexOf(item)
                const isDisabled = !isSelectable(item)
                const isDead = item.kind === 'session' && attendanceOf(item.session) === 'off'
                const isMuted = item.kind === 'reminder' && item.isFired
                return (
                  <div
                    key={item.key}
                    id={`search-option-${index}`}
                    data-key={item.key}
                    role="option"
                    aria-selected={index === selectedIndex}
                    aria-disabled={isDisabled || undefined}
                    title={item.kind === 'command' ? (item.disabledReason ?? undefined) : undefined}
                    className={['search-row', `search-${item.kind}`, isDead ? 'dead' : '', isMuted ? 'muted' : '', isDisabled ? 'disabled' : ''].join(' ')}
                    // 입력칸 포커스를 지킨다 (↑↓·Enter 를 계속 쓰게)
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (!isDisabled && index !== selectedIndex) setSelectedKey(item.key)
                    }}
                    onClick={() => {
                      if (!isDisabled) finish(item)
                    }}
                  >
                    {renderRow(item)}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
