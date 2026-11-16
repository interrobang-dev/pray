import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DateField, TimeField } from './DateTimePicker'
import { confirmText, dateOf, formatTime, parseTimeText, QUICK_CHOICES, quickChoice, toIso, type LocalDate, type QuickChoiceKind } from './dateTimePick'
import { Modal } from './Modal'
import { scheduleBlockReason, scheduledFailureMessage } from './scheduledMessages'
import type { ScheduledMessage } from './types'

/** 터치 기기는 열 때 시각 칸에 포커스하지 않는다 (가상 키보드가 창을 가린다) */
const TOUCH_QUERY = '(hover: none)'
/** 확인 줄 "in 42m" 을 다시 계산하는 간격 */
const NOW_TICK_MS = 30_000

interface Props {
  sessionId: string
  /** 받는 세션 이름 (제목 아래 "To …") */
  targetName: string
  /** 보낼 최종 글 (Send 와 같은 withQuote·withAttachmentPaths 결과) */
  text: string
  onClose: () => void
  /** 등록 성공: 서버 응답 항목. 입력칸 비우기·띠 알림은 부른 쪽 */
  onScheduled: (message: ScheduledMessage) => void
}

/**
 * 예약 보내기 창 (입력 상자 시계 버튼이 연다). 보낼 글 미리보기 · 빠른 칩 · [날짜][시각][Schedule] · 확인 한 줄.
 * `/` 로 시작하거나 `\` 로 끝나는 글은 서버 400 과 같은 조건이라 미리 막는다. 실패는 창 안 빨간 줄.
 * 입력 상자 안에서 그려 대화 패널의 쌓임 맥락에 갇히지 않게 body 로 portal 한다
 */
export function ScheduleMessageModal({ sessionId, targetName, text, onClose, onScheduled }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [date, setDate] = useState<LocalDate>(() => dateOf(Date.now()))
  const [timeText, setTimeText] = useState('')
  const [isScheduling, setIsScheduling] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const blockReason = scheduleBlockReason(text)
  const minutes = parseTimeText(timeText)
  const confirm = minutes === null ? null : confirmText(date, minutes, now, 'Sends')
  const canSchedule = blockReason === null && minutes !== null && !isScheduling

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (blockReason === null && !window.matchMedia(TOUCH_QUERY).matches) timeRef.current?.focus()
  }, []) // 열 때 한 번

  function applyQuickChoice(kind: QuickChoiceKind) {
    const choice = quickChoice(kind, Date.now())
    setDate(choice.date)
    setTimeText(formatTime(choice.minutes))
    setNow(Date.now())
  }

  /** 등록: 이 PC 날짜·시각을 Z 꼴 ISO 로 (지났으면 서버 400 빨간 줄) */
  async function schedule() {
    if (blockReason !== null || isScheduling) return
    const sentMinutes = parseTimeText(timeText)
    if (sentMinutes === null) {
      timeRef.current?.focus()
      return
    }
    setErrorMessage(null)
    setIsScheduling(true)
    try {
      const response = await fetch('/api/scheduled-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text, at: toIso(date, sentMinutes) }),
      })
      const data = (await response.json().catch(() => ({}))) as { scheduledMessage?: ScheduledMessage; message?: unknown }
      if (!response.ok || !data.scheduledMessage) {
        setErrorMessage(scheduledFailureMessage(response.status, data.message))
        setIsScheduling(false)
        return
      }
      onScheduled(data.scheduledMessage)
    } catch {
      setErrorMessage('Network error')
      setIsScheduling(false)
    }
  }

  return createPortal(
    <Modal title="Schedule send" subtitle={`To ${targetName}`} onClose={onClose} className="schedule-modal" hasCloseButton>
      <div className="schedule-preview" title={text}>
        {text}
      </div>
      {blockReason && (
        <div className="schedule-error" role="alert">
          {blockReason}
        </div>
      )}
      <div className="reminders-form">
        <div className="reminders-chips" role="group" aria-label="Quick times">
          {QUICK_CHOICES.map((choice) => (
            <button key={choice.kind} type="button" className="reminders-chip" onClick={() => applyQuickChoice(choice.kind)} disabled={blockReason !== null}>
              {choice.label}
            </button>
          ))}
        </div>
        <div className="reminders-form-row">
          <DateField date={date} now={now} onChange={setDate} />
          <TimeField text={timeText} date={date} now={now} inputRef={timeRef} onTextChange={setTimeText} onEnter={() => void schedule()} />
          <button className="reminders-add" onClick={() => void schedule()} disabled={!canSchedule}>
            {isScheduling ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
        {confirm && <div className={confirm.isPast ? 'reminders-confirm is-past' : 'reminders-confirm'}>{confirm.text}</div>}
      </div>
      {errorMessage && (
        <div className="schedule-error" role="alert">
          {errorMessage}
        </div>
      )}
    </Modal>,
    document.body,
  )
}
