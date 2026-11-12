import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { buildChatRows, hidingWorkKey, rowIndexOfJumpKey, rowKeyOf, type ChatRow, type Work } from './chatRows'
import { reuseMessages, reuseRows } from './chatReuse'
import { loadMessages, type HeldMessages } from './chatDelta'
import { expandedStartIndex, resolveStartIndex, startIndexRevealing, windowStartAt, type WindowStart } from './chatWindow'
import { ChatSearch } from './ChatSearchBar'
import type { SearchTarget } from './chatSearch'
import { Composer, QuoteIcon, type ComposerHandle } from './Composer'
import { restoreToComposerDraft } from './composerDraft'
import { handoverBandText, isSuggestionVisible } from './composerText'
import { BtwCard, type BtwCardHandle } from './BtwCard'
import { ChatImageSession } from './ChatImage'
import { runningToolNames, shortToolName } from './runningTools'
import { isTeamWaitSummary, teamToolOf } from './teamTools'
import { FilesButton } from './Files'
import { CopyButton } from './CopyButton'
import { isMarkableMessage, withMark, withoutMark, type ChatMark } from './chatMarks'
import { MarkButton, MarksButton } from './MarksButton'
import { MarkdownText } from './Markdown'
import { PositionChip } from './PositionChip'
import { memberOf as memberDisplay } from './sessionPosition'
import { formatElapsed, ShellsButton, type ShellRequest } from './Shells'
import type { AskQuestion, ChatMessage, Shell, ToolUse } from './types'
import { isWorkOpen, type ChatStyle } from './appearance'
import { appearance, subscribeTheme } from './theme'

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
  /** 입력 상자 오른쪽 아래에 보일 문맥 크기 ("143k"; level 은 색, title 은 툴팁·aria-label). 없으면 그 부분 없음 */
  contextSize?: { text: string; level: string; title: string } | null
  /** Hand over 할 수 있는 지시자(handOver.ts)면 문맥 크기가 버튼이 되고 누르면 이것 (새 지시자 창). 툴팁 둘째 줄은 `handOverTitle` */
  onHandOver?: (() => void) | null
  handOverTitle?: string | null
  /** 문맥 크기 옆 마지막 차례 캐시율 ("95% cached"; title 은 툴팁·aria-label). 없으면 그 부분 없음 */
  turnCache?: { text: string; title: string } | null
  /** 입력 상자 오른쪽 아래에 문맥 크기 옆으로 보일 모델·effort ("Opus 5.5 · xhigh"). 누르면 `onChangeModel` */
  modelText?: string | null
  /** 모델 버튼 툴팁 첫 줄의 모델 ID ("claude-opus-5-5") */
  modelFullName?: string | null
  /** 다음에 뜰 때 쓸 모델·effort 가 지금과 다르면 그 글 ("Sonnet · high"). 버튼 글 뒤 " → …" */
  modelNextText?: string | null
  /** 모델·effort 를 바꿔 다시 띄우는 중이면 버튼 대신 "Restarting…" */
  isModelRestarting?: boolean
  /** 모델 버튼을 누르면 모델·effort 변경 창을 연다 */
  onChangeModel?: () => void
  isApprovalNeeded: boolean
  /** 훅 상태가 working 이면 대화 맨 아래에 작업 중 표시기 */
  isWorking: boolean
  workingSince: string | null
  pendingTool: string | null
  /** 서버가 붙잡고 있는 AskUserQuestion. 있으면 승인 막대 대신 질문 카드 */
  question: { questions: AskQuestion[] } | null
  /** 입력칸에 그려진 Claude Code 다음 입력 제안. 있으면 입력 상자의 빈 입력칸에 흐린 글 + Tab 칩 */
  suggestion: string | null
  /** 인계 중이면 직전 지시자 이름 (Hand over 로 띄운 새 지시자가 인계 글에 답하기 전). 입력 상자·곁가지 질문을 막고 상자 위에 띠를 띄운다 */
  handoverFrom: string | null
  /** 전역 SSE 의 transcript 이벤트로 올라가는 카운터. 바뀌면 다시 읽는다 */
  version: number
  /** 전역 SSE 의 btw 이벤트로 올라가는 카운터. 바뀌면 곁가지 질문 카드가 문답을 다시 받는다 */
  btwVersion: number
  /** 세션 ID → 화면 이름 (App 의 세션 목록). 팀원 이름 찾기와 지시·보고 한 줄을 눌렀을 때 그 팀원이 목록에 있는지 보는 데 쓴다 */
  sessionNames: Record<string, string>
  /** 세션 ID → 역할 (칩). 없거나 null 이면 칩 없이. 옛 서버 응답이면 이름 앞 "[역할]" 에서 읽는다 */
  sessionPositions?: Record<string, string | null>
  /** 이 세션 대화에서 찾아 갈 곳 (점프·돌아가기). 없으면 null */
  jump: Jump | null
  onJumpHandled: () => void
  /** 지시·보고 한 줄을 누름: 그 팀원 세션을 열고 target 으로 간다. rowKey 는 돌아올 때 찾을 이 줄 */
  onOpenRelay: (memberSessionId: string, target: JumpTarget, rowKey: string) => void
  /** 실행 중인 백그라운드 shell. 있으면 오른쪽 아래 버튼 묶음에 ">_" 버튼 */
  shells: Shell[]
  /** 상태 표시줄 Shells 창에서 고른 이 세션의 shell. ShellsButton 이 그 shell 을 고른 채 모달을 열고 onShellRequestHandled 로 비운다 */
  shellRequest: ShellRequest | null
  onShellRequestHandled: () => void
  /** 대화 맨 끝에 대기 중인 메시지가 있는지 알린다 (App 의 모델 변경 창이 Apply 를 막는 데 쓴다). 사라질 때 false */
  onQueuedChange?: (sessionId: string, hasQueuedMessage: boolean) => void
  /** 대화 안 검색 막대를 열었는지 (App 의 머리 돋보기 버튼·Ctrl+F). 열려 있는 동안 막대가 대화 위에 붙는다 */
  isSearchOpen: boolean
  /** 바뀔 때마다 이미 열려 있는 검색 막대의 입력칸에 포커스한다 */
  searchFocusId: number
  onSearchClose: () => void
  /** App 의 Ctrl+Shift+B 가 올리는 카운터. 바뀔 때마다 곁가지 질문 카드를 열고 카드 입력칸에 포커스한다 */
  btwOpenId: number
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  const key = ['command', 'file_path', 'pattern', 'description', 'prompt', 'url'].find((k) => typeof record[k] === 'string')
  const value = key ? String(record[key]) : ''
  return value.split('\n')[0].slice(0, 120) || name
}

/** 팀원 만들기(team_spawn_member·옛 jk_spawn_member) 결과의 첫 sessionId = 새 팀원 */
const SPAWNED_SESSION_ID = /"sessionId":\s*"([^"]+)"/
/**
 * 백그라운드 작업(명령·MCP 호출·에이전트·모니터)이 끝나면 오는 알림. 작업 중에 오면 system 메시지 글에 이 꼴로 들어 있다.
 * 120초를 넘긴 팀 대기 도구(team_wait·옛 jk_wait)도 백그라운드로 넘어가 결과가 이 알림으로 온다
 */
const TASK_NOTIFICATION = /<task-notification>[\s\S]*?<\/task-notification>/g
const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
/** 알림 status → 한 줄 표시. 실제 jsonl 에 나온 값은 이 셋뿐이고 모니터 이벤트는 status 가 없다 */
const NOTIFICATION_STATUS_LABELS: Record<string, string> = { completed: 'completed', failed: 'failed', killed: 'stopped' }

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
  return notification.status === 'completed' && isTeamWaitSummary(notification.summary)
}

/** 팀 대기 도구 결과의 task 가 null = 시간 안에 끝난 팀원이 없다 (기다릴 task 가 없을 때도 null 이지만 그건 바로 돌아와 백그라운드 알림이 되지 않는다) */
function isWaitTimeout(json: string | null): boolean {
  try {
    return json !== null && (JSON.parse(json) as { task?: unknown }).task === null
  } catch {
    return false
  }
}

/** "Background task completed · MCP task … (pray/team_wait)". 요약 끝의 상태 낱말은 앞에서 말했으니 뺀다 */
function notificationTitle(notification: TaskNotification): string {
  const { status, summary } = notification
  if (isWaitNotification(notification) && isWaitTimeout(notification.result)) return 'Waiting for members · timed out'
  const heading = status ? `Background task ${NOTIFICATION_STATUS_LABELS[status] ?? status}` : 'Background notice'
  const shortSummary = status && summary.endsWith(` ${status}.`) ? summary.slice(0, -(status.length + 2)) : summary
  return shortSummary ? `${heading} · ${shortSummary}` : heading
}

const COMPACT_SUMMARY_TITLE = 'Conversation compacted · continuing from a summary'
const INTERRUPT_TITLE = 'Stopped'

/** 가운데 작은 한 줄 (보고 말풍선이 되지 않는 알림·대화 압축 요약). 원문은 접어 둔다 (글자 그대로. HTML 로 꽂지 않는다) */
function NoticeLine({ title, raw, isFailed = false, jumpKey, markClass = '' }: { title: string; raw: string; isFailed?: boolean; jumpKey: string; markClass?: string }) {
  return (
    <details className={`msg notice${isFailed ? ' failed' : ''}${markClass}`} data-jump-key={jumpKey}>
      <summary title={title}>{title}</summary>
      <pre>{raw}</pre>
    </details>
  )
}

/** 팀장↔팀원이 주고받은 글: 팀장 → 팀원 지시, 팀원 → 팀장 보고. 팀장 대화에는 한 줄로 보이고 누르면 그 팀원 대화의 그 메시지로 간다 */
interface Relay {
  kind: 'instruction' | 'report'
  /** 지시를 받은·보고한 팀원. 결과가 아직 없는 팀원 만들기면 null (세션이 아직 없다) */
  memberSessionId: string | null
  memberName: string
  /** 팀원 역할 (칩). 없으면 null */
  memberPosition: string | null
  text: string
  /** 지시 = 팀장이 도구를 부른 시각, 보고 = 팀원 task 가 끝난 시각. 줄에 보이고, 팀원 대화에 같은 글이 여럿이면 이것과 가장 가까운 것으로 간다 */
  at: string
}

