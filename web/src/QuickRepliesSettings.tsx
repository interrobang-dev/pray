import { useEffect, useRef, useState } from 'react'
import { DEFAULT_QUICK_REPLIES, MAX_QUICK_REPLIES, MAX_QUICK_REPLY_LENGTH, normalizeQuickReplies, quickReplies, setQuickReplies } from './quickReplies'

/**
 * 설정 창 Chat 탭의 "Quick replies" 절: 줄마다 입력칸과 ×, [Add reply]·[Restore defaults].
 * 줄은 이 창의 state 라 빈 줄·중복 줄도 고치는 동안 남고, 저장은 정리한 목록(normalizeQuickReplies)으로 바로 한다 (대화 탭에 곧장 보인다).
 * 다 비우면 칩이 꺼진다. Reset chat style 은 이 목록을 건드리지 않는다 (저장 키가 따로다)
 */
export function QuickRepliesSettings() {
  const [rows, setRows] = useState<string[]>(() => [...quickReplies()])
  const isOff = normalizeQuickReplies(rows).length === 0
  /** 사람이 고친 뒤에만 저장한다 (열기만 해서는 저장 키를 만들지 않는다 — 고른 적 없으면 기본 칩을 따른다) */
  const isEditedRef = useRef(false)
  useEffect(() => {
    if (isEditedRef.current) setQuickReplies(rows)
  }, [rows])

  /** 줄을 바꾼다. 앞 state 로 계산해 연달아 눌러도 빠지지 않는다 */
  function change(update: (current: string[]) => string[]) {
    isEditedRef.current = true
    setRows(update)
  }

  return (
    <section className="appearance-section quick-replies-settings">
      <span className="appearance-label">Quick replies</span>
      <span className="appearance-hint">Shown above the input when a session asks you to decide. End with “:” to fill the input instead of sending.</span>
      {rows.map((row, index) => (
        <div key={index} className="quick-reply-row">
          <input
            type="text"
            value={row}
            maxLength={MAX_QUICK_REPLY_LENGTH}
            spellCheck={false}
            autoComplete="off"
            placeholder="Reply"
            aria-label={`Quick reply ${index + 1}`}
            onChange={(event) => {
              const { value: text } = event.target
              change((current) => current.map((value, at) => (at === index ? text : value)))
            }}
          />
          <button
            type="button"
            className="quick-reply-remove"
            onClick={() => change((current) => current.filter((_, at) => at !== index))}
            title="Remove reply"
            aria-label={`Remove quick reply ${index + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      {isOff && <span className="appearance-hint">No replies · quick replies are off</span>}
      <div className="quick-reply-actions">
        <button type="button" onClick={() => setRows((current) => (current.length >= MAX_QUICK_REPLIES ? current : [...current, '']))} disabled={rows.length >= MAX_QUICK_REPLIES}>
          Add reply
        </button>
        <button type="button" onClick={() => change(() => [...DEFAULT_QUICK_REPLIES])}>
          Restore defaults
        </button>
      </div>
    </section>
  )
}
