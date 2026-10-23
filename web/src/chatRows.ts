import type { ChatMessage, ToolUse } from './types'

/** 작업 묶음에 들어간 claude 메시지 하나: 설명 글(답변 글이거나 글이 없으면 null)과 일반 도구 호출 */
export interface WorkPart {
  message: ChatMessage
  text: string | null
  toolUses: ToolUse[]
}

/** 답변 전 작업 묶음 = 한 줄로 접는 claude 의 중간 설명 글과 일반 도구 호출 */
export interface Work {
  /**
   * 묶음 구간(relay·질문 카드·사람 쪽·system 메시지 사이)의 첫 메시지 ID. 펼침 상태를 기억하는 키 (대화를 다시 받아도 그대로다).
   * 글·도구가 없는 메시지여도 구간 첫 메시지라 차례가 끝나 답변이 빠져도 바뀌지 않는다
   */
  key: string
  parts: WorkPart[]
  toolCount: number
  /** 도구 이름별 개수. 많은 순 (같으면 먼저 쓴 순) */
  toolCounts: { name: string; count: number }[]
  /** 첫 메시지부터 묶음 다음 메시지(답변·relay)까지. 다음 메시지가 없으면 마지막 메시지까지 */
  durationMs: number
  /**
   * 아직 안 끝난 묶음 = 차례가 진행 중이고 대화 맨 끝(대기 메시지 제외)의 묶음. 접혀 있어도 설명 글은 말풍선으로 보이고(도구 줄만 접힌다)
   * 줄에 시간이 없다. 아직 답변인지 모르는 가장 최근 글도 따로 빼지 않고 parts 의 제자리에 든다
   */
  isInProgress: boolean
}

/**
 * 대화 탭의 한 줄. message = 사람 쪽·system 메시지(지금처럼 그린다), text = claude 글 말풍선(답변 또는 도구 없는 구간의 글),
 * work = 작업 묶음, special = 묶지 않는 도구 호출 (relay 말풍선·질문 카드. S 는 Chat 이 정한다)
 */
export type ChatRow<S> =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'text'; message: ChatMessage }
  | { kind: 'work'; work: Work }
  | { kind: 'special'; toolUse: ToolUse; special: S }

interface RunItem {
  message: ChatMessage
  /** classify 가 null 을 준 도구 호출 */
  toolUses: ToolUse[]
}

function workOf(parts: WorkPart[], run: RunItem[], isInProgress: boolean): Work {
  const toolUses = parts.flatMap((part) => part.toolUses)
  const counts = new Map<string, number>()
  for (const toolUse of toolUses) counts.set(toolUse.name, (counts.get(toolUse.name) ?? 0) + 1)
  const lastPart = parts[parts.length - 1]
  const next = run[run.findIndex((item) => item.message === lastPart.message) + 1]
  const durationMs = Date.parse(next?.message.timestamp ?? lastPart.message.timestamp) - Date.parse(parts[0].message.timestamp)
  return {
    key: run[0].message.id,
    parts,
    toolCount: toolUses.length,
    toolCounts: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    durationMs: Math.max(0, durationMs) || 0,
    isInProgress,
  }
}

/**
 * relay·질문 카드 사이의 메시지들. 답변이 이 안에 있으면 묶음을 답변 바로 위에 둔다. 도구가 하나도 없으면 묶지 않고 글 말풍선 그대로.
 * 진행 중이면 답변을 빼지 않는다 (Chat 이 parts 의 설명 글을 시간 순서대로 그린다)
 */
