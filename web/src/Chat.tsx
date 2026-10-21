import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { FilesButton } from './Files'
import { MarkdownText } from './Markdown'
import { NEWLINE_KEYS } from './Terminal'
import type { AskQuestion, ChatMessage, ToolUse } from './types'

interface Props {
  sessionId: string
  isWritable: boolean
  isApprovalNeeded: boolean
  /** 훅 상태가 working 이면 대화 맨 아래에 작업 중 표시기 */
  isWorking: boolean
  workingSince: string | null
  pendingTool: string | null
  /** 서버가 붙잡고 있는 AskUserQuestion. 있으면 승인 막대 대신 질문 카드 */
  question: { questions: AskQuestion[] } | null
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

const ASK_TOOL = 'AskUserQuestion'

/** 대화 기록의 AskUserQuestion. answers 가 null 이면 아직 결과가 없는 질문 중 */
interface Asked {
  questions: { question: string; header: string }[]
  answers: Record<string, string> | null
}

/** 답했으면(서버가 붙인 answers) 질문 → 답, 결과가 아직 없으면 질문 중. 그 밖(옛 서버·취소·대화로 답하기)은 null = 도구 블록 그대로 */
function askedOf(toolUse: ToolUse): Asked | null {
  if (toolUse.name !== ASK_TOOL) return null
  const { questions } = (toolUse.input ?? {}) as { questions?: unknown }
  if (!Array.isArray(questions)) return null
  const items = questions
    .filter((item): item is { question: string; header?: unknown } => typeof item?.question === 'string')
    .map((item) => ({ question: item.question, header: typeof item.header === 'string' ? item.header : '' }))
  if (toolUse.answers) return { questions: items, answers: toolUse.answers }
  if (toolUse.result === null) return { questions: items, answers: null }
  return null
}

/** 질문 → 답 카드 (claude 쪽). 원래 도구 블록은 안에 접어 둔다. 질문 중이면 표시만 */
function AskedCard({ toolUse, asked }: { toolUse: ToolUse; asked: Asked }) {
  const { answers } = asked
  if (!answers) {
    return (
      <div className="msg asked waiting">
        <span className="asked-label">질문 중</span> {asked.questions.map((item) => item.header).filter(Boolean).join(' · ')}
      </div>
    )
  }
  return (
    <div className="msg asked">
      <div className="asked-label">질문 → 답</div>
      {asked.questions.map((item) => (
        <div key={item.question} className="asked-item">
          <div className="asked-question">{item.question}</div>
          <div className="asked-answer">{answers[item.question] ?? '—'}</div>
        </div>
      ))}
      <ToolBlock toolUse={toolUse} />
    </div>
  )
}

/** 질문 하나에 대한 고르기·직접 입력 */
interface Draft {
  labels: string[]
  customText: string
}

/** 답했는지: 단일 선택은 하나를 고르거나 글을 썼을 때, 여러 개 고르기는 하나 이상 고르거나 글을 썼을 때 */
function isDraftAnswered(draft: Draft): boolean {
  return draft.labels.length > 0 || draft.customText.trim() !== ''
}

/** 서버로 보낼 답: 단일 선택은 글을 썼으면 그 글, 아니면 고른 라벨. 여러 개 고르기는 고른 라벨 + 글 */
function answerOf(question: AskQuestion, draft: Draft): string[] {
  const customText = draft.customText.trim()
  if (!question.multiSelect) return customText ? [customText] : draft.labels
  return customText ? [...draft.labels, customText] : draft.labels
}

const ANSWER_CONFLICT_MESSAGE = '이미 답했거나 서버가 질문을 놓쳤습니다. 터미널 탭에서 확인하세요'

/**
 * claude 의 AskUserQuestion 에 답하는 카드. 승인 막대 자리(대화와 입력칸 사이)에 뜬다.
 * 질문이 바뀌면 Chat 이 key 를 바꿔 상태를 새로 시작한다
 */
function QuestionCard({ sessionId, questions }: { sessionId: string; questions: AskQuestion[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ labels: [], customText: '' })))
  /** 미리보기용. 포커스한 선택지가 없으면 고른 선택지의 미리보기 */
  const [focusedOptionIndex, setFocusedOptionIndex] = useState<number | null>(null)
  /** sent 는 서버가 받았고 세션 목록에서 질문이 사라지기를 기다리는 중 */
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isBusy = sendState !== 'idle'
  const active = questions[activeIndex]
  const activeDraft = drafts[activeIndex]
  const isAllAnswered = drafts.every(isDraftAnswered)

  const focusedOption = focusedOptionIndex === null ? undefined : active.options[focusedOptionIndex]
  const previewOption = focusedOption?.preview ? focusedOption : active.options.find((option) => option.preview && activeDraft.labels.includes(option.label))

  function updateDraft(index: number, update: (draft: Draft) => Draft) {
    setDrafts((current) => current.map((draft, i) => (i === index ? update(draft) : draft)))
  }

  /** 단일 선택은 그 선택지 하나만 남기고 직접 입력을 비운다 (라디오처럼 둘 중 하나가 답). 여러 개 고르기는 켜고 끈다 */
  function chooseOption(label: string) {
    updateDraft(activeIndex, (draft) =>
      active.multiSelect
        ? { ...draft, labels: draft.labels.includes(label) ? draft.labels.filter((l) => l !== label) : [...draft.labels, label] }
        : { labels: [label], customText: '' },
    )
  }

  /** 단일 선택에서 글을 쓰면 그 글이 답이라 고른 선택지를 푼다 */
  function changeCustomText(customText: string) {
    updateDraft(activeIndex, (draft) => ({
      labels: active.multiSelect || !customText.trim() ? draft.labels : [],
      customText,
    }))
  }

  // 숫자 키로 지금 탭의 선택지를 고른다. 입력칸에 포커스가 있으면 글자로 둔다
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isBusy || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || !/^[1-9]$/.test(event.key)) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const option = active.options[Number(event.key) - 1]
      if (!option) return
      event.preventDefault()
      chooseOption(option.label)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function send(body: unknown) {
    setSendState('sending')
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.ok) {
        setSendState('sent')
        return
      }
      setErrorMessage(response.status === 409 ? ANSWER_CONFLICT_MESSAGE : `보내지 못했습니다 (HTTP ${response.status})`)
    } catch {
      setErrorMessage('보내지 못했습니다 (네트워크 오류)')
    }
    setSendState('idle')
  }

  function submit() {
    void send({ answers: Object.fromEntries(questions.map((question, i) => [question.question, answerOf(question, drafts[i])])) })
  }

  return (
    <div className="question-card" role="group" aria-label="claude 의 질문">
      {questions.length > 1 && (
        <div className="question-tabs" role="tablist">
          {questions.map((question, i) => {
            const isAnswered = isDraftAnswered(drafts[i])
            return (
              <button
                key={question.question}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                className={[i === activeIndex ? 'on' : '', isAnswered ? 'answered' : ''].join(' ')}
                title={isAnswered ? '답함' : '아직 안 답함'}
                onClick={() => {
                  setActiveIndex(i)
                  setFocusedOptionIndex(null)
                }}
              >
                <span className="tab-mark" aria-hidden="true">
                  {isAnswered ? '✓' : '○'}
                </span>
                {question.header}
              </button>
            )
          })}
        </div>
      )}
      <div className="question-body">
        <div className="question-head">
          {questions.length === 1 && <span className="question-chip">{active.header}</span>}
          <span className="question-mode">{active.multiSelect ? '여러 개 고르기' : '하나 고르기'}</span>
        </div>
        <div className="question-text">{active.question}</div>
        <div className="question-options">
          {active.options.map((option, i) => {
            const isSelected = activeDraft.labels.includes(option.label)
            return (
              <button
                key={option.label}
                type="button"
                className={`question-option${isSelected ? ' selected' : ''}${active.multiSelect ? ' multi' : ''}`}
                aria-pressed={isSelected}
                disabled={isBusy}
                onClick={() => chooseOption(option.label)}
                onFocus={() => setFocusedOptionIndex(i)}
                onBlur={() => setFocusedOptionIndex(null)}
              >
                <span className="option-key" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="option-body">
                  <span className="option-label">{option.label}</span>
                  {option.description && <span className="option-description">{option.description}</span>}
                </span>
              </button>
            )
          })}
        </div>
        {/* 미리보기는 글자 그대로 (HTML 로 꽂지 않는다) */}
        {previewOption && (
          <div className="question-preview">
            <div className="question-preview-label">미리보기 · {previewOption.label}</div>
            <pre>{previewOption.preview}</pre>
          </div>
        )}
        <textarea
          className="question-custom"
          value={activeDraft.customText}
          onChange={(e) => changeCustomText(e.target.value)}
          placeholder={active.multiSelect ? '직접 입력 (고른 것과 함께)' : '직접 입력 (쓰면 이 글이 답)'}
          rows={Math.min(Math.max(activeDraft.customText.split('\n').length, 1), 5)}
          disabled={isBusy}
        />
      </div>
      <div className="question-actions">
        {errorMessage && (
          <span className="question-error" role="alert">
            {errorMessage}
          </span>
        )}
        {sendState === 'sent' && <span className="question-status">보냈습니다</span>}
        <button type="button" className="primary" disabled={isBusy || !isAllAnswered} onClick={submit} title={isAllAnswered ? undefined : '모든 질문에 답해야 합니다'}>
          제출
        </button>
        <button type="button" disabled={isBusy} onClick={() => void send({ chat: true })}>
          대화로 답하기
        </button>
        <button type="button" disabled={isBusy} onClick={() => void send({ cancel: true })}>
          취소
        </button>
      </div>
    </div>
  )
}


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

