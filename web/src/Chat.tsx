import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import { NEWLINE_KEYS } from './Terminal'

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

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm]
// 언어가 표시된 코드 블록만 칠한다. 자동 추측(detect)은 엉뚱한 언어로 칠하기 쉬워 끈다
const REHYPE_PLUGINS: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false }]]
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

/** claude 응답 말풍선. raw HTML 은 react-markdown 기본값대로 글자로 보인다 (rehype-raw 안 씀).
 *  memo: 입력칸에 칠 때마다 대화 전체를 다시 파싱하지 않게 */
const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
})

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

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    // 줄마다 따로 보내고 줄 사이에 Claude Code 줄바꿈 키를 넣는다 (\n 을 그대로 보내면 줄바꿈으로 안 들어간다)
    const lines = text.split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (index > 0) await sendKeys(NEWLINE_KEYS)
      if (line) await sendKeys(line)
    }
    await sendKeys('\r')
  }

  /** Enter = 보내기, Shift+Enter = 줄바꿈. 한글 조합 중 Enter 는 조합 확정이라 보내지 않는다 */
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((message) => (
          <div key={message.id} className={`msg ${message.role}`}>
            {message.text &&
              (message.role === 'assistant' ? (
                <AssistantText text={message.text} />
              ) : (
                <div className="text">{message.text}</div>
              ))}
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
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="지시를 입력하고 Enter (줄바꿈은 Shift+Enter)"
            rows={Math.min(Math.max(draft.split('\n').length, 1), 8)}
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
