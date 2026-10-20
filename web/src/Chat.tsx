import { useEffect, useRef, useState, type FormEvent } from 'react'

interface ToolUse {
  id: string
  name: string
  input: unknown
  result: string | null
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  timestamp: string
  text: string
  toolUses: ToolUse[]
}

interface Props {
  sessionId: string
  isWritable: boolean
  isApprovalNeeded: boolean
  pendingTool: string | null
  /** 전역 SSE 의 transcript 이벤트로 올라가는 카운터. 바뀌면 다시 읽는다 */
  version: number
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  const key = ['command', 'file_path', 'pattern', 'description', 'prompt', 'url'].find((k) => typeof record[k] === 'string')
  const value = key ? String(record[key]) : ''
  return value.split('\n')[0].slice(0, 120) || name
}

export function Chat({ sessionId, isWritable, isApprovalNeeded, pendingTool, version }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let isCancelled = false
    fetch(`/api/sessions/${sessionId}/messages`)
      .then((r) => r.json())
      .then((data: ChatMessage[]) => {
        if (!isCancelled) setMessages(data)
      })
    return () => {
      isCancelled = true
    }
  }, [sessionId, version])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const sendKeys = (data: string) =>
    fetch(`/api/sessions/${sessionId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await sendKeys(text)
    await sendKeys('\r')
  }

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((message) => (
          <div key={message.id} className={`msg ${message.role}`}>
            {message.text && <div className="text">{message.text}</div>}
            {message.toolUses.map((toolUse) => (
              <details key={toolUse.id} className="tool">
                <summary>
                  <code>{toolUse.name}</code> {summarizeInput(toolUse.name, toolUse.input)}
                </summary>
                <pre>{JSON.stringify(toolUse.input, null, 2)}</pre>
                {toolUse.result !== null && <pre className="result">{toolUse.result}</pre>}
              </details>
            ))}
          </div>
        ))}
        {messages.length === 0 && <p className="hint">아직 대화가 없습니다</p>}
        <div ref={bottomRef} />
      </div>
      {isWritable && isApprovalNeeded && (
        <div className="approval">
          <span>
            승인 대기: <code>{pendingTool ?? '?'}</code>
          </span>
          <button className="yes" onClick={() => void sendKeys('\r')}>
            승인 (Enter)
          </button>
          <button className="no" onClick={() => void sendKeys('\x1b')}>
            거부 (Esc)
          </button>
        </div>
      )}
      {isWritable ? (
        <form className="composer" onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="지시를 입력하고 Enter"
            autoFocus
          />
          <button type="submit">보내기</button>
        </form>
      ) : (
        <p className="hint">터미널·IDE에서 띄운 세션이라 관찰만 가능합니다</p>
      )}
    </div>
  )
}