export function Chat({ sessionId, isWritable, isApprovalNeeded, isWorking, workingSince, pendingTool, question, version, sessionNames }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pendings, setPendings] = useState<PendingMessage[]>([])
  /** 질문 중에는 입력칸을 막는다. 키 입력이 터미널의 질문 화면에 들어가면 Enter 가 1번 선택지로 답해 버린다. 쓰던 글은 남긴다 */
  const isAsking = Boolean(question) || pendingTool === ASK_TOOL
  const nextPendingIdRef = useRef(1)
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  /** 사용자가 맨 아래를 보고 있는지. 스크롤 때마다 갱신한다 (내용만 길어질 때는 스크롤 이벤트가 없어 직전 값이 남는다 = "갱신 직전에 맨 아래였는지") */
  const isAtBottomRef = useRef(true)
  /** 같은 값을 "맨 아래로" 버튼을 그리는 데 쓴다 */
  const [isAtBottom, setIsAtBottom] = useState(true)
  /** 위를 보는 사이 새 메시지가 왔는지. 버튼의 점 */
  const [hasUnread, setHasUnread] = useState(false)
  /** 세션을 열거나 바꾼 뒤 첫 로딩이면 위치와 관계없이 맨 아래에서 시작한다 */
  const isFirstLoadRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)

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

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ block: 'end' })
    isAtBottomRef.current = true
  }

  // 메시지가 갱신되면 맨 아래를 보고 있었을 때만 따라 내려간다 (위를 읽는 중이면 그대로 두고 새 메시지면 버튼에 점). 첫 로딩은 늘 맨 아래
  useEffect(() => {
    const lastMessageId = messages.at(-1)?.id ?? null
    const isNewMessage = lastMessageId !== lastMessageIdRef.current
    lastMessageIdRef.current = lastMessageId
    if (isFirstLoadRef.current || isAtBottomRef.current) {
      scrollToBottom()
      // 마운트 직후의 빈 목록은 첫 로딩이 아니다
      if (messages.length > 0) isFirstLoadRef.current = false
    } else if (isNewMessage) {
      setHasUnread(true)
    }
  }, [messages])

  useEffect(() => {
    setPendings((current) => settlePendings(current, messages))
  }, [messages])

  useEffect(() => {
    setPendings([])
    isFirstLoadRef.current = true
    isAtBottomRef.current = true
    setIsAtBottom(true)
    setHasUnread(false)
  }, [sessionId])

  // 작업 중 표시기도 같은 규칙: 맨 아래를 보고 있었을 때만 따라 내려간다
  useEffect(() => {
    if (isWorking && isAtBottomRef.current) scrollToBottom()
  }, [isWorking])

  function onMessagesScroll() {
    const element = messagesRef.current
    if (!element) return
    const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX
    isAtBottomRef.current = isNearBottom
    setIsAtBottom(isNearBottom)
    if (isNearBottom) setHasUnread(false)
  }

  function onToBottomClick() {
    const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: isReducedMotion ? 'auto' : 'smooth' })
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
    if (!text || isAsking) return
    setDraft('')
    // jsonl 에 남기까지(transcript 갱신 → 대화 전체 다시 받기) 기다리지 않고 내 말풍선을 바로 띄운다
    const pendingId = nextPendingIdRef.current++
    const knownIds = new Set(messages.map((message) => message.id))
    flushSync(() => setPendings((current) => [...current, { id: pendingId, text, knownIds, isFailed: false }]))
    scrollToBottom()
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
      <div className="messages-pane">
        <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>
          {messages.map((message) => {
            // 팀원 대화: 서버가 보낸 팀장·파트장 지시
            if (message.from) {
              return (
                <div key={message.id} className="msg user relay">
                  <div className="relay-label">{message.from.name} 지시</div>
                  <MarkdownText text={message.text} />
                </div>
              )
            }
            // 팀장 대화: 백그라운드로 넘어간 jk_wait 의 결과 알림
            const notified = message.role === 'system' ? waitReport(waitNotificationResult(message.text)) : null
            if (notified) {
              return (
                <div key={message.id} className="msg relay">
                  <div className="relay-label">{memberNameOf(notified.memberSessionId)} →</div>
                  <MarkdownText text={notified.result} />
                  <details className="tool">
                    <summary>
                      <code>task-notification</code> jk_wait 결과
                    </summary>
                    <pre className="result">{message.text}</pre>
                  </details>
                </div>
              )
            }
            // 팀장 대화의 지시·보고 도구 호출은 말풍선으로, AskUserQuestion 은 질문 → 답 카드로 빼고 원래 도구 블록은 그 안에 접어 둔다
            const relays = message.toolUses.map((toolUse) => ({ toolUse, relay: relayOf(toolUse, memberNameOf), asked: askedOf(toolUse) }))
            const plainToolUses = relays.filter(({ relay, asked }) => !relay && !asked).map(({ toolUse }) => toolUse)
            const isEmptyWithoutRelays = !message.text && plainToolUses.length === 0 && relays.length > 0
            return (
              <Fragment key={message.id}>
                {!isEmptyWithoutRelays && (
                  <div className={`msg ${message.role}${message.isQueued ? ' queued' : ''}`}>
                    {message.text &&
                      (message.role === 'assistant' ? (
                        <MarkdownText text={message.text} />
                      ) : (
                        <div className="text">{message.text}</div>
                      ))}
                    {plainToolUses.map((toolUse) => (
                      <ToolBlock key={toolUse.id} toolUse={toolUse} />
                    ))}
                    {message.isQueued && <div className="queued-label">대기 중</div>}
                  </div>
                )}
                {relays.map(({ toolUse, relay, asked }) =>
                  relay ? (
                    <div key={toolUse.id} className="msg relay">
                      <div className="relay-label">{relay.label}</div>
                      <MarkdownText text={relay.text} />
                      <ToolBlock toolUse={toolUse} />
                    </div>
                  ) : (
                    asked && <AskedCard key={toolUse.id} toolUse={toolUse} asked={asked} />
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
        {!isAtBottom && (
          <button
            type="button"
            className="to-bottom"
            onClick={onToBottomClick}
            title="맨 아래로"
            aria-label={hasUnread ? '맨 아래로 (새 메시지)' : '맨 아래로'}
          >
            ↓{hasUnread && <span className="to-bottom-dot" />}
          </button>
        )}
        <FilesButton key={sessionId} sessionId={sessionId} version={version} />
      </div>
      {question?.questions.length ? (
        <QuestionCard key={`${sessionId}:${question.questions.map((item) => item.question).join('\n')}`} sessionId={sessionId} questions={question.questions} />
      ) : (
        isWritable &&
        isApprovalNeeded &&
        // 질문에 Enter 는 1번 선택지로 답하고 Esc 는 작업을 멈추므로 승인 버튼을 주지 않는다 (서버가 질문을 놓쳤을 때. 서버 재시작 등)
        (pendingTool === ASK_TOOL ? (
          <div className="approval">질문에 답하려면 터미널 탭을 열어 주세요</div>
        ) : (
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
        ))
      )}
      {isWritable ? (
        <form className="composer" onSubmit={submit}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={isAsking ? '위 질문에 먼저 답해 주세요' : '지시를 입력하고 Enter (줄바꿈은 Shift+Enter)'}
            rows={Math.min(Math.max(draft.split('\n').length, 1), 8)}
            disabled={isAsking}
            autoFocus
          />
          <button type="submit" className="send" disabled={!draft.trim() || isAsking} aria-label="보내기" title="보내기 (Enter)">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M3 3.5 21.5 12 3 20.5 3 13.6 14 12 3 10.4Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      ) : (
        <p className="hint">터미널·IDE에서 띄운 세션이라 관찰만 가능합니다</p>
      )}
    </div>
  )
}