/** 팀 대기 도구 결과 JSON 에서 팀원 보고. 해석 실패·시간 초과(task null)·결과 없음이면 null */
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
function reportRelay(report: NonNullable<ReturnType<typeof waitReport>>, receivedAt: string, memberOf: MemberOf): Relay {
  return {
    kind: 'report',
    memberSessionId: report.memberSessionId,
    ...nameParts(memberOf(report.memberSessionId)),
    text: report.result,
    at: report.finishedAt ?? receivedAt,
  }
}

/** 세션 ID → 지시·보고 한 줄에 보일 팀원 이름과 역할 */
type MemberOf = (sessionId: string) => { name: string; position: string | null }

function nameParts(member: { name: string; position: string | null }): { memberName: string; memberPosition: string | null } {
  return { memberName: member.name, memberPosition: member.position }
}

/**
 * 팀원 만들기 결과의 새 팀원: 첫 sessionId 와 서버가 붙인 이름 member.name·역할 member.position (role 로 만들면 입력에 이름이 없다).
 * 옛 대화 기록은 이름에 "[FE] Park" 꼴로 역할이 들어 있고 position 이 없다
 */
function spawnedMember(toolUse: ToolUse): { sessionId: string; name: string | null; position: string | null } | null {
  const sessionId = toolUse.result?.match(SPAWNED_SESSION_ID)?.[1]
  if (!sessionId) return null
  try {
    const { member } = JSON.parse(toolUse.result ?? '') as { member?: { name?: unknown; position?: unknown } }
    return {
      sessionId,
      name: typeof member?.name === 'string' ? member.name : null,
      position: typeof member?.position === 'string' ? member.position : null,
    }
  } catch {
    return { sessionId, name: null, position: null }
  }
}

/** 팀장 대화의 팀 MCP 도구 호출을 지시·보고 한 줄로 (옛·새 이름 → teamTools.ts). 실패한 지시(결과가 JSON 이 아닌 오류 글)·상태 보기·정리는 null */
function relayOf(toolUse: ToolUse, message: ChatMessage, memberOf: MemberOf): Relay | null {
  const teamTool = teamToolOf(toolUse.name)
  if (!teamTool) return null
  const input = (toolUse.input ?? {}) as { name?: unknown; role?: unknown; sessionId?: unknown; instruction?: unknown }
  const isDelivered = toolUse.result === null || toolUse.result.startsWith('{')
  if (typeof input.instruction === 'string' && input.instruction && isDelivered) {
    const instruction = { kind: 'instruction', text: input.instruction, at: message.timestamp } as const
    if (teamTool === 'spawn') {
      const memberSessionId = spawnedMember(toolUse)?.sessionId ?? null
      if (memberSessionId) return { ...instruction, memberSessionId, ...nameParts(memberOf(memberSessionId)) }
      // 결과(새 세션)가 오기 전: 팀장이 준 이름, role 로 만들면 "[역할]"
      const pendingName = typeof input.name === 'string' ? input.name : null
      const pendingPosition = typeof input.role === 'string' ? input.role : null
      if (pendingName || pendingPosition) {
        const pending = pendingName ? memberDisplay(pendingName, pendingPosition) : { name: '', position: pendingPosition }
        return { ...instruction, memberSessionId: null, ...nameParts(pending) }
      }
    }
    if (teamTool === 'assign' && typeof input.sessionId === 'string') {
      return { ...instruction, memberSessionId: input.sessionId, ...nameParts(memberOf(input.sessionId)) }
    }
  }
  if (teamTool === 'wait' && toolUse.result) {
    const report = waitReport(toolUse.result)
    if (report) return reportRelay(report, message.timestamp, memberOf)
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
export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

function relayLabel(relay: Relay): string {
  return relay.kind === 'instruction' ? '→ Assigned to' : '← Report from'
}

/** 한 줄에 보이는 글 (검색 대상). RelayLine 이 그리는 글과 같은 꼴 */
function relayLineText(relay: Relay): string {
  const clock = formatClock(relay.at)
  return `${relayLabel(relay)} ${relay.memberPosition ?? ''}${relay.memberName}${clock ? ` · ${clock}` : ''}`
}

/**
 * 팀장 대화의 지시·보고 한 줄 "→ Assigned to (FE 칩) Park · 10:12"·"← Report from (FE 칩) Park · 10:30". 내용은 툴팁(앞부분)만.
 * 누르면 그 팀원 대화의 그 메시지로 간다. 팀원 세션이 아직 없으면(spawn 결과 전) 누를 수 없다
 */
const RelayLine = memo(function RelayLine({ relay, jumpKey, markClass, onOpen }: { relay: Relay; jumpKey: string; markClass: string; onOpen: () => void }) {
  const label = relayLabel(relay)
  const clock = formatClock(relay.at)
  // 툴팁 글은 지시·보고 전문을 줄로 나눠 자르므로 글이 바뀔 때만 다시 만든다
  const preview = useMemo(() => relayPreview(relay.text), [relay.text])
  return (
    <button
      type="button"
      className={`relay-line${markClass}`}
      data-jump-key={jumpKey}
      title={relay.memberSessionId ? preview : 'Creating member session'}
      disabled={!relay.memberSessionId}
      onClick={onOpen}
    >
      {label} <PositionChip position={relay.memberPosition} />
      {relay.memberName}
      {clock ? ` · ${clock}` : ''}
    </button>
  )
})

/** 셸 도구(Bash·PowerShell)의 복사할 명령. 그 밖의 도구·문자열이 아닌 command 는 null */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
function shellCommandOf(toolUse: ToolUse): string | null {
  if (!SHELL_TOOLS.has(toolUse.name)) return null
  const { command } = (toolUse.input ?? {}) as { command?: unknown }
  return typeof command === 'string' ? command : null
}

function ToolBlock({ toolUse, searchKey = null }: { toolUse: ToolUse; searchKey?: string | null }) {
  const command = shellCommandOf(toolUse)
  // 명령 줄은 대화 안 검색 대상이라 요소를 찾을 키를 단다
  const jumpKey = command !== null ? `tool:${toolUse.id}` : undefined
  return (
    <details className={`tool${jumpKey && jumpKey === searchKey ? ' search-current' : ''}`} data-jump-key={jumpKey}>
      <summary>
        {command !== null && <CopyButton text={command} label="Copy command" />}
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
        <span className="asked-label">Asking</span> {asked.questions.map((item) => item.header).filter(Boolean).join(' · ')}
      </div>
    )
  }
  return (
    <div className="msg asked">
      <div className="asked-label">Question → answer</div>
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

/**
 * "14 steps · Bash 6 · Read 5 · Edit 3 · 2m 10s". 시간은 작업 중 표시기와 같은 꼴(formatElapsed)이고,
 * 1초 미만이면 빼고, 진행 중이면 작업 중 표시기에 있으니 뺀다
 */
function workTitle(work: Work): string {
  const counts = work.toolCounts.slice(0, WORK_TOOL_NAMES_SHOWN).map(({ name, count }) => `${shortToolName(name)} ${count}`)
  const startedAt = work.parts[0].message.timestamp
  const duration = !work.isInProgress && work.durationMs >= 1000 ? [formatElapsed(startedAt, Date.parse(startedAt) + work.durationMs)] : []
  return [`${work.toolCount} ${work.toolCount === 1 ? 'step' : 'steps'}`, ...counts, ...duration].join(' · ')
}

/** 말풍선 테두리 클래스: 점프로 찾아 간 줄(2초 깜빡임)과 대화 안 검색의 현재 결과(늘 켜 둠) */
function markClasses(key: string, highlightKey: string | null, searchKey: string | null): string {
  return `${highlightKey === key ? ' jump-highlight' : ''}${searchKey === key ? ' search-current' : ''}`
}

/**
 * 묶음 안 claude 메시지 말풍선들: 설명 글(마크다운)·도구 줄을 시간 순서대로.
 * 설명 글이 있는 말풍선은 점프로 찾아 갈 수 있다 (data-jump-key = 메시지 ID. 글 없는 것은 답변 말풍선과 ID 가 겹쳐 빼고)
 */
function WorkParts({ work, highlightKey, searchKey }: { work: Work; highlightKey: string | null; searchKey: string | null }) {
  return (
    <>
      {work.parts
        .filter((part) => part.text || part.toolUses.length > 0)
        .map((part) => (
        <div
          key={part.message.id}
          className={`msg assistant${part.text ? markClasses(part.message.id, highlightKey, searchKey) : ''}`}
          data-jump-key={part.text ? part.message.id : undefined}
        >
          {part.text && (
            <>
              <CopyButton text={part.text} />
              <MarkdownText text={part.text} isChat />
            </>
          )}
          {part.toolUses.map((toolUse) => (
            <ToolBlock key={toolUse.id} toolUse={toolUse} searchKey={searchKey} />
          ))}
        </div>
      ))}
    </>
  )
}

/**
 * 답변 전 작업 묶음. 한 줄이고 누르면 아래에 말풍선들이 펼쳐진다. 접혀 있으면 안쪽을 그리지 않는다 (마크다운 파싱을 피하려고).
 * 아직 안 끝난 묶음(진행 중)은 접혀 있어도 설명 글만 줄 아래에 말풍선으로 시간 순서대로 보인다 — 도구 줄은 접고, 지금 도는 도구는
 * 대화 맨 아래 작업 중 표시기에만 보인다. 펼치면 그 말풍선들 대신 펼친 안쪽에 보인다 (같은 글이 두 번 보이지 않게)
 */
function WorkLine({
  work,
  isOpen,
  onToggle,
  highlightKey,
  searchKey,
}: {
  work: Work
  isOpen: boolean
  onToggle: () => void
  highlightKey: string | null
  searchKey: string | null
}) {
  const title = workTitle(work)
  // 진행 중인데 끝난 도구가 아직 없으면(첫 도구가 도는 중) 줄 없이 설명 글 말풍선만 보인다
  const hasLine = !work.isInProgress || work.toolCount > 0
  return (
    <>
      {hasLine && (
        <div className="work">
          <button type="button" className="work-summary" aria-expanded={isOpen} onClick={onToggle} title={title}>
            {title}
          </button>
          {isOpen && (
            <div className="work-items">
              <WorkParts work={work} highlightKey={highlightKey} searchKey={searchKey} />
            </div>
          )}
        </div>
      )}
      {/* 대화 말풍선과 같은 자리·간격이 되게 .work 밖에 둔다. 차례가 끝나면 마지막 글은 답변 말풍선이 되고 나머지는 줄 안으로 들어간다 */}
      {work.isInProgress &&
        !(isOpen && hasLine) &&
        work.parts.map(
          (part) =>
            part.text && (
              <div key={part.message.id} className={`msg assistant${markClasses(part.message.id, highlightKey, searchKey)}`} data-jump-key={part.message.id}>
                <CopyButton text={part.text} />
                <MarkdownText text={part.text} isChat />
              </div>
            ),
        )}
    </>
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

const ANSWER_CONFLICT_MESSAGE = 'Already answered, or the server lost the question. Check the Terminal tab'

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
      setErrorMessage(response.status === 409 ? ANSWER_CONFLICT_MESSAGE : `Couldn't send (HTTP ${response.status})`)
    } catch {
      setErrorMessage("Couldn't send (network error)")
    }
    setSendState('idle')
  }

  function submit() {
    void send({ answers: Object.fromEntries(questions.map((question, i) => [question.question, answerOf(question, drafts[i])])) })
  }

  return (
    <div className="question-card" role="group" aria-label="Question from claude">
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
                title={isAnswered ? 'Answered' : 'Not answered yet'}
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
          <span className="question-mode">{active.multiSelect ? 'Select multiple' : 'Select one'}</span>
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
            <div className="question-preview-label">Preview · {previewOption.label}</div>
            <pre>{previewOption.preview}</pre>
          </div>
        )}
        <textarea
          className="question-custom"
          value={activeDraft.customText}
          onChange={(e) => changeCustomText(e.target.value)}
          placeholder={active.multiSelect ? 'Type your own (sent with your picks)' : 'Type your own (this becomes the answer)'}
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
        {sendState === 'sent' && <span className="question-status">Sent</span>}
        <button type="button" className="primary" disabled={isBusy || !isAllAnswered} onClick={submit} title={isAllAnswered ? undefined : 'Answer every question first'}>
          Submit
        </button>
        <button type="button" disabled={isBusy} onClick={() => void send({ chat: true })}>
          Chat about this
        </button>
        <button type="button" disabled={isBusy} onClick={() => void send({ cancel: true })}>
          Cancel
        </button>
      </div>
    </div>
  )
}


