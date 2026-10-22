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
/** 이 도구들의 결과는 자르지 않는다: 팀원 보고가 결과 JSON 안에 있어 자르면 화면이 해석하지 못한다 */
const UNLIMITED_RESULT_PREFIX = 'mcp__jk-corp__'

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

function unwrapPastes(text: string): string {
  return text.replace(PASTE_BLOCK, '$2')
}

interface QueueItem {
  id: string
  timestamp: string
  content: string | undefined
}

/** 대기열에서 빼는 queue-operation. popAll 은 빈 입력칸 ↑ 로 대기 메시지를 입력칸에 꺼낸 것(꺼낸 것마다 한 줄), popOne 은 하나만 꺼낸 것 */
const TAKE_OPERATIONS = new Set(['remove', 'popAll', 'popOne'])

/** 대기열을 바꾸는 줄 (applyQueueRecord) */
const QUEUE_RECORD_TYPES = new Set(['queue-operation', 'cost-state'])

/**
 * dequeue 바로 뒤에 claude 가 받은 글: 다음 queue-operation 전에 처음 나오는 사람 쪽 글(user 줄의 글·queued_command 첨부). 없으면 undefined.
 * 차례가 끝난 뒤 꺼낸 것은 바로 뒤에 같은 글의 user 줄로 남는다 (슬래시 명령·글 없는 enqueue 는 글이 달라 맞지 않는다)
 */
function promptAfter(lines: string[], index: number): string | undefined {
  for (let next = index + 1; next < lines.length; next++) {
    if (!lines[next].trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(lines[next])
    } catch {
      continue
    }
    if (record.isSidechain || record.isMeta) continue
    if (record.type === 'queue-operation') return undefined
    if (record.type === 'attachment') {
      const attachment = record.attachment as { type?: string; prompt?: unknown } | undefined
      if (attachment?.type === 'queued_command') return typeof attachment.prompt === 'string' ? attachment.prompt : undefined
      continue
    }
    if (record.type !== 'user' || record.isCompactSummary === true) continue
    const content = (record.message as { content?: string | Block[] } | undefined)?.content
    if (typeof content === 'string') return content
    const texts = Array.isArray(content) ? content.filter((block) => block.type === 'text' && block.text).map((block) => block.text!) : []
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
 * 강제 종료로 cost-state 가 없을 때도 dequeue 를 글로 맞추면 남은 항목만 남고 어긋나지 않는다
 */
function applyQueueRecord(queue: QueueItem[], record: Record<string, unknown>, index: number, timestamp: string, lines: string[]): void {
  if (record.type === 'cost-state') {
    queue.length = 0
    return
  }
  const content = typeof record.content === 'string' ? record.content : undefined
  if (record.operation === 'enqueue') queue.push({ id: `queued-${index}`, timestamp, content })
  if (TAKE_OPERATIONS.has(record.operation as string)) {
    const position = queue.findIndex((item) => item.content === content)
    if (position >= 0) queue.splice(position, 1)
  }
  if (record.operation === 'dequeue' && queue.length > 0) {
    const prompt = promptAfter(lines, index)
    const position = prompt === undefined ? -1 : queue.findIndex((item) => item.content === prompt)
    queue.splice(Math.max(position, 0), 1)
  }
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
  const messages: ChatMessage[] = []
  const toolUseById = new Map<string, ToolUse>()
  const assistantByMessageId = new Map<string, ChatMessage>()
  /** 대기열 (enqueue 순). 글이 없는 enqueue 도 dequeue 순서를 맞추려고 넣고 화면에는 안 낸다 */
  const queue: QueueItem[] = []
  const lines = jsonl.split('\n')

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.isSidechain || record.isMeta) continue
    const type = record.type
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : ''
    const uuid = typeof record.uuid === 'string' ? record.uuid : `${messages.length}`

    if (QUEUE_RECORD_TYPES.has(type as string)) {
      applyQueueRecord(queue, record, index, timestamp, lines)
      continue
    }
    if (type === 'attachment') {
      const attachment = record.attachment as { type?: string; prompt?: unknown } | undefined
      if (attachment?.type !== 'queued_command') continue
      const queued = userTextMessage(uuid, timestamp, attachment.prompt)
      if (queued) messages.push(queued)
      continue
    }
    if (type !== 'user' && type !== 'assistant') continue
    const message = record.message as { id?: string; content?: string | Block[] } | undefined
    const content = message?.content

    if (type === 'user') {
      // 압축 요약은 type user 줄이지만 사람 말이 아니다. 붙여넣기 풀기 없이 원문 그대로 system 으로 낸다
      if (record.isCompactSummary === true) {
        const text = resultToText(content)
        if (text) messages.push({ id: uuid, role: 'system', timestamp, text, toolUses: [], isCompactSummary: true })
        continue
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const toolUse = toolUseById.get(block.tool_use_id)
            if (!toolUse) continue
            const result = resultToText(block.content)
            toolUse.result = toolUse.name.startsWith(UNLIMITED_RESULT_PREFIX) ? result : result.slice(0, RESULT_LIMIT)
            if (toolUse.name === 'AskUserQuestion') {
              const answers = askAnswers(record.toolUseResult)
              if (answers) toolUse.answers = answers
            }
          }
        }
      }
      const user = userTextMessage(uuid, timestamp, content)
      if (user) messages.push(user)
      continue
    }

    if (!Array.isArray(content)) continue
    const messageId = message?.id ?? uuid
    let target = assistantByMessageId.get(messageId)
    if (!target) {
      target = { id: uuid, role: 'assistant', timestamp, text: '', toolUses: [] }
      assistantByMessageId.set(messageId, target)
      messages.push(target)
    }
    for (const block of content) {
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
  for (const item of queue) {
    const queued = userTextMessage(item.id, item.timestamp, item.content)
    if (queued) messages.push({ ...queued, isQueued: true })
  }
  return messages
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
  const queue: QueueItem[] = []
  const lines = jsonl.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.isSidechain || record.isMeta || !QUEUE_RECORD_TYPES.has(record.type as string)) continue
    applyQueueRecord(queue, record, index, '', lines)
  }
  return queue.flatMap(({ content }) => (content === undefined || content.startsWith('<') ? [] : [{ raw: content, text: unwrapPastes(content) }]))
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
