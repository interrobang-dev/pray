import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react'
import hljs from 'highlight.js/lib/common'
import { codeLinesHtml, normalizeText, plainLines, splitHighlightedLines } from './codeLines'
import { clickLine, isSameRange, selectionLineRange, type LineRange } from './codeSelection'

/** 이보다 긴 글은 문법 강조 없이 보인다 (강조에 시간이 들어 고를 때 멈칫한다. 측정 → workspace.md) */
export const HIGHLIGHT_MAX_CHARS = 512 * 1024

const SELECTED_CLASS = 'is-selected'

interface Props {
  text: string
  language: string | null
  /** 고른 줄 범위 (FilesTab 이 파일별로 기억한다) */
  selection: LineRange | null
  onSelectionChange: (range: LineRange | null) => void
}

/**
 * Files 탭의 읽기 전용 코드 보기: 줄 번호 + 문법 강조(highlight.js, 색은 style.css 의 .hljs-* 규칙), 긴 줄은 가로 스크롤.
 * 줄 요소(`.code-line[data-line]`)를 한 번에 innerHTML 로 넣는다 — 몇 천 줄을 React 요소로 만들지 않게.
 * 줄 번호는 `::before { content: attr(data-line) }` 라 선택·복사에 끼지 않는다.
 * 줄 고르기: 줄 번호 클릭(Shift = 범위)과 글자 드래그 선택(걸친 줄). 고른 줄 표시는 줄 요소의 class 를 직접 바꾼다.
 * 4단계(편집)는 이 컴포넌트 자리를 편집기로 바꾼다
 */
export const CodeView = memo(function CodeView({ text, language, selection, onSelectionChange }: Props) {
  const { html, lineCount } = useMemo(() => {
    const normalized = normalizeText(text)
    const canHighlight = language !== null && normalized.length <= HIGHLIGHT_MAX_CHARS && hljs.getLanguage(language) !== undefined
    const lines = canHighlight ? splitHighlightedLines(hljs.highlight(normalized, { language, ignoreIllegals: true }).value) : plainLines(normalized)
    return { html: codeLinesHtml(lines), lineCount: lines.length }
  }, [text, language])
  const viewRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  /** Shift+클릭의 시작 줄 (마지막 그냥 클릭·드래그를 시작한 줄) */
  const anchorRef = useRef<number | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const onChangeRef = useRef(onSelectionChange)
  onChangeRef.current = onSelectionChange
  /** 지금 class 를 붙여 둔 범위와 그때의 줄 HTML (HTML 이 바뀌면 줄 요소가 새것이라 뗄 것이 없다) */
  const paintedRef = useRef<{ html: string; range: LineRange | null }>({ html: '', range: null })

  useLayoutEffect(() => {
    const lines = linesRef.current?.children
    if (!lines) return
    const painted = paintedRef.current
    if (painted.html === html && isSameRange(painted.range, selection)) return
    const paint = (range: LineRange | null, isOn: boolean) => {
      if (!range) return
      for (let line = range.start; line <= Math.min(range.end, lines.length); line++) lines[line - 1].classList.toggle(SELECTED_CLASS, isOn)
    }
    if (painted.html === html) paint(painted.range, false)
    paint(selection, true)
    paintedRef.current = { html, range: selection }
  }, [html, selection])

  // 글자 드래그 선택(폰의 길게 눌러 고르기 포함)이 이 코드 안에 걸치면 그 줄들을 고른다. 접힌(클릭만 한) 선택은 무시해 고른 줄이 남는다
  useEffect(() => {
    const onSelectionChangeEvent = () => {
      const lines = linesRef.current
      const domSelection = document.getSelection()
      if (!lines || !domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return
      const range = domSelection.getRangeAt(0)
      const startLine = lineElementAt(lines, range.startContainer, range.startOffset, false)
      const endLine = lineElementAt(lines, range.endContainer, range.endOffset, true)
      if (!startLine || !endLine) return
      const probe = document.createRange()
      probe.setStart(endLine, 0)
      probe.setEnd(range.endContainer, range.endOffset)
      const next = selectionLineRange(lineNumberOf(startLine), lineNumberOf(endLine), probe.toString() === '')
      const anchorLine = domSelection.anchorNode ? lineElementAt(lines, domSelection.anchorNode, domSelection.anchorOffset, false) : null
      anchorRef.current = anchorLine ? lineNumberOf(anchorLine) : next.start
      if (!isSameRange(next, selectionRef.current)) onChangeRef.current(next)
    }
    document.addEventListener('selectionchange', onSelectionChangeEvent)
    return () => document.removeEventListener('selectionchange', onSelectionChangeEvent)
  }, [])

  /** 줄 번호(왼쪽에 붙은 ::before 칸) 클릭. 그 칸에서는 글자 선택을 시작하지 않는다 */
  function onMouseDown(event: MouseEvent<HTMLDivElement>) {
    const view = viewRef.current
    const line = (event.target as Element).closest('.code-line')
    if (event.button !== 0 || !view || !line || !(line instanceof HTMLElement)) return
    if (event.clientX - view.getBoundingClientRect().left >= gutterWidth(line)) return
    event.preventDefault()
    document.getSelection()?.removeAllRanges()
    const next = clickLine(selectionRef.current, lineNumberOf(line), anchorRef.current, event.shiftKey)
    anchorRef.current = next.anchor
    onChangeRef.current(next.range)
  }

  return (
    <div className="code-view" ref={viewRef} style={{ '--gutter-digits': String(lineCount).length } as CSSProperties}>
      <div className="code-lines hljs" ref={linesRef} onMouseDown={onMouseDown} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
})

function lineNumberOf(line: Element): number {
  return Number(line.getAttribute('data-line'))
}

/** 선택 끝점이 든 줄 요소. 끝점이 줄 사이(.code-lines 자신)면 앞 끝은 offset 자리 줄, 뒤 끝은 그 앞 줄. 이 코드 밖이면 null */
function lineElementAt(lines: HTMLElement, container: Node, offset: number, isEnd: boolean): Element | null {
  if (container === lines) return lines.children[isEnd ? offset - 1 : offset] ?? null
  const element = container instanceof Element ? container : container.parentElement
  const line = element?.closest('.code-line') ?? null
  return line && lines.contains(line) ? line : null
}

/** 줄 번호 칸 폭: ::before 의 폭·안쪽 여백·오른쪽 선·글자와의 간격. 이 칸은 sticky 라 가로 스크롤과 무관하게 보기 왼쪽에 있다 */
function gutterWidth(line: HTMLElement): number {
  const before = getComputedStyle(line, '::before')
  return [before.width, before.paddingLeft, before.paddingRight, before.borderRightWidth, before.marginRight].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
}
