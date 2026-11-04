import { isInterruptText } from './interrupt.js'

export interface ToolUse {
  id: string
  name: string
  input: unknown
  result: string | null
  /** AskUserQuestion 에 답한 기록 ({ 질문문: 답 }). 결과 줄의 toolUseResult.answers */
  answers?: Record<string, string>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  timestamp: string
  text: string
  toolUses: ToolUse[]
  /** 서버가 보낸 팀장·파트장 지시인 user 메시지에만 있다 (instructions.jsonl 과 내용이 같은 것) */
  from?: { sessionId: string | null; name: string }
  /** 작업 중에 보내 아직 Claude Code 대기열에 있는 메시지에만 있다. 대화 맨 끝에 온다 */
  isQueued?: boolean
  /** Claude Code 가 대화를 압축하며 남긴 요약 (role system, text 는 요약 원문)에만 있다 */
  isCompactSummary?: true
  /** 사람이 작업을 중지(Esc)해 Claude Code 가 남긴 "[Request interrupted by user]" 줄 (role system, text 는 원문)에만 있다 */
  isInterrupt?: true
}

/** instructions.jsonl 한 줄. 서버가 팀원 터미널에 지시를 보낼 때 남긴다 */
export interface InstructionRecord {
  /** 받는 팀원 */
  sessionId: string
  /** 그 지휘 단위의 팀장·파트장. 없으면 null */
  fromSessionId: string | null
  text: string
  at: string
}

interface Block {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
}

const RESULT_LIMIT = 2000
/**
 * 이 도구들의 결과는 자르지 않는다: 팀원 보고가 결과 JSON 안에 있어 자르면 화면이 해석하지 못한다.
 * 팀 MCP 의 서버 키는 지금 pray, 이름을 바꾸기 전 리드는 jk-corp — 옛 jsonl 이 남아 있어 둘 다 영구로 본다
 */
const UNLIMITED_RESULT_PREFIXES = ['mcp__pray__', 'mcp__jk-corp__']

function resultToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'object' && item && 'text' in item ? String((item as Block).text) : ''))
      .join('\n')
  }
  return ''
}

