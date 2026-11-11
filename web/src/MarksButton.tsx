import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { buildMarkList, markPreview, type ChatMark } from './chatMarks'
import { useDismiss } from './Shells'
import { formatAgo, formatDateTime, type ChatMessage } from './types'

/** 북마크 그림. 마크했으면 채운다 */
function BookmarkIcon({ isFilled, size }: { isFilled: boolean; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M7 4.5h10a.5.5 0 0 1 .5.5v14.2l-5.5-3.9-5.5 3.9V5a.5.5 0 0 1 .5-.5Z"
        fill={isFilled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 말풍선 위 모서리의 마크 버튼 (claude 답·내 말). 마우스 기기는 올렸을 때만, 마크했으면 늘 보인다 (style.css).
 * 클릭은 preventDefault·stopPropagation 이라 말풍선·details·점프를 일으키지 않는다. onSetMark 는 Chat 이 고정해 넘긴다
 */
export function MarkButton({ messageKey, isMarked, onSetMark }: { messageKey: string; isMarked: boolean; onSetMark: (key: string, isMarked: boolean) => void }) {
  const label = isMarked ? 'Unmark' : 'Mark'
  function onClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onSetMark(messageKey, !isMarked)
  }
  return (
    <button type="button" className="mark-button" aria-pressed={isMarked} title={label} aria-label={label} onClick={onClick}>
      <BookmarkIcon isFilled={isMarked} size={14} />
    </button>
  )
}

/**
 * 대화 오른쪽 아래 버튼 묶음의 북마크 원 버튼 + 개수 (마크가 있을 때만). 누르면 버튼 왼쪽 위에 작은 창:
 * 줄 = You·Claude · 글 첫 줄 · 말풍선 시각 · ×(마크 해제), 대화 순서. 대화에 없는 말풍선은 흐리게 "Message not found" 이고 × 로만 지운다.
 * 줄을 누르면 창을 닫고 onGo(key) — Chat 이 점프와 같은 방식으로 그 말풍선까지 그리고 스크롤·강조한다. 세션이 바뀌면 Chat 이 key 로 새로 만든다
 */
export function MarksButton({
  marks,
  messages,
  onGo,
  onSetMark,
}: {
  marks: ChatMark[]
  messages: ChatMessage[]
  onGo: (key: string) => void
  onSetMark: (key: string, isMarked: boolean) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const isShown = isOpen && marks.length > 0
  useDismiss(isShown, rootRef, toggleRef, setIsOpen)
  const items = useMemo(() => (isShown ? buildMarkList(marks, messages) : []), [isShown, marks, messages])
  if (marks.length === 0) return null

  const now = Date.now()
  const label = `${marks.length} marked message${marks.length === 1 ? '' : 's'}`
  return (
    <div className="marks" ref={rootRef}>
      {isShown && (
        <div id="marks-popover" className="marks-popover" role="dialog" aria-label="Marked messages">
          <div className="marks-head">Marked messages</div>
          {items.map(({ key, createdAt, message }) => {
            const iso = message?.timestamp ?? createdAt
            return (
              <div key={key} className={`marks-row${message ? '' : ' missing'}`}>
                <button
                  type="button"
                  className="marks-go"
                  disabled={!message}
                  onClick={() => {
                    setIsOpen(false)
                    onGo(key)
                  }}
                >
                  <span className="marks-role">{message ? (message.role === 'user' ? 'You' : 'Claude') : '—'}</span>
                  <span className="marks-preview">{message ? markPreview(message.text) : 'Message not found'}</span>
                  <span className="marks-time" title={formatDateTime(iso)}>
                    {formatAgo(iso, now)}
                  </span>
                </button>
                <button type="button" className="marks-remove" title="Unmark" aria-label="Unmark" onClick={() => onSetMark(key, false)}>
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      <button
        ref={toggleRef}
        type="button"
        className="marks-button"
        aria-expanded={isShown}
        aria-controls="marks-popover"
        onClick={() => setIsOpen(!isShown)}
        title={label}
        aria-label={label}
      >
        <BookmarkIcon isFilled size={18} />
        <span className="marks-button-count" aria-hidden="true">
          {marks.length}
        </span>
      </button>
    </div>
  )
}
