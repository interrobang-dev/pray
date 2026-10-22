import type { ChatMessage, ToolUse } from './types'

/** 작업 묶음에 들어간 claude 메시지 하나: 설명 글(답변 글이거나 글이 없으면 null)과 일반 도구 호출 */
export interface WorkPart {
  message: ChatMessage
  text: string | null
  toolUses: ToolUse[]
}

/** 답변 전 작업 묶음 = 한 줄로 접는 claude 의 중간 설명 글과 일반 도구 호출 */
export interface Work {
  /** 첫 메시지 ID. 펼침 상태를 기억하는 키 (대화를 다시 받아도 그대로다) */
  key: string
  parts: WorkPart[]
  toolCount: number
  /** 도구 이름별 개수. 많은 순 (같으면 먼저 쓴 순) */
  toolCounts: { name: string; count: number }[]
  /** 첫 메시지부터 묶음 다음 메시지(답변·relay)까지. 다음 메시지가 없으면 마지막 메시지까지 */
  durationMs: number
  /** 세션이 작업 중이고 대화 맨 끝(대기 메시지 제외)의 묶음 */
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

function workOf(parts: WorkPart[], run: RunItem[]): Work {
  const toolUses = parts.flatMap((part) => part.toolUses)
  const counts = new Map<string, number>()
  for (const toolUse of toolUses) counts.set(toolUse.name, (counts.get(toolUse.name) ?? 0) + 1)
  const lastPart = parts[parts.length - 1]
  const next = run[run.findIndex((item) => item.message === lastPart.message) + 1]
  const durationMs = Date.parse(next?.message.timestamp ?? lastPart.message.timestamp) - Date.parse(parts[0].message.timestamp)
  return {
    key: parts[0].message.id,
    parts,
    toolCount: toolUses.length,
    toolCounts: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    durationMs: Math.max(0, durationMs) || 0,
    isInProgress: false,
  }
}

/** relay·질문 카드 사이의 메시지들. 답변이 이 안에 있으면 묶음을 답변 바로 위에 둔다. 도구가 하나도 없으면 묶지 않고 글 말풍선 그대로 */
function runRows<S>(run: RunItem[], answer: ChatMessage | undefined): ChatRow<S>[] {
  const parts: WorkPart[] = run
    .map(({ message, toolUses }) => ({ message, text: message === answer || !message.text ? null : message.text, toolUses }))
    .filter((part) => part.text !== null || part.toolUses.length > 0)
  const rows: ChatRow<S>[] = parts.some((part) => part.toolUses.length > 0)
    ? [{ kind: 'work', work: workOf(parts, run) }]
    : parts.map((part) => ({ kind: 'text', message: part.message }))
  if (answer && run.some((item) => item.message === answer)) rows.push({ kind: 'text', message: answer })
  return rows
}

/** 사람 쪽·system 메시지 사이의 claude 메시지들. 마지막으로 글이 있는 메시지의 글만 답변이다 */
function segmentRows<S>(segment: ChatMessage[], classify: (toolUse: ToolUse, message: ChatMessage) => S | null): ChatRow<S>[] {
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
      rows.push(...runRows<S>(run, answer), ...specials)
      run = []
    }
  }
  rows.push(...runRows<S>(run, answer))
  return rows
}

/**
 * 대화 메시지 → 화면 줄. 사람 쪽·system 메시지(대기 중 포함)가 구간을 나누고, 구간 안의 claude 중간 설명 글과 일반 도구 호출
 * (classify 가 null 을 준 것)을 작업 묶음 하나로 접는다. 작업 중이면 대화 맨 끝(대기 메시지 제외) 묶음이 진행 중이다.
 * classify 는 도구 호출과 그 호출이 든 메시지를 받는다
 */
export function buildChatRows<S>(
  messages: ChatMessage[],
  classify: (toolUse: ToolUse, message: ChatMessage) => S | null,
  isWorking: boolean,
): ChatRow<S>[] {
  const rows: ChatRow<S>[] = []
  let segment: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      segment.push(message)
      continue
    }
    rows.push(...segmentRows(segment, classify), { kind: 'message', message })
    segment = []
  }
  rows.push(...segmentRows(segment, classify))
  if (!isWorking) return rows
  const isQueuedRow = (row: ChatRow<S> | undefined) => row?.kind === 'message' && row.message.isQueued === true
  let lastIndex = rows.length - 1
  while (isQueuedRow(rows[lastIndex])) lastIndex--
  // 묶음이 맨 끝이거나 바로 뒤가 그 답변(지금 글)이면 진행 중. 묶음 바로 뒤의 글 말풍선은 늘 그 묶음의 답변이다 (묶음 뒤에는 답변·relay·질문 카드·구간 끝만 온다)
  const workIndex = rows[lastIndex]?.kind === 'text' ? lastIndex - 1 : lastIndex
  const row = rows[workIndex]
  if (row?.kind === 'work') rows[workIndex] = { kind: 'work', work: { ...row.work, isInProgress: true } }
  return rows
}