/** AskUserQuestion 결과 줄의 toolUseResult({ questions, answers, annotations })에서 답만. 문자열 아닌 값은 뺀다 */
function askAnswers(toolUseResult: unknown): Record<string, string> | null {
  const answers = (toolUseResult as { answers?: unknown } | undefined)?.answers
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return null
  const entries = Object.entries(answers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/**
 * Claude Code 가 붙여넣기로 받은 글(pty 입력 조각)을 감싼 꼴: `\n\n<pasted_content id="4자리 hex">\n` + 글 + `\n</pasted_content id="같은 id">\n\n`.
 * 감쌀 때 넣은 줄바꿈(앞뒤 최대 2개씩, 태그 안쪽 1개씩)까지 지우면 보낸 글이 그대로 돌아온다 (Claude Code 자신의 풀기 함수와 같은 규칙)
 */
const PASTE_BLOCK = /\n{0,2}<pasted_content id="([0-9a-f]{4})">\n([\s\S]*?)\n<\/pasted_content id="\1">\n{0,2}/g

export function unwrapPastes(text: string): string {
  return text.replace(PASTE_BLOCK, '$2')
}

interface QueueItem {
  id: string
  timestamp: string
  content: string | undefined
}

/** 대기열과, 지금이 프로세스가 떠난 뒤(cost-state) 다음 대화 줄이 오기 전인지 (applyQueueRecord) */
interface QueueState {
  items: QueueItem[]
  isAfterExit: boolean
}

/** 끝나는 프로세스가 같이 끈 백그라운드 작업 알림 (status killed) */
function isKilledNotification(content: string | undefined): boolean {
  return content !== undefined && content.startsWith('<task-notification>') && content.includes('<status>killed</status>')
}

/** 대기열에서 빼는 queue-operation. popAll 은 빈 입력칸 ↑ 로 대기 메시지를 입력칸에 꺼낸 것(꺼낸 것마다 한 줄), popOne 은 하나만 꺼낸 것 */
const TAKE_OPERATIONS = new Set(['remove', 'popAll', 'popOne'])

/** 사람 쪽 글: 문자열 그대로이거나 text 블록만 남긴 배열 (userTextMessage·promptAfter 는 text 블록만 본다). 그 밖의 꼴은 undefined */
type HumanContent = string | Block[] | undefined

/**
 * jsonl 한 줄에서 메시지를 만드는 데 쓰는 것만 남긴 것 (buildMessages 가 쓴다). 사이드체인·메타·빈 줄·깨진 줄·쓰지 않는 줄은 null.
 * 줄 번호가 대기 메시지 id 가 되므로 배열은 jsonl 줄과 같은 자리다
 */
export type MessageLine =
  | { type: 'queue-operation'; timestamp: string; operation: unknown; content: string | undefined }
  | { type: 'cost-state' }
  | { type: 'queued-command'; uuid: string | undefined; timestamp: string; prompt: HumanContent }
  | { type: 'compact-summary'; uuid: string | undefined; timestamp: string; text: string }
  | {
      type: 'user'
      uuid: string | undefined
      /** 대화 사슬의 앞 줄. null = 사슬의 맨 앞(세션 첫 줄), undefined = 필드 없음 (되돌린 글 가리기 restoredPromptLines) */
      parentUuid: string | null | undefined
      timestamp: string
      content: HumanContent
      toolResults: ToolResultLine[]
    }
  | { type: 'assistant'; uuid: string | undefined; timestamp: string; messageId: unknown; blocks: Block[] }

/** user 줄의 도구 결과. 앞서 나온 도구 호출(이름을 아는 것)에 붙는 것만 남기고 결과 글은 그 이름으로 이미 잘랐다 */
interface ToolResultLine {
  toolUseId: string
  result: string
  /** AskUserQuestion 결과일 때만 (toolUseResult.answers) */
  answers: Record<string, string> | null
}

function humanContent(content: unknown): HumanContent {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return (content as Block[]).filter((block) => block.type === 'text' && block.text)
}

/**
 * jsonl 줄 → MessageLine. 줄마다 JSON.parse 하는 비싼 단계라 덧붙은 줄만 넣을 수 있게 앞 줄의 상태(도구 호출 ID → 이름)를 들고 있다.
 * 도구 결과를 자를지(UNLIMITED_RESULT_PREFIXES)는 그 앞에 나온 도구 호출 이름으로 정한다 (buildMessages 가 결과를 붙이는 도구 호출과 같은 것)
 */
export class MessageLineParser {
  readonly lines: (MessageLine | null)[] = []
  private readonly toolNames = new Map<string, string>()

  /** 끝난 줄을 넣는다 */
  push(line: string): void {
    this.lines.push(this.parse(line, true))
  }

  /** 아직 덜 쓰였을 수 있는 마지막 줄을 상태를 바꾸지 않고 해석한다 (다 쓰이면 push 로 다시 넣는다) */
  peek(line: string): MessageLine | null {
    return this.parse(line, false)
  }

  private parse(line: string, isCommitted: boolean): MessageLine | null {
    if (!line.trim()) return null
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      return null
    }
    if (record.isSidechain || record.isMeta) return null
    const type = record.type
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : ''
    const uuid = typeof record.uuid === 'string' ? record.uuid : undefined
    if (type === 'cost-state') return { type }
    if (type === 'queue-operation') {
      return { type, timestamp, operation: record.operation, content: typeof record.content === 'string' ? record.content : undefined }
    }
    if (type === 'attachment') {
      const attachment = record.attachment as { type?: string; prompt?: unknown } | undefined
      if (attachment?.type !== 'queued_command') return null
      return { type: 'queued-command', uuid, timestamp, prompt: humanContent(attachment.prompt) }
    }
    if (type !== 'user' && type !== 'assistant') return null
    const message = record.message as { id?: unknown; content?: string | Block[] } | undefined
    const content = message?.content

    if (type === 'user') {
      if (record.isCompactSummary === true) return { type: 'compact-summary', uuid, timestamp, text: resultToText(content) }
      const toolResults: ToolResultLine[] = []
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue
          const name = this.toolNames.get(block.tool_use_id)
          if (name === undefined) continue
          const result = resultToText(block.content)
          toolResults.push({
            toolUseId: block.tool_use_id,
            result: UNLIMITED_RESULT_PREFIXES.some((prefix) => name.startsWith(prefix)) ? result : result.slice(0, RESULT_LIMIT),
            answers: name === 'AskUserQuestion' ? askAnswers(record.toolUseResult) : null,
          })
        }
      }
      const parentUuid = record.parentUuid === null ? null : typeof record.parentUuid === 'string' ? record.parentUuid : undefined
      return { type, uuid, parentUuid, timestamp, content: humanContent(content), toolResults }
    }

    if (!Array.isArray(content)) return null
    const blocks = content.filter((block) => (block.type === 'text' && block.text) || (block.type === 'tool_use' && block.id))
    if (isCommitted) {
      for (const block of blocks) if (block.type === 'tool_use') this.toolNames.set(block.id!, block.name ?? '?')
    }
    return { type, uuid, timestamp, messageId: message?.id, blocks }
  }
}

