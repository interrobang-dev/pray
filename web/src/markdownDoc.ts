/** Files 탭 md 미리보기의 순수 함수: md 파일 판정, 문서 안 링크·그림 주소 가르기, 상대 경로 풀기 (`markdownDoc.test.ts`) */

/** 미리보기로 보는 파일: `.md`·`.markdown` (대소문자 무시) */
export function isMarkdownPath(path: string | null): boolean {
  return path !== null && /\.(md|markdown)$/i.test(path)
}

export type DocLinkKind = 'external' | 'anchor' | 'file' | 'other'

/**
 * 문서 링크 주소의 종류: http(s)·mailto 는 external(새 탭), `#…` 는 anchor, 프로토콜·드라이브 문자·`\\` 가 없는 것은 file(세션 cwd 안 파일),
 * 그 밖(`javascript:`·`C:\…`·`file:` 등)은 other — 아무것도 하지 않는다
 */
export function docLinkKind(href: string): DocLinkKind {
  const trimmed = href.trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return 'external'
  if (trimmed.startsWith('#')) return 'anchor'
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('//')) return 'other'
  return 'file'
}

/**
 * md 파일(cwd 기준 `/` 경로) 안의 상대 주소를 cwd 기준 경로로 푼다. `?`·`#` 뒤는 떼고 `%20` 같은 이스케이프는 푼다.
 * `/` 로 시작하면 cwd 기준(GitHub 의 저장소 루트 기준처럼). `..` 가 cwd 밖으로 나가거나 file 종류가 아니면 null
 */
export function resolveDocPath(filePath: string, href: string): string | null {
  if (docLinkKind(href) !== 'file') return null
  let target = href.trim().replace(/[?#].*$/, '')
  try {
    target = decodeURIComponent(target)
  } catch {
    // 깨진 이스케이프는 글자 그대로
  }
  target = target.replace(/\\/g, '/')
  if (!target) return null
  const base = target.startsWith('/') ? [] : filePath.split('/').slice(0, -1)
  const parts = [...base]
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.length > 0 ? parts.join('/') : null
}

/** 그림 주소: http(s)·`data:image/` 는 그대로, 상대 경로는 cwd 기준 경로(`{ path }`), 그 밖(이 PC 절대 경로 등)은 null — 그리지 않는다 */
export function docImageTarget(filePath: string, src: string): { url: string } | { path: string } | null {
  const trimmed = src.trim()
  if (/^https?:/i.test(trimmed) || /^data:image\//i.test(trimmed)) return { url: trimmed }
  const path = resolveDocPath(filePath, trimmed)
  return path ? { path } : null
}

/** 제목 글 → GitHub 꼴 앵커 이름: 소문자, 글자·숫자·`-`·`_`·공백 밖은 지우고 공백은 `-` (한글은 그대로) */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}
