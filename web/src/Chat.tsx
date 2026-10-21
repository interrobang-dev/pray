import { Fragment, memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
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
  /** 훅 상태가 working 이면 대화 맨 아래에 작업 중 표시기 */
  isWorking: boolean
  workingSince: string | null
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

/** 경과 시간 "12초"·"1분 12초"·"1시간 2분 3초" */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`
  if (minutes > 0) return `${minutes}분 ${seconds}초`
  return `${seconds}초`
}

/** 메신저의 "입력 중…" 같은 작업 중 표시기. 1초 타이머가 이 컴포넌트만 다시 그리게 따로 둔다 (대화 전체 마크다운 파싱을 피하려고) */
function WorkingIndicator({ since }: { since: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return (
    <div className="typing" role="status">
      <span className="typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>
        작업 중
        {/* 매초 바뀌는 글자를 화면 낭독기가 계속 읽지 않게 */}
        {since && <span aria-hidden="true"> · {formatDuration(now - Date.parse(since))}</span>}
      </span>
    </div>
  )
}

/** 맨 아래에서 이만큼 안쪽이면 "맨 아래를 보고 있다" 로 본다 */
const BOTTOM_SLACK_PX = 40

/** 보냈지만 아직 jsonl 에서 안 보인 내 말. 진짜 user 메시지가 오면 없앤다 */
interface PendingMessage {
  id: number
  text: string
  /** 보낸 시점에 이미 있던 메시지 ID. 같은 글을 전에 보낸 적이 있어도 그것과 맞추지 않게 뺀다 */
  knownIds: Set<string>
  isFailed: boolean
}

/** 확인되지 않은 임시 말풍선을 조용히 없애기까지. `/help` 같은 슬래시 명령은 user 메시지로 안 남을 수 있다 */
const PENDING_TIMEOUT_MS = 15_000

const PASTE_TAG = /<\/?pasted_content id="[^"]*">/g

/**
 * 내 말과 jsonl 의 user 메시지 비교 키. 서버 instructionKey(server/src/messages.ts)와 같은 규칙:
 * Claude Code 는 pty 로 들어온 긴 입력을 4096바이트 조각으로 받아 `<pasted_content id="…">` 태그로 감싸고
 * 조각 경계에 줄바꿈을 넣어 남기므로, 태그를 빼고 공백을 전부 지운 뒤 비교한다
 */
function messageKey(text: string): string {
  return text.replace(PASTE_TAG, '').replace(/\s+/g, '')
}

/** 새로 생긴 user 메시지와 글이 같은 임시 말풍선을 없앤다. 메시지 하나는 말풍선 하나에만, 앞에서부터 맞춘다. 전송 실패는 사용자가 닫을 때까지 둔다 */
function settlePendings(pendings: PendingMessage[], messages: ChatMessage[]): PendingMessage[] {
  const matchedIds = new Set<string>()
  const remaining = pendings.filter((pending) => {
    if (pending.isFailed) return true
    const key = messageKey(pending.text)
    const match = messages.find(
      (message) => message.role === 'user' && !pending.knownIds.has(message.id) && !matchedIds.has(message.id) && messageKey(message.text) === key,
    )
    if (!match) return true
    matchedIds.add(match.id)
    return false
  })
  if (remaining.length === pendings.length) return pendings
  // 이미 다른 말풍선과 맞춘 메시지는 남은 말풍선이 다음 번에 다시 맞추지 않게 한다 (같은 글을 연달아 보냈을 때)
  return remaining.map((pending) => ({ ...pending, knownIds: new Set([...pending.knownIds, ...matchedIds]) }))
}

export function Chat({ sessionId, isWritable, isApprovalNeeded, isWorking, workingSince, pendingTool, version, sessionNames }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pendings, setPendings] = useState<PendingMessage[]>([])
  const nextPendingIdRef = useRef(1)
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  /** 사용자가 맨 아래를 보고 있는지. 스크롤 때마다 갱신한다 (표시기가 생겨 내용만 길어질 때는 스크롤 이벤트가 없어 직전 값이 남는다) */
  const isAtBottomRef = useRef(true)

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

  useEffect(() => {
    setPendings((current) => settlePendings(current, messages))
  }, [messages])

  useEffect(() => {
    setPendings([])
  }, [sessionId])

  // 메시지가 바뀌면 위에서 늘 맨 아래로 내린다. 표시기는 맨 아래를 보고 있었을 때만 따라 내려간다
  useEffect(() => {
    if (isWorking && isAtBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [isWorking])

  function onMessagesScroll() {
    const element = messagesRef.current
    if (element) isAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX
  }

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
    // jsonl 에 남기까지(transcript 갱신 → 대화 전체 다시 받기) 기다리지 않고 내 말풍선을 바로 띄운다
    const pendingId = nextPendingIdRef.current++
    const knownIds = new Set(messages.map((message) => message.id))
    flushSync(() => setPendings((current) => [...current, { id: pendingId, text, knownIds, isFailed: false }]))
    bottomRef.current?.scrollIntoView({ block: 'end' })
    setTimeout(() => setPendings((current) => current.filter((pending) => pending.id !== pendingId || pending.isFailed)), PENDING_TIMEOUT_MS)
    const markFailed = () =>
      setPendings((current) => current.map((pending) => (pending.id === pendingId ? { ...pending, isFailed: true } : pending)))
    const send = async (data: string) => {
      if (!(await sendKeys(data)).ok) markFailed()
    }
    try {
      // 줄마다 따로 보내고 줄 사이에 Claude Code 줄바꿈 키를 넣는다 (\n 을 그대로 보내면 줄바꿈으로 안 들어간다)
      const lines = text.split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        if (index > 0) await send(NEWLINE_KEYS)
        if (line) await send(line)
      }
      await send('\r')
    } catch {
      markFailed()
    }
  }

  function dismissPending(pendingId: number) {
    setPendings((current) => current.filter((pending) => pending.id !== pendingId))
  }

  /** Enter = 보내기, Shift+Enter = 줄바꿈. 한글 조합 중 Enter 는 조합 확정이라 보내지 않는다 */
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <div className="chat">
      <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>
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
        {pendings.map((pending) => (
          <div key={`pending-${pending.id}`} className={`msg user pending${pending.isFailed ? ' failed' : ''}`}>
            <div className="text">{pending.text}</div>
            <div className="pending-label">
              {pending.isFailed ? '전송 실패' : '보내는 중'}
              {pending.isFailed && (
                <button type="button" className="pending-dismiss" aria-label="닫기" onClick={() => dismissPending(pending.id)}>
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        {messages.length === 0 && pendings.length === 0 && <p className="hint">아직 대화가 없습니다</p>}
        {isWorking && <WorkingIndicator since={workingSince} />}
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