/** jsonl 전체 → MessageLine 배열 (jsonl.split('\n') 과 같은 자리) */
function messageLinesOf(jsonl: string): (MessageLine | null)[] {
  const parser = new MessageLineParser()
  for (const line of jsonl.split('\n')) parser.push(line)
  return parser.lines
}

/**
 * dequeue 바로 뒤에 claude 가 받은 글: 다음 queue-operation 전에 처음 나오는 사람 쪽 글(user 줄의 글·queued_command 첨부). 없으면 undefined.
 * 차례가 끝난 뒤 꺼낸 것은 바로 뒤에 같은 글의 user 줄로 남는다 (슬래시 명령·글 없는 enqueue 는 글이 달라 맞지 않는다)
 */
function promptAfter(lines: readonly (MessageLine | null)[], index: number): string | undefined {
  for (let next = index + 1; next < lines.length; next++) {
    const line = lines[next]
    if (!line) continue
    if (line.type === 'queue-operation') return undefined
    if (line.type === 'queued-command') return typeof line.prompt === 'string' ? line.prompt : undefined
    if (line.type !== 'user') continue
    const { content } = line
    if (typeof content === 'string') return content
    const texts = Array.isArray(content) ? content.map((block) => block.text!) : []
    if (texts.length > 0) return texts.join('\n')
  }
  return undefined
}

/**
 * queue-operation·cost-state 한 줄을 대기열에 반영한다. enqueue 에는 uuid 가 없어 줄 번호로 id 를 만든다 (jsonl 은 덧붙기만 해서 다시 받아도 같다).
 * remove·popAll·popOne 은 이유(받아들임·취소·꺼냄)와 관계없이 글이 같은 것 중 먼저 들어온 것을 뺀다.
 * dequeue 는 글이 없다. 바로 뒤에 claude 가 받은 글(promptAfter)과 같은 것을, 없으면 맨 앞을 뺀다 (Claude Code 는 우선순위(jsonl 에 없음)가 같으면 먼저 들어온 것부터 뺀다).
 * cost-state 는 Claude Code 프로세스가 이 세션을 떠날 때(종료·kill·호스트 재시작·세션 전환) 남기는 줄이고 정상 진행 중에는 안 나온다.
 * 대기열은 프로세스 메모리에만 있어 그 프로세스와 함께 사라지므로 여기서 비운다 (다시 뜬 프로세스는 못 받은 알림을 "stopped" 알림으로 새로 enqueue 한다).
 * 안 비우면 주인 없는 항목이 맨 앞에 남아 그 뒤 dequeue 가 한 칸씩 어긋나 가장 최근에 받은 것이 늘 대기 중으로 보인다.
 * 강제 종료로 cost-state 가 없을 때도 dequeue 를 글로 맞추면 남은 항목만 남고 어긋나지 않는다.
 * **끝나는 프로세스는 cost-state 를 남긴 뒤 같이 끈 백그라운드 shell 의 killed 알림을 자기 대기열에 넣는다** (트레이 Quit·호스트 재시작 때.
 * 실제 jsonl 에서 cost-state 와 다음 대화 줄 사이의 killed 알림 22건은 모두 꺼낸 기록이 없었고, 그 사이 새 프로세스가 넣는 것은 stopped 알림이었다).
 * 그 프로세스는 이미 없어 영영 대기 중으로 남아 대화 맨 끝에 계속 붙으므로, 대기열에 넣지 않고 돌려준다 — buildMessages 가 그 자리에 한 번 보인다
 */
