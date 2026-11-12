import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { DateField, TimeField } from './DateTimePicker'
import { confirmText, dateOf, formatTime, isSameDate, parseTimeText, QUICK_CHOICES, quickChoice, toIso, type LocalDate, type QuickChoiceKind } from './dateTimePick'
import { Modal } from './Modal'
import {
  applyReminder,
  creatorLabel,
  formatDue,
  formatFiredDue,
  reminderSections,
  remindersOf,
  removeReminder,
  unacknowledgedCount,
} from './reminders'
import { formatDateTime, type Office, type Reminder, type Session } from './types'

/** 툴바 Reminders 아이콘: 알람시계 */
function RemindersIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
      <circle cx="8" cy="9" r="5" />
      <path d="M8 6.5V9l1.75 1.25" />
      <path d="M2.25 4.25 4.5 2.25M13.75 4.25 11.5 2.25" />
    </svg>
  )
}

/**
 * 목록 툴바의 "Reminders" 줄(아이콘 + 글자 + 울렸고 확인 전인 개수 빨간 배지). 누르면 Reminders 창을 연다.
 * 예정만 있으면 배지 없이 보통, 아무것도 없으면 흐리지만 눌린다 (등록하러 들어가야 해서)
 */
export function RemindersButton({ office, onOpen }: { office: Office; onOpen: () => void }) {
  const reminders = remindersOf(office)
  const sections = reminderSections(reminders)
  const firedCount = unacknowledgedCount(reminders)
  const hasAny = sections.fired.length + sections.upcoming.length > 0
  return (
    <button className={hasAny ? 'toolbar-row reminders-toggle has-reminders' : 'toolbar-row reminders-toggle'} onClick={onOpen} title="Reminders">
      <RemindersIcon />
      Reminders
      {firedCount > 0 && <span className="needs-you-count urgent">{firedCount}</span>}
    </button>
  )
}

/** 알림 API 요청. 성공이면 응답의 reminder(DELETE 는 없음), 실패면 서버 message (TeamTodosModal 의 requestTodo 와 같은 꼴) */
async function requestReminder(url: string, method: string, body?: unknown): Promise<{ reminder?: Reminder; failure: string | null }> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as { reminder?: Reminder; message?: string }
    return response.ok ? { reminder: data.reminder, failure: null } : { failure: data.message ?? `HTTP ${response.status}` }
  } catch {
    return { failure: 'Network error' }
  }
}

interface ViewProps {
  office: Office
  sessions: Session[]
  now: number
  /** 창을 닫는다 */
  onClose: () => void
  /** 응답 항목을 App 의 office 에 먼저 넣는다 (SSE 가 오면 서버 것으로 바뀐다) */
  onChangeReminders: (update: (reminders: Reminder[]) => Reminder[]) => void
}

/**
 * Reminders 창 (툴바 Reminders 줄이 연다).
 * 맨 위 등록 칸(글 + 빠른 칩 + 날짜·시각 + Add + 확인 한 줄), 그 아래 "Fired"(울렸고 확인 전: 체크 = 확인, × = 지우기), "Upcoming"(아직: × = 지우기). 확인한 것은 보이지 않는다
 */