/**
 * 메신저의 "입력 중…" 같은 작업 중 표시기. 1초 타이머가 이 컴포넌트만 다시 그리게 따로 둔다 (대화 전체를 다시 그리지 않게).
 * tools = 이번 차례에 실행 중인 도구 이름 ("Bash · 1m 12s"). 없으면(생각 중·글 쓰는 중) 점 옆에 경과 시간만, since 가 없으면 시간도 뺀다.
 * onInterrupt 가 있으면 옆에 [중지] (누른 뒤 서버 결과가 올 때까지 "중지 중…")
 */
function WorkingIndicator({
  tools,
  since,
  onInterrupt,
  isInterrupting,
}: {
  tools: string[]
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
  const toolText = tools.join(' · ')
  return (
    <div className="typing-row">
      <div className="typing" role="status">
        <span className="typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {/* 점은 화면 낭독기에 안 보이므로 글로 알린다 */}
        <span className="typing-label">Working</span>
        {toolText && <span className="typing-text">{toolText}</span>}
        {/* 매초 바뀌는 글자를 화면 낭독기가 계속 읽지 않게 */}
        {since && (
          <span className="typing-time" aria-hidden="true">
            {toolText && '· '}
            {formatElapsed(since, now)}
          </span>
        )}
      </div>
      {onInterrupt && (
        <button type="button" className="interrupt" disabled={isInterrupting} onClick={onInterrupt} title="Stop claude's work (Esc)">
          {isInterrupting ? 'Stopping…' : 'Stop'}
        </button>
      )}
    </div>
  )
}

/** 맨 아래에서 이만큼 안쪽이면 "맨 아래를 보고 있다" 로 본다 */
const BOTTOM_SLACK_PX = 40
/** 맨 위에서 이만큼 안쪽까지 스크롤하면 이전 줄을 더 그린다 */
const EXPAND_TOP_PX = 400

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

/** 보낼 글을 쓴 뒤 Enter(`\r`) 를 보내기까지. 짧으면 글과 `\r` 이 한 덩어리로 읽혀 제출 대신 줄바꿈이 된다 */
const SUBMIT_ENTER_DELAY_MS = 300

/** 대기 메시지 취소 결과 (서버 outcome) → 대화 맨 아래 한 줄 */
const CANCEL_OUTCOME_LABELS: Record<string, string> = {
  // 취소한 글은 웹 입력칸에 넣는다
  cancelled: 'cancelled · moved to the input box',
  accepted: 'already taken by claude',
  stuck: "couldn't cancel: check the Terminal tab",
  failed: 'failed: check the Terminal tab',
}
/** 취소 결과 한 줄을 보여 주는 시간 */
const CANCEL_NOTICE_MS = 6_000

/** 중지 결과 (서버 outcome) → 대화 맨 아래 한 줄. 멈춘 것(stopped)은 대화의 "중지됨" 줄과 표시기가 사라지는 것으로 충분해 알리지 않는다 */
const INTERRUPT_OUTCOME_LABELS: Record<string, string | null> = {
  stopped: null,
  continued: 'Stopped · moving on to the queued message',
  restored: "Stopped · no response yet, so your message is back in claude's input box (it will join your next message): check the Terminal tab",
  unknown: 'May not have stopped: check the Terminal tab',
}
/** 응답 전 중지로 돌아온 글을 서버가 Claude Code 입력칸에서 비우고 넘겨 줘(text) 웹 입력칸에 넣었을 때. 위 restored 는 넘겨받지 못했을 때다 (mod 가 안 붙음 등) */
const RESTORED_TO_INPUT_LABEL = 'Stopped · no response yet, so your message was moved to the input box'
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
 * 여럿이면 시각이 at 과 가장 가까운 것. key 는 그 말풍선의 data-jump-key, 끝난 작업 묶음 안 설명 글이면 workKey 가 그 묶음
 * (접혀 있으면 안 그려져 펼친다. 진행 중 묶음의 설명 글은 접혀 있어도 보여 펼치지 않는다)
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
  return { key: found.id, workKey: hidingWorkKey(rows, found) }
}

/**
 * 대화 안 검색 대상을 화면 순서대로: 사람 쪽 글(대기 중 포함)·claude 글(답변·중간 설명 글)·팀원 쪽 지시 말풍선·system 글,
 * 한 줄로 보이는 것(알림·압축 요약·중지 줄·팀장 쪽 지시/보고 한 줄)은 화면에 보이는 한 줄 글, Bash·PowerShell 명령.
 * 도구 결과·다른 도구 입력·질문 카드는 뺀다. key 는 화면 요소의 data-jump-key 와 같다
 */
function buildSearchTargets(rows: ChatRow<Special>[], memberOf: MemberOf): SearchTarget[] {
  const targets: SearchTarget[] = []
  const add = (key: string, text: string, workKey: string | null = null) => {
    if (text) targets.push({ key, text, workKey })
  }
  for (const row of rows) {
    if (row.kind === 'text') {
      add(row.message.id, row.message.text)
    } else if (row.kind === 'work') {
      const { work } = row
      for (const part of work.parts) {
        // 끝난 묶음의 설명 글은 접혀 있으면 안 그려져 펼쳐야 한다. 진행 중 묶음의 설명 글은 접혀 있어도 말풍선으로 보인다
        if (part.text) add(part.message.id, part.text, work.isInProgress ? null : work.key)
        for (const toolUse of part.toolUses) {
          const command = shellCommandOf(toolUse)
          if (command) add(`tool:${toolUse.id}`, command, work.key)
        }
      }
    } else if (row.kind === 'special') {
      if (row.special.kind === 'relay') add(`relay:${row.toolUse.id}`, relayLineText(row.special.relay))
    } else {
      const { message } = row
      if (message.from) {
        add(message.id, message.text)
      } else if (message.isCompactSummary) {
        add(message.id, COMPACT_SUMMARY_TITLE)
      } else if (message.isInterrupt) {
        add(message.id, INTERRUPT_TITLE)
      } else {
        const parts = message.role === 'system' ? splitNotifications(message.text) : null
        if (!parts) {
          add(message.id, message.text)
          continue
        }
        parts.forEach((part, index) => {
          const key = `${message.id}:${index}`
          if (typeof part === 'string') return add(key, part)
          const report = isWaitNotification(part) ? waitReport(part.result ?? '') : null
          if (report) add(`relay:${key}`, relayLineText(reportRelay(report, message.timestamp, memberOf)))
          else add(key, notificationTitle(part))
        })
      }
    }
  }
  return targets
}

/** 줄 하나에 넘기는 것. 그 줄에 해당할 때만 값이 있고 아니면 null·false 라, 바뀐 줄만 다시 그린다 */
interface ChatRowViewProps {
  row: ChatRow<Special>
  /** 작업 묶음이 펼쳐졌는지 */
  isOpen: boolean
  /** 점프로 찾아 간 키 (이 줄 안에 있을 때만) */
  highlightKey: string | null
  /** 대화 안 검색의 현재 결과 키 (이 줄 안에 있을 때만) */
  searchKey: string | null
  /** 지시·보고 한 줄 바로 아래 알림 (이 줄 안에 있을 때만) */
  lineNotice: { rowKey: string; text: string } | null
  /** system 글 안 팀 대기 도구 보고의 팀원 이름 (사람 쪽·system 줄만) */
  memberOf: MemberOf | null
  /** 이 대기 메시지에 [Cancel] 을 보이는지 (맨 마지막 대기 메시지·취소할 수 있을 때) */
  canCancelQueued: boolean
  /** [Cancel] 을 누른 대기 메시지 ID (대기 메시지 줄만) */
  cancellingId: string | null
  /** 이 줄의 claude 답·내 말 말풍선을 마크했는지 */
  isMarked: boolean
  /** 묶음 키와 지금 펼쳐졌는지 (누르면 그 반대로 정한다) */
  onToggleWork: (key: string, isOpen: boolean) => void
  onOpenRelay: (relay: Relay, rowKey: string) => void
  onCancelQueued: (message: ChatMessage) => void
  /** 말풍선 마크하기·풀기 (Chat 이 고정해 넘긴다) */
  onSetMark: (key: string, isMarked: boolean) => void
  /** 말풍선 인용 버튼 (근무 중인 웹 세션만. 아니면 null 이라 버튼이 없다) */
  onQuote: ((message: ChatMessage) => void) | null
}

