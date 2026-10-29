/** 트레이 앱 알림이 세션 패널을 여는 주소 해시 `#session=<id>`. 화면은 읽어 고른 뒤 해시를 지운다 */

/** `#session=<id>` 의 id. 꼴이 다르거나 비었으면 null */
export function sessionIdFromHash(hash: string): string | null {
  const match = hash.match(/^#session=([^&]+)$/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]) || null
  } catch {
    return null
  }
}
