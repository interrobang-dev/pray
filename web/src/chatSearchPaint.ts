import { findTextRanges, isBlankQuery, locatePieceRange } from './chatSearch'

/**
 * 일치한 글자 칠하기 (CSS Custom Highlight API). React 가 그린 DOM 은 건드리지 않고 화면에 그려진 대상 요소의 텍스트 노드에서 Range 를 만들어
 * `::highlight()` 로 칠한다 (style.css). 지원하지 않는 브라우저는 칠하기만 건너뛴다
 */
const MATCH_HIGHLIGHT = 'chat-search'
const CURRENT_HIGHLIGHT = 'chat-search-current'

/** 화면에 보이는 글이 아닌 것: 도구 결과·"Queued" 라벨·"Instruction from …" 라벨·도구 줄의 도구 이름 */
const SKIP_SELECTOR = '.result, .queued-label, .relay-label, summary > code, [data-search-skip]'

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

export function clearSearchHighlights(): void {
  const api = highlightApi()
  api?.registry.delete(MATCH_HIGHLIGHT)
  api?.registry.delete(CURRENT_HIGHLIGHT)
}

/** 칠할 수 있는 글: 접힌 details 안(summary 밖)이나 건너뛸 요소 안의 글은 화면에 없다 */
function isPaintable(node: Text): boolean {
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP_SELECTOR)) return false
  const details = parent.closest('details')
  return !details || details.open || parent.closest('summary') !== null
}

function paintableTextNodes(element: Element): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isPaintable(node as Text)) nodes.push(node as Text)
  }
  return nodes
}

/** 요소에 그려진 글에서 query 와 일치하는 곳의 Range 들. 여러 텍스트 노드(굵은 글·코드 강조 span)에 걸쳐도 된다 */
function rangesIn(element: Element, query: string): Range[] {
  const nodes = paintableTextNodes(element)
  const spans = findTextRanges(nodes.map((node) => node.data).join(''), query)
  const lengths = nodes.map((node) => node.data.length)
  const ranges: Range[] = []
  for (const [start, end] of spans) {
    const located = locatePieceRange(lengths, start, end)
    if (!located) continue
    const range = new Range()
    range.setStart(nodes[located.startIndex], located.startOffset)
    range.setEnd(nodes[located.endIndex], located.endOffset)
    ranges.push(range)
  }
  return ranges
}

function elementsByKey(container: HTMLElement): Map<string, Element> {
  const elements = new Map<string, Element>()
  for (const element of container.querySelectorAll('[data-jump-key]')) {
    const key = element.getAttribute('data-jump-key')
    if (key) elements.set(key, element)
  }
  return elements
}

/**
 * 화면에 그려진 결과 요소들의 일치 글자를 칠한다. 현재 결과 안의 것은 진한 색, 나머지는 옅은 색.
 * 접혀서 DOM 에 없는 결과는 칠할 것이 없다 (그 결과로 갈 때 Chat 이 펼친다)
 */
export function paintSearchHighlights(container: HTMLElement, query: string, matchKeys: string[], currentKey: string | null): void {
  const api = highlightApi()
  if (!api) return
  if (isBlankQuery(query)) {
    clearSearchHighlights()
    return
  }
  const elements = elementsByKey(container)
  const matches = api.create()
  const current = api.create()
  current.priority = 1
  for (const key of matchKeys) {
    const element = elements.get(key)
    if (!element) continue
    for (const range of rangesIn(element, query)) (key === currentKey ? current : matches).add(range)
  }
  api.registry.set(MATCH_HIGHLIGHT, matches)
  api.registry.set(CURRENT_HIGHLIGHT, current)
}

/**
 * 현재 결과가 접힌 도구 줄(details)인데 일치한 곳이 한 줄 요약에 안 보이면(여러 줄 명령의 뒤쪽 줄 등) 펼쳐서 보인다.
 * 사용자가 이동했을 때만 부른다 (다시 접은 것을 칠할 때마다 펼치지 않게)
 */
export function revealCurrentMatch(container: HTMLElement, currentKey: string | null, query: string): void {
  if (!currentKey) return
  const element = elementsByKey(container).get(currentKey)
  if (!(element instanceof HTMLDetailsElement) || element.open) return
  if (rangesIn(element, query).length === 0) element.open = true
}
