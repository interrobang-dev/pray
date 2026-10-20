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
          if (toolUse) toolUse.result = resultToText(block.content).slice(0, RESULT_LIMIT)
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