/** 말풍선 인용 버튼: 입력 상자에 그 말풍선 인용 칩을 붙인다. 자리·보이기 규칙은 마크 버튼과 같다 */
function QuoteButton({ message, onQuote }: { message: ChatMessage; onQuote: (message: ChatMessage) => void }) {
  return (
    <button
      type="button"
      className="quote-button"
      title="Quote in reply"
      aria-label="Quote in reply"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onQuote(message)
      }}
    >
      <QuoteIcon />
    </button>
  )
}

/** 대화 줄 하나. memo 라 대화를 다시 받아도 줄 객체(chatReuse 가 바뀌지 않은 줄은 이전 객체를 쓴다)와 넘긴 값이 그대로면 다시 그리지 않는다 */
const ChatRowView = memo(function ChatRowView({
  row,
  isOpen,
  highlightKey,
  searchKey,
  lineNotice,
  memberOf,
  canCancelQueued,
  cancellingId,
  isMarked,
  onToggleWork,
  onOpenRelay,
  onCancelQueued,
  onSetMark,
  onQuote,
}: ChatRowViewProps) {
  /** 점프로 찾아 간 말풍선이면 강조 클래스 */
  function highlightClass(key: string): string {
    return markClasses(key, highlightKey, searchKey)
  }

  /** 지시·보고 한 줄과 그 아래 알림 */
  function renderRelayLine(relay: Relay, rowKey: string) {
    return (
      <Fragment key={rowKey}>
        <RelayLine relay={relay} jumpKey={rowKey} markClass={highlightClass(rowKey)} onOpen={() => onOpenRelay(relay, rowKey)} />
        {lineNotice?.rowKey === rowKey && (
          <div className="queue-notice" role="status">
            {lineNotice.text}
          </div>
        )}
      </Fragment>
    )
  }

  if (row.kind === 'work') {
    const { work } = row
    return <WorkLine work={work} isOpen={isOpen} onToggle={() => onToggleWork(work.key, isOpen)} highlightKey={highlightKey} searchKey={searchKey} />
  }
  // claude 답변 (구간의 마지막 글. 도구 없는 구간이면 글마다)
  if (row.kind === 'text') {
    return (
      <div className={`msg assistant${isMarked ? ' marked' : ''}${highlightClass(row.message.id)}`} data-jump-key={row.message.id}>
        {onQuote && <QuoteButton message={row.message} onQuote={onQuote} />}
        <CopyButton text={row.message.text} />
        <MarkButton messageKey={row.message.id} isMarked={isMarked} onSetMark={onSetMark} />
        <MarkdownText text={row.message.text} isChat />
      </div>
    )
  }
  // 팀장 대화의 지시·보고 도구 호출은 한 줄로 (내용은 팀원 대화에서 본다), AskUserQuestion 은 질문 → 답 카드로 (원래 도구 블록은 그 안에 접어 둔다)
  if (row.kind === 'special') {
    const { toolUse, special } = row
    return special.kind === 'relay' ? renderRelayLine(special.relay, `relay:${toolUse.id}`) : <AskedCard toolUse={toolUse} asked={special.asked} />
  }
  const { message } = row
  // 팀원 대화: 서버가 보낸 팀장·파트장 지시 (전문)
  if (message.from) {
    return (
      <div className={`msg user relay${highlightClass(message.id)}`} data-jump-key={message.id}>
        <CopyButton text={message.text} />
        <div className="relay-label">Instruction from {message.from.name}</div>
        <MarkdownText text={message.text} isChat />
      </div>
    )
  }
  // 대화 압축 요약: 사람 말이 아니라 한 줄. 요약 원문은 접어 둔다
  if (message.isCompactSummary) {
    return <NoticeLine title={COMPACT_SUMMARY_TITLE} raw={message.text} jumpKey={message.id} markClass={highlightClass(message.id)} />
  }
  // 중지(Esc) 기록: 사람 말이 아니라 한 줄. 원문은 접어 둔다
  if (message.isInterrupt) {
    return <NoticeLine title={INTERRUPT_TITLE} raw={message.text} jumpKey={message.id} markClass={highlightClass(message.id)} />
  }
  // 백그라운드 작업 알림: 팀장 대화의 팀 대기 도구 팀원 보고는 보고 한 줄, 그 밖은 알림마다 한 줄. 알림 앞뒤 글은 system 글 그대로
  const parts = message.role === 'system' ? splitNotifications(message.text) : null
  if (parts) {
    return (
      <>
        {parts.map((part, index) => {
          const key = `${message.id}:${index}`
          if (typeof part === 'string') {
            return (
              <div key={key} className={`msg system${highlightClass(key)}`} data-jump-key={key}>
                <div className="text">{part}</div>
              </div>
            )
          }
          const report = isWaitNotification(part) ? waitReport(part.result ?? '') : null
          if (!report || !memberOf) {
            return (
              <NoticeLine
                key={key}
                title={notificationTitle(part)}
                raw={part.raw}
                isFailed={part.status === 'failed'}
                jumpKey={key}
                markClass={highlightClass(key)}
              />
            )
          }
          return renderRelayLine(reportRelay(report, message.timestamp, memberOf), `relay:${key}`)
        })}
      </>
    )
  }
  // 사람 쪽 말·system 글 (도구 호출은 claude 메시지에만 있다). 내 말이면 마크 버튼
  const isMarkable = isMarkableMessage(message)
  return (
    <div
      className={`msg ${message.role}${message.isQueued ? ' queued' : ''}${isMarkable && isMarked ? ' marked' : ''}${highlightClass(message.id)}`}
      data-jump-key={message.id}
    >
      {isMarkable && onQuote && <QuoteButton message={message} onQuote={onQuote} />}
      {isMarkable && <MarkButton messageKey={message.id} isMarked={isMarked} onSetMark={onSetMark} />}
      {message.text && <div className="text">{message.text}</div>}
      {message.isQueued && (
        <div className="queued-label">
          Queued
          {canCancelQueued && (
            <button
              type="button"
              className="queued-cancel"
              disabled={cancellingId !== null}
              onClick={() => onCancelQueued(message)}
              title="Take this message out of the queue before claude gets it"
            >
              {cancellingId === message.id ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

/**
 * 대화 말풍선 목록 (그리는 범위의 줄들). memo 라 props 가 그대로면 Chat 이 다시 그려져도(입력칸이 비었는지·임시 말풍선·알림·"맨 아래" 버튼 등)
 * 목록을 다시 훑지 않는다. 그래서 함수 props 는 Chat 이 useCallback 으로 고정해 넘긴다. 줄마다 그 줄에 해당하는 값만 넘겨 바뀐 줄만 다시 그린다
 */
const MessageRows = memo(function MessageRows({
  rows,
  memberOf,
  workToggles,
  workBundles,
  highlightKey,
  searchKey,
  lineNotice,
  lastQueuedId,
  canCancelQueued,
  cancellingId,
  markedKeys,
  onToggleWork,
  onOpenRelay,
  onCancelQueued,
  onSetMark,
  onQuote,
}: {
  rows: ChatRow<Special>[]
  memberOf: MemberOf
  /** 사람이(또는 검색·점프가) 펼치거나 접은 작업 묶음 키 → 펼쳤는지. 없는 묶음은 workBundles 설정을 따른다 (isWorkOpen) */
  workToggles: ReadonlyMap<string, boolean>
  workBundles: ChatStyle['workBundles']
  /** 점프로 찾아 간 줄의 data-jump-key */
  highlightKey: string | null
  /** 대화 안 검색의 현재 결과 data-jump-key */
  searchKey: string | null
  /** 지시·보고 한 줄 바로 아래 알림 (그 팀원이 세션 목록에 없을 때) */
  lineNotice: { rowKey: string; text: string } | null
  lastQueuedId: string | null
  canCancelQueued: boolean
  cancellingId: string | null
  /** 마크한 말풍선 키 (줄에는 그 줄 것인지만 boolean 으로 넘긴다) */
  markedKeys: ReadonlySet<string>
  onToggleWork: (key: string, isOpen: boolean) => void
  onOpenRelay: (relay: Relay, rowKey: string) => void
  onCancelQueued: (message: ChatMessage) => void
  onSetMark: (key: string, isMarked: boolean) => void
  onQuote: ((message: ChatMessage) => void) | null
}) {
  const highlightRow = highlightKey === null ? -1 : rowIndexOfJumpKey(rows, highlightKey)
  const searchRow = searchKey === null ? -1 : rowIndexOfJumpKey(rows, searchKey)
  const noticeRow = lineNotice === null ? -1 : rowIndexOfJumpKey(rows, lineNotice.rowKey)
  return rows.map((row, index) => {
    const isQueuedRow = row.kind === 'message' && Boolean(row.message.isQueued)
    return (
      <ChatRowView
        key={rowKeyOf(row)}
        row={row}
        isOpen={row.kind === 'work' && isWorkOpen(row.work.isInProgress, workToggles.get(row.work.key), workBundles)}
        highlightKey={index === highlightRow ? highlightKey : null}
        searchKey={index === searchRow ? searchKey : null}
        lineNotice={index === noticeRow ? lineNotice : null}
        memberOf={row.kind === 'message' ? memberOf : null}
        canCancelQueued={isQueuedRow && row.kind === 'message' && row.message.id === lastQueuedId && canCancelQueued}
        cancellingId={isQueuedRow ? cancellingId : null}
        isMarked={(row.kind === 'text' || row.kind === 'message') && markedKeys.has(row.message.id)}
        onToggleWork={onToggleWork}
        onOpenRelay={onOpenRelay}
        onCancelQueued={onCancelQueued}
        onSetMark={onSetMark}
        onQuote={onQuote}
      />
    )
  })
})

/** 끌고 있는 것이 파일인지 (대화 속 글자·그림을 끌 때는 반응하지 않는다) */
function isFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

/** 놓은 파일. 폴더는 뺀다 (통째로 올리지 않는다. 폴더도 크기 0 인 File 로 오고 읽으면 실패한다) */
function droppedFiles(dataTransfer: DataTransfer): File[] {
  const items = Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
  if (items.length === 0) return Array.from(dataTransfer.files)
  return items.flatMap((item) => {
    if (item.webkitGetAsEntry()?.isDirectory) return []
    const file = item.getAsFile()
    return file ? [file] : []
  })
}

export function Chat({
  sessionId,
  isWritable,
  footer,
  contextSize,
  onHandOver,
  handOverTitle,
  turnCache,
  modelText,
  modelFullName,
  modelNextText,
  isModelRestarting,
  onChangeModel,
  isApprovalNeeded,
  isWorking,
  workingSince,
  pendingTool,
  question,
  suggestion,
  handoverFrom,
  version,
  btwVersion,
  sessionNames,
  sessionPositions,
  jump,
  onJumpHandled,
  onOpenRelay,
  shells,
  shellRequest,
  onShellRequestHandled,
  onQueuedChange,
  isSearchOpen,
  searchFocusId,
  onSearchClose,
  btwOpenId,
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
  /** 입력칸이 비었는지 (제안 표시 조건). 글은 입력 상자(Composer) 안 state 라 글자를 칠 때 대화가 다시 그려지지 않는다 */
  const [isDraftEmpty, setIsDraftEmpty] = useState(true)
  const [pendings, setPendings] = useState<PendingMessage[]>([])
  /** 질문 중에는 입력칸을 막는다. 키 입력이 터미널의 질문 화면에 들어가면 Enter 가 1번 선택지로 답해 버린다. 쓰던 글은 남긴다 */
  const isAsking = Boolean(question) || pendingTool === ASK_TOOL
  /** 인계 중에도 입력칸을 막는다 (서버 /input·btw 409). 쓰던 글은 남긴다 */
  const isHandingOver = handoverFrom !== null
  /** 파일을 끌어 놓아 첨부할 수 있는지 (클립 버튼과 같은 조건: 근무 중인 웹 세션, 질문·인계 중 아님) */
  const canDropFiles = isWritable && !isAsking && !isHandingOver
  /** 파일을 대화 탭 위로 끌고 있는 중 (놓을 곳 안내를 덮어 보인다) */
  const [isFileOver, setIsFileOver] = useState(false)
  /** 입력 상자의 흐린 제안 글 (조건은 composerText.ts isSuggestionVisible) */
  const isSuggestionShown = isSuggestionVisible({
    suggestion,
    isWritable,
    isWorking,
    isApprovalNeeded,
    isAsking,
    isHandingOver,
    isDraftEmpty,
    hasUnconfirmedPending: pendings.some((pending) => !pending.isFailed),
  })
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
  const hasQueuedMessage = useMemo(() => messages.some((m) => m.isQueued && m.role === "user"), [messages])
  useEffect(() => {
    onQueuedChange?.(sessionId, hasQueuedMessage)
    return () => onQueuedChange?.(sessionId, false)
  }, [sessionId, hasQueuedMessage, onQueuedChange])
  const canCancelQueued = isWritable && isWorking && !isApprovalNeeded && !isAsking
  /** 작업 중 표시기 옆 [중지]. 대기 메시지 취소와 같은 조건 (승인 대기·질문 중 Esc 는 도구 거부·질문 거절이 된다. 서버도 다시 확인한다) */
  const canInterrupt = isWritable && isWorking && !isApprovalNeeded && !isAsking
  /** [중지] 를 누른 뒤 "중지 중…". 멈췄으면 표시기가 사라질 때까지 둔다 */
  const [isInterrupting, setIsInterrupting] = useState(false)
  /** 중지 결과·실패 한 줄. INTERRUPT_NOTICE_MS 뒤 사라진다 */
  const [interruptNotice, setInterruptNotice] = useState<string | null>(null)
  const nextPendingIdRef = useRef(1)
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve())
  const messagesRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const btwRef = useRef<BtwCardHandle>(null)
  /** 사용자가 맨 아래를 보고 있는지. 스크롤 때마다 갱신한다 (내용만 길어질 때는 스크롤 이벤트가 없어 직전 값이 남는다 = "갱신 직전에 맨 아래였는지") */
  const isAtBottomRef = useRef(true)
  /** 같은 값을 "맨 아래로" 버튼을 그리는 데 쓴다 */
  const [isAtBottom, setIsAtBottom] = useState(true)
  /** 위를 보는 사이 새 메시지가 왔는지. 버튼의 점 */
  const [hasUnread, setHasUnread] = useState(false)
  /** 세션을 열거나 바꾼 뒤 첫 로딩이면 위치와 관계없이 맨 아래에서 시작한다 */
  const isFirstLoadRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)

  /**
   * 팀원 만들기 때 붙은 팀원 이름·역할 [세션 ID, 이름·역할] 목록을 글로. 글이라 대화를 다시 받아도 내용이 같으면 memberOf 가 그대로다
   * (memberOf 가 바뀌면 지시·보고 줄이 모두 다시 만들어진다)
   */
  const spawnedJson = useMemo(() => {
    const spawned: [string, { name: string; position: string | null }][] = []
    for (const message of messages) {
      for (const toolUse of message.toolUses) {
        if (teamToolOf(toolUse.name) !== 'spawn') continue
        const inputName = (toolUse.input as { name?: unknown } | null)?.name
        const member = spawnedMember(toolUse)
        const name = member?.name ?? (typeof inputName === 'string' ? inputName : null)
        if (member && name) spawned.push([member.sessionId, memberDisplay(name, member.position)])
      }
    }
    return JSON.stringify(spawned)
  }, [messages])
  /** 팀원 이름·역할: 팀원 만들기 때 붙은 것(서버가 붙인 member.name·member.position, 없으면 팀장이 준 name) → 세션 목록 이름·역할 → ID 앞 8자리 */
  const memberOf = useMemo<MemberOf>(() => {
    const spawned = new Map<string, { name: string; position: string | null }>(JSON.parse(spawnedJson))
    return (id: string) => {
      const own = spawned.get(id)
      if (own) return own
      const listed = sessionNames[id]
      // 목록 이름은 세션 목록의 이름이라 옛 꼴 "[역할] 이름" 일 수 있다. 목록에 역할이 따로 있으면 그것이 먼저
      return listed ? memberDisplay(listed, sessionPositions?.[id]) : { name: id.slice(0, 8), position: null }
    }
  }, [spawnedJson, sessionNames, sessionPositions])

  /**
   * 화면 줄: 구간마다 claude 의 중간 설명 글·일반 도구 호출을 작업 묶음으로 접고, relay 한 줄·질문 카드는 그 자리에 둔다.
   * 차례가 진행 중이면 맨 끝 묶음은 진행 중이라 접혀 있어도 설명 글이 보인다. 승인 대기도 진행 중이다 (승인 창이 뜰 때마다 글이 숨었다 보이지 않게)
   */
  const isTurnInProgress = isWorking || isApprovalNeeded
  /** 작업 중 표시기의 실행 중인 도구. 메시지가 바뀔 때만 다시 찾는다 (표시기의 1초 타이머와 무관) */
  const runningTools = useMemo(() => runningToolNames(messages), [messages])
  /** 바로 앞의 줄. 다시 만든 줄 중 그대로인 것은 이 객체를 다시 써서 줄마다 memo 가 걸린다 */
  const rowsRef = useRef<ChatRow<Special>[]>([])
  const rows = useMemo(() => {
    const built = buildChatRows<Special>(
      messages,
      (toolUse, message) => {
        const relay = relayOf(toolUse, message, memberOf)
        if (relay) return { kind: 'relay', relay }
        const asked = askedOf(toolUse)
        return asked ? { kind: 'asked', asked } : null
      },
      isTurnInProgress,
    )
    const reused = reuseRows(rowsRef.current, built, (a, b) => JSON.stringify(a) === JSON.stringify(b))
    rowsRef.current = reused
    return reused
  }, [messages, memberOf, isTurnInProgress])
  /** 그리는 범위의 시작 줄 (줄 키). null = 아직 정하지 않음(최근 RENDER_STEP 줄). 세션을 바꾸면 null */
  const [windowStart, setWindowStart] = useState<WindowStart | null>(null)
  const startIndex = resolveStartIndex(rows, windowStart)
  const startIndexRef = useRef(startIndex)
  startIndexRef.current = startIndex
  const visibleRows = useMemo(() => rows.slice(startIndex), [rows, startIndex])
  /** 위로 더 그리기 직전 첫 줄 요소와 그 화면 위치. 그린 뒤 같은 자리에 오게 scrollTop 을 보정한다 */
  const expandAnchorRef = useRef<{ element: Element; top: number } | null>(null)
  const earlierRef = useRef<HTMLDivElement>(null)
  /** target 줄이 안 그린 범위면 거기까지 그리는 범위를 넓힌다 (점프·검색 이동) */
  const revealRow = useCallback((targetIndex: number) => {
    const next = startIndexRevealing(startIndexRef.current, targetIndex)
    if (next !== startIndexRef.current) setWindowStart(windowStartAt(rowsRef.current, next))
  }, [])
  /** 설명 글이 말풍선으로 보이는 진행 중 묶음. 이게 바뀌면(끝남) 중간 설명 글이 줄 안으로 들어가 대화 길이가 갑자기 줄어든다 */
  const liveWorkRow = rows.find((row) => row.kind === 'work' && row.work.isInProgress)
  const liveWorkKey = liveWorkRow?.kind === 'work' ? liveWorkRow.work.key : null
  /**
   * 사람이 펼치거나 접은 작업 묶음 키(Work.key) → 펼쳤는지. 몇 초마다 대화를 다시 받아도 그대로이게 여기 둔다. 세션을 바꾸면 비운다.
   * 여기 없는 묶음은 설정 Work bundles(Collapsed·Expanded)를 따른다 — Expanded 에서 직접 접은 묶음은 접힌 채다
   */
  const [workToggles, setWorkToggles] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const { workBundles } = useSyncExternalStore(subscribeTheme, appearance).chat
  /** 대화 안 검색의 현재 결과 (data-jump-key). 노란 테두리를 늘 켜 둔다. 검색을 닫으면 null */
  const [searchCurrentKey, setSearchCurrentKey] = useState<string | null>(null)
  /** 검색이 이동한 결과. 바뀔 때마다 그 요소로 스크롤한다 (id 는 같은 결과로 다시 이동할 때도 새로 하려고) */
  const [searchScroll, setSearchScroll] = useState<{ key: string; id: number } | null>(null)
  const nextSearchScrollIdRef = useRef(1)
  /** 검색 대상은 검색을 열어 둔 동안만 만든다 (대화가 길어도 평소에는 비용이 없다) */
  const searchTargets = useMemo(() => (isSearchOpen ? buildSearchTargets(rows, memberOf) : []), [isSearchOpen, rows, memberOf])
  /**
   * 검색의 현재 결과가 바뀜. 사용자가 이동한 것이면(isNavigation) 접힌 작업 묶음 안이면 펼치고 그 요소로 스크롤한다.
   * 대화가 갱신돼 위치만 다시 잡힌 것이면 테두리만 옮기고 스크롤·펼치기는 하지 않는다 (읽던 자리에서 끌려가지 않게)
   */
  const handleSearchCurrentChange = useCallback((target: SearchTarget | null, isNavigation: boolean) => {
    setSearchCurrentKey(target?.key ?? null)
    if (!target || !isNavigation) return
    const { workKey } = target
    if (workKey) setWorkToggles((current) => (current.get(workKey) ? current : new Map(current).set(workKey, true)))
    // 안 그린 범위의 결과면 거기까지 그린다 (개수에는 처음부터 든다)
    revealRow(rowIndexOfJumpKey(rowsRef.current, target.key))
    setSearchScroll({ key: target.key, id: nextSearchScrollIdRef.current++ })
  }, [revealRow])

  /** 마크한 말풍선 (hq.json chatMarks, 마크한 순서). 대화 탭을 열거나 세션을 바꾸면 받는다. 세션 목록 SSE 에는 없다 */
  const [marks, setMarks] = useState<ChatMark[]>([])
  const marksRef = useRef(marks)
  marksRef.current = marks
  /** 줄에는 그 줄 것인지만 넘긴다 (마크 하나를 바꾸면 그 줄만 다시 그린다) */
  const markedKeys = useMemo(() => new Set(marks.map((mark) => mark.key)), [marks])
  /** 마크 요청은 보낸 순서대로 하나씩 (빨리 두 번 누르면 PUT·DELETE 가 거꾸로 닿지 않게) */
  const markQueueRef = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    setMarks([])
    let isCancelled = false
    fetch(`/api/sessions/${sessionId}/marks`, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ marks: ChatMark[] }>) : null))
      .then((data) => {
        if (!isCancelled && data) setMarks(data.marks)
      })
      .catch(() => {})
    return () => {
      isCancelled = true
    }
  }, [sessionId])
  /**
   * 말풍선 마크하기·풀기. 화면을 먼저 바꾸고 요청이 실패하면 그 마크만 되돌린 뒤 대화 맨 아래 한 줄로 알린다 (점프 "Message not found" 와 같은 자리).
   * 고정 함수라 줄 memo 를 깨지 않는다
   */
  const setMark = useCallback((key: string, isMarked: boolean) => {
    const targetSessionId = sessionIdRef.current
    const previous = marksRef.current.find((mark) => mark.key === key)
    if (isMarked === Boolean(previous)) return
    setMarks((current) => (isMarked ? withMark(current, key, new Date().toISOString()) : withoutMark(current, key)))
    markQueueRef.current = markQueueRef.current.then(async () => {
      let failure: string | null = null
      try {
        const response = await fetch(`/api/sessions/${targetSessionId}/marks/${encodeURIComponent(key)}`, { method: isMarked ? 'PUT' : 'DELETE' })
        if (!response.ok) failure = ((await response.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${response.status}`
      } catch {
        failure = 'Network error'
      }
      if (failure === null || sessionIdRef.current !== targetSessionId) return
      setMarks((current) => (isMarked ? withoutMark(current, key) : previous ? withMark(current, key, previous.createdAt) : current))
      setJumpNotice(`Couldn't ${isMarked ? 'mark' : 'unmark'} the message · ${failure}`)
    })
  }, [])
  /** 마크 창에서 고른 말풍선으로 간다: 점프와 같이 안 그린 줄이면 거기까지 그리고, 끝난 작업 묶음 안이면 펼친 뒤 강조 효과가 스크롤한다 */
  const nextMarkJumpIdRef = useRef(-1)
  const goToMark = useCallback(
    (key: string) => {
      const index = rowIndexOfJumpKey(rowsRef.current, key)
      if (index < 0) {
        setJumpNotice('Message not found')
        return
      }
      const row = rowsRef.current[index]
      if (row.kind === 'work' && !row.work.isInProgress) {
        const workKey = row.work.key
        setWorkToggles((current) => (current.get(workKey) ? current : new Map(current).set(workKey, true)))
      }
      revealRow(index)
      // 점프의 id(App 이 1부터 올린다)와 겹치지 않게 음수로
      setHighlight({ key, id: nextMarkJumpIdRef.current-- })
    },
    [revealRow],
  )

  /** 말풍선 인용 버튼: 입력 상자에 인용 칩을 붙인다 (보낼 때 글 앞에 붙는다 → composerText.ts withQuote). 고정 함수라 줄 memo 를 깨지 않는다 */
  const quoteMessage = useCallback((message: ChatMessage) => {
    composerRef.current?.quote({
      sessionId: sessionIdRef.current,
      key: message.id,
      isClaude: message.role === 'assistant',
      clock: formatClock(message.timestamp),
      text: message.text,
    })
  }, [])

  /** 마지막으로 받은 대화와 그 서버 버전. 같은 세션을 다시 받을 때 바뀐 뒤쪽만 받는다 (chatDelta.ts). 세션을 열거나 바꾸면 전체를 받는다 */
  const heldRef = useRef<HeldMessages | null>(null)
  useEffect(() => {
    let isCancelled = false
    loadMessages(sessionId, heldRef.current).then(({ messages: data, version: loadedVersion }) => {
      if (isCancelled) return
      heldRef.current = loadedVersion ? { sessionId, version: loadedVersion, messages: data } : null
      // 그대로인 메시지는 이전 객체를 쓴다 (줄마다 memo 가 걸려 새·바뀐 줄만 다시 그린다). 하나도 안 바뀌었으면 다시 그리지 않는다
      setMessages((current) => reuseMessages(current, data))
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
    setWorkToggles(new Map())
    setWindowStart(null)
    expandAnchorRef.current = null
    setSearchCurrentKey(null)
    setSearchScroll(null)
    setHighlight(null)
    setJumpNotice(null)
    setLineNotice(null)
    isFirstLoadRef.current = true
    isAtBottomRef.current = true
    setIsAtBottom(true)
    setHasUnread(false)
  }, [sessionId])

  // 이 세션 대화를 처음 받으면 최근 RENDER_STEP 줄의 첫 줄을 시작으로 정한다. 그 뒤로 새 메시지가 와도 시작 줄은 그대로라 아래쪽만 늘어난다
  useEffect(() => {
    if (windowStart || loadedSessionId !== sessionId || rows.length === 0) return
    setWindowStart(windowStartAt(rows, resolveStartIndex(rows, null)))
  }, [windowStart, loadedSessionId, sessionId, rows])

  // 작업 중 표시기도 같은 규칙: 맨 아래를 보고 있었을 때만 따라 내려간다
  useEffect(() => {
    if (isWorking && isAtBottomRef.current) scrollToBottom()
  }, [isWorking])

  // 진행 중 묶음이 끝나면(차례 끝·relay 등이 낌) 접힌 채 보이던 중간 설명 글이 줄 안으로 들어가 대화가 갑자기 줄어든다 (스크롤 이벤트가 없을 수 있다).
  // 그리기 전에, 맨 아래를 보고 있었으면 맨 아래에 두고 위를 읽던 중이면 움직이지 않고 "맨 아래를 보고 있는지" 만 다시 잰다 (줄어든 만큼 맨 아래에 닿았을 수 있다).
  // 줄은 처음부터 묶음 첫 자리에 있어 줄 위쪽은 움직이지 않는다
  useLayoutEffect(() => {
    if (isAtBottomRef.current) scrollToBottom()
    else onMessagesScroll()
  }, [liveWorkKey])

  /** 점프한 곳을 못 찾으면 세션만 연 것으로 하고 맨 아래에서 알린다 */
  function showJumpMissing() {
    scrollToBottom()
    setJumpNotice('Message not found')
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
    if (workKey) setWorkToggles((current) => new Map(current).set(workKey, true))
    // 안 그린 범위면 거기까지 그린 뒤 스크롤한다 (같은 렌더에 묶인다)
    revealRow(rowIndexOfJumpKey(rows, found.key))
    setHighlight({ key: found.key, id: jump.id })
  }, [jump, loadedSessionId, sessionId, messages, rows, onJumpHandled, revealRow])

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

  // 검색 막대가 열리고 닫히면 대화 높이가 막대만큼 바뀐다 (스크롤 이벤트가 없다). 맨 아래를 보고 있었으면 맨 아래에 두고, 아니면 다시 잰다
  useLayoutEffect(() => {
    if (isAtBottomRef.current) scrollToBottom()
    else onMessagesScroll()
  }, [isSearchOpen])

  // 검색이 이동한 결과를 (펼친 묶음까지 그려진 뒤) 가운데로 스크롤하고, 그 위치를 "맨 아래를 보고 있는지" 에 반영한다
  useLayoutEffect(() => {
    if (!searchScroll) return
    const element = messagesRef.current?.querySelector(`[data-jump-key="${CSS.escape(searchScroll.key)}"]`)
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    onMessagesScroll()
  }, [searchScroll])

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
  // 줄마다 넘기는 함수가 App 이 다시 그릴 때마다 바뀌지 않게 최신 값을 ref 로 읽는다
  const relayContextRef = useRef({ sessionNames, onOpenRelay })
  relayContextRef.current = { sessionNames, onOpenRelay }
  const openRelay = useCallback((relay: Relay, rowKey: string) => {
    const { memberSessionId } = relay
    if (!memberSessionId) return
    if (!Object.hasOwn(relayContextRef.current.sessionNames, memberSessionId)) {
      setLineNotice({ rowKey, text: "Can't open: no session record" })
      return
    }
    setLineNotice(null)
    relayContextRef.current.onOpenRelay(memberSessionId, { kind: relay.kind, text: relay.text, at: relay.at }, rowKey)
  }, [])

  const onMessagesScroll = useCallback(() => {
    const element = messagesRef.current
    if (!element) return
    const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX
    isAtBottomRef.current = isNearBottom
    setIsAtBottom(isNearBottom)
    if (isNearBottom) setHasUnread(false)
  }, [])

  /** 맨 위 가까이(EXPAND_TOP_PX 안) 스크롤했고 안 그린 이전 줄이 있으면 RENDER_STEP 줄 더 그린다. 지금 첫 줄의 화면 위치를 기억해 그린 뒤 보정한다 */
  const expandIfNearTop = useCallback(() => {
    const element = messagesRef.current
    const firstRow = earlierRef.current?.nextElementSibling
    if (!element || !firstRow || expandAnchorRef.current || startIndexRef.current === 0 || element.scrollTop >= EXPAND_TOP_PX) return
    expandAnchorRef.current = { element: firstRow, top: firstRow.getBoundingClientRect().top }
    setWindowStart(windowStartAt(rowsRef.current, expandedStartIndex(startIndexRef.current)))
  }, [])

  const onMessagesScrollEvent = useCallback(() => {
    onMessagesScroll()
    expandIfNearTop()
  }, [onMessagesScroll, expandIfNearTop])

  // 위로 더 그렸으면 그리기 전 첫 줄이 화면에서 같은 자리에 오게 scrollTop 을 보정한다 (브라우저가 이미 맞췄으면 0).
  // 보정한 뒤에도 맨 위 가까이면(줄이 작아서) 한 번 더 늘린다
  useLayoutEffect(() => {
    const anchor = expandAnchorRef.current
    const element = messagesRef.current
    if (!anchor || !element) return
    expandAnchorRef.current = null
    if (anchor.element.isConnected) element.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top
    onMessagesScroll()
    expandIfNearTop()
  }, [startIndex, onMessagesScroll, expandIfNearTop])

  const toggleWork = useCallback(
    (key: string, isOpen: boolean) => {
      flushSync(() => setWorkToggles((current) => new Map(current).set(key, !isOpen)))
      // 펼치면 내용만 길어지고 스크롤 이벤트가 없어 "맨 아래를 보고 있다" 가 남는다. 다음 갱신 때 펼친 것을 읽다 끌려 내려가지 않게 다시 잰다
      onMessagesScroll()
    },
    [onMessagesScroll],
  )

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

  /** 입력 상자가 보낸 글 (입력칸·보낸 첨부 칩은 입력 상자가 이미 비웠다) */
  function send(text: string) {
    // jsonl 에 남기까지(transcript 갱신 → 대화 전체 다시 받기) 기다리지 않고 내 말풍선을 바로 띄운다
    const pendingId = nextPendingIdRef.current++
    const knownIds = new Set(messages.map((message) => message.id))
    flushSync(() => setPendings((current) => [...current, { id: pendingId, text, knownIds, isFailed: false }]))
    scrollToBottom()
    setTimeout(() => setPendings((current) => current.filter((pending) => pending.id !== pendingId || pending.isFailed)), PENDING_TIMEOUT_MS)
    const markFailed = () =>
      setPendings((current) => current.map((pending) => (pending.id === pendingId ? { ...pending, isFailed: true } : pending)))
    // 글 전체를 한 번에 쓰고 잠시 뒤 Enter: 조각이나 \r 을 짧은 간격으로 이으면 claude 가 한 read 로 받아 \r 이 줄바꿈이 된다.
    // 앞 보내기의 \r 까지 끝난 뒤에 시작해야 두 글이 섞이지 않는다
    const run = async () => {
      try {
        if (!(await sendKeys(text)).ok) return markFailed()
        await new Promise((resolve) => setTimeout(resolve, SUBMIT_ENTER_DELAY_MS))
        if (!(await sendKeys('\r')).ok) markFailed()
      } catch {
        markFailed()
      }
    }
    sendQueueRef.current = sendQueueRef.current.then(run)
  }

  /** 입력칸의 `/btw`. 질문이면 카드에 바로 띄우고 서버 요청은 보내기 줄에 세운다 (서버가 pty 에 쓰는 명령 글이 앞 글·Enter 와 섞이지 않게) */
  function sendBtw(question: string | null) {
    const card = btwRef.current
    if (!card) return
    if (question === null) {
      card.open()
      return
    }
    const run = card.ask(question)
    sendQueueRef.current = sendQueueRef.current.then(run)
  }

  /** 곁가지 질문 카드를 열고 카드 입력칸에 포커스한다 (입력 상자 버튼·App 의 Ctrl+Shift+B) */
  function openBtwForInput() {
    btwRef.current?.openForInput()
  }

  /** 카드를 Esc 로 닫으면 대화 입력칸으로 돌아간다 (터치 기기는 가상 키보드가 뜨지 않게 그대로) */
  function focusComposer() {
    if (!window.matchMedia('(hover: none)').matches) composerRef.current?.focus()
  }

  // App 의 단축키가 올리는 카운터가 바뀔 때만 연다 (세션을 바꾸거나 Chat 이 처음 뜰 때는 열지 않는다)
  const handledBtwOpenIdRef = useRef(btwOpenId)
  useEffect(() => {
    if (btwOpenId === handledBtwOpenIdRef.current) return
    handledBtwOpenIdRef.current = btwOpenId
    openBtwForInput()
  }, [btwOpenId])

  /** 곁가지 질문 카드 높이가 바뀌면 맨 아래를 보고 있었을 때만 맨 아래에 둔다 (카드만큼 대화가 줄어 마지막 글이 가려지지 않게) */
  const keepBottomOnBtwResize = useCallback(() => {
    if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [])

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

  /** Esc 단축키가 부를 최신 interrupt (리스너를 렌더마다 다시 달지 않게) */
  const interruptRef = useRef(interrupt)
  interruptRef.current = interrupt

  // Esc = [중지]. [중지] 가 보일 때만, 포커스가 입력 상자거나 아무 데도 없을 때만 —
  // 모달(Modal 의 Esc 닫기는 전파를 안 막는다)·검색 막대·곁가지 카드·팝오버의 Esc 와 같이 일어나지 않게
  useEffect(() => {
    if (!canInterrupt || isInterrupting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
      if (document.querySelector('[aria-modal="true"]')) return
      const active = document.activeElement
      const isComposerFocused = active instanceof HTMLTextAreaElement && active.closest('form.composer') !== null
      if (!isComposerFocused && active !== document.body && active !== null) return
      event.preventDefault()
      void interruptRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canInterrupt, isInterrupting])

  /** 되돌아온 글(응답 전 중지·취소한 대기 메시지)을 웹 입력칸 맨 앞에 넣는다. 대화 탭을 떠나 Composer 가 없으면 저장소에만 넣고 다시 그려질 때 보인다 */
  function restoreToComposer(text: string) {
    restoreToComposerDraft(text)
    composerRef.current?.reload()
  }

  /**
   * 작업 중인 claude 를 멈춘다. 서버가 Esc 를 보내고 jsonl 로 결말을 확인해 준다 (최대 몇 초). 확인 창 없음.
   * 응답 전에 멈춰 보낸 글이 Claude Code 입력칸에 돌아왔으면 서버가 그 입력칸을 비우고 글(text)을 준다 — 웹 입력칸에 넣는다
   */
  async function interrupt() {
    const requestSessionId = sessionId
    setIsInterrupting(true)
    setInterruptNotice(null)
    let notice: string | null
    let isStopped = false
    let isRestored = false
    let restoredText: string | null = null
    try {
      const response = await fetch(`/api/sessions/${sessionId}/interrupt`, { method: 'POST' })
      const body = (await response.json().catch(() => ({}))) as { outcome?: string; text?: unknown; message?: string }
      const outcome = body.outcome ?? ''
      isStopped = response.ok && (outcome === 'stopped' || outcome === 'restored')
      isRestored = response.ok && outcome === 'restored'
      if (response.ok && typeof body.text === 'string' && body.text) restoredText = body.text
      // stopped 의 null(알리지 않음)이 ?? 로 unknown 문구가 되지 않게 키가 있는지로 본다
      notice = !response.ok
        ? `Couldn't stop: ${body.message ?? `HTTP ${response.status}`}`
        : outcome === 'restored' && restoredText !== null
          ? RESTORED_TO_INPUT_LABEL
          : Object.hasOwn(INTERRUPT_OUTCOME_LABELS, outcome)
            ? INTERRUPT_OUTCOME_LABELS[outcome]
            : INTERRUPT_OUTCOME_LABELS.unknown
    } catch {
      notice = 'Stop failed: network error'
    }
    // 세션을 바꿨으면 넣지 않는다 (입력칸은 세션마다가 아니라 한 벌이라 다른 세션으로 보내게 된다)
    if (sessionIdRef.current !== requestSessionId) return
    if (restoredText !== null) {
      // 응답 전 중지로 돌아온 글은 대화에서도 뺀다 (서버가 jsonl 줄을 빼고, 아직 확인 전인 임시 말풍선은 여기서. 15초 기다리지 않게)
      if (isRestored) {
        const restoredKey = messageKey(restoredText)
        setPendings((current) => current.filter((pending) => pending.isFailed || messageKey(pending.text) !== restoredKey))
      }
      restoreToComposer(restoredText)
    }
    // 멈췄으면 서버가 바꾼 상태가 와서 표시기가 사라질 때까지 "중지 중…" 그대로 (응답과 상태 갱신 사이에 [중지] 가 깜박이지 않게)
    if (!isStopped) setIsInterrupting(false)
    setInterruptNotice(notice)
  }

  /**
   * 마지막 대기 메시지를 Claude Code 대기열에서 뺀다. 서버가 ↑ 로 전부 꺼내고 나머지를 다시 넣은 뒤 결과를 준다 (몇 초 걸린다).
   * 뺐으면(cancelled) 그 글을 웹 입력칸에 넣는다
   */
  const cancelQueued = useCallback(async (message: ChatMessage) => {
    const requestSessionId = sessionId
    setCancellingId(message.id)
    setCancelNotice(null)
    let notice: string
    let isCancelled = false
    try {
      const response = await fetch(`/api/sessions/${sessionId}/queue/cancel-last`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text }),
      })
      const body = (await response.json().catch(() => ({}))) as { outcome?: string; message?: string }
      isCancelled = response.ok && body.outcome === 'cancelled'
      notice = response.ok
        ? (CANCEL_OUTCOME_LABELS[body.outcome ?? ''] ?? CANCEL_OUTCOME_LABELS.failed)
        : `couldn't cancel: ${body.message ?? `HTTP ${response.status}`}`
    } catch {
      notice = 'failed: network error'
    }
    if (sessionIdRef.current !== requestSessionId) return
    // 대기열에서 뺀 글은 고쳐 보낼 수 있게 웹 입력칸으로
    if (isCancelled) restoreToComposer(message.text)
    setCancellingId(null)
    setCancelNotice(notice)
  }, [sessionId])

  /** 파일을 끌고 들어오거나 위에서 움직일 때: 놓을 수 있으면 복사 커서와 안내, 아니면 금지 커서 (어느 쪽이든 브라우저가 파일을 열지 않게 막는다) */
  function onFileDragOver(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = canDropFiles ? 'copy' : 'none'
    if (canDropFiles && !isFileOver) setIsFileOver(true)
  }
  /** 대화 탭 밖으로 나갈 때만 안내를 끈다 (안쪽 요소 사이를 지날 때도 dragleave 가 온다) */
  function onFileDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFileOver(false)
  }
  function onFileDrop(event: DragEvent<HTMLDivElement>) {
    if (!isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    setIsFileOver(false)
    if (canDropFiles) composerRef.current?.attach(droppedFiles(event.dataTransfer))
  }

  return (
    <div className="chat" onDragEnter={onFileDragOver} onDragOver={onFileDragOver} onDragLeave={onFileDragLeave} onDrop={onFileDrop}>
      {isFileOver && canDropFiles && (
        <div className="drop-overlay" aria-hidden="true">
          <span>Drop files to attach</span>
        </div>
      )}
      <div className="messages-pane">
        {isSearchOpen && (
          <ChatSearch
            key={sessionId}
            targets={searchTargets}
            containerRef={messagesRef}
            focusId={searchFocusId}
            onClose={onSearchClose}
            onCurrentChange={handleSearchCurrentChange}
          />
        )}
        {/* chat-scope: 설정 창 Chat 탭의 대화 모양(<html data-chat-*>)이 걸리는 범위 */}
        <div className="messages chat-scope" ref={messagesRef} onScroll={onMessagesScrollEvent}>
          {/* 그리는 범위 밖 이전 줄이 있다는 표시. 바로 다음 요소가 첫 줄이라 위로 더 그릴 때 위치 보정의 기준이 된다 */}
          {startIndex > 0 && (
            <div ref={earlierRef} className="earlier-rows">
              Earlier messages · scroll up
            </div>
          )}
          {/* 대화 속 이 PC 파일 그림을 받을 세션: 지금 보이는 메시지의 세션 (세션을 바꾼 직후 messages 는 앞 세션 것이다) */}
          <ChatImageSession.Provider value={loadedSessionId}>
            <MessageRows
              rows={visibleRows}
              memberOf={memberOf}
              workToggles={workToggles}
              workBundles={workBundles}
              highlightKey={highlight?.key ?? null}
              searchKey={searchCurrentKey}
              lineNotice={lineNotice}
              lastQueuedId={lastQueuedId}
              canCancelQueued={canCancelQueued}
              cancellingId={cancellingId}
              markedKeys={markedKeys}
              onToggleWork={toggleWork}
              onOpenRelay={openRelay}
              onCancelQueued={cancelQueued}
              onSetMark={setMark}
              onQuote={isWritable ? quoteMessage : null}
            />
          </ChatImageSession.Provider>
          {pendings.map((pending) => (
            <div key={`pending-${pending.id}`} className={`msg user pending${pending.isFailed ? ' failed' : ''}`}>
              <div className="text">{pending.text}</div>
              <div className="pending-label">
                {pending.isFailed ? 'Send failed' : 'Sending'}
                {pending.isFailed && (
                  <button type="button" className="pending-dismiss" aria-label="Dismiss" onClick={() => dismissPending(pending.id)}>
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
          {cancelNotice && (
            <div className="queue-notice" role="status">
              Queued message · {cancelNotice}
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
          {messages.length === 0 && pendings.length === 0 && <p className="hint">No messages yet</p>}
          {isWorking && (
            <WorkingIndicator
              tools={runningTools}
              since={workingSince}
              onInterrupt={canInterrupt ? () => void interrupt() : null}
              isInterrupting={isInterrupting}
            />
          )}
          <div ref={bottomRef} />
        </div>
        {/* 맨 아래가 아닐 때만 뜨는 "↓": 입력칸 위 가운데. 오른쪽 묶음(도구 버튼) 개수와 관계없이 늘 같은 자리다 */}
        {!isAtBottom && (
          <button
            type="button"
            className="to-bottom"
            onClick={onToBottomClick}
            title="Scroll to bottom"
            aria-label={hasUnread ? 'Scroll to bottom (new messages)' : 'Scroll to bottom'}
          >
            ↓{hasUnread && <span className="to-bottom-dot" />}
          </button>
        )}
        {/* 오른쪽 아래 원 버튼 묶음. 화면에서는 아래부터 폴더 → 마크 → shell 로 쌓인다.
            자주 뜨고 숨는 것일수록 위에 둔다: shell 이 뜨고 끝나도 폴더는 그대로다 */}
        <div className="pane-buttons">
          <ShellsButton key={`shells:${sessionId}`} sessionId={sessionId} shells={shells} request={shellRequest} onRequestHandled={onShellRequestHandled} />
          <MarksButton key={`marks:${sessionId}`} marks={marks} messages={messages} onGo={goToMark} onSetMark={setMark} />
          <FilesButton key={sessionId} sessionId={sessionId} version={version} />
        </div>
      </div>
      {isWritable && question?.questions.length ? (
        <QuestionCard key={`${sessionId}:${question.questions.map((item) => item.question).join('\n')}`} sessionId={sessionId} questions={question.questions} />
      ) : (
        isWritable &&
        isApprovalNeeded &&
        // 질문에 Enter 는 1번 선택지로 답하고 Esc 는 작업을 멈추므로 승인 버튼을 주지 않는다 (서버가 질문을 놓쳤을 때. 서버 재시작 등)
        (pendingTool === ASK_TOOL ? (
          <div className="approval">Open the Terminal tab to answer the question</div>
        ) : (
          <div className="approval">
            <span>
              Needs approval: <code>{pendingTool ?? '?'}</code>
            </span>
            <button className="yes" onClick={() => void sendKeys('\r')}>
              Approve (Enter)
            </button>
            <button className="no" onClick={() => void sendKeys('\x1b')}>
              Deny (Esc)
            </button>
          </div>
        ))
      )}
      {isWritable && (
        <ChatImageSession.Provider value={sessionId}>
          <BtwCard
            key={sessionId}
            ref={btwRef}
            sessionId={sessionId}
            version={btwVersion}
            isAsking={isAsking}
            isApprovalNeeded={isApprovalNeeded}
            isHandingOver={isHandingOver}
            onAsk={sendBtw}
            onEscClosed={focusComposer}
            onResize={keepBottomOnBtwResize}
          />
        </ChatImageSession.Provider>
      )}
      {isWritable && handoverFrom !== null && (
        <div className="handover-band" role="status">
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="handover-text">{handoverBandText(handoverFrom)}</span>
        </div>
      )}
      {/* 쓸 수 없는 동안에도 마운트해 두어 쓰던 글·첨부가 남는다 (그동안은 아무것도 그리지 않는다) */}
      <Composer
        ref={composerRef}
        sessionId={sessionId}
        isWritable={isWritable}
        isAsking={isAsking}
        isHandingOver={isHandingOver}
        suggestion={isSuggestionShown ? suggestion : null}
        onEmptyChange={setIsDraftEmpty}
        onSend={send}
        onBtw={sendBtw}
        onOpenBtw={openBtwForInput}
        onGoQuote={goToMark}
      />
      {isWritable && (contextSize || turnCache || modelText || isModelRestarting || onChangeModel) && (
        <div className="composer-meta">
          {[
            contextSize &&
              (onHandOver ? (
                <button
                  key="context"
                  type="button"
                  className={`context-size ${contextSize.level} composer-hand-over`}
                  title={[contextSize.title, handOverTitle].filter(Boolean).join('\n')}
                  onClick={onHandOver}
                >
                  {contextSize.text}
                </button>
              ) : (
                <span key="context" className={`context-size ${contextSize.level}`} role="img" title={contextSize.title} aria-label={contextSize.title}>
                  {contextSize.text}
                </span>
              )),
            turnCache && (
              <span key="cache" title={turnCache.title} aria-label={turnCache.title}>
                {turnCache.text}
              </span>
            ),
            isModelRestarting ? (
              <span key="model" title="Restarting with the new model / effort">
                Restarting…
              </span>
            ) : onChangeModel ? (
              <button
                key="model"
                type="button"
                className="composer-model"
                title={[modelFullName, modelNextText && `Next: ${modelNextText}`, 'Change model & effort'].filter(Boolean).join('\n')}
                onClick={onChangeModel}
              >
                {modelText ?? 'Model'}
                {modelNextText && <span className="model-next"> → {modelNextText}</span>}
              </button>
            ) : (
              modelText && <span key="model">{modelText}</span>
            ),
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}
        </div>
      )}
      {!isWritable && (footer ?? <p className="hint">Started from a terminal or IDE, so this session is view-only</p>)}
    </div>
  )
}