export function RemindersModal({ office, sessions, now, onClose, onChangeReminders }: ViewProps) {
  const [draft, setDraft] = useState('')
  const [date, setDate] = useState<LocalDate>(() => dateOf(Date.now()))
  const [timeText, setTimeText] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLInputElement>(null)
  const { fired, upcoming } = reminderSections(remindersOf(office))
  const minutes = parseTimeText(timeText)
  const canAdd = draft.trim() !== '' && minutes !== null && !isAdding
  const confirm = minutes === null ? null : confirmText(date, minutes, now)

  function setPending(reminderId: string, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (isPending) next.add(reminderId)
      else next.delete(reminderId)
      return next
    })
  }

  /** 등록: 글은 서버가 길이를 본다(넘으면 400 빨간 줄). 시각은 이 PC 날짜·시각을 UTC ISO 로 바꿔 보낸다(지났으면 서버 400). 기다리는 사이 바꾼 칸은 남긴다 */
  async function add() {
    const text = draft.trim()
    if (!text) {
      textRef.current?.focus()
      return
    }
    if (isAdding) return
    const sentMinutes = parseTimeText(timeText)
    if (sentMinutes === null) {
      timeRef.current?.focus()
      return
    }
    const sentDate = date
    const at = toIso(sentDate, sentMinutes)
    setErrorMessage(null)
    setIsAdding(true)
    const result = await requestReminder('/api/reminders', 'POST', { text, at })
    setIsAdding(false)
    if (result.failure !== null) {
      setErrorMessage(result.failure)
      return
    }
    const added = result.reminder
    if (added) onChangeReminders((reminders) => applyReminder(reminders, added))
    setDraft((current) => (current === draft ? '' : current))
    // 시각 칸 Enter 는 "1530" → "15:30" 으로 고친 직후 부르므로 글자가 아니라 읽은 값으로 견준다
    setTimeText((current) => (parseTimeText(current) === sentMinutes ? '' : current))
    setDate((current) => (isSameDate(current, sentDate) ? dateOf(Date.now()) : current))
  }

  /** 빠른 칩: 누른 순간의 이 PC 시각으로 날짜·시각을 채운다 */
  function applyQuickChoice(kind: QuickChoiceKind) {
    const choice = quickChoice(kind, Date.now())
    setDate(choice.date)
    setTimeText(formatTime(choice.minutes))
  }

  function onTextKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void add()
  }

  /** 확인(PATCH)·지우기(DELETE). 기다리는 동안 그 줄의 버튼을 막는다 */
  async function act(reminder: Reminder, kind: 'acknowledge' | 'delete') {
    if (pendingIds.has(reminder.id)) return
    setErrorMessage(null)
    setPending(reminder.id, true)
    const url = `/api/reminders/${encodeURIComponent(reminder.id)}`
    const result = kind === 'acknowledge' ? await requestReminder(url, 'PATCH', { isAcknowledged: true }) : await requestReminder(url, 'DELETE')
    setPending(reminder.id, false)
    if (result.failure !== null) {
      setErrorMessage(result.failure)
      return
    }
    const updated = result.reminder
    if (kind === 'delete') onChangeReminders((reminders) => removeReminder(reminders, reminder.id))
    else if (updated) onChangeReminders((reminders) => applyReminder(reminders, updated))
  }

  function renderItem(reminder: Reminder, isFired: boolean) {
    const isPending = pendingIds.has(reminder.id)
    const due = isFired ? `Due ${formatFiredDue(reminder.at, now)}` : formatDue(reminder.at, now)
    return (
      <li key={reminder.id} className={isFired ? 'reminders-item fired' : 'reminders-item'}>
        {isFired && (
          <input
            type="checkbox"
            checked={isPending}
            disabled={isPending}
            onChange={() => void act(reminder, 'acknowledge')}
            aria-label={`Mark "${reminder.text}" as seen`}
          />
        )}
        <span className="reminders-body">
          <span className="reminders-text" title={reminder.text}>
            {reminder.text}
          </span>
          <span className="reminders-meta">
            <span title={formatDateTime(reminder.at)}>{due}</span>
            {isFired && reminder.isLate && <span className="reminders-late"> · Late</span>}
            {' · '}
            {creatorLabel(reminder.createdBy, sessions, office.teams)}
          </span>
        </span>
        <button
          className="reminders-remove"
          onClick={() => void act(reminder, 'delete')}
          disabled={isPending}
          title="Delete reminder"
          aria-label={`Delete "${reminder.text}"`}
        >
          ×
        </button>
      </li>
    )
  }

  return (
    <Modal title="Reminders" onClose={onClose} className="reminders-modal" hasCloseButton>
      {errorMessage && <div className="all-todos-error">{errorMessage}</div>}
      <div className="reminders-form">
        {/* 글 길이(trim 뒤 1~500자)는 서버가 보고 넘으면 400 빨간 줄 (할 일 입력칸과 같은 이유로 maxLength 없음) */}
        <input
          ref={textRef}
          className="reminders-input"
          value={draft}
          placeholder="Remind me about…"
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onTextKeyDown}
          aria-label="Reminder text"
        />
        <div className="reminders-chips" role="group" aria-label="Quick times">
          {QUICK_CHOICES.map((choice) => (
            <button key={choice.kind} type="button" className="reminders-chip" onClick={() => applyQuickChoice(choice.kind)}>
              {choice.label}
            </button>
          ))}
        </div>
        <div className="reminders-form-row">
          <DateField date={date} now={now} onChange={setDate} />
          <TimeField text={timeText} date={date} now={now} inputRef={timeRef} onTextChange={setTimeText} onEnter={() => void add()} />
          <button className="reminders-add" onClick={() => void add()} disabled={!canAdd}>
            {isAdding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {confirm && <div className={confirm.isPast ? 'reminders-confirm is-past' : 'reminders-confirm'}>{confirm.text}</div>}
      </div>
      {fired.length === 0 && upcoming.length === 0 && <p className="side-view-empty">No reminders</p>}
      {fired.length > 0 && (
        <section className="reminders-section">
          <div className="reminders-section-head">
            Fired <span className="reminders-section-count">{fired.length}</span>
          </div>
          <ul className="reminders-list">{fired.map((reminder) => renderItem(reminder, true))}</ul>
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="reminders-section">
          <div className="reminders-section-head">
            Upcoming <span className="reminders-section-count">{upcoming.length}</span>
          </div>
          <ul className="reminders-list">{upcoming.map((reminder) => renderItem(reminder, false))}</ul>
        </section>
      )}
    </Modal>
  )
}
