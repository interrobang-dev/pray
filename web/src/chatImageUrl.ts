/**
 * 대화 속 그림의 주소 정하기 (Markdown.tsx 의 대화용 img). claude 는 `![캡처](C:\Users\…\a.png)` 처럼 이 PC 파일 경로로 그림을 링크한다.
 * 브라우저는 로컬 파일을 못 여니 서버 `GET /api/sessions/:id/image?path=` 로 받는다 (범위 → server chatImage.ts)
 */

export interface ChatImageTarget {
  /** img 에 넣을 주소. 보일 수 없으면 null (세션을 모름·모르는 프로토콜) */
  src: string | null
  /** 이 PC 파일 경로 (서버로 받는 것). 웹 주소·data 면 null */
  path: string | null
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

/**
 * 그림 원문 주소 → img 주소. http(s)·data:image 는 그대로, 드라이브 문자 절대 경로·`file:///C:/…`·상대 경로는 서버 그림 API 로.
 * 그 밖(다른 프로토콜·`//호스트`·`/`·`\` 로 시작·`file://서버/…`)은 src null
 */
export function chatImageTarget(raw: string, sessionId: string | null): ChatImageTarget {
  const url = raw.trim()
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) return { src: url, path: null }
  let path: string | null = null
  if (/^file:\/\/\//i.test(url)) {
    const rest = decodeSafely(url.slice('file:///'.length))
    path = DRIVE_PATH.test(rest) ? rest : null
  } else if (DRIVE_PATH.test(url)) {
    path = url
  } else if (url !== '' && !SCHEME.test(url) && !/^[\\/]/.test(url)) {
    path = url
  }
  if (path === null) return { src: null, path: null }
  return { src: sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/image?path=${encodeURIComponent(path)}` : null, path }
}

/** 퍼센트 인코딩 풀기. 틀린 꼴(`%zz`)이면 그대로 */
export function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 마크다운 원문의 인라인 그림 `![alt](주소 "제목")` 에서 주소를 원문 그대로 꺼낸다. 인라인 꼴이 아니면(참조 `![a][r]` 등) null.
 * 파서가 준 주소를 쓰지 않는 이유: 마크다운은 `\` 뒤 문장 부호를 이스케이프로 먹어(`D:\workspace\@private` → `D:\workspace@private`)
 * Windows 경로가 깨지고, 주소를 퍼센트 인코딩한다 (`\` → `%5C`)
 */
export function imageDestinationOf(source: string): string | null {
  const match = /\]\(\s*(?:<([^<>\n]*)>|(\S+?))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)$/.exec(source)
  if (!match) return null
  return match[1] ?? match[2] ?? null
}

/**
 * img 의 원문 주소: 마크다운 원문에서 그 그림 자리(start·end 오프셋)를 잘라 꺼내고, 못 꺼내면 파서가 준 주소(웹 주소가 아니면 퍼센트 인코딩을 풀어서)
 */
export function rawImageUrl(markdown: string | null, start: number | undefined, end: number | undefined, parsed: string): string {
  const destination = markdown !== null && start !== undefined && end !== undefined ? imageDestinationOf(markdown.slice(start, end)) : null
  if (destination !== null) return destination
  return /^(https?|data):/i.test(parsed) ? parsed : decodeSafely(parsed)
}

/** 설명이 없을 때 쓸 파일 이름: 마지막 `/`·`\` 뒤 (웹 주소는 `?`·`#` 앞) */
export function imageFileName(raw: string): string {
  const url = raw.trim()
  const withoutQuery = /^https?:\/\//i.test(url) ? url.replace(/[?#].*$/, '') : url
  if (/^data:/i.test(withoutQuery)) return 'image'
  const name = withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return decodeSafely(name) || 'image'
}
