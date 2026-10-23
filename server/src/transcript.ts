export interface TranscriptSummary {
  title: string | null
  lastAt: string | null
  /**
   * 마지막 대화 줄 시각: 사람 쪽 user 줄(지시·도구 결과·중지 줄)과 claude 응답 줄. 사이드체인·메타·압축 요약·`<` 로 시작하는 글
   * (백그라운드 알림·슬래시 명령)과 Claude Code 자체 응답은 뺀다 — lastAt 은 ai-title·종료·resume 줄에도 바뀌어 차례가 끝난 시각으로 못 쓴다
   */
  turnEndedAt: string | null
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

/** turnEndedAt 에 넣는 대화 줄인지 */
function isConversationLine(record: Record<string, unknown>): boolean {
  if (record.isSidechain || record.isMeta) return false
  const message = record.message as { content?: unknown; model?: unknown } | undefined
  if (record.type === 'assistant') return message?.model !== SYNTHETIC_MODEL
  if (record.type !== 'user' || record.isCompactSummary === true) return false
  const content = message?.content
  return typeof content === 'string' ? !content.startsWith('<') : Array.isArray(content)
}

export function summarizeTranscript(jsonl: string): TranscriptSummary {
  const summary: TranscriptSummary = { title: null, lastAt: null, turnEndedAt: null, lastAssistantText: null, model: null, effort: null }
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
      if (isConversationLine(record)) summary.turnEndedAt = record.timestamp
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
