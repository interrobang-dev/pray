import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import {
  addDays,
  calendarCells,
  compareDates,
  dateLabel,
  dateOf,
  formatTime,
  isPastTime,
  isSameDate,
  monthTitle,
  parseTimeText,
  shiftMonth,
  slotOf,
  timeSlots,
  WEEKDAY_LABELS,
  type LocalDate,
} from './dateTimePick'
import { priorityMenuPlacement } from './teamTodos'

/** 터치 기기는 시각 칸을 눌러도 목록을 열지 않는다 (가상 키보드와 목록이 같이 떠서. ▾ 로 연다) — TeamTodosModal 과 같은 기준 */
const TOUCH_QUERY = '(hover: none)'
const SLOTS = timeSlots()

function CalendarIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
      <path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3l2 1.25" />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'down' | 'left' | 'right' }) {
  const path = direction === 'down' ? 'M4.5 6.5 8 10l3.5-3.5' : direction === 'left' ? 'M9.5 4.5 6 8l3.5 3.5' : 'M6.5 4.5 10 8l-3.5 3.5'
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d={path} />
    </svg>
  )
}

/**
 * 떠 있는 팝오버 공통: 열리면 anchor 아래(자리가 없으면 위)에 fixed 로 놓고 보이게 한다 (모달 안에서 잘리지 않게).
 * 바깥 누르기·Esc·창 크기 바꾸기·바깥 스크롤로 닫는다. Esc 는 캡처에서 멈춰 Modal 의 Esc(창 닫기)까지 가지 않게 한다 (우선순위 메뉴와 같다)
 */
function usePopover(isOpen: boolean, anchorRef: RefObject<HTMLElement | null>, popoverRef: RefObject<HTMLElement | null>, close: (isFocusBack: boolean) => void) {
  const closeRef = useRef(close)
  closeRef.current = close

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const popover = popoverRef.current
    if (!isOpen || !anchor || !popover) return
    const { left, top } = priorityMenuPlacement(
      anchor.getBoundingClientRect(),
      { width: popover.offsetWidth, height: popover.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    popover.style.left = `${left}px`
    popover.style.top = `${top}px`
    popover.style.visibility = 'visible'
  }, [isOpen, anchorRef, popoverRef])

  useEffect(() => {
    if (!isOpen) return
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && (popoverRef.current?.contains(target) === true || anchorRef.current?.contains(target) === true)
    // Modal 이 mousedown 을 멈추므로 캡처로 본다
    const onDown = (event: PointerEvent) => {
      if (!isInside(event.target)) closeRef.current(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeRef.current(true)
    }
    // 시각 목록 자체의 스크롤은 빼고, 창·목록이 움직이면 anchor 와 어긋나므로 닫는다
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && popoverRef.current?.contains(event.target))) closeRef.current(false)
    }
    const onResize = () => closeRef.current(false)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [isOpen, anchorRef, popoverRef])
}

function dateKey(date: LocalDate): string {
  return `${date.year}-${date.month}-${date.day}`
}

/**
 * 날짜 버튼 + 달력 팝오버. 글자 "Today"·"Tomorrow"·"Fri, Nov 14".
 * 달력: 머리 "November 2026" + ‹ ›(지난 달로는 못 간다), 요일 줄, 6주 칸. 지난 날은 흐리고 못 누른다, 오늘은 강조색 글자, 고른 날은 강조 면.
 * 키보드: 화살표로 날 이동(달을 넘으면 그 달로, 오늘보다 앞으로는 안 간다), Enter·Space 고르기, Esc 닫기, Tab 은 닫는다
 */
