/**
 * 트레이 창에서 새 창으로 열려는 주소를 기본 브라우저로 넘길지. Pray 서버 자신이 아닌 http(s) 만 넘긴다 —
 * 서버 주소(그림 "Open original" 같은 `/api/...`)는 지금처럼 Electron 새 창으로 열고, 그 밖의 프로토콜은 넘기지 않는다
 */
export function isExternalUrl(url: string, serverUrl: string): boolean {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  return target.origin !== new URL(serverUrl).origin
}
