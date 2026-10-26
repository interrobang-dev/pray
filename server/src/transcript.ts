export interface TranscriptSummary {
  title: string | null
  /** timestamp 가 있는 첫 줄의 시각 (세션 시작). 세션 목록의 생성 시각이 hq 기록에 없을 때(외부 세션) 쓴다 */
  startedAt: string | null
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
  /**
   * 같은 응답 usage 의 input_tokens + cache_read_input_tokens + cache_creation_input_tokens = 다음 차례에 다시 읽을 문맥 크기.
   * usage 가 없거나 그 뒤에 대화 압축(compact_boundary)이 있으면 null (압축 뒤 문맥은 요약이라 크기를 모른다)
   */
  contextTokens: number | null
}

interface ContentBlock {
  type: string
  text?: string
}

/** Claude Code 가 직접 만든 응답(API 오류·"No response requested." 등)의 model. 모델·effort 판정에서 건너뛴다 */
const SYNTHETIC_MODEL = '<synthetic>'

/** 응답 usage 의 문맥 토큰 합. 세 값 중 숫자가 하나도 없으면 null */
function contextTokensOf(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens } = usage as Record<string, unknown>
  const counts = [input_tokens, cache_read_input_tokens, cache_creation_input_tokens].filter(
    (count): count is number => typeof count === 'number',
  )
  return counts.length === 0 ? null : counts.reduce((sum, count) => sum + count, 0)
}

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
  const summary: TranscriptSummary = {
    title: null,
    startedAt: null,
    lastAt: null,
    turnEndedAt: null,
    lastAssistantText: null,
    model: null,
    effort: null,
    contextTokens: null,
  }
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
      summary.startedAt ??= record.timestamp
      summary.lastAt = record.timestamp
      if (isConversationLine(record)) summary.turnEndedAt = record.timestamp
    }
    if (record.type === 'system' && record.subtype === 'compact_boundary') summary.contextTokens = null
    if (record.type === 'assistant') {
      const message = record.message as { content?: ContentBlock[]; model?: unknown; usage?: unknown } | undefined
      const text = message?.content
        ?.filter((block) => block.type === 'text' && block.text)
        .map((block) => (block.text ?? '').trim())
        .join('\n')
      if (text) summary.lastAssistantText = text
      if (typeof message?.model === 'string' && message.model !== SYNTHETIC_MODEL) {
        summary.model = message.model
        const effort = record.perTurnEffort ?? record.effort
        summary.effort = typeof effort === 'string' ? effort : null
        summary.contextTokens = contextTokensOf(message.usage)
      }
    }
  }
  return summary
}
