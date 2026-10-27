import type { ChatMessage } from './types'

/**
 * 대화를 다시 받을 때 바뀐 뒤쪽만 받는다. 서버는 메시지 목록마다 버전(내용의 sha1)을 주고, 화면이 가진 버전을 `?since=` 로 보내면
 * 그 목록과 처음 달라진 자리(fromIndex)부터 끝까지만 준다 (앞 메시지도 바뀔 수 있어 서버가 글로 비교한다).
 * 세션을 열거나 바꾸면 버전 없이 전체를 받는다. 옛 서버는 since 를 무시하고 배열을 주고, 버전 꼴이 아닌 ETag 는 버리므로 늘 전체 받기다
 */

/** 화면이 가진 목록과 그 버전 */
export interface HeldMessages {
  sessionId: string
  version: string
  messages: ChatMessage[]
}

/** 서버 버전 꼴 (sha1 hex) */
const VERSION = /^[0-9a-f]{40}$/

/** 약한 ETag `W/"<버전>"` → 버전. 꼴이 다르면(옛 서버의 Express ETag 등) null */
export function versionOfEtag(etag: string | null): string | null {
  const version = etag?.match(/^W\/"([^"]*)"$/)?.[1]
  return version && VERSION.test(version) ? version : null
}

/** 대화 API 주소. 같은 세션의 버전을 가졌으면 그 뒤 바뀐 것만 달라고 한다 */
export function messagesUrl(sessionId: string, held: HeldMessages | null): string {
  const path = `/api/sessions/${sessionId}/messages`
  return held && held.sessionId === sessionId ? `${path}?since=${held.version}` : path
}

/**
 * 응답 → 메시지 전체와 그 버전. 배열(전체)이면 그대로(버전은 ETag), `{ version, fromIndex, total, messages }` 면 held 의 fromIndex 앞에 이어 붙인다.
 * 꼴·개수가 안 맞거나 held 가 없는데 앞부분이 필요하면 null (전체를 다시 받는다)
 */
export function applyMessagesResponse(
  data: unknown,
  etag: string | null,
  held: HeldMessages | null,
): { messages: ChatMessage[]; version: string | null } | null {
  if (Array.isArray(data)) return { messages: data as ChatMessage[], version: versionOfEtag(etag) }
  if (typeof data !== 'object' || data === null) return null
  const { version, fromIndex, total, messages } = data as Record<string, unknown>
  if (typeof version !== 'string' || !VERSION.test(version) || !Array.isArray(messages)) return null
  if (!Number.isInteger(fromIndex) || !Number.isInteger(total)) return null
  const from = fromIndex as number
  const base = held?.messages ?? []
  if (from < 0 || from > base.length || from + messages.length !== total) return null
  // 하나도 안 바뀌었으면 가진 배열 그대로
  if (held && version === held.version && from === base.length && messages.length === 0) return { messages: base, version }
  return { messages: [...base.slice(0, from), ...(messages as ChatMessage[])], version }
}

/** 대화를 받는다: 가진 버전이 있으면 바뀐 뒤쪽만, 이어 붙이기가 안 맞으면 한 번 전체를 다시 받는다 */
export async function loadMessages(sessionId: string, held: HeldMessages | null): Promise<{ messages: ChatMessage[]; version: string | null }> {
  const usable = held?.sessionId === sessionId ? held : null
  const response = await fetch(messagesUrl(sessionId, usable))
  const applied = applyMessagesResponse(await response.json(), response.headers.get('ETag'), usable)
  if (applied) return applied
  const full = await fetch(messagesUrl(sessionId, null))
  return { messages: await full.json(), version: versionOfEtag(full.headers.get('ETag')) }
}
