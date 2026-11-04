/** 세션 문맥 크기(토큰) 표시: 패널 머리·목록 세션 줄. 팀장 지침이 팀원 문맥 15만을 넘으면 정리하므로 그 근처를 색으로 알린다 */

/** 이 이상이면 경고색 (팀장 지침의 팀원 정리 기준 15만) */
export const CONTEXT_WARN_TOKENS = 150_000
/** 이 이상이면 주의색 (정리 기준에 다가가는 중) */
export const CONTEXT_CAUTION_TOKENS = 120_000

export type ContextLevel = 'normal' | 'caution' | 'warn'

function oneDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/** "950"·"1.2k"·"143k"·"1.2M": 1000 미만은 그대로, 1만 미만은 k 소수 한 자리, 100만 미만은 k 정수, 그 이상은 M 소수 한 자리 */
export function contextSizeText(tokens: number): string {
  const rounded = Math.round(Math.max(0, tokens))
  if (rounded < 1000) return String(rounded)
  // 9950 부터는 소수 한 자리로 "10.0k" 가 되므로 정수 k
  if (rounded < 9950) return `${oneDecimal(rounded / 1000)}k`
  const thousands = Math.round(rounded / 1000)
  if (thousands < 1000) return `${thousands}k`
  return `${oneDecimal(rounded / 1_000_000)}M`
}

export function contextLevel(tokens: number): ContextLevel {
  if (tokens >= CONTEXT_WARN_TOKENS) return 'warn'
  if (tokens >= CONTEXT_CAUTION_TOKENS) return 'caution'
  return 'normal'
}

/** 툴팁·aria-label "Context 143,254 tokens" */
export function contextSizeTitle(tokens: number): string {
  return `Context ${Math.round(Math.max(0, tokens)).toLocaleString('en-US')} tokens`
}

/** 입력 쪽 usage 세 값 (서버 transcript.ts 의 TurnUsage·teamTasks 의 TaskUsage 가 다 이 칸을 가진다) */
export interface InputUsage {
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/** 캐시율 % = cache read / (input + cache write + cache read), 반올림 (token-ledger mod 와 같은 식). 입력이 0 이면 null */
export function cacheRateOf(usage: InputUsage): number | null {
  const total = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
  return total > 0 ? Math.round((usage.cacheReadTokens / total) * 100) : null
}

/** 입력 상자 아래 "95% cached" 와 툴팁. 마지막 차례 usage 가 없으면(null·옛 서버 응답의 undefined·입력 0) null */
export function turnCacheOf(usage: InputUsage | null | undefined): { text: string; title: string } | null {
  if (!usage) return null
  const rate = cacheRateOf(usage)
  if (rate === null) return null
  const total = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
  const count = (value: number) => value.toLocaleString('en-US')
  return {
    text: `${rate}% cached`,
    title: `Last turn: cache read ${count(usage.cacheReadTokens)} of ${count(total)} input tokens (cache write ${count(usage.cacheCreationTokens)}, uncached ${count(usage.inputTokens)})`,
  }
}

/** 화면에 그릴 값. 모르면(null·옛 서버 응답의 undefined) null = 표시 안 함 */
export function contextSizeOf(tokens: number | null | undefined): { text: string; level: ContextLevel; title: string } | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return null
  return { text: contextSizeText(tokens), level: contextLevel(tokens), title: contextSizeTitle(tokens) }
}
