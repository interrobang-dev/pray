/** task 하나가 쓴 토큰 (그 팀원 jsonl 의 claude 응답 usage 합). 운영 기록 — Tasks 창에 보인다 */
export interface TaskUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  /** 센 claude 응답 수 (같은 message.id 는 하나) */
  turns: number
}

/** task 가 끝난 뒤 jsonl 에서 읽어 task 에 싣는 운영 기록 */
export interface TaskEnd {
  /** 끝난 뒤 팀원의 문맥 크기 (세션 목록 요약의 contextTokens) */
  contextTokens: number | null
  usage: TaskUsage | null
  model: string | null
}

/** 사용량이 없는 synthetic 응답(중지·오류 안내)의 model. transcript.ts 와 같다 */
const SYNTHETIC_MODEL = '<synthetic>'

const tokenCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

interface AssistantLine {
  isSidechain?: unknown
  timestamp?: unknown
  message?: { id?: unknown; model?: unknown; usage?: unknown }
}

/**
 * jsonl 글에서 sinceIso 이후 claude 응답(`type: assistant`, 사이드체인·synthetic 제외, `message.usage` 가 있는 것)의 usage 합과
 * 마지막 응답의 model (순수). 한 응답이 스트리밍 조각으로 여러 줄 남으므로 같은 message.id 는 마지막 줄 값만 센다.
 * 끝에서부터 거꾸로 읽고 since 보다 앞선 응답 줄을 만나면 멈춘다 (jsonl 은 시간순으로 덧붙는다 — 큰 파일 앞부분을 해석하지 않으려고).
 * 센 응답이 없으면 usage·model 모두 null
 */
export function taskUsageOf(text: string, sinceIso: string): { usage: TaskUsage | null; model: string | null } {
  const since = new Date(sinceIso).getTime()
  const usage: TaskUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 0 }
  const seenIds = new Set<string>()
  let model: string | null = null
  let end = text.length
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1
    const line = text.slice(start, end)
    end = start - 1
    // 응답 줄만 해석한다 (대부분의 줄을 JSON.parse 하지 않게)
    if (!line.includes('"assistant"')) continue
    let record: AssistantLine & { type?: unknown }
    try {
      record = JSON.parse(line) as AssistantLine & { type?: unknown }
    } catch {
      continue
    }
    if (record.type !== 'assistant') continue
    const at = typeof record.timestamp === 'string' ? new Date(record.timestamp).getTime() : Number.NaN
    if (at < since) break
    if (Number.isNaN(at) || record.isSidechain === true) continue
    const message = record.message
    if (typeof message?.usage !== 'object' || message.usage === null || message.model === SYNTHETIC_MODEL) continue
    if (typeof message.id === 'string') {
      // 거꾸로 읽으니 처음 본 줄이 그 응답의 마지막 줄이다
      if (seenIds.has(message.id)) continue
      seenIds.add(message.id)
    }
    const { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } = message.usage as Record<string, unknown>
    usage.inputTokens += tokenCount(input_tokens)
    usage.outputTokens += tokenCount(output_tokens)
    usage.cacheCreationTokens += tokenCount(cache_creation_input_tokens)
    usage.cacheReadTokens += tokenCount(cache_read_input_tokens)
    usage.turns++
    if (model === null && typeof message.model === 'string') model = message.model
  }
  return usage.turns === 0 ? { usage: null, model: null } : { usage, model }
}

/** onFinish 가 쓰는 읽기 (index.ts 는 세션 목록과 같은 jsonl 캐시를 준다) */
export interface TaskEndReader {
  /** 요약 캐시 — 덧붙은 줄만 읽는다. jsonl 이 없으면 null */
  summary: (sessionId: string) => Promise<{ contextTokens: number | null } | null>
  /** jsonl 글 전체. 없으면 null */
  text: (sessionId: string) => Promise<string | null>
}

/** 끝난 task 의 문맥 크기·사용량·모델. 큰 jsonl 글은 한 번만 읽는다. 읽기 실패는 던진다 (부르는 쪽이 로그) */
export async function readTaskEnd(task: { memberSessionId: string; createdAt: string }, reader: TaskEndReader): Promise<TaskEnd> {
  const [summary, text] = await Promise.all([reader.summary(task.memberSessionId), reader.text(task.memberSessionId)])
  const { usage, model } = text === null ? { usage: null, model: null } : taskUsageOf(text, task.createdAt)
  return { contextTokens: summary?.contextTokens ?? null, usage, model }
}