function applyQueueRecord(
  queue: QueueState,
  line: Extract<MessageLine, { type: 'queue-operation' | 'cost-state' }>,
  index: number,
  lines: readonly (MessageLine | null)[],
): QueueItem | null {
  if (line.type === 'cost-state') {
    queue.items.length = 0
    queue.isAfterExit = true
    return null
  }
  const { content, operation } = line
  if (operation === 'enqueue') {
    const item = { id: `queued-${index}`, timestamp: line.timestamp, content }
    if (queue.isAfterExit && isKilledNotification(content)) return item
    queue.items.push(item)
  }
  if (TAKE_OPERATIONS.has(operation as string)) {
    const position = queue.items.findIndex((item) => item.content === content)
    if (position >= 0) queue.items.splice(position, 1)
  }
  if (operation === 'dequeue' && queue.items.length > 0) {
    const prompt = promptAfter(lines, index)
    const position = prompt === undefined ? -1 : queue.items.findIndex((item) => item.content === prompt)
    queue.items.splice(Math.max(position, 0), 1)
  }
  return null
}

/**
 * 응답 전 중지(Esc)로 Claude Code 입력칸에 되돌아간 사람 글 줄의 번호. 그 줄은 보낼 때 이미 jsonl 에 적혀 남지만 대화에서 빠진다:
 * 다음 사람 쪽 줄이 그 줄을 건너뛰어 같은 앞 줄(parentUuid)에 붙고(형제), 되돌린 줄 아래에는 첨부만 있고 claude 응답이 없다 (실측 2.1.312).
 * 그래서 사람 글 줄 R 뒤에 claude 응답 없이 같은 parentUuid 의 user 줄이 오면 R 을 되돌린 글로 본다.
 * 다음 글을 보내기 전(형제가 아직 없을 때)은 가리지 못한다 — Esc 때는 jsonl 에 아무 줄도 붙지 않는다.
 * 프로세스가 끝났다 resume 하면 R 아래에 "No response requested." 응답이 붙어 R 이 문맥에 들어가므로(실측) 그때는 가리지 않는다 (응답이 형제보다 먼저 온다)
 */
function restoredPromptLines(lines: readonly (MessageLine | null)[]): Set<number> {
  const restored = new Set<number>()
  /** 마지막 claude 응답 뒤에 나온 사람 글 줄: parentUuid → 줄 번호 */
  const prompts = new Map<string | null, number>()
  for (const [index, line] of lines.entries()) {
    if (line?.type === 'assistant') prompts.clear()
    if (line?.type !== 'user' || line.parentUuid === undefined) continue
    const sibling = prompts.get(line.parentUuid)
    if (sibling !== undefined) restored.add(sibling)
    const text = line.toolResults.length === 0 ? userTextMessage('', '', line.content)?.text : undefined
    const isPrompt = text !== undefined && !isInterruptText(text)
    if (isPrompt) prompts.set(line.parentUuid, index)
    else prompts.delete(line.parentUuid)
  }
  return restored
}

/** 사람 쪽 글 → 메시지. 문자열이 `<` 로 시작하면 system (명령 출력·알림 등. 붙여넣기를 풀기 전 글로 본다), 블록 배열이면 text 블록만 (없으면 null) */
function userTextMessage(id: string, timestamp: string, content: unknown): ChatMessage | null {
  if (typeof content === 'string') {
    return { id, role: content.startsWith('<') ? 'system' : 'user', timestamp, text: unwrapPastes(content), toolUses: [] }
  }
  if (!Array.isArray(content)) return null
  const text = (content as Block[])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!)
    .join('\n')
  return text ? { id, role: 'user', timestamp, text: unwrapPastes(text), toolUses: [] } : null
}

