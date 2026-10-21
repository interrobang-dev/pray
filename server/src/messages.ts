export interface ToolUse {
  id: string
  name: string
  input: unknown
  result: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  timestamp: string
  text: string
  toolUses: ToolUse[]
  /** 서버가 보낸 팀장·파트장 지시인 user 메시지에만 있다 (instructions.jsonl 과 내용이 같은 것) */
  from?: { sessionId: string | null; name: string }
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

/** jsonl 전체를 채팅 메시지 배열로 바꾼다. 사이드체인·메타·thinking 은 뺀다. */
export function parseMessages(jsonl: string): ChatMessage[] {
  const messages: ChatMessage[] = []
  const toolUseById = new Map<string, ToolUse>()
  const assistantByMessageId = new Map<string, ChatMessage>()

  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.isSidechain || record.isMeta) continue
    const type = record.type
    if (type !== 'user' && type !== 'assistant') continue
    const message = record.message as { id?: string; content?: string | Block[] } | undefined
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : ''
    const uuid = typeof record.uuid === 'string' ? record.uuid : `${messages.length}`
    const content = message?.content

    if (type === 'user') {
      if (typeof content === 'string') {
        messages.push({
          id: uuid,
          role: content.startsWith('<') ? 'system' : 'user',
          timestamp,
          text: content,
          toolUses: [],
        })
        continue
      }
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolUse = toolUseById.get(block.tool_use_id)
          if (!toolUse) continue
          const result = resultToText(block.content)
          toolUse.result = toolUse.name.startsWith(UNLIMITED_RESULT_PREFIX) ? result : result.slice(0, RESULT_LIMIT)
        }
      }
      const text = content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text!)
        .join('\n')
      if (text) messages.push({ id: uuid, role: 'user', timestamp, text, toolUses: [] })
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
  return messages
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
