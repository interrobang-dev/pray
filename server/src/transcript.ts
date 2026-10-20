export interface TranscriptSummary {
  title: string | null
  lastAt: string | null
  lastAssistantText: string | null
}

interface ContentBlock {
  type: string
  text?: string
}

export function summarizeTranscript(jsonl: string): TranscriptSummary {
  const summary: TranscriptSummary = { title: null, lastAt: null, lastAssistantText: null }
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      summary.title = record.aiTitle
    }
    if (typeof record.timestamp === 'string') {
      summary.lastAt = record.timestamp
    }
    if (record.type === 'assistant') {
      const message = record.message as { content?: ContentBlock[] } | undefined
      const text = message?.content
        ?.filter((block) => block.type === 'text' && block.text)
        .map((block) => (block.text ?? '').trim())
        .join('\n')
      if (text) summary.lastAssistantText = text
    }
  }
  return summary
}