export function DateField({ date, now, onChange }: { date: LocalDate; now: number; onChange: (date: LocalDate) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [cursor, setCursor] = useState(date)
  const [view, setView] = useState({ year: date.year, month: date.month })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const today = dateOf(now)

  usePopover(isOpen, buttonRef, popoverRef, (isFocusBack) => {
    setIsOpen(false)
    if (isFocusBack) buttonRef.current?.focus()
  })

  // 커서 날로 포커스 (열 때·화살표로 옮길 때·달을 넘길 때)
  useEffect(() => {
    if (!isOpen) return
    popoverRef.current?.querySelector<HTMLButtonElement>(`[data-date="${dateKey(cursor)}"]`)?.focus()
  }, [isOpen, cursor])

  function open() {
    const start = compareDates(date, today) < 0 ? today : date
    setCursor(start)
    setView({ year: start.year, month: start.month })
    setIsOpen(true)
  }

  function pick(next: LocalDate) {
    setIsOpen(false)
    buttonRef.current?.focus()
    onChange(next)
  }

  function moveCursor(days: number) {
    const next = addDays(cursor, days)
    const clamped = compareDates(next, today) < 0 ? today : next
    setCursor(clamped)
    setView({ year: clamped.year, month: clamped.month })
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    const step = steps[event.key]
    if (step === undefined) return
    event.preventDefault()
    moveCursor(step)
  }

  function onPopoverKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') setIsOpen(false)
  }

  /** ‹ › 달 옮기기: 커서도 그 달의 같은 날(없으면 끝 날, 오늘보다 앞이면 오늘)로 옮긴다 */
  function showMonth(delta: number) {
    const next = shiftMonth(view.year, view.month, delta)
    const lastDay = new Date(next.year, next.month, 0).getDate()
    const candidate = { year: next.year, month: next.month, day: Math.min(cursor.day, lastDay) }
    const clamped = compareDates(candidate, today) < 0 ? today : candidate
    setView(next)
    setCursor(clamped)
  }

  const cells = calendarCells(view.year, view.month, today)
  const isCurrentMonth = view.year === today.year && view.month === today.month
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="dtp-field dtp-date"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Reminder date: ${dateLabel(date, now)}`}
      >
        <CalendarIcon />
        <span className="dtp-field-text">{dateLabel(date, now)}</span>
        <ChevronIcon direction="down" />
      </button>
      {isOpen && (
        <div ref={popoverRef} className="dtp-popover dtp-calendar" role="dialog" aria-label="Choose date" onKeyDown={onPopoverKeyDown}>
          <div className="dtp-calendar-head">
            <button type="button" className="dtp-month-nav" onClick={() => showMonth(-1)} disabled={isCurrentMonth} title="Previous month" aria-label="Previous month">
              <ChevronIcon direction="left" />
            </button>
            <span className="dtp-month-title" aria-live="polite">
              {monthTitle(view.year, view.month)}
            </span>
            <button type="button" className="dtp-month-nav" onClick={() => showMonth(1)} title="Next month" aria-label="Next month">
              <ChevronIcon direction="right" />
            </button>
          </div>
          <div className="dtp-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="dtp-days" onKeyDown={onGridKeyDown}>
            {cells.map((cell) => {
              const isSelected = isSameDate(cell.date, date)
              const isCursor = isSameDate(cell.date, cursor)
              const className = ['dtp-day', cell.isInMonth ? '' : 'is-outside', cell.isToday ? 'is-today' : '', isSelected ? 'is-selected' : '']
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={dateKey(cell.date)}
                  type="button"
                  className={className}
                  data-date={dateKey(cell.date)}
                  disabled={cell.isPast}
                  tabIndex={isCursor ? 0 : -1}
                  aria-pressed={isSelected}
                  aria-label={new Date(cell.date.year, cell.date.month - 1, cell.date.day).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  onClick={() => pick(cell.date)}
                >
                  {cell.date.day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

interface TimeFieldProps {
  /** 칸의 글자 (부모가 갖는다 — Add 켜기·확인 줄이 이 글자를 읽어 판단한다) */
  text: string
  /** 고른 날짜 (오늘이면 목록의 지난 칸을 흐린다) */
  date: LocalDate
  now: number
  inputRef: RefObject<HTMLInputElement | null>
  onTextChange: (text: string) => void
  /** 칸에서 Enter (글자를 해석한 뒤 부른다. 값을 읽었을 때만) */
  onEnter: (minutes: number) => void
}

/**
 * 시각 칸: [🕒 글 칸 ▾]. 직접 치거나("1530"·"15:30"·"9"·"9:5", 포커스가 빠지거나 Enter 에 "15:30" 으로 고친다. 못 읽으면 빨간 테두리)
 * 목록에서 고른다. 목록은 ▾·시계 아이콘을 누르거나 칸에서 ↓, 마우스로 칸을 누를 때 열린다 (터치 기기는 칸을 누르면 치기만).
 * 목록 = 15분 칸 00:00~23:45, 연 순간 친 값(못 읽으면 지금 시각 — 오늘이 아니면 09:00) 칸으로 스크롤, 오늘이면 지난 칸은 흐리고 못 누른다.
 * ▾·↓ 로 열면 포커스가 목록으로 가고(↑↓ 이동·Enter 고르기), 칸을 눌러 열면 포커스는 칸에 남아 계속 칠 수 있다 (치는 동안 그 값 칸으로 스크롤)
 */
export function TimeField({ text, date, now, inputRef, onTextChange, onEnter }: TimeFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isInvalid, setIsInvalid] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  /** 열 때 목록으로 포커스를 옮길지 (▾·↓ 로 열었을 때) */
  const isFocusListRef = useRef(false)
  const parsed = parseTimeText(text)
  const today = dateOf(now)
  const isToday = isSameDate(date, today)
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const anchorSlot = slotOf(parsed ?? (isToday ? nowMinutes : 9 * 60))

  usePopover(isOpen, boxRef, popoverRef, (isFocusBack) => {
    setIsOpen(false)
    if (isFocusBack) inputRef.current?.focus()
  })

  // 연 순간·치는 동안 기준 칸을 목록 가운데로. ▾·↓ 로 열었으면 그 칸(지났으면 다음 고를 수 있는 칸)에 포커스
  useLayoutEffect(() => {
    const list = popoverRef.current
    if (!isOpen || !list) return
    const item = list.querySelector<HTMLButtonElement>(`[data-minutes="${anchorSlot}"]`)
    if (item) list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2
    if (isFocusListRef.current) {
      isFocusListRef.current = false
      focusAnchorItem()
    }
  }, [isOpen, anchorSlot])

  /** 기준 칸에 포커스. 지난 칸이면 다음 고를 수 있는 칸 */
  function focusAnchorItem() {
    const list = popoverRef.current
    const item = list?.querySelector<HTMLButtonElement>(`[data-minutes="${anchorSlot}"]`)
    const target = item && !item.disabled ? item : list?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    target?.focus({ preventScroll: true })
  }

  function openList(isFocusList: boolean) {
    isFocusListRef.current = isFocusList
    setIsOpen(true)
  }

  /** 친 글자 해석: 읽으면 "15:30" 꼴로 고치고, 못 읽으면 빨간 테두리 (빈 칸은 그대로) */
  function commit(): number | null {
    if (text.trim() === '') {
      setIsInvalid(false)
      return null
    }
    if (parsed === null) {
      setIsInvalid(true)
      return null
    }
    setIsInvalid(false)
    if (formatTime(parsed) !== text) onTextChange(formatTime(parsed))
    return parsed
  }

  function pick(minutes: number) {
    setIsOpen(false)
    setIsInvalid(false)
    onTextChange(formatTime(minutes))
    inputRef.current?.focus()
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (isOpen) focusAnchorItem()
      else openList(true)
      return
    }
    if (event.key === 'Tab') setIsOpen(false)
    if (event.key !== 'Enter') return
    event.preventDefault()
    setIsOpen(false)
    const minutes = commit()
    if (minutes !== null) onEnter(minutes)
  }

  /** 목록 안: ↑↓ 로 누를 수 있는 칸 사이 이동, Tab 은 닫는다 */
  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      setIsOpen(false)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(popoverRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = index === -1 ? 0 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    items[next]?.focus()
  }

  return (
    <>
      <div ref={boxRef} className={isInvalid ? 'dtp-field dtp-time is-invalid' : 'dtp-field dtp-time'}>
        {/* 시계 아이콘을 눌러도 목록을 연다 (▾ 와 같다. 키보드로는 ▾ 가 맡는다) */}
        <span className="dtp-time-icon" onClick={() => (isOpen ? setIsOpen(false) : openList(true))} aria-hidden="true">
          <ClockIcon />
        </span>
        <input
          ref={inputRef}
          className="dtp-time-input"
          value={text}
          placeholder="Time"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => {
            setIsInvalid(false)
            onTextChange(event.target.value)
          }}
          onClick={() => {
            if (!isOpen && !window.matchMedia(TOUCH_QUERY).matches) openList(false)
          }}
          onBlur={(event) => {
            // 목록 칸을 누르러 가는 포커스 이동은 고르기가 맡는다
            if (!(event.relatedTarget instanceof Node && popoverRef.current?.contains(event.relatedTarget))) commit()
          }}
          onKeyDown={onInputKeyDown}
          aria-label="Reminder time"
          aria-invalid={isInvalid}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title="Type a time like 15:30 or 1530, or pick from the list"
        />
        <button
          type="button"
          className="dtp-time-toggle"
          onClick={() => (isOpen ? setIsOpen(false) : openList(true))}
          title="Pick a time"
          aria-label="Pick a time"
          aria-expanded={isOpen}
        >
          <ChevronIcon direction="down" />
        </button>
      </div>
      {isOpen && (
        <div ref={popoverRef} className="dtp-popover dtp-times" role="listbox" aria-label="Choose time" onKeyDown={onListKeyDown}>
          {SLOTS.map((minutes) => {
            const isPast = isPastTime(date, minutes, now)
            const isSelected = parsed === minutes
            return (
              <button
                key={minutes}
                type="button"
                role="option"
                className={isSelected ? 'dtp-time-option is-selected' : 'dtp-time-option'}
                data-minutes={minutes}
                disabled={isPast}
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => pick(minutes)}
              >
                {formatTime(minutes)}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
