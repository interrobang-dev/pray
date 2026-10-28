import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { btwBlockReason, composerRows, MAX_BTW_ROWS } from './composerText'
import { CopyButton } from './CopyButton'
import { MarkdownText } from './Markdown'
import type { BtwItem } from './types'

/** Chat 이 카드에 시키는 것: 입력칸의 `/btw 질문` 과 `/btw`, 입력 상자 버튼·단축키 */
export interface BtwCardHandle {
  /** 카드를 열고 질문을 "보내는 중" 으로 바로 보인다. 돌려준 일(서버 요청)은 Chat 이 앞 보내기 뒤에 돌린다 (pty 에 쓰는 글이 섞이지 않게) */
  ask: (question: string) => () => Promise<void>
  /** 카드를 다시 연다 (마지막 문답) */
  open: () => void
  /** 카드를 열고 카드 자신의 입력칸에 포커스한다 (이미 열려 있으면 포커스만) */
  openForInput: () => void
}

interface Props {
  ref: Ref<BtwCardHandle>
  sessionId: string
  /** 전역 SSE 의 btw 이벤트로 올라가는 카운터. 바뀌면 문답을 다시 받는다 */
  version: number
  /** 질문 중 (서버 409). 질문 카드 숫자 키를 가로채지 않게 열 때 입력칸에 포커스하지 않고, 보내기를 막는다 */
  isAsking: boolean
  /** 승인 대기 (서버 409). 보내기를 막는다 */
  isApprovalNeeded: boolean
  /** 카드 입력칸의 질문. Chat 의 보내기 줄에 세우고 ask 로 카드에 띄운다 (입력칸의 `/btw 질문` 과 같은 길) */
  onAsk: (question: string) => void
  /** Esc 로 카드를 닫음 (Chat 이 대화 입력칸에 포커스를 돌려준다) */
  onEscClosed: () => void
  /** 카드 높이가 바뀜 (대화가 맨 아래를 보고 있었으면 맨 아래에 두려고) */
  onResize: () => void
}

/** 서버 목록에 아직 없는 질문: 보내는 중이거나 보내기 자체가 실패함(409·네트워크) */
interface LocalAsk {
  question: string
  error: string | null
}

/** 카드에 보이는 문답 하나 (서버 것 또는 LocalAsk) */
interface View {
  key: string
  question: string
  status: BtwItem['status']
  answer: string | null
  error: string | null
}

/**
 * 곁가지 질문(btw) 카드: 입력칸 위에 질문과 답을 보인다 (대화 목록에는 넣지 않는다 — 대화 기록에 남지 않는 문답이다).
 * 서버가 세션마다 최근 20개를 들고 있어 ◀ ▶ 로 앞 문답을 본다. × 는 닫기만, Clear 는 서버 것까지 지운다.
 * 카드 아래에 자기 입력칸이 있어 이어서 계속 물을 수 있다 (답을 기다리는 동안은 보내기를 막는다 — 서버가 세션당 하나만 받는다).
 * 세션마다 새로 만든다 (Chat 이 key 를 준다)
 */