/**
 * jsonl 전체를 채팅 메시지 배열로 바꾼다. 사이드체인·메타·thinking 은 뺀다. 압축 요약(isCompactSummary)은 system 이다.
 * 작업 중에 보낸 메시지는 user 로 남지 않는다: 보낼 때 queue-operation enqueue, 차례 중간에 받아들이면 remove +
 * queued_command 첨부(그 위치에 user 로 넣는다), 차례가 끝난 뒤 받으면 dequeue + 일반 user, ↑ 로 입력칸에 꺼내면 popAll.
 * 아직 대기 중인 것(지금 프로세스가 넣은 것만. applyQueueRecord)은 맨 끝에 isQueued 로 붙인다
 */
export function parseMessages(jsonl: string): ChatMessage[] {
  return buildMessages(messageLinesOf(jsonl))
}

/**
 * MessageLine 배열 → 채팅 메시지 배열 (parseMessages 의 뒷단계). 매번 새 객체를 만들고 lines 는 바꾸지 않는다.
 * 앞 메시지도 뒤 줄에 따라 바뀐다: 도구 결과는 앞의 도구 호출에, 같은 message.id 의 assistant 줄은 앞 메시지에 붙고, 대기열은 맨 끝에 붙는다
 */
export function buildMessages(lines: readonly (MessageLine | null)[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const toolUseById = new Map<string, ToolUse>()
  const assistantByMessageId = new Map<unknown, ChatMessage>()
  /** 대기열 (enqueue 순). 글이 없는 enqueue 도 dequeue 순서를 맞추려고 넣고 화면에는 안 낸다 */
  const queue: QueueState = { items: [], isAfterExit: false }
  const restored = restoredPromptLines(lines)

  for (const [index, line] of lines.entries()) {
    if (!line) continue
    if (line.type === 'queue-operation' || line.type === 'cost-state') {
      // 끝난 프로세스가 남긴 killed 알림은 대기 중이 아니라 그 자리의 system 글
      const leftover = applyQueueRecord(queue, line, index, lines)
      const notice = leftover && userTextMessage(leftover.id, leftover.timestamp, leftover.content)
      if (notice) messages.push(notice)
      continue
    }
    queue.isAfterExit = false
    const { timestamp } = line
    const uuid = line.uuid ?? `${messages.length}`

    if (line.type === 'queued-command') {
      const queued = userTextMessage(uuid, timestamp, line.prompt)
      if (queued) messages.push(queued)
      continue
    }
    // 압축 요약은 type user 줄이지만 사람 말이 아니다. 붙여넣기 풀기 없이 원문 그대로 system 으로 낸다
    if (line.type === 'compact-summary') {
      if (line.text) messages.push({ id: uuid, role: 'system', timestamp, text: line.text, toolUses: [], isCompactSummary: true })
      continue
    }
    if (line.type === 'user') {
      for (const { toolUseId, result, answers } of line.toolResults) {
        const toolUse = toolUseById.get(toolUseId)
        if (!toolUse) continue
        toolUse.result = result
        if (answers) toolUse.answers = answers
      }
      // 응답 전 중지로 입력칸에 되돌아가 대화에서 빠진 글
      if (restored.has(index)) continue
      const user = userTextMessage(uuid, timestamp, line.content)
      // 중지 기록은 사람 쪽 글 줄로 남지만 사람 말이 아니다
      if (user && isInterruptText(user.text)) messages.push({ ...user, role: 'system', isInterrupt: true })
      else if (user) messages.push(user)
      continue
    }

    const messageId = line.messageId ?? uuid
    let target = assistantByMessageId.get(messageId)
    if (!target) {
      target = { id: uuid, role: 'assistant', timestamp, text: '', toolUses: [] }
      assistantByMessageId.set(messageId, target)
      messages.push(target)
    }
    for (const block of line.blocks) {
      if (block.type === 'text' && block.text) {
        target.text = target.text ? `${target.text}\n${block.text}` : block.text
      }
      if (block.type === 'tool_use' && block.id) {
        const toolUse: ToolUse = { id: block.id, name: block.name ?? '?', input: block.input, result: null }
        toolUseById.set(block.id, toolUse)
        target.toolUses.push(toolUse)
      }
    }
  }
  for (const item of queue.items) {
    const queued = userTextMessage(item.id, item.timestamp, item.content)
    if (queued) messages.push({ ...queued, isQueued: true })
  }
  return messages
}

/**
 * isQueued 메시지를 뺀다. 근무 중이 아닌(휴식·퇴근) 세션용: 대기열은 claude 프로세스 메모리에만 있어 프로세스와 함께 사라졌다.
 * cost-state 로 비운 뒤에도 끝나는 프로세스가 알림을 enqueue 하거나, 강제 종료로 cost-state 가 없으면 jsonl 에는 대기 중으로 남는다
 */
export function withoutQueued(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => !message.isQueued)
}

