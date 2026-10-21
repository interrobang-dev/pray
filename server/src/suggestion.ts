/** 입력칸 제안 하나의 최대 길이. 넘으면 자른다 (한 줄 칩이라 길 일이 없다) */
export const MAX_SUGGESTION_LENGTH = 1000

/** invalid = 꼴이 틀림(400), ignored = 웹 세션이 아님, unchanged = 값이 같음, changed = 바뀜(broadcast) */
export type SuggestionUpdate = 'invalid' | 'ignored' | 'unchanged' | 'changed'

/**
 * mod 가 보낸 `{ sessionId, text }`(text 가 null 이면 지움)를 세션별 제안 Map 에 반영한다 (순수, Map 만 바꾼다).
 * 글은 앞뒤 공백을 지우고 MAX_SUGGESTION_LENGTH 에서 자르며, 비면 지움으로 본다
 */
export function applySuggestion(suggestions: Map<string, string>, webSessionIds: ReadonlySet<string>, body: unknown): SuggestionUpdate {
  if (typeof body !== 'object' || body === null) return 'invalid'
  const { sessionId, text } = body as { sessionId?: unknown; text?: unknown }
  if (typeof sessionId !== 'string' || (typeof text !== 'string' && text !== null)) return 'invalid'
  if (!webSessionIds.has(sessionId)) return 'ignored'
  const next = text?.trim().slice(0, MAX_SUGGESTION_LENGTH) || null
  if (next === (suggestions.get(sessionId) ?? null)) return 'unchanged'
  if (next === null) suggestions.delete(sessionId)
  else suggestions.set(sessionId, next)
  return 'changed'
}
