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

/** 다른 PC 의 Pray 로 옮겨 갈 때 붙이는 해시. 받는 화면은 그 PC 에서 마지막에 연 세션을 되살리고 해시를 지운다 */
export const RESUME_HASH = '#resume'

/** 옮겨 갈 PC 주소에 `#resume` 을 붙인 주소 (원래 해시는 바꾼다) */
export function resumeUrlOf(url: string): string {
  const target = new URL(url)
  target.hash = RESUME_HASH
  return target.toString()
}

/**
 * 처음 그릴 때 마지막에 연 세션을 되살릴지: PC 칩으로 옮겨 왔거나(`#resume`) 새로고침했을 때만.
 * 새 탭·트레이 창 첫 실행·안드로이드 PC 목록은 첫 화면 그대로
 */
export function shouldRestoreLastSession(hash: string, navigationType: string | undefined): boolean {
  return hash === RESUME_HASH || navigationType === 'reload'
}