/** 아직 대기 중인 사람 쪽 글. raw 는 jsonl content 그대로(↑ 로 꺼내면 입력칸에 들어가는 글), text 는 화면 글(붙여넣기를 푼 것) */
export interface QueuedPrompt {
  raw: string
  text: string
}

/**
 * 대기열에 남은 사람 쪽 글 (들어온 순). 대화 탭의 "대기 중" user 말풍선과 같은 것이다: 글 없는 enqueue(플러그인이 넣은 것. ↑ 로 안 꺼내진다)와
 * `<` 로 시작하는 글(백그라운드 작업 알림 등. 화면에서는 system)은 뺀다
 */
export function queuedPrompts(jsonl: string): QueuedPrompt[] {
  const queue: QueueState = { items: [], isAfterExit: false }
  const lines = messageLinesOf(jsonl)
  for (const [index, line] of lines.entries()) {
    if (!line) continue
    if (line.type === 'queue-operation' || line.type === 'cost-state') applyQueueRecord(queue, line, index, lines)
    else queue.isAfterExit = false
  }
  return queue.items.flatMap(({ content }) => (content === undefined || content.startsWith('<') ? [] : [{ raw: content, text: unwrapPastes(content) }]))
}

/** instructions.jsonl 에서 그 세션이 받은 지시만 고른다. 깨진 줄·모양이 다른 줄은 건너뛴다 */
export function parseInstructionLog(jsonl: string, sessionId: string): InstructionRecord[] {
  const records: InstructionRecord[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let record: Partial<InstructionRecord>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record?.sessionId !== sessionId || typeof record.text !== 'string') continue
    records.push({
      sessionId,
      fromSessionId: typeof record.fromSessionId === 'string' ? record.fromSessionId : null,
      text: record.text,
      at: typeof record.at === 'string' ? record.at : '',
    })
  }
  return records
}

const PASTE_TAG = /<\/?pasted_content id="[^"]*">/g

/**
 * 지시문 비교 키. Claude Code 는 pty 로 들어온 긴 입력을 4096바이트 조각으로 받아 붙여넣기 조각을
 * `<pasted_content id="…">` 태그로 감싸고 조각 경계에 줄바꿈을 넣어 jsonl 에 남긴다 (경계는 낱말 중간에도 온다).
 * 그래서 태그를 빼고 공백을 전부 지운 뒤 비교한다
 */
export function instructionKey(text: string): string {
  return text.replace(PASTE_TAG, '').replace(/\s+/g, '')
}

/**
 * 내용이 지시 기록과 같은 user 메시지에 from 을 붙이고 글은 보낸 지시문으로 바꾼다 (붙여넣기 태그 제거).
 * 기록 하나는 메시지 하나에만, 앞에서부터 맞춘다
 */
export function attachInstructions(
  messages: ChatMessage[],
  records: InstructionRecord[],
  nameOf: (sessionId: string | null) => string,
): ChatMessage[] {
  const pending = new Map<string, InstructionRecord[]>()
  for (const record of records) {
    const key = instructionKey(record.text)
    if (key) pending.set(key, [...(pending.get(key) ?? []), record])
  }
  return messages.map((message) => {
    if (message.role !== 'user') return message
    const record = pending.get(instructionKey(message.text))?.shift()
    if (!record) return message
    return { ...message, text: record.text, from: { sessionId: record.fromSessionId, name: nameOf(record.fromSessionId) } }
  })
}
