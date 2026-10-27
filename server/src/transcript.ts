import { isInterruptText } from './interrupt.js'

/**
 * 주 대화 줄의 마지막 차례가 어떻게 끝났는지 (훅 상태를 모를 때 jsonl 로 표시 상태를 다시 만드는 데 쓴다).
 * none = 대화 없음, ended = claude 최종 응답으로 끝남, interrupted = 중지 줄로 끝남,
 * cut = 차례 중간(응답 전·도구 호출·도구 결과)에서 끊겼고 그 뒤에 프로세스 경계(cost-state)가 있음, in-progress = 차례 중간이고 경계가 없음
 */
export type TurnKind = 'none' | 'ended' | 'interrupted' | 'cut' | 'in-progress'

export interface TurnOutcome {
  kind: TurnKind
  /** ended 일 때만: 그 차례의 마지막 claude 글 (글이 없었으면 null) */
  text: string | null
}

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
  /** 마지막 차례의 끝 (turnOutcome 참고) */
  turn: TurnOutcome
}

interface ContentBlock {
  type: string
  text?: string
}

/** 차례 상태를 바꾸는 대화 줄의 종류. 차례와 무관한 줄은 null */
type TurnEvent = 'input' | 'interrupt' | 'working' | 'ended'

/** 사람 쪽 user 줄의 글 (문자열이거나 text 블록들). 글 블록이 없으면 null */
function humanText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = (content as ContentBlock[]).filter((block) => block.type === 'text' && block.text).map((block) => block.text as string)
  return texts.length > 0 ? texts.join('\n') : null
}

/**
 * 대화 줄이 마지막 차례 상태에 하는 일. 사이드체인·메타·압축 요약·`<` 로 시작하는 글(백그라운드 알림·슬래시 명령)·Claude Code 자체 응답은 뺀다 (turnEndedAt 과 같은 규칙).
 * claude 응답은 도구 호출이 없고 stop_reason 이 tool_use·null(스트리밍 중 조각)이 아니면 최종 응답(ended)이고, 그 밖은 차례 중간(working)이다
 */
function turnEventOf(record: Record<string, unknown>): TurnEvent | null {
  if (record.isSidechain || record.isMeta) return null
  const message = record.message as { content?: unknown; model?: unknown; stop_reason?: unknown } | undefined
  if (record.type === 'attachment') {
    const attachment = record.attachment as { type?: string; prompt?: unknown } | undefined
    if (attachment?.type !== 'queued_command' || typeof attachment.prompt !== 'string') return null
    return attachment.prompt.startsWith('<') ? null : 'input'
  }
  if (record.type === 'assistant') {
    if (message?.model === SYNTHETIC_MODEL) return null
    const blocks = Array.isArray(message?.content) ? (message.content as ContentBlock[]) : []
    if (blocks.some((block) => block.type === 'tool_use')) return 'working'
    const stopReason = message?.stop_reason
    return stopReason === null || stopReason === 'tool_use' ? 'working' : 'ended'
  }
  if (record.type !== 'user' || record.isCompactSummary === true) return null
  const text = humanText(message?.content)
  if (text === null) return Array.isArray(message?.content) ? 'working' : null
  if (typeof message?.content === 'string' && text.startsWith('<')) return null
  return isInterruptText(text) ? 'interrupt' : 'input'
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
    turn: { kind: 'none', text: null },
  }
  let phase: 'none' | 'ended' | 'interrupted' | 'working' = 'none'
  let hasBoundary = false
  let turnText: string | null = null
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
    if (record.type === 'cost-state') hasBoundary = true
    const event = turnEventOf(record)
    if (event) {
      phase = event === 'input' ? 'working' : event === 'interrupt' ? 'interrupted' : event
      hasBoundary = false
      if (event === 'input') turnText = null
    }
    if (record.type === 'system' && record.subtype === 'compact_boundary') summary.contextTokens = null
    if (record.type === 'assistant') {
      const message = record.message as { content?: ContentBlock[]; model?: unknown; usage?: unknown } | undefined
      const text = message?.content
        ?.filter((block) => block.type === 'text' && block.text)
        .map((block) => (block.text ?? '').trim())
        .join('\n')
      if (text) {
        summary.lastAssistantText = text
        if (message?.model !== SYNTHETIC_MODEL && !record.isSidechain && !record.isMeta) turnText = text
      }
      if (typeof message?.model === 'string' && message.model !== SYNTHETIC_MODEL) {
        summary.model = message.model
        const effort = record.perTurnEffort ?? record.effort
        summary.effort = typeof effort === 'string' ? effort : null
        summary.contextTokens = contextTokensOf(message.usage)
      }
    }
  }
  const kind: TurnKind = phase === 'working' ? (hasBoundary ? 'cut' : 'in-progress') : phase
  summary.turn = { kind, text: kind === 'ended' ? turnText : null }
  return summary
}
