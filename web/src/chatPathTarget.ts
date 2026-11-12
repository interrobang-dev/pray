import { findHighlights } from './markdownHighlight'

/**
 * 대화 속 경로·URL 판정 (순수). 눌러 열 수 있는 경로(서버 `POST /api/sessions/:id/open-path` 가 받는 꼴)와 인라인 코드 전체가 경로·URL 인지.
 * 서버 꼴(chatImage.ts 의 chatImagePathKind)은 드라이브 절대·cwd 상대만이라 `/api/…`·`~/…`·`\\server\…` 는 눌리지 않는다
 */

const DRIVE_PATH = /^[A-Za-z]:[\\/]/

/** 서버가 받는 경로 꼴인지. 끝의 `:줄`·`:줄:열` 은 서버가 떼므로 떼고 본다 */
export function isOpenablePath(text: string): boolean {
  if (text === '' || text.length > 2048 || /[\x00-\x1f]/.test(text)) return false
  const path = text.replace(/:\d+(?::\d+)?$/, '')
  const drive = DRIVE_PATH.exec(path)
  const rest = drive ? path.slice(drive[0].length) : path
  if (/[:<>"|?*]/.test(rest)) return false
  return drive !== null || !/^[\\/~]/.test(path)
}

export type InlineCodeTarget = { kind: 'url'; url: string } | { kind: 'path'; path: string }

/**
 * 인라인 코드(`…`, 코드 블록 아님) 전체가 http(s) URL 이면 url, 숫자·경로 강조(findHighlights)의 경로 규칙으로 전체가 한 경로이고 열 수 있는 꼴이면 path, 아니면 null.
 * 앞뒤 공백은 보지 않는다 (코드 칩 글 그대로 — 공백이 붙으면 경로가 아니다)
 */
export function inlineCodeTarget(text: string): InlineCodeTarget | null {
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      new URL(text)
      return { kind: 'url', url: text }
    } catch {
      return null
    }
  }
  const ranges = findHighlights(text, { isNumbers: false })
  if (ranges.length !== 1 || ranges[0].start !== 0 || ranges[0].end !== text.length) return null
  return isOpenablePath(text) ? { kind: 'path', path: text } : null
}
