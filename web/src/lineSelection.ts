import { useEffect, useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react'
import { clickLine, isSameRange, selectionLineRange, type LineRange } from './codeSelection'

const SELECTED_CLASS = 'is-selected'

interface Options {
  /** 줄 요소들이 직속 자식으로 든 칸 (innerHTML). 줄 N 은 children[N-1] */
  linesRef: RefObject<HTMLDivElement | null>
  /** 줄 요소 선택자 (`.code-line`·`.diff-row`) */
  lineSelector: string
  /** 줄 번호 속성 (`data-line`·`data-row`) */
  numberAttribute: string
  /** 그 mousedown 이 줄 번호 칸 위인지 */
  isGutterHit: (event: MouseEvent<HTMLDivElement>, line: HTMLElement) => boolean
  /** 줄 HTML. 바뀌면 줄 요소가 새것이라 표시를 다시 붙인다 */
  html: string
  selection: LineRange | null
  onSelectionChange: (range: LineRange | null) => void
}

/**
 * 코드 보기·diff 보기의 줄 고르기 (규칙 → workspace.md "줄 고르기"): 번호 칸 클릭 = 그 줄(같은 한 줄이면 풀기), Shift+클릭 = 시작 줄부터,
 * 글자 드래그(document selectionchange — 폰의 길게 눌러 고르기 포함) = 걸친 줄. 고른 줄은 줄 요소에 class `is-selected` 를 직접 붙인다.
 * 돌려준 onMouseDown 을 줄 칸에 건다
 */
export function useLineSelection({ linesRef, lineSelector, numberAttribute, isGutterHit, html, selection, onSelectionChange }: Options) {
  /** Shift+클릭의 시작 줄 (마지막 그냥 클릭·드래그를 시작한 줄) */
  const anchorRef = useRef<number | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const onChangeRef = useRef(onSelectionChange)
  onChangeRef.current = onSelectionChange
  /** 지금 class 를 붙여 둔 범위와 그때의 줄 HTML (HTML 이 바뀌면 줄 요소가 새것이라 뗄 것이 없다) */
  const paintedRef = useRef<{ html: string; range: LineRange | null }>({ html: '', range: null })
  const numberOf = (line: Element) => Number(line.getAttribute(numberAttribute))

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
  }, [linesRef, html, selection])

  // 글자 드래그 선택이 이 칸 안에 걸치면 그 줄들을 고른다. 접힌(클릭만 한) 선택은 무시해 고른 줄이 남는다
  useEffect(() => {
    /** 선택 끝점이 든 줄 요소. 끝점이 줄 사이(줄 칸 자신)면 앞 끝은 offset 자리 줄, 뒤 끝은 그 앞 줄. 이 칸 밖이면 null */
    const lineAt = (lines: HTMLElement, container: Node, offset: number, isEnd: boolean): Element | null => {
      if (container === lines) return lines.children[isEnd ? offset - 1 : offset] ?? null
      const element = container instanceof Element ? container : container.parentElement
      const line = element?.closest(lineSelector) ?? null
      return line && lines.contains(line) ? line : null
    }
    const onSelectionChangeEvent = () => {
      const lines = linesRef.current
      const domSelection = document.getSelection()
      if (!lines || !domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return
      const range = domSelection.getRangeAt(0)
      const startLine = lineAt(lines, range.startContainer, range.startOffset, false)
      const endLine = lineAt(lines, range.endContainer, range.endOffset, true)
      if (!startLine || !endLine) return
      const probe = document.createRange()
      probe.setStart(endLine, 0)
      probe.setEnd(range.endContainer, range.endOffset)
      const next = selectionLineRange(Number(startLine.getAttribute(numberAttribute)), Number(endLine.getAttribute(numberAttribute)), probe.toString() === '')
      const anchorLine = domSelection.anchorNode ? lineAt(lines, domSelection.anchorNode, domSelection.anchorOffset, false) : null
      anchorRef.current = anchorLine ? Number(anchorLine.getAttribute(numberAttribute)) : next.start
      if (!isSameRange(next, selectionRef.current)) onChangeRef.current(next)
    }
    document.addEventListener('selectionchange', onSelectionChangeEvent)
    return () => document.removeEventListener('selectionchange', onSelectionChangeEvent)
  }, [linesRef, lineSelector, numberAttribute])

  /** 줄 번호 칸 클릭. 그 칸에서는 글자 선택을 시작하지 않는다 (Shift+클릭이 글자 선택을 늘리지 않게) */
  function onMouseDown(event: MouseEvent<HTMLDivElement>) {
    const line = (event.target as Element).closest(lineSelector)
    if (event.button !== 0 || !(line instanceof HTMLElement) || !isGutterHit(event, line)) return
    event.preventDefault()
    document.getSelection()?.removeAllRanges()
    const next = clickLine(selectionRef.current, numberOf(line), anchorRef.current, event.shiftKey)
    anchorRef.current = next.anchor
    onChangeRef.current(next.range)
  }

  return onMouseDown
}
