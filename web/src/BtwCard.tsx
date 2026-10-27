import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { CopyButton } from './CopyButton'
import { MarkdownText } from './Markdown'
import type { BtwItem } from './types'

/** Chat 이 카드에 시키는 것: 입력칸의 `/btw 질문` 과 `/btw` */
export interface BtwCardHandle {
  /** 카드를 열고 질문을 "보내는 중" 으로 바로 보인다. 돌려준 일(서버 요청)은 Chat 이 앞 보내기 뒤에 돌린다 (pty 에 쓰는 글이 섞이지 않게) */
  ask: (question: string) => () => Promise<void>
  /** 카드를 다시 연다 (마지막 문답) */
  open: () => void
}

interface Props {
  ref: Ref<BtwCardHandle>
  sessionId: string
  /** 전역 SSE 의 btw 이벤트로 올라가는 카운터. 바뀌면 문답을 다시 받는다 */
  version: number
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
 * 세션마다 새로 만든다 (Chat 이 key 를 준다)
 */
export function BtwCard({ ref, sessionId, version, onResize }: Props) {
  const [items, setItems] = useState<BtwItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  /** 보고 있는 문답 key. null 이면 맨 마지막 (새 문답이 오면 따라간다) */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [localAsk, setLocalAsk] = useState<LocalAsk | null>(null)
  const [clearError, setClearError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

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

  if (!isOpen) return null

  const views: View[] = items.map((item) => ({ key: item.id, question: item.question, status: item.status, answer: item.answer, error: item.error }))
  // 보내는 중인 질문은 서버 목록에 들어오면(pending) 따로 보이지 않는다
  const isLocalListed = localAsk && !localAsk.error && items.some((item) => item.status === 'pending' && item.question === localAsk.question)
  if (localAsk && !isLocalListed) {
    views.push({ key: 'local', question: localAsk.question, status: localAsk.error ? 'failed' : 'pending', answer: null, error: localAsk.error })
  }
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
              <MarkdownText text={view.answer} />
            </div>
          )}
        </div>
      ) : (
        <div className="btw-body btw-empty">No side questions yet. Type /btw and a question — claude answers from this conversation without stopping its work</div>
      )}
    </div>
  )
}
