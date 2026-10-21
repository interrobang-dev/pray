import { Fragment, memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github.css'
import { NEWLINE_KEYS } from './Terminal'
import type { ChatMessage, ToolUse } from './types'

interface Props {
  sessionId: string
  isWritable: boolean
  isApprovalNeeded: boolean
  pendingTool: string | null
  /** 전역 SSE 의 transcript 이벤트로 올라가는 카운터. 바뀌면 다시 읽는다 */
  version: number
  /** 세션 ID → 화면 이름 (App 의 세션 목록). 팀원 이름 찾기용 */
  sessionNames: Record<string, string>
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

const SPAWN_TOOL = 'mcp__jk-corp__jk_spawn_member'
const ASSIGN_TOOL = 'mcp__jk-corp__jk_assign'
const WAIT_TOOL = 'mcp__jk-corp__jk_wait'
/** jk_spawn_member 결과의 첫 sessionId = 새 팀원 */
const SPAWNED_SESSION_ID = /"sessionId":\s*"([^"]+)"/
/** 120초를 넘긴 jk_wait 는 백그라운드로 넘어가고, 결과는 나중에 이 꼴의 알림 메시지(system)로 온다 */
const WAIT_NOTIFICATION = /^<task-notification>[\s\S]*\(jk-corp\/jk_wait\) completed\.<\/summary>\s*<result>\n([\s\S]*)\n<\/result>\s*<\/task-notification>\s*$/
const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** 알림의 결과 JSON. Claude Code 가 <result> 안의 `<`·`>` 를 엔티티로 바꿔 넣으므로 되돌린다 (한 번에 바꿔 `&amp;lt;` 가 두 번 풀리지 않게) */
function waitNotificationResult(text: string): string {
  return (text.match(WAIT_NOTIFICATION)?.[1] ?? '').replace(/&(lt|gt|amp|quot|apos);/g, (_, entity: string) => XML_ENTITIES[entity])
}

/** 팀장↔팀원이 주고받은 글: 팀장 → 팀원 지시, 팀원 → 팀장 보고 */
interface Relay {
  label: string
  text: string
}

/** jk_wait 결과 JSON 에서 팀원 보고. 해석 실패·시간 초과(task null)·결과 없음이면 null */
function waitReport(json: string): { memberSessionId: string; result: string } | null {
  try {
    const { task } = JSON.parse(json) as { task?: { memberSessionId?: unknown; result?: unknown } | null }
    if (typeof task?.memberSessionId === 'string' && typeof task.result === 'string' && task.result) {
      return { memberSessionId: task.memberSessionId, result: task.result }
    }
  } catch {
    // 지금처럼 도구 블록으로 둔다
  }
  return null
}

/** 팀장 대화의 jk 도구 호출을 말풍선으로. 실패한 지시(결과가 JSON 이 아닌 오류 글)·jk_status·jk_dismiss 는 null */
function relayOf(toolUse: ToolUse, memberNameOf: (sessionId: string) => string): Relay | null {
  const input = (toolUse.input ?? {}) as { name?: unknown; sessionId?: unknown; instruction?: unknown }
  const isDelivered = toolUse.result === null || toolUse.result.startsWith('{')
  if (typeof input.instruction === 'string' && input.instruction && isDelivered) {
    if (toolUse.name === SPAWN_TOOL && typeof input.name === 'string') return { label: `→ ${input.name}`, text: input.instruction }
    if (toolUse.name === ASSIGN_TOOL && typeof input.sessionId === 'string') {
      return { label: `→ ${memberNameOf(input.sessionId)}`, text: input.instruction }
    }
  }
  if (toolUse.name === WAIT_TOOL && toolUse.result) {
    const report = waitReport(toolUse.result)
    if (report) return { label: `${memberNameOf(report.memberSessionId)} →`, text: report.result }
  }
  return null
}

function ToolBlock({ toolUse }: { toolUse: ToolUse }) {
  return (
    <details className="tool">
      <summary>
        <code>{toolUse.name}</code> {summarizeInput(toolUse.name, toolUse.input)}
      </summary>
      <pre>{JSON.stringify(toolUse.input, null, 2)}</pre>
      {toolUse.result !== null && <pre className="result">{toolUse.result}</pre>}
    </details>
  )
}

/** claude 가 쓴 글(응답, 팀장↔팀원 지시·보고) 말풍선 내용. raw HTML 은 react-markdown 기본값대로 글자로 보인다 (rehype-raw 안 씀).
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

export function Chat({ sessionId, isWritable, isApprovalNeeded, pendingTool, version, sessionNames }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  /** 팀원 이름: jk_spawn_member 때 붙인 이름 → 세션 목록 이름 → ID 앞 8자리 */
  const memberNameOf = useMemo(() => {
    const spawnedNames = new Map<string, string>()
    for (const message of messages) {
      for (const toolUse of message.toolUses) {
        const name = (toolUse.input as { name?: unknown } | null)?.name
        const spawnedId = toolUse.result?.match(SPAWNED_SESSION_ID)?.[1]
        if (toolUse.name === SPAWN_TOOL && typeof name === 'string' && spawnedId) spawnedNames.set(spawnedId, name)
      }
    }
    return (id: string) => spawnedNames.get(id) ?? sessionNames[id] ?? id.slice(0, 8)
  }, [messages, sessionNames])

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
        {messages.map((message) => {
          // 팀원 대화: 서버가 보낸 팀장·파트장 지시
          if (message.from) {
            return (
              <div key={message.id} className="msg user relay">
                <div className="relay-label">{message.from.name} 지시</div>
                <AssistantText text={message.text} />
              </div>
            )
          }
          // 팀장 대화: 백그라운드로 넘어간 jk_wait 의 결과 알림
          const notified = message.role === 'system' ? waitReport(waitNotificationResult(message.text)) : null
          if (notified) {
            return (
              <div key={message.id} className="msg relay">
                <div className="relay-label">{memberNameOf(notified.memberSessionId)} →</div>
                <AssistantText text={notified.result} />
                <details className="tool">
                  <summary>
                    <code>task-notification</code> jk_wait 결과
                  </summary>
                  <pre className="result">{message.text}</pre>
                </details>
              </div>
            )
          }
          // 팀장 대화: 지시·보고 도구 호출은 말풍선으로 빼고 원래 도구 블록은 그 안에 접어 둔다
          const relays = message.toolUses.map((toolUse) => ({ toolUse, relay: relayOf(toolUse, memberNameOf) }))
          const plainToolUses = relays.filter(({ relay }) => !relay).map(({ toolUse }) => toolUse)
          const isEmptyWithoutRelays = !message.text && plainToolUses.length === 0 && relays.length > 0
          return (
            <Fragment key={message.id}>
              {!isEmptyWithoutRelays && (
                <div className={`msg ${message.role}`}>
                  {message.text &&
                    (message.role === 'assistant' ? (
                      <AssistantText text={message.text} />
                    ) : (
                      <div className="text">{message.text}</div>
                    ))}
                  {plainToolUses.map((toolUse) => (
                    <ToolBlock key={toolUse.id} toolUse={toolUse} />
                  ))}
                </div>
              )}
              {relays.map(
                ({ toolUse, relay }) =>
                  relay && (
                    <div key={toolUse.id} className="msg relay">
                      <div className="relay-label">{relay.label}</div>
                      <AssistantText text={relay.text} />
                      <ToolBlock toolUse={toolUse} />
                    </div>
                  ),
              )}
            </Fragment>
          )
        })}
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