function runRows<S>(run: RunItem[], answer: ChatMessage | undefined, isInProgress: boolean): ChatRow<S>[] {
  const separateAnswer = isInProgress ? undefined : answer
  const parts: WorkPart[] = run
    .map(({ message, toolUses }) => ({ message, text: message === separateAnswer || !message.text ? null : message.text, toolUses }))
    .filter((part) => part.text !== null || part.toolUses.length > 0)
  const rows: ChatRow<S>[] = parts.some((part) => part.toolUses.length > 0)
    ? [{ kind: 'work', work: workOf(parts, run, isInProgress) }]
    : parts.map((part) => ({ kind: 'text', message: part.message }))
  if (separateAnswer && run.some((item) => item.message === separateAnswer)) rows.push({ kind: 'text', message: separateAnswer })
  return rows
}

/**
 * 사람 쪽·system 메시지 사이의 claude 메시지들. 마지막으로 글이 있는 메시지의 글만 답변이다.
 * isLive 면 이 구간이 진행 중인 차례의 끝이라 마지막 relay·질문 카드 뒤의 묶음이 진행 중이다
 */
function segmentRows<S>(segment: ChatMessage[], classify: (toolUse: ToolUse, message: ChatMessage) => S | null, isLive: boolean): ChatRow<S>[] {
  const answer = [...segment].reverse().find((message) => message.text)
  const rows: ChatRow<S>[] = []
  let run: RunItem[] = []
  for (const message of segment) {
    const specials: ChatRow<S>[] = []
    const toolUses: ToolUse[] = []
    for (const toolUse of message.toolUses) {
      const special = classify(toolUse, message)
      if (special === null) toolUses.push(toolUse)
      else specials.push({ kind: 'special', toolUse, special })
    }
    run.push({ message, toolUses })
    // 지금 화면처럼 메시지 안에서는 글·일반 도구 다음에 relay·질문 카드. 그 자리에서 묶음을 나눈다
    if (specials.length > 0) {
      rows.push(...runRows<S>(run, answer, false), ...specials)
      run = []
    }
  }
  rows.push(...runRows<S>(run, answer, isLive))
  return rows
}

/**
 * 대화 메시지 → 화면 줄. 사람 쪽·system 메시지(대기 중 포함)가 구간을 나누고, 구간 안의 claude 중간 설명 글과 일반 도구 호출
 * (classify 가 null 을 준 것)을 작업 묶음 하나로 접는다. 차례가 진행 중(isTurnInProgress)이고 대화 맨 끝(대기 메시지 제외)이
 * claude 메시지면 그 구간의 마지막 묶음은 아직 안 끝난 것이라 진행 중이다. classify 는 도구 호출과 그 호출이 든 메시지를 받는다
 */
export function buildChatRows<S>(
  messages: ChatMessage[],
  classify: (toolUse: ToolUse, message: ChatMessage) => S | null,
  isTurnInProgress: boolean,
): ChatRow<S>[] {
  const lastMessage = [...messages].reverse().find((message) => !message.isQueued)
  const liveMessage = isTurnInProgress && lastMessage?.role === 'assistant' ? lastMessage : undefined
  const rows: ChatRow<S>[] = []
  let segment: ChatMessage[] = []
  const flushSegment = () => segmentRows(segment, classify, liveMessage !== undefined && segment.at(-1) === liveMessage)
  for (const message of messages) {
    if (message.role === 'assistant') {
      segment.push(message)
      continue
    }
    rows.push(...flushSegment(), { kind: 'message', message })
    segment = []
  }
  rows.push(...flushSegment())
  return rows
}

/**
 * 접혀 있으면 이 메시지의 설명 글을 감추는 작업 묶음의 키 (점프가 찾은 글을 보이게 펼치려고). 끝난 묶음 안 설명 글이면 그 묶음,
 * 진행 중 묶음은 접혀 있어도 설명 글이 말풍선으로 보이므로 null. 답변·묶음 밖 메시지도 null
 */
export function hidingWorkKey<S>(rows: ChatRow<S>[], message: ChatMessage): string | null {
  for (const row of rows) {
    if (row.kind !== 'work' || row.work.isInProgress) continue
    if (row.work.parts.some((part) => part.message === message && part.text !== null)) return row.work.key
  }
  return null
}
