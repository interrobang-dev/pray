/**
 * 대화 마크다운의 숫자·파일 경로 강조. 글에서 강조할 자리를 찾는 순수 함수(`findHighlights`)와,
 * 그 자리를 hast 의 text 노드에서 `<span class="num">`·`<span class="path">` 로 나누는 rehype 플러그인(`rehypeHighlightTokens`).
 * 색은 style.css 의 `.markdown .num`·`.markdown .path` 가 칠한다 (Markdown.tsx 의 isChat 일 때만 플러그인을 건다)
 */

export type HighlightKind = 'num' | 'path'

export interface HighlightRange {
  start: number
  end: number
  kind: HighlightKind
}

/** 경로로 보는 파일 확장자 (이름 단독일 때와 슬래시가 하나뿐인 `a/b.ext` 일 때) */
const FILE_EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|jsonl?|mdx?|s?css|html?|xml|ya?ml|toml|ini|cfg|conf|env|lock|log|txt|csv|tsv|sql|sh|bash|zsh|ps1|bat|cmd|vbs|py|rb|go|rs|java|kt|gradle|properties|cs|cpp|hpp|c|h|swift|php|vue|svelte|png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|tar|exe|dll|jar|sln|csproj'
const EXTENSION_PATTERN = new RegExp(`^(?:${FILE_EXTENSIONS})$`)

/** 숫자가 아닌 `.js` 이름 (Node.js·Next.js 같은 제품 이름은 파일이 아니다) */
const PRODUCT_NAME_PATTERN = /^(?:node|next|vue|nuxt|express|three|chart|d3|nest|ember|alpine|backbone|angular|react|socket|p5|moment|dayjs)\.js$/i

/** 강조하지 않는 덩어리: URL·이메일 (경로·숫자 모두 칠하지 않는다) */
const EXCLUDED_PATTERN = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+|\bwww\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

const SEGMENT = '[\\w@+.\\-]'
/** 윈도우 절대 경로 C:\… D:/… */
const WINDOWS_PATH = /[A-Za-z]:[\\/][\w@+.\-\\/]*/g
/** ~/… ./… ../… 로 시작하는 경로 */
const PREFIXED_PATH = new RegExp(`(?:~|\\.{1,2})\\/${SEGMENT}+(?:\\/${SEGMENT}*)*`, 'g')
/** /로 시작하는 절대 경로 (슬래시 명령 /btw 하나는 뺀다 — 아래에서 구간 수로 거른다) */
const ROOTED_PATH = new RegExp(`\\/${SEGMENT}+(?:\\/${SEGMENT}*)+`, 'g')
/** 슬래시가 든 상대 경로 */
const RELATIVE_PATH = new RegExp(`${SEGMENT}+(?:\\/${SEGMENT}*)+`, 'g')
/** 확장자 있는 파일 이름 단독, 또는 점 파일 */
const FILE_NAME = new RegExp(`(?:${SEGMENT}*[\\w@+-])?\\.(?:${FILE_EXTENSIONS})(?![\\w])(?!\\.\\w)|\\.(?:gitignore|gitattributes|env|npmrc|editorconfig|prettierrc|eslintrc|dockerignore)(?![\\w])`, 'g')
/** 파일 뒤 `:줄` `:줄:열` (경로 안에 넣어 숫자로 따로 칠하지 않는다) */
const LINE_SUFFIX = /^:\d+(?::\d+)?(?![\w])/

/** 경로 앞에 올 수 없는 글자 (낱말·다른 경로의 한가운데) */
const PATH_PREV_BLOCK = /[\w./\\:@~)\]-]/

function overlaps(ranges: { start: number; end: number }[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && end > range.start)
}

/** 끝의 문장 부호를 뗀 끝 위치 */
function trimEnd(text: string, start: number, end: number): number {
  let trimmed = end
  while (trimmed > start && '.,;:!?'.includes(text[trimmed - 1])) trimmed--
  return trimmed
}

/** 경로 후보 하나가 경로인지: 슬래시 하나뿐이고 확장자가 없는 and/or·input/output·TCP/IP 같은 말, 숫자뿐인 1/2·2026/10/28 은 아니다 */
function isPathLike(path: string): boolean {
  const segments = path.split('/')
  const names = segments.filter((segment) => segment !== '' && segment !== '.' && segment !== '..' && segment !== '~')
  if (names.length === 0 || names.every((name) => /^[\d.,-]+$/.test(name))) return false
  const slashCount = segments.length - 1
  if (path.startsWith('~/') || path.startsWith('./') || path.startsWith('../')) return true
  if (slashCount >= 2) return true
  // 슬래시 하나: 마지막 구간이 알려진 확장자를 가진 파일일 때만
  const last = segments[segments.length - 1]
  const dot = last.lastIndexOf('.')
  return dot > 0 && EXTENSION_PATTERN.test(last.slice(dot + 1))
}

