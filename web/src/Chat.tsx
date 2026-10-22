import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { buildChatRows, type ChatRow, type Work } from './chatRows'
import { FilesButton } from './Files'
import { MarkdownText } from './Markdown'
import { NEWLINE_KEYS } from './Terminal'
import type { AskQuestion, ChatMessage, ToolUse } from './types'

/**
 * 대화를 불러온 뒤 찾아 갈 곳. 지시·보고 = 팀원 대화에서 글이 같은 메시지 (같은 글이 여럿이면 at 과 시각이 가장 가까운 것),
 * row = 팀장 대화의 지시·보고 한 줄 (돌아가기)
 */
export type JumpTarget = { kind: 'instruction' | 'report'; text: string; at: string } | { kind: 'row'; rowKey: string }

/** App 이 고른 세션의 Chat 에 넘기는 점프. Chat 이 그 세션 대화를 불러온 뒤 한 번 처리하고 onJumpHandled 를 부른다 */
export interface Jump {
  id: number
  target: JumpTarget
}

interface Props {
  sessionId: string
  /** 근무 중인 웹 세션만 true. 입력·승인·질문·제안·대기 취소는 이때만 (휴식·퇴근 세션 pty 에 키를 보내지 않게) */
  isWritable: boolean
  /** 입력할 수 없을 때 입력칸 자리에 둘 것 (휴식 안내·퇴근 버튼). 없으면 외부 세션 안내 */
  footer?: ReactNode
  isApprovalNeeded: boolean
  /** 훅 상태가 working 이면 대화 맨 아래에 작업 중 표시기 */
  isWorking: boolean
  workingSince: string | null
  pendingTool: string | null
  /** 서버가 붙잡고 있는 AskUserQuestion. 있으면 승인 막대 대신 질문 카드 */
  question: { questions: AskQuestion[] } | null
  /** 입력칸에 그려진 Claude Code 다음 입력 제안. 있으면 대화 오른쪽 아래 제안 버튼 + 말풍선 */
  suggestion: string | null
  /** 전역 SSE 의 transcript 이벤트로 올라가는 카운터. 바뀌면 다시 읽는다 */
  version: number
  /** 세션 ID → 화면 이름 (App 의 세션 목록). 팀원 이름 찾기와 지시·보고 한 줄을 눌렀을 때 그 팀원이 목록에 있는지 보는 데 쓴다 */
  sessionNames: Record<string, string>
  /** 이 세션 대화에서 찾아 갈 곳 (점프·돌아가기). 없으면 null */
  jump: Jump | null
  onJumpHandled: () => void
  /** 지시·보고 한 줄을 누름: 그 팀원 세션을 열고 target 으로 간다. rowKey 는 돌아올 때 찾을 이 줄 */
  onOpenRelay: (memberSessionId: string, target: JumpTarget, rowKey: string) => void
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
/**
 * 백그라운드 작업(명령·MCP 호출·에이전트·모니터)이 끝나면 오는 알림. 작업 중에 오면 system 메시지 글에 이 꼴로 들어 있다.
 * 120초를 넘긴 jk_wait 도 백그라운드로 넘어가 결과가 이 알림으로 온다
 */
const TASK_NOTIFICATION = /<task-notification>[\s\S]*?<\/task-notification>/g
const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
/** 알림 status → 한 줄 표시. 실제 jsonl 에 나온 값은 이 셋뿐이고 모니터 이벤트는 status 가 없다 */
const NOTIFICATION_STATUS_LABELS: Record<string, string> = { completed: '완료', failed: '실패', killed: '중단' }

interface TaskNotification {
  /** 원문 그대로 (펼치면 보인다) */
  raw: string
  status: string | null
  summary: string
  result: string | null
}

/** 알림 안의 태그 값. Claude Code 가 값 안의 `<`·`>` 를 엔티티로 바꿔 넣으므로 되돌린다 (한 번에 바꿔 `&amp;lt;` 가 두 번 풀리지 않게) */
function notificationField(raw: string, tag: string): string | null {
  const value = raw.match(new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`))?.[1]
  return value === undefined ? null : value.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity: string) => XML_ENTITIES[entity])
}

/** system 글을 알림과 그 앞뒤 글로 나눈다. 알림이 없으면 null */
function splitNotifications(text: string): (string | TaskNotification)[] | null {
  const parts: (string | TaskNotification)[] = []
  let end = 0
  for (const match of text.matchAll(TASK_NOTIFICATION)) {
    const before = text.slice(end, match.index).trim()
    if (before) parts.push(before)
    const raw = match[0]
    parts.push({ raw, status: notificationField(raw, 'status'), summary: notificationField(raw, 'summary') ?? '', result: notificationField(raw, 'result') })
    end = match.index + raw.length
  }
  if (end === 0) return null
  const after = text.slice(end).trim()
  if (after) parts.push(after)
  return parts
}

function isWaitNotification(notification: TaskNotification): boolean {
  return notification.status === 'completed' && notification.summary.includes('(jk-corp/jk_wait)')
}

/** jk_wait 결과의 task 가 null = 시간 안에 끝난 팀원이 없다 (기다릴 task 가 없을 때도 null 이지만 그건 바로 돌아와 백그라운드 알림이 되지 않는다) */
function isWaitTimeout(json: string | null): boolean {
  try {
    return json !== null && (JSON.parse(json) as { task?: unknown }).task === null
  } catch {
    return false
  }
}

/** "백그라운드 작업 완료 · MCP task … (jk-corp/jk_wait)". 요약 끝의 상태 낱말은 앞에서 한국어로 말했으니 뺀다 */
function notificationTitle(notification: TaskNotification): string {
  const { status, summary } = notification
  if (isWaitNotification(notification) && isWaitTimeout(notification.result)) return '팀원 결과 기다림 · 시간 초과'
  const heading = status ? `백그라운드 작업 ${NOTIFICATION_STATUS_LABELS[status] ?? status}` : '백그라운드 알림'
  const shortSummary = status && summary.endsWith(` ${status}.`) ? summary.slice(0, -(status.length + 2)) : summary
  return shortSummary ? `${heading} · ${shortSummary}` : heading
}

const COMPACT_SUMMARY_TITLE = '대화 압축됨 · 이전 대화를 요약해 이어감'
const INTERRUPT_TITLE = '중지됨'

/** 가운데 작은 한 줄 (보고 말풍선이 되지 않는 알림·대화 압축 요약). 원문은 접어 둔다 (글자 그대로. HTML 로 꽂지 않는다) */
function NoticeLine({ title, raw, isFailed = false }: { title: string; raw: string; isFailed?: boolean }) {
  return (
    <details className={`msg notice${isFailed ? ' failed' : ''}`}>
      <summary title={title}>{title}</summary>
      <pre>{raw}</pre>
    </details>
  )
}

/** 팀장↔팀원이 주고받은 글: 팀장 → 팀원 지시, 팀원 → 팀장 보고. 팀장 대화에는 한 줄로 보이고 누르면 그 팀원 대화의 그 메시지로 간다 */
interface Relay {
  kind: 'instruction' | 'report'
  /** 지시를 받은·보고한 팀원. 결과가 아직 없는 jk_spawn_member 면 null (세션이 아직 없다) */
  memberSessionId: string | null
  memberName: string
  text: string
  /** 지시 = 팀장이 도구를 부른 시각, 보고 = 팀원 task 가 끝난 시각. 줄에 보이고, 팀원 대화에 같은 글이 여럿이면 이것과 가장 가까운 것으로 간다 */
  at: string
}

/** jk_wait 결과 JSON 에서 팀원 보고. 해석 실패·시간 초과(task null)·결과 없음이면 null */
function waitReport(json: string): { memberSessionId: string; result: string; finishedAt: string | null } | null {
  try {
    const { task } = JSON.parse(json) as { task?: { memberSessionId?: unknown; result?: unknown; finishedAt?: unknown } | null }
    if (typeof task?.memberSessionId === 'string' && typeof task.result === 'string' && task.result) {
      return { memberSessionId: task.memberSessionId, result: task.result, finishedAt: typeof task.finishedAt === 'string' ? task.finishedAt : null }
    }
  } catch {
    // 지금처럼 도구 블록으로 둔다
  }
  return null
}

/** 보고 한 줄. task 가 끝난 시각이 없으면(옛 서버) 결과를 받은 메시지 시각 */
function reportRelay(report: NonNullable<ReturnType<typeof waitReport>>, receivedAt: string, memberNameOf: (sessionId: string) => string): Relay {
  return {
    kind: 'report',
    memberSessionId: report.memberSessionId,
    memberName: memberNameOf(report.memberSessionId),
    text: report.result,
    at: report.finishedAt ?? receivedAt,
  }
}

/** jk_spawn_member 결과의 새 팀원: 첫 sessionId 와 서버가 붙인 이름 member.name (role 로 만들면 입력에 이름이 없다) */
function spawnedMember(toolUse: ToolUse): { sessionId: string; name: string | null } | null {
  const sessionId = toolUse.result?.match(SPAWNED_SESSION_ID)?.[1]
  if (!sessionId) return null
  try {
    const { member } = JSON.parse(toolUse.result ?? '') as { member?: { name?: unknown } }
    return { sessionId, name: typeof member?.name === 'string' ? member.name : null }
  } catch {
    return { sessionId, name: null }
  }
}

/** 팀장 대화의 jk 도구 호출을 지시·보고 한 줄로. 실패한 지시(결과가 JSON 이 아닌 오류 글)·jk_status·jk_dismiss 는 null */
function relayOf(toolUse: ToolUse, message: ChatMessage, memberNameOf: (sessionId: string) => string): Relay | null {
  const input = (toolUse.input ?? {}) as { name?: unknown; role?: unknown; sessionId?: unknown; instruction?: unknown }
  const isDelivered = toolUse.result === null || toolUse.result.startsWith('{')
  if (typeof input.instruction === 'string' && input.instruction && isDelivered) {
    const instruction = { kind: 'instruction', text: input.instruction, at: message.timestamp } as const
    if (toolUse.name === SPAWN_TOOL) {
      const memberSessionId = spawnedMember(toolUse)?.sessionId ?? null
      if (memberSessionId) return { ...instruction, memberSessionId, memberName: memberNameOf(memberSessionId) }
      // 결과(새 세션)가 오기 전: 팀장이 준 이름, role 로 만들면 "[역할]"
      const pendingName = typeof input.name === 'string' ? input.name : typeof input.role === 'string' ? `[${input.role}]` : null
      if (pendingName) return { ...instruction, memberSessionId: null, memberName: pendingName }
    }
    if (toolUse.name === ASSIGN_TOOL && typeof input.sessionId === 'string') {
      return { ...instruction, memberSessionId: input.sessionId, memberName: memberNameOf(input.sessionId) }
    }
  }
  if (toolUse.name === WAIT_TOOL && toolUse.result) {
    const report = waitReport(toolUse.result)
    if (report) return reportRelay(report, message.timestamp, memberNameOf)
  }
  return null
}

/** 한 줄 툴팁에 보이는 내용 앞부분 (빈 줄 뺀 줄 수·줄마다 글자 수) */
const RELAY_PREVIEW_LINES = 6
const RELAY_PREVIEW_LINE_CHARS = 100

function relayPreview(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim())
  const shown = lines
    .slice(0, RELAY_PREVIEW_LINES)
    .map((line) => (line.length > RELAY_PREVIEW_LINE_CHARS ? `${line.slice(0, RELAY_PREVIEW_LINE_CHARS)}…` : line))
  return lines.length > RELAY_PREVIEW_LINES ? [...shown, '…'].join('\n') : shown.join('\n')
}

/** 한 줄의 시각 "10:12". 오늘이 아니면 "10/21 10:12" */
function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

/**
 * 팀장 대화의 지시·보고 한 줄 "→ [FE] Park 에게 지시함 · 10:12"·"[FE] Park 에게서 보고받음 · 10:30". 내용은 툴팁(앞부분)만.
 * 누르면 그 팀원 대화의 그 메시지로 간다. 팀원 세션이 아직 없으면(spawn 결과 전) 누를 수 없다
 */
function RelayLine({ relay, jumpKey, isHighlighted, onOpen }: { relay: Relay; jumpKey: string; isHighlighted: boolean; onOpen: () => void }) {
  const label = relay.kind === 'instruction' ? `→ ${relay.memberName} 에게 지시함` : `${relay.memberName} 에게서 보고받음`
  const clock = formatClock(relay.at)
  return (
    <button
      type="button"
      className={`relay-line${isHighlighted ? ' jump-highlight' : ''}`}
      data-jump-key={jumpKey}
      title={relay.memberSessionId ? relayPreview(relay.text) : '팀원 세션을 만드는 중'}
      disabled={!relay.memberSessionId}
      onClick={onOpen}
    >
      {clock ? `${label} · ${clock}` : label}
    </button>
  )
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

/** 작업 묶음에 넣지 않고 그 자리에 두는 도구 호출: 팀장↔팀원 말풍선, 질문 → 답 카드 */
type Special = { kind: 'relay'; relay: Relay } | { kind: 'asked'; asked: Asked }

/** 묶음 줄에 이름별 개수를 보여 주는 도구 수 (많은 순). 나머지는 전체 개수에만 든다 */
const WORK_TOOL_NAMES_SHOWN = 3

/** 묶음 줄의 도구 이름. MCP 도구 `mcp__<서버>__<도구>` 는 백그라운드 알림 요약과 같은 `<서버>/<도구>` 로 줄인다 */
function shortToolName(name: string): string {
  const match = name.match(/^mcp__(.+?)__(.+)$/)
  return match ? `${match[1]}/${match[2]}` : name
}

/** "작업 14개 · Bash 6 · Read 5 · Edit 3 · 2분 10초". 시간은 1초 미만이면 뺀다 */
function workTitle(work: Work): string {
  const counts = work.toolCounts.slice(0, WORK_TOOL_NAMES_SHOWN).map(({ name, count }) => `${shortToolName(name)} ${count}`)
  const duration = work.durationMs >= 1000 ? [formatDuration(work.durationMs)] : []
  return [`작업 ${work.toolCount}개`, ...counts, ...duration].join(' · ')
}

/**
 * 묶음 안 claude 메시지 말풍선들: 설명 글(마크다운)·도구 줄을 시간 순서대로.
 * 설명 글이 있는 말풍선은 점프로 찾아 갈 수 있다 (data-jump-key = 메시지 ID. 글 없는 것은 답변 말풍선과 ID 가 겹쳐 빼고)
 */
function WorkParts({ work, highlightKey }: { work: Work; highlightKey: string | null }) {
  return (
    <>
      {work.parts.map((part) => (
        <div
          key={part.message.id}
          className={`msg assistant${part.text && highlightKey === part.message.id ? ' jump-highlight' : ''}`}
          data-jump-key={part.text ? part.message.id : undefined}
        >
          {part.text && <MarkdownText text={part.text} />}
          {part.toolUses.map((toolUse) => (
            <ToolBlock key={toolUse.id} toolUse={toolUse} />
          ))}
        </div>
      ))}
    </>
  )
}

/**
 * 답변 전 작업 묶음. 끝난 묶음은 한 줄이고 누르면 아래에 말풍선들이 펼쳐진다. 접혀 있으면 안쪽을 그리지 않는다 (마크다운 파싱을 피하려고).
 * 아직 안 끝난 묶음(진행 중)은 접지 않고 말풍선들을 대화처럼 그대로 둔다 (진행 중 표시는 대화 맨 아래 작업 중 표시기 하나)
 */
function WorkLine({ work, isOpen, onToggle, highlightKey }: { work: Work; isOpen: boolean; onToggle: () => void; highlightKey: string | null }) {
  if (work.isInProgress) return <WorkParts work={work} highlightKey={highlightKey} />
  const title = workTitle(work)
  return (
    <div className="work">
      <button type="button" className="work-summary" aria-expanded={isOpen} onClick={onToggle} title={title}>
        {title}
      </button>
      {isOpen && (
        <div className="work-items">
          <WorkParts work={work} highlightKey={highlightKey} />
        </div>
      )}
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

/**
 * 메신저의 "입력 중…" 같은 작업 중 표시기. 1초 타이머가 이 컴포넌트만 다시 그리게 따로 둔다 (대화 전체 마크다운 파싱을 피하려고).
 * onInterrupt 가 있으면 옆에 [중지] (누른 뒤 서버 결과가 올 때까지 "중지 중…")
 */
function WorkingIndicator({
  since,
  onInterrupt,
  isInterrupting,
}: {
  since: string | null
  onInterrupt: (() => void) | null
  isInterrupting: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return (
    <div className="typing-row">
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
      {onInterrupt && (
        <button type="button" className="interrupt" disabled={isInterrupting} onClick={onInterrupt} title="claude 의 작업을 멈춘다 (터미널의 Esc 와 같다)">
          {isInterrupting ? '중지 중…' : '중지'}
        </button>
      )}
    </div>
  )
}

/** 맨 아래에서 이만큼 안쪽이면 "맨 아래를 보고 있다" 로 본다 */
const BOTTOM_SLACK_PX = 40

/** 터치 기기(마우스 없음). style.css 의 터치 기기 스타일과 같은 기준. 이 기기에서는 세션을 열 때 입력칸에 포커스하지 않는다 (가상 키보드가 바로 떠 대화를 가린다) */
const TOUCH_QUERY = '(hover: none)'

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

/** 대기 메시지 취소 결과 (서버 outcome) → 대화 맨 아래 한 줄 */
const CANCEL_OUTCOME_LABELS: Record<string, string> = {
  cancelled: '취소됨',
  accepted: '이미 claude 가 받음',
  stuck: '취소 못 함: 터미널 탭에서 확인',
  failed: '실패: 터미널 탭에서 확인',
}
/** 취소 결과 한 줄을 보여 주는 시간 */
const CANCEL_NOTICE_MS = 6_000

/** 중지 결과 (서버 outcome) → 대화 맨 아래 한 줄. 멈춘 것(stopped)은 대화의 "중지됨" 줄과 표시기가 사라지는 것으로 충분해 알리지 않는다 */
const INTERRUPT_OUTCOME_LABELS: Record<string, string | null> = {
  stopped: null,
  continued: '중지됨 · 대기 중이던 메시지를 이어서 처리합니다',
  restored: '중지됨 · 응답 전이라 보낸 글이 claude 입력칸에 남음 (다음 글과 이어 붙음): 터미널 탭에서 확인',
  unknown: '중지 못 했을 수 있음: 터미널 탭에서 확인',
}
/** 중지 결과 한 줄을 보여 주는 시간. 입력칸에 남은 글 안내는 읽을 시간이 더 필요하다 */
const INTERRUPT_NOTICE_MS = 10_000
/** "중지 중…" 을 [중지] 로 되돌리기까지 (서버가 결말을 최대 3초 기다리므로 그보다 길게) */
const INTERRUPT_STUCK_MS = 8_000

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

/** 점프로 찾아 간 줄을 강조하는 시간 (style.css 의 jump-flash 와 같은 길이) */
const JUMP_HIGHLIGHT_MS = 2_000
/** 점프 실패 한 줄("해당 메시지를 찾지 못함" 등)을 보여 주는 시간 */
const JUMP_NOTICE_MS = 6_000

/**
 * 팀원 대화에서 지시·보고와 글이 같은 메시지 (비교는 messageKey). 지시 = 서버가 from 을 붙인 user 메시지, 보고 = claude 글.
 * 여럿이면 시각이 at 과 가장 가까운 것. key 는 그 말풍선의 data-jump-key, 접힌 작업 묶음 안(설명 글)이면 workKey 가 그 묶음
 */
function findMessageTarget(
  target: { kind: 'instruction' | 'report'; text: string; at: string },
  messages: ChatMessage[],
  rows: ChatRow<unknown>[],
): { key: string; workKey: string | null } | null {
  const key = messageKey(target.text)
  if (!key) return null
  const candidates = messages.filter(
    (message) =>
      (target.kind === 'instruction' ? message.role === 'user' && message.from : message.role === 'assistant') && messageKey(message.text) === key,
  )
  if (candidates.length === 0) return null
  const at = Date.parse(target.at)
  const distance = (message: ChatMessage) => Math.abs(Date.parse(message.timestamp) - at)
  // 시각을 못 읽으면(NaN) 비교가 늘 거짓이라 처음 것
  const found = candidates.reduce((best, message) => (distance(message) < distance(best) ? message : best))
  const work = rows.find((row) => row.kind === 'work' && row.work.parts.some((part) => part.message === found && part.text !== null))
  return { key: found.id, workKey: work?.kind === 'work' ? work.work.key : null }
}

export function Chat({
  sessionId,
  isWritable,
  footer,
  isApprovalNeeded,
  isWorking,
  workingSince,
  pendingTool,
  question,
  suggestion,
  version,
  sessionNames,
  jump,
  onJumpHandled,
  onOpenRelay,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  /** messages 가 어느 세션 것인지. 세션을 바꾼 뒤 새 대화가 오기 전까지는 앞 세션 것이 남아 있어 점프는 이것이 맞을 때만 처리한다 */
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  /** 점프로 찾아 간 줄의 data-jump-key. JUMP_HIGHLIGHT_MS 동안 강조하고, 바뀔 때마다 그 줄로 스크롤한다 (id 는 같은 줄로 다시 갈 때도 새로 하려고) */
  const [highlight, setHighlight] = useState<{ key: string; id: number } | null>(null)
  /** 점프한 곳을 찾지 못함. 대화 맨 아래 한 줄 */
  const [jumpNotice, setJumpNotice] = useState<string | null>(null)
  /** 지시·보고 한 줄 바로 아래 알림 (그 팀원이 세션 목록에 없을 때) */
  const [lineNotice, setLineNotice] = useState<{ rowKey: string; text: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [pendings, setPendings] = useState<PendingMessage[]>([])
  /** 질문 중에는 입력칸을 막는다. 키 입력이 터미널의 질문 화면에 들어가면 Enter 가 1번 선택지로 답해 버린다. 쓰던 글은 남긴다 */
  const isAsking = Boolean(question) || pendingTool === ASK_TOOL
  /**
   * 제안 버튼·말풍선: Claude Code 가 빈 입력칸에 제안을 그리는 때와 같게 (작업·승인 대기·질문 중이 아니고 입력칸이 비었을 때).
   * 막 보낸 말이 아직 확인 전이면 mod 가 보낸 null 이 반영되기 전일 수 있어 숨긴다 (전송 실패는 입력이 안 갔으니 그대로)
   */
  const isSuggestionShown =
    Boolean(suggestion) &&
    isWritable &&
    !isWorking &&
    !isApprovalNeeded &&
    !isAsking &&
    draft === '' &&
    pendings.every((pending) => pending.isFailed)
  /** [취소] 를 누른 대기 메시지 ID. 서버가 결과를 줄 때까지 버튼이 "취소 중…" */
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  /** 대기 메시지 취소 결과 한 줄. CANCEL_NOTICE_MS 뒤 사라진다 */
  const [cancelNotice, setCancelNotice] = useState<string | null>(null)
  /** 응답이 왔을 때 아직 같은 세션을 보고 있는지 보려고 */
  const sessionIdRef = useRef(sessionId)
  /**
   * [취소] 는 맨 마지막 "대기 중" 말풍선에만 (Claude Code 는 대기열을 전부 꺼내는 방법만 있어 서버가 나머지를 다시 넣는다).
   * claude 가 작업 중이고 승인 대기·질문 중이 아닐 때만 (서버도 다시 확인한다)
   */
  const lastQueuedId = useMemo(() => [...messages].reverse().find((m) => m.isQueued && m.role === 'user' && !m.from)?.id ?? null, [messages])
  const canCancelQueued = isWritable && isWorking && !isApprovalNeeded && !isAsking
  /** 작업 중 표시기 옆 [중지]. 대기 메시지 취소와 같은 조건 (승인 대기·질문 중 Esc 는 도구 거부·질문 거절이 된다. 서버도 다시 확인한다) */
  const canInterrupt = isWritable && isWorking && !isApprovalNeeded && !isAsking
  /** [중지] 를 누른 뒤 "중지 중…". 멈췄으면 표시기가 사라질 때까지 둔다 */
  const [isInterrupting, setIsInterrupting] = useState(false)
  /** 중지 결과·실패 한 줄. INTERRUPT_NOTICE_MS 뒤 사라진다 */
  const [interruptNotice, setInterruptNotice] = useState<string | null>(null)
  const nextPendingIdRef = useRef(1)
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  /** 사용자가 맨 아래를 보고 있는지. 스크롤 때마다 갱신한다 (내용만 길어질 때는 스크롤 이벤트가 없어 직전 값이 남는다 = "갱신 직전에 맨 아래였는지") */
  const isAtBottomRef = useRef(true)
  /** 같은 값을 "맨 아래로" 버튼을 그리는 데 쓴다 */
  const [isAtBottom, setIsAtBottom] = useState(true)
  /** 위를 보는 사이 새 메시지가 왔는지. 버튼의 점 */
  const [hasUnread, setHasUnread] = useState(false)
  /** 세션을 열거나 바꾼 뒤 첫 로딩이면 위치와 관계없이 맨 아래에서 시작한다 */
  const isFirstLoadRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)

  /** 팀원 이름: jk_spawn_member 때 붙인 이름(서버가 붙인 member.name, 없으면 팀장이 준 name) → 세션 목록 이름 → ID 앞 8자리 */
  const memberNameOf = useMemo(() => {
    const spawnedNames = new Map<string, string>()
    for (const message of messages) {
      for (const toolUse of message.toolUses) {
        if (toolUse.name !== SPAWN_TOOL) continue
        const inputName = (toolUse.input as { name?: unknown } | null)?.name
        const spawned = spawnedMember(toolUse)
        const name = spawned?.name ?? (typeof inputName === 'string' ? inputName : null)
        if (spawned && name) spawnedNames.set(spawned.sessionId, name)
      }
    }
    return (id: string) => spawnedNames.get(id) ?? sessionNames[id] ?? id.slice(0, 8)
  }, [messages, sessionNames])

  /**
   * 화면 줄: 구간마다 claude 의 중간 설명 글·일반 도구 호출을 작업 묶음으로 접고, relay 한 줄·질문 카드는 그 자리에 둔다.
   * 차례가 진행 중이면 맨 끝 묶음은 접지 않는다. 승인 대기도 진행 중이다 (승인 창이 뜰 때마다 접혔다 펼쳐지지 않게)
   */
  const isTurnInProgress = isWorking || isApprovalNeeded
  const rows = useMemo(
    () =>
      buildChatRows<Special>(
        messages,
        (toolUse, message) => {
          const relay = relayOf(toolUse, message, memberNameOf)
          if (relay) return { kind: 'relay', relay }
          const asked = askedOf(toolUse)
          return asked ? { kind: 'asked', asked } : null
        },
        isTurnInProgress,
      ),
    [messages, memberNameOf, isTurnInProgress],
  )
  /** 접지 않고 대화처럼 보이는 진행 중 묶음. 이게 바뀌면(접힘) 대화 길이가 갑자기 줄어든다 */
  const liveWorkRow = rows.find((row) => row.kind === 'work' && row.work.isInProgress)
  const liveWorkKey = liveWorkRow?.kind === 'work' ? liveWorkRow.work.key : null
  /** 펼친 작업 묶음 키 (Work.key). 몇 초마다 대화를 다시 받아도 접히지 않게 여기 둔다. 세션을 바꾸면 비운다 */
  const [openWorkKeys, setOpenWorkKeys] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let isCancelled = false
    fetch(`/api/sessions/${sessionId}/messages`)
      .then((r) => r.json())
      .then((data: ChatMessage[]) => {
        if (isCancelled) return
        setMessages(data)
        setLoadedSessionId(sessionId)
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
    sessionIdRef.current = sessionId
    setCancellingId(null)
    setCancelNotice(null)
    setIsInterrupting(false)
    setInterruptNotice(null)
    setPendings([])
    setOpenWorkKeys(new Set())
    setHighlight(null)
    setJumpNotice(null)
    setLineNotice(null)
    isFirstLoadRef.current = true
    isAtBottomRef.current = true
    setIsAtBottom(true)
    setHasUnread(false)
  }, [sessionId])

  // 작업 중 표시기도 같은 규칙: 맨 아래를 보고 있었을 때만 따라 내려간다
  useEffect(() => {
    if (isWorking && isAtBottomRef.current) scrollToBottom()
  }, [isWorking])

  // 진행 중 묶음이 접히면 대화가 갑자기 줄어든다 (스크롤 이벤트가 없을 수 있다). 그리기 전에, 맨 아래를 보고 있었으면 맨 아래에 두고
  // 위를 읽던 중이면 움직이지 않고 "맨 아래를 보고 있는지" 만 다시 잰다 (줄어든 만큼 맨 아래에 닿았을 수 있다)
  useLayoutEffect(() => {
    if (isAtBottomRef.current) scrollToBottom()
    else onMessagesScroll()
  }, [liveWorkKey])

  // 제안이 뜨면 대화 끝에 말풍선 자리(suggestion-space)가 생긴다. 맨 아래를 보고 있었으면 그 자리까지 내려 방금 끝난 응답 끝이 말풍선에 가리지 않게
  useEffect(() => {
    if (isSuggestionShown && isAtBottomRef.current) scrollToBottom()
  }, [isSuggestionShown])

  /** 점프한 곳을 못 찾으면 세션만 연 것으로 하고 맨 아래에서 알린다 */
  function showJumpMissing() {
    scrollToBottom()
    setJumpNotice('해당 메시지를 찾지 못함')
  }

  // 점프: 이 세션 대화를 불러온 뒤 한 번. 첫 로딩의 맨 아래 스크롤(위 효과) 다음에 돈다. 접힌 작업 묶음 안이면 펼치고, 스크롤·강조는 아래 효과가 한다
  useEffect(() => {
    if (!jump || loadedSessionId !== sessionId) return
    onJumpHandled()
    const { target } = jump
    const found = target.kind === 'row' ? { key: target.rowKey, workKey: null } : findMessageTarget(target, messages, rows)
    if (!found) {
      showJumpMissing()
      return
    }
    const { workKey } = found
    if (workKey) setOpenWorkKeys((current) => new Set(current).add(workKey))
    setHighlight({ key: found.key, id: jump.id })
  }, [jump, loadedSessionId, sessionId, messages, rows, onJumpHandled])

  // 강조할 줄이 정해지면 (펼친 묶음까지 그려진 뒤) 가운데로 스크롤하고, 그 위치를 "맨 아래를 보고 있는지" 에 반영한다 (다음 갱신에 끌려 내려가지 않게)
  useLayoutEffect(() => {
    if (!highlight) return
    const element = messagesRef.current?.querySelector(`[data-jump-key="${CSS.escape(highlight.key)}"]`)
    if (!element) {
      setHighlight(null)
      showJumpMissing()
      return
    }
    element.scrollIntoView({ block: 'center' })
    onMessagesScroll()
    const timer = setTimeout(() => setHighlight(null), JUMP_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight])

  // 못 찾음 알림은 맨 아래에 생긴다. 맨 아래로 내려 둔 뒤 생겨 가려지지 않게 한 번 더 내린다
  useEffect(() => {
    if (!jumpNotice) return
    if (isAtBottomRef.current) scrollToBottom()
    const timer = setTimeout(() => setJumpNotice(null), JUMP_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [jumpNotice])

  useEffect(() => {
    if (!lineNotice) return
    const timer = setTimeout(() => setLineNotice(null), JUMP_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [lineNotice])

  /** 지시·보고 한 줄을 눌렀다: 그 팀원 세션이 목록에 있으면(퇴근 포함) App 이 연다. 없으면(퇴근 기록까지 지워짐) 열지 않고 줄 아래에 알린다 */
  function openRelay(relay: Relay, rowKey: string) {
    const { memberSessionId } = relay
    if (!memberSessionId) return
    if (!Object.hasOwn(sessionNames, memberSessionId)) {
      setLineNotice({ rowKey, text: '세션 기록이 없어 열 수 없음' })
      return
    }
    setLineNotice(null)
    onOpenRelay(memberSessionId, { kind: relay.kind, text: relay.text, at: relay.at }, rowKey)
  }

  /** 지시·보고 한 줄과 그 아래 알림 */
  function renderRelayLine(relay: Relay, rowKey: string) {
    return (
      <Fragment key={rowKey}>
        <RelayLine relay={relay} jumpKey={rowKey} isHighlighted={highlight?.key === rowKey} onOpen={() => openRelay(relay, rowKey)} />
        {lineNotice?.rowKey === rowKey && (
          <div className="queue-notice" role="status">
            {lineNotice.text}
          </div>
        )}
      </Fragment>
    )
  }

  /** 점프로 찾아 간 말풍선이면 강조 클래스 */
  function highlightClass(key: string): string {
    return highlight?.key === key ? ' jump-highlight' : ''
  }

  function onMessagesScroll() {
    const element = messagesRef.current
    if (!element) return
    const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX
    isAtBottomRef.current = isNearBottom
    setIsAtBottom(isNearBottom)
    if (isNearBottom) setHasUnread(false)
  }

  function toggleWork(key: string) {
    flushSync(() =>
      setOpenWorkKeys((current) => {
        const next = new Set(current)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    )
    // 펼치면 내용만 길어지고 스크롤 이벤트가 없어 "맨 아래를 보고 있다" 가 남는다. 다음 갱신 때 펼친 것을 읽다 끌려 내려가지 않게 다시 잰다
    onMessagesScroll()
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

  useEffect(() => {
    if (!cancelNotice) return
    const timer = setTimeout(() => setCancelNotice(null), CANCEL_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [cancelNotice])

  // 작업이 끝나면 "중지 중…" 도 끝. 멈췄다는데 상태가 안 바뀌면(그 사이 새 차례가 시작됨) 잠시 뒤 [중지] 로 되돌린다
  useEffect(() => {
    if (!isWorking) setIsInterrupting(false)
  }, [isWorking])
  useEffect(() => {
    if (!isInterrupting) return
    const timer = setTimeout(() => setIsInterrupting(false), INTERRUPT_STUCK_MS)
    return () => clearTimeout(timer)
  }, [isInterrupting])

  useEffect(() => {
    if (!interruptNotice) return
    const timer = setTimeout(() => setInterruptNotice(null), INTERRUPT_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [interruptNotice])

  /** 작업 중인 claude 를 멈춘다. 서버가 Esc 를 보내고 jsonl 로 결말을 확인해 준다 (최대 몇 초). 확인 창 없음 */
  async function interrupt() {
    const requestSessionId = sessionId
    setIsInterrupting(true)
    setInterruptNotice(null)
    let notice: string | null
    let isStopped = false
    try {
      const response = await fetch(`/api/sessions/${sessionId}/interrupt`, { method: 'POST' })
      const body = (await response.json().catch(() => ({}))) as { outcome?: string; message?: string }
      const outcome = body.outcome ?? ''
      isStopped = response.ok && (outcome === 'stopped' || outcome === 'restored')
      // stopped 의 null(알리지 않음)이 ?? 로 unknown 문구가 되지 않게 키가 있는지로 본다
      notice = response.ok
        ? Object.hasOwn(INTERRUPT_OUTCOME_LABELS, outcome)
          ? INTERRUPT_OUTCOME_LABELS[outcome]
          : INTERRUPT_OUTCOME_LABELS.unknown
        : `중지 못 함: ${body.message ?? `HTTP ${response.status}`}`
    } catch {
      notice = '중지 실패: 네트워크 오류'
    }
    if (sessionIdRef.current !== requestSessionId) return
    // 멈췄으면 서버가 바꾼 상태가 와서 표시기가 사라질 때까지 "중지 중…" 그대로 (응답과 상태 갱신 사이에 [중지] 가 깜박이지 않게)
    if (!isStopped) setIsInterrupting(false)
    setInterruptNotice(notice)
  }

  /** 마지막 대기 메시지를 Claude Code 대기열에서 뺀다. 서버가 ↑ 로 전부 꺼내고 나머지를 다시 넣은 뒤 결과를 준다 (몇 초 걸린다) */
  async function cancelQueued(message: ChatMessage) {
    const requestSessionId = sessionId
    setCancellingId(message.id)
    setCancelNotice(null)
    let notice: string
    try {
      const response = await fetch(`/api/sessions/${sessionId}/queue/cancel-last`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text }),
      })
      const body = (await response.json().catch(() => ({}))) as { outcome?: string; message?: string }
      notice = response.ok
        ? (CANCEL_OUTCOME_LABELS[body.outcome ?? ''] ?? CANCEL_OUTCOME_LABELS.failed)
        : `취소 못 함: ${body.message ?? `HTTP ${response.status}`}`
    } catch {
      notice = '실패: 네트워크 오류'
    }
    if (sessionIdRef.current !== requestSessionId) return
    setCancellingId(null)
    setCancelNotice(notice)
  }

  /** 제안을 입력칸에 채우고 커서를 끝에 둔다. 보내지 않는다 (사람이 확인하고 Enter) */
  function fillSuggestion() {
    if (!suggestion) return
    flushSync(() => setDraft(suggestion))
    const textarea = composerRef.current
    textarea?.focus()
    textarea?.setSelectionRange(suggestion.length, suggestion.length)
  }

  /**
   * Enter = 보내기, Shift+Enter = 줄바꿈. 한글 조합 중 Enter 는 조합 확정이라 보내지 않는다.
   * 제안이 보이면 (= 빈 입력칸) Tab = 제안 채우기. 그 밖의 Tab 은 기본 동작(포커스 이동)
   */
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isPlainTab = event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    if (isPlainTab && isSuggestionShown && !event.nativeEvent.isComposing) {
      event.preventDefault()
      fillSuggestion()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <div className="chat">
      <div className="messages-pane">
        <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>
          {rows.map((row) => {
            if (row.kind === 'work') {
              const { work } = row
              return (
                <WorkLine
                  key={`work:${work.key}`}
                  work={work}
                  isOpen={openWorkKeys.has(work.key)}
                  onToggle={() => toggleWork(work.key)}
                  highlightKey={highlight?.key ?? null}
                />
              )
            }
            // claude 답변 (구간의 마지막 글. 도구 없는 구간이면 글마다)
            if (row.kind === 'text') {
              return (
                <div key={row.message.id} className={`msg assistant${highlightClass(row.message.id)}`} data-jump-key={row.message.id}>
                  <MarkdownText text={row.message.text} />
                </div>
              )
            }
            // 팀장 대화의 지시·보고 도구 호출은 한 줄로 (내용은 팀원 대화에서 본다), AskUserQuestion 은 질문 → 답 카드로 (원래 도구 블록은 그 안에 접어 둔다)
            if (row.kind === 'special') {
              const { toolUse, special } = row
              return special.kind === 'relay' ? (
                renderRelayLine(special.relay, `relay:${toolUse.id}`)
              ) : (
                <AskedCard key={toolUse.id} toolUse={toolUse} asked={special.asked} />
              )
            }
            const { message } = row
            // 팀원 대화: 서버가 보낸 팀장·파트장 지시 (전문)
            if (message.from) {
              return (
                <div key={message.id} className={`msg user relay${highlightClass(message.id)}`} data-jump-key={message.id}>
                  <div className="relay-label">{message.from.name} 지시</div>
                  <MarkdownText text={message.text} />
                </div>
              )
            }
            // 대화 압축 요약: 사람 말이 아니라 한 줄. 요약 원문은 접어 둔다
            if (message.isCompactSummary) return <NoticeLine key={message.id} title={COMPACT_SUMMARY_TITLE} raw={message.text} />
            // 중지(Esc) 기록: 사람 말이 아니라 한 줄. 원문은 접어 둔다
            if (message.isInterrupt) return <NoticeLine key={message.id} title={INTERRUPT_TITLE} raw={message.text} />
            // 백그라운드 작업 알림: 팀장 대화의 jk_wait 팀원 보고는 보고 한 줄, 그 밖은 알림마다 한 줄. 알림 앞뒤 글은 system 글 그대로
            const parts = message.role === 'system' ? splitNotifications(message.text) : null
            if (parts) {
              return (
                <Fragment key={message.id}>
                  {parts.map((part, index) => {
                    const key = `${message.id}:${index}`
                    if (typeof part === 'string') {
                      return (
                        <div key={key} className="msg system">
                          <div className="text">{part}</div>
                        </div>
                      )
                    }
                    const report = isWaitNotification(part) ? waitReport(part.result ?? '') : null
                    if (!report) return <NoticeLine key={key} title={notificationTitle(part)} raw={part.raw} isFailed={part.status === 'failed'} />
                    return renderRelayLine(reportRelay(report, message.timestamp, memberNameOf), `relay:${key}`)
                  })}
                </Fragment>
              )
            }
            // 사람 쪽 말·system 글 (도구 호출은 claude 메시지에만 있다)
            return (
              <div key={message.id} className={`msg ${message.role}${message.isQueued ? ' queued' : ''}`}>
                {message.text && <div className="text">{message.text}</div>}
                {message.isQueued && (
                  <div className="queued-label">
                    대기 중
                    {message.id === lastQueuedId && canCancelQueued && (
                      <button
                        type="button"
                        className="queued-cancel"
                        disabled={cancellingId !== null}
                        onClick={() => void cancelQueued(message)}
                        title="claude 가 받기 전에 이 메시지를 대기열에서 뺀다"
                      >
                        {cancellingId === message.id ? '취소 중…' : '취소'}
                      </button>
                    )}
                  </div>
                )}
              </div>
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
          {cancelNotice && (
            <div className="queue-notice" role="status">
              대기 메시지 · {cancelNotice}
            </div>
          )}
          {interruptNotice && (
            <div className="queue-notice" role="status">
              {interruptNotice}
            </div>
          )}
          {jumpNotice && (
            <div className="queue-notice" role="status">
              {jumpNotice}
            </div>
          )}
          {messages.length === 0 && pendings.length === 0 && <p className="hint">아직 대화가 없습니다</p>}
          {isWorking && (
            <WorkingIndicator
              since={workingSince}
              onInterrupt={canInterrupt ? () => void interrupt() : null}
              isInterrupting={isInterrupting}
            />
          )}
          {/* 맨 아래로 내렸을 때 마지막 글이 제안 말풍선 위에 오게 비워 두는 자리. bottomRef 앞이라 scrollToBottom 이 여기까지 보여 준다 */}
          {isSuggestionShown && <div className="suggestion-space" aria-hidden="true" />}
          <div ref={bottomRef} />
        </div>
        {/* 오른쪽 아래 원 버튼 묶음. 화면에서는 아래부터 제안 → 폴더 → "↓" 로 쌓인다 */}
        <div className="pane-buttons">
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
          {isSuggestionShown && (
            <button type="button" className="suggestion" onClick={fillSuggestion} title={suggestion ?? undefined} aria-label={`제안을 입력칸에 채우기: ${suggestion}`}>
              <span className="suggestion-bubble">
                <span className="suggestion-text">{suggestion}</span>
                <kbd className="suggestion-key">Tab</kbd>
              </span>
              <span className="suggestion-icon" aria-hidden="true">
                ✦
              </span>
            </button>
          )}
        </div>
      </div>
      {isWritable && question?.questions.length ? (
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
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={isAsking ? '위 질문에 먼저 답해 주세요' : '지시를 입력하고 Enter (줄바꿈은 Shift+Enter)'}
            rows={Math.min(Math.max(draft.split('\n').length, 1), 8)}
            disabled={isAsking}
            autoFocus={!window.matchMedia(TOUCH_QUERY).matches}
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
        (footer ?? <p className="hint">터미널·IDE에서 띄운 세션이라 관찰만 가능합니다</p>)
      )}
    </div>
  )
}
