/**
 * 코드 보기(CodeView.tsx)의 DOM 도우미: 줄 번호 칸 폭, 보이는 줄, 찾기(Ctrl+F) 맞은 곳 칠하기·스크롤.
 * 줄은 innerHTML 이라 React 가 모르는 요소다 — 칠하기는 CSS Custom Highlight API 로 DOM 을 건드리지 않는다
 */
import { locatePieceRange } from './chatSearch'
import type { CodeMatch } from './codeFind'

const MATCH_HIGHLIGHT = 'code-find'
const CURRENT_HIGHLIGHT = 'code-find-current'

/** 줄 번호 칸 폭: ::before 의 폭·안쪽 여백·오른쪽 선·글자와의 간격. 이 칸은 sticky 라 가로 스크롤과 무관하게 보기 왼쪽에 있다 */
export function gutterWidth(line: HTMLElement): number {
  const before = getComputedStyle(line, '::before')
  return [before.width, before.paddingLeft, before.paddingRight, before.borderRightWidth, before.marginRight].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
}

/** 보기 안에 보이는 줄 번호 [처음, 끝] (1부터). 줄 높이는 모두 같다 (white-space: pre, 접지 않음) */
export function visibleLines(view: HTMLElement, lines: HTMLElement): [number, number] {
  const first = lines.firstElementChild as HTMLElement | null
  if (!first) return [1, 0]
  const lineHeight = first.offsetHeight || 18
  const top = view.getBoundingClientRect().top - first.getBoundingClientRect().top
  const start = Math.max(1, Math.floor(top / lineHeight) + 1)
  return [start, Math.min(lines.children.length, start + Math.ceil(view.clientHeight / lineHeight))]
}

interface HighlightLike {
  add(range: Range): void
  priority: number
}
interface HighlightRegistry {
  set(name: string, highlight: HighlightLike): void
  delete(name: string): void
}

function highlightApi(): { registry: HighlightRegistry; create: () => HighlightLike } | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
  const Highlight = (globalThis as unknown as { Highlight?: new () => HighlightLike }).Highlight
  return registry && Highlight ? { registry, create: () => new Highlight() } : null
}

export function clearCodeFindHighlights(): void {
  const api = highlightApi()
  api?.registry.delete(MATCH_HIGHLIGHT)
  api?.registry.delete(CURRENT_HIGHLIGHT)
}

/** 줄 요소 안 글자 [start, end) 의 Range (문법 강조 span 여러 개에 걸쳐도 된다). 줄 밖이면 null */
export function lineRange(line: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  const located = locatePieceRange(
    nodes.map((node) => node.data.length),
    start,
    end,
  )
  if (!located) return null
  const range = new Range()
  range.setStart(nodes[located.startIndex], located.startOffset)
  range.setEnd(nodes[located.endIndex], located.endOffset)
  return range
}

/** matches[from..to) 를 칠한다 (보이는 줄 근처만 — 맞은 곳이 수만 개여도 Range 를 다 만들지 않게). currentIndex 는 진한 색 */
export function paintCodeMatches(lines: HTMLElement, matches: CodeMatch[], from: number, to: number, currentIndex: number): void {
  const api = highlightApi()
  if (!api) return
  const all = api.create()
  const current = api.create()
  current.priority = 1
  for (let index = from; index < to; index++) {
    const match = matches[index]
    const line = lines.children[match.line - 1]
    const range = line ? lineRange(line, match.start, match.end) : null
    if (range) (index === currentIndex ? current : all).add(range)
  }
  api.registry.set(MATCH_HIGHLIGHT, all)
  api.registry.set(CURRENT_HIGHLIGHT, current)
}

/** 그 줄이 보기 위아래 끝에 걸치거나 밖이면 가운데로 세로 스크롤한다 */
export function scrollLineIntoView(view: HTMLElement, line: HTMLElement): void {
  const viewRect = view.getBoundingClientRect()
  const rect = line.getBoundingClientRect()
  if (rect.top < viewRect.top + rect.height || rect.bottom > viewRect.bottom - rect.height) {
    view.scrollTop += rect.top - viewRect.top - (view.clientHeight - rect.height) / 2
  }
}

/** 맞은 곳을 보이게: 세로는 scrollLineIntoView, 가로는 맞은 글자가 번호 칸에 가리거나 오른쪽 밖이면 */
export function scrollMatchIntoView(view: HTMLElement, lines: HTMLElement, match: CodeMatch): void {
  const line = lines.children[match.line - 1] as HTMLElement | undefined
  if (!line) return
  scrollLineIntoView(view, line)
  const rect = lineRange(line, match.start, match.end)?.getBoundingClientRect()
  if (!rect) return
  const viewRect = view.getBoundingClientRect()
  const left = viewRect.left + gutterWidth(line)
  if (rect.left < left || rect.right > viewRect.right) view.scrollLeft += rect.left - left - (viewRect.right - left) / 3
}