function findPaths(text: string, excluded: { start: number; end: number }[]): HighlightRange[] {
  const found: HighlightRange[] = []
  const add = (start: number, end: number, check?: (path: string) => boolean) => {
    const trimmed = trimEnd(text, start, end)
    if (trimmed <= start || PATH_PREV_BLOCK.test(text[start - 1] ?? '') || overlaps(excluded, start, trimmed) || overlaps(found, start, trimmed)) return
    if (check && !check(text.slice(start, trimmed))) return
    const suffix = LINE_SUFFIX.exec(text.slice(trimmed))
    found.push({ start, end: trimmed + (suffix ? suffix[0].length : 0), kind: 'path' })
  }
  for (const match of text.matchAll(WINDOWS_PATH)) add(match.index, match.index + match[0].length)
  for (const match of text.matchAll(PREFIXED_PATH)) add(match.index, match.index + match[0].length, isPathLike)
  for (const match of text.matchAll(ROOTED_PATH)) add(match.index, match.index + match[0].length, isPathLike)
  for (const match of text.matchAll(RELATIVE_PATH)) add(match.index, match.index + match[0].length, isPathLike)
  for (const match of text.matchAll(FILE_NAME)) add(match.index, match.index + match[0].length, (name) => !PRODUCT_NAME_PATTERN.test(name))
  return found
}

const UNITS = '%|ms|ns|[µμ]s|us|sec|s|min|m|hr|h|d|w|px|pt|rem|em|vh|vw|fps|[kMG]?Hz|[KMGT]i?B|kB|B|[kMG]?bps|k|K|M|G|x|×'
/** 날짜 · 시각 · 버전 · 천 단위 쉼표 수 · 일반 수(소수·부호) 뒤에 단위 */
const NUMBER = new RegExp(
  `\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}(?!\\d)|\\d{1,2}:\\d{2}(?::\\d{2})?(?!\\d)|v?\\d+(?:\\.\\d+){2,}|[-+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?:${UNITS})?`,
  'g',
)

const ASCII_WORD = /[A-Za-z0-9_]/

function findNumbers(text: string, taken: { start: number; end: number }[]): HighlightRange[] {
  const found: HighlightRange[] = []
  for (const match of text.matchAll(NUMBER)) {
    let start = match.index
    const end = start + match[0].length
    const previous = text[start - 1] ?? ''
    const next = text[end] ?? ''
    let isRangeTail = false
    if (match[0][0] === '-' || match[0][0] === '+') {
      // 부호는 낱말에 붙지 않았을 때만: -7·(+3). `10-20`·`1+2` 처럼 숫자 뒤면 부호가 아니라 연산·범위라 뒷수만 칠하고, UTF-8·a-7 처럼 글자 뒤면 낱말의 일부다
      if (/\d/.test(previous)) {
        start += 1
        isRangeTail = true
      } else if (ASCII_WORD.test(previous) || previous === ')' || previous === ']') continue
    }
    // 낱말 중간(v2·h1·a56abbde·x_1)과 점·#·슬래시 옆(.5·#123456·1/2)은 뺀다. 한글은 붙어도 된다 ("3개"·"약3.5배")
    if (!isRangeTail && (ASCII_WORD.test(previous) || previous === '.' || previous === '#' || previous === '/')) continue
    if (ASCII_WORD.test(next) || next === '/') continue
    if (overlaps(taken, start, end)) continue
    found.push({ start, end, kind: 'num' })
  }
  return found
}

/**
 * 글에서 강조할 자리를 앞에서부터 순서대로 돌려준다 (겹치지 않는다).
 * 경로가 숫자보다 먼저 정해져 경로 안의 숫자는 숫자로 칠하지 않는다. URL·이메일은 어느 쪽도 칠하지 않는다
 */
export function findHighlights(text: string, options: { isNumbers?: boolean; isPaths?: boolean } = {}): HighlightRange[] {
  const { isNumbers = true, isPaths = true } = options
  if (!/[\d/.\\]/.test(text)) return []
  const excluded = [...text.matchAll(EXCLUDED_PATTERN)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
  const paths = isPaths ? findPaths(text, excluded) : []
  const numbers = isNumbers ? findNumbers(text, [...excluded, ...paths]) : []
  return [...paths, ...numbers].sort((a, b) => a.start - b.start)
}

// ── rehype 플러그인 ─────────────────────────────────────

interface HastText {
  type: 'text'
  value: string
}

interface HastElement {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: HastNode[]
}

type HastNode = HastText | HastElement | { type: string; children?: HastNode[] }

/** 안쪽 글을 건드리지 않는 요소: 코드·링크·제목·이미 다른 강조가 든 span */
const SKIP_TAGS = new Set(['code', 'pre', 'a', 'kbd', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'script', 'style', 'svg', 'textarea'])

function splitText(node: HastText): HastNode[] | null {
  const ranges = findHighlights(node.value)
  if (ranges.length === 0) return null
  const parts: HastNode[] = []
  let at = 0
  for (const range of ranges) {
    if (range.start > at) parts.push({ type: 'text', value: node.value.slice(at, range.start) })
    parts.push({
      type: 'element',
      tagName: 'span',
      properties: { className: [range.kind] },
      children: [{ type: 'text', value: node.value.slice(range.start, range.end) }],
    })
    at = range.end
  }
  if (at < node.value.length) parts.push({ type: 'text', value: node.value.slice(at) })
  return parts
}

function walk(node: HastNode): void {
  const children = (node as { children?: HastNode[] }).children
  if (!children) return
  if (node.type === 'element' && SKIP_TAGS.has((node as HastElement).tagName)) return
  const next: HastNode[] = []
  for (const child of children) {
    if (child.type === 'text') {
      next.push(...(splitText(child as HastText) ?? [child]))
    } else {
      walk(child)
      next.push(child)
    }
  }
  ;(node as { children: HastNode[] }).children = next
}

/** unified 플러그인: 일반 글 안의 숫자·경로를 span 으로 나눈다 */
export function rehypeHighlightTokens() {
  return (tree: HastNode) => walk(tree)
}
