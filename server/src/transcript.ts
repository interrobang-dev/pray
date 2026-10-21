export interface TranscriptSummary {
  title: string | null
  lastAt: string | null
  lastAssistantText: string | null
  /** 마지막 claude 응답의 모델 ID (예: claude-opus-5-5) */
  model: string | null
  /** 같은 응답의 effort. 그 차례에 실제로 쓴 perTurnEffort 를 먼저, 없으면 effort */
  effort: string | null
}

interface ContentBlock {
  type: string
  text?: string
}

/** Claude Code 가 직접 만든 응답(API 오류·"No response requested." 등)의 model. 모델·effort 판정에서 건너뛴다 */
const SYNTHETIC_MODEL = '<synthetic>'

export function summarizeTranscript(jsonl: string): TranscriptSummary {
  const summary: TranscriptSummary = { title: null, lastAt: null, lastAssistantText: null, model: null, effort: null }
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
      const message = record.message as { content?: ContentBlock[]; model?: unknown } | undefined
      const text = message?.content
        ?.filter((block) => block.type === 'text' && block.text)
        .map((block) => (block.text ?? '').trim())
        .join('\n')
      if (text) summary.lastAssistantText = text
      if (typeof message?.model === 'string' && message.model !== SYNTHETIC_MODEL) {
        summary.model = message.model
        const effort = record.perTurnEffort ?? record.effort
        summary.effort = typeof effort === 'string' ? effort : null
      }
    }
  }
  return summary
}