export function BtwCard({ ref, sessionId, version, isAsking, isApprovalNeeded, onAsk, onEscClosed, onResize }: Props) {
  const [items, setItems] = useState<BtwItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  /** 보고 있는 문답 key. null 이면 맨 마지막 (새 문답이 오면 따라간다) */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [localAsk, setLocalAsk] = useState<LocalAsk | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)
  /** 카드 입력칸의 글 */
  const [draft, setDraft] = useState('')
  /** 바뀔 때마다 카드 입력칸에 포커스한다 (버튼·단축키) */
  const [focusRequest, setFocusRequest] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize
  const isAskingRef = useRef(isAsking)
  isAskingRef.current = isAsking

  const views: View[] = items.map((item) => ({ key: item.id, question: item.question, status: item.status, answer: item.answer, error: item.error }))
  // 보내는 중인 질문은 서버 목록에 들어오면(pending) 따로 보이지 않는다
  const isLocalListed = localAsk && !localAsk.error && items.some((item) => item.status === 'pending' && item.question === localAsk.question)
  if (localAsk && !isLocalListed) {
    views.push({ key: 'local', question: localAsk.question, status: localAsk.error ? 'failed' : 'pending', answer: null, error: localAsk.error })
  }
  /** 답을 기다리는 질문이 있음 (닫아 두었어도 서버는 하나만 받는다) */
  const isPending = views.some((view) => view.status === 'pending')
  const blockReason = btwBlockReason({ isAsking, isApprovalNeeded, isPending })

  async function load() {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/btw`)
      if (!response.ok) return
      const body = (await response.json()) as { items?: BtwItem[] }
      setItems(body.items ?? [])
    } catch {
      // 다음 이벤트·다시 열기에서 다시 받는다
    }
  }

  useEffect(() => {
    void load()
  }, [sessionId, version])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver(() => onResizeRef.current())
    observer.observe(root)
    return () => observer.disconnect()
  }, [isOpen])

  // 질문 중에는 포커스하지 않는다 (질문 카드 숫자 키는 입력칸에 포커스가 있으면 먹지 않는다)
  useEffect(() => {
    if (focusRequest > 0 && !isAskingRef.current) inputRef.current?.focus()
  }, [focusRequest])

  useImperativeHandle(ref, () => ({
    ask(question) {
      setLocalAsk({ question, error: null })
      setSelectedKey(null)
      setIsOpen(true)
      return async () => {
        try {
          const response = await fetch(`/api/sessions/${sessionId}/btw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
          })
          const body = (await response.json().catch(() => ({}))) as { requestId?: unknown; message?: unknown }
          if (!response.ok || typeof body.requestId !== 'string') {
            setLocalAsk({ question, error: typeof body.message === 'string' ? body.message : `Couldn't send (HTTP ${response.status})` })
            return
          }
          setLocalAsk(null)
          await load()
        } catch {
          setLocalAsk({ question, error: "Couldn't send: network error" })
        }
      }
    },
    open() {
      // 보내기 실패는 그때 한 번 알린 것이라 다시 열면 서버 문답만 보인다
      setLocalAsk((current) => (current?.error ? null : current))
      setSelectedKey(null)
      setIsOpen(true)
      void load()
    },
    openForInput() {
      setLocalAsk((current) => (current?.error ? null : current))
      setSelectedKey(null)
      setIsOpen(true)
      setFocusRequest((current) => current + 1)
      void load()
    },
  }))

  async function clear() {
    setClearError(null)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/btw`, { method: 'DELETE' })
      if (!response.ok) {
        setClearError(`Couldn't clear (HTTP ${response.status})`)
        return
      }
      setItems([])
      setLocalAsk(null)
      setIsOpen(false)
    } catch {
      setClearError("Couldn't clear: network error")
    }
  }

  /** 카드 입력칸의 질문을 보낸다. 입력칸은 비우고 포커스를 둔다 (이어서 계속 묻는다) */
  function submit() {
    const question = draft.trim()
    if (!question || blockReason) return
    setDraft('')
    onAsk(question)
    inputRef.current?.focus()
  }

  /**
   * Enter = 보내기, Shift+Enter = 줄바꿈 (한글 조합 중 Enter 는 조합 확정이라 무시).
   * Esc = 글이 있으면 글만 지우고, 없으면 카드를 닫는다. 이벤트를 멈춰 패널·모달의 Esc 닫기가 같이 일어나지 않게 한다
   */
  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (draft) {
        setDraft('')
        return
      }
      setIsOpen(false)
      onEscClosed()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  if (!isOpen) return null

  const foundIndex = selectedKey === null ? -1 : views.findIndex((view) => view.key === selectedKey)
  const index = foundIndex >= 0 ? foundIndex : views.length - 1
  const view = views[index]
  // 맨 마지막을 보고 있으면 null 로 두어 새 문답을 따라간다
  const select = (next: number) => setSelectedKey(next >= views.length - 1 ? null : (views[next]?.key ?? null))

  return (
    <div ref={rootRef} className="btw-card" role="region" aria-label="Side question">
      <div className="btw-head">
        <span className="btw-label" title="Answered from the current conversation without tools. Not saved to the conversation">
          Side question
        </span>
        {views.length > 1 && (
          <span className="btw-nav">
            <button type="button" onClick={() => select(index - 1)} disabled={index <= 0} title="Previous" aria-label="Previous side question">
              ◀
            </button>
            <span className="btw-count">
              {index + 1}/{views.length}
            </span>
            <button type="button" onClick={() => select(index + 1)} disabled={index >= views.length - 1} title="Next" aria-label="Next side question">
              ▶
            </button>
          </span>
        )}
        <span className="btw-head-space" />
        {views.length > 0 && (
          <button type="button" className="btw-clear" onClick={() => void clear()} title="Delete all side questions of this session">
            Clear
          </button>
        )}
        <button type="button" className="btw-close" onClick={() => setIsOpen(false)} title="Close" aria-label="Close side question">
          ×
        </button>
      </div>
      {clearError && (
        <div className="btw-error" role="alert">
          {clearError}
        </div>
      )}
      {view ? (
        <div className="btw-body">
          <div className="btw-question">{view.question}</div>
          {view.status === 'pending' && (
            <div className="btw-waiting" role="status">
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Answering…
            </div>
          )}
          {view.status === 'failed' && (
            <div className="btw-error" role="alert">
              {view.error}
            </div>
          )}
          {view.status === 'answered' && view.answer !== null && (
            <div className="btw-answer">
              <CopyButton text={view.answer} />
              <MarkdownText text={view.answer} isChat />
            </div>
          )}
        </div>
      ) : (
        <div className="btw-body btw-empty">No side questions yet. Ask below — claude answers from this conversation without stopping its work</div>
      )}
      <form
        className="btw-input"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Ask a side question — not added to the conversation"
          aria-label="Side question"
          rows={composerRows(draft, MAX_BTW_ROWS)}
        />
        <button type="submit" className="btw-send" disabled={!draft.trim() || blockReason !== null} aria-label="Send side question" title={blockReason ?? 'Send (Enter)'}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M3 3.5 21.5 12 3 20.5 3 13.6 14 12 3 10.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
      {blockReason && (
        <div className="btw-note" role="status">
          {blockReason}
        </div>
      )}
    </div>
  )
}
