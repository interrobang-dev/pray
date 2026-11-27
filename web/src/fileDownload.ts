import { apiUrl } from './workspaceApi'

/**
 * Files 탭 파일 받기 (Copy 메뉴 Download·Share…). 받기 주소는 서버 `GET /api/sessions/:id/file/download?path=` —
 * 종류와 상관없이 attachment 로 준다.
 */

/** 안드로이드 앱이 WebView 에 `addJavascriptInterface(…, "PrayShare")` 로 넣는 브리지. 앱은 url 이 받기 주소 꼴인지 본 뒤 받아서 공유 창을 띄운다 */
export interface PrayShareBridge {
  share(url: string, fileName: string): void
}

declare global {
  interface Window {
    PrayShare?: PrayShareBridge
  }
}

/** 받기 주소 (같은 출처 상대 주소). `<a download>` 가 이것을 연다 */
export function downloadUrl(sessionId: string, path: string): string {
  return apiUrl(sessionId, 'file/download', { path })
}

/** 브리지에 넘길 절대 주소 — 앱은 페이지 밖에서 받으므로 출처가 붙어야 한다 */
export function absoluteDownloadUrl(origin: string, sessionId: string, path: string): string {
  return new URL(downloadUrl(sessionId, path), origin).href
}

/** 안드로이드 앱 안일 때만 브리지 (일반 브라우저는 null) */
export function shareBridge(): PrayShareBridge | null {
  const bridge = typeof window === 'undefined' ? undefined : window.PrayShare
  return bridge && typeof bridge.share === 'function' ? bridge : null
}

/** 숨긴 `<a href download>` 를 눌러 받는다 (서버가 attachment 라 이름은 서버 머리가 정하고, download 값은 같은 이름) */
export function startDownload(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
}
