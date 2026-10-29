import { memo, useMemo, useRef, type CSSProperties } from 'react'
import hljs from 'highlight.js/lib/common'
import { codeLinesHtml, normalizeText, plainLines, splitHighlightedLines } from './codeLines'
import type { LineRange } from './codeSelection'
import { useLineSelection } from './lineSelection'

/** 이보다 긴 글은 문법 강조 없이 보인다 (강조에 시간이 들어 고를 때 멈칫한다. 측정 → workspace.md) */
export const HIGHLIGHT_MAX_CHARS = 512 * 1024

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
 * 줄 고르기는 useLineSelection (DiffView 와 같다). 4단계(편집)는 이 컴포넌트 자리를 편집기로 바꾼다
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
  const onMouseDown = useLineSelection({
    linesRef,
    lineSelector: '.code-line',
    numberAttribute: 'data-line',
    // 번호 칸은 sticky ::before 라 요소가 없어 보기 왼쪽에서의 x 로 가린다
    isGutterHit: (event, line) => {
      const view = viewRef.current
      return view !== null && event.clientX - view.getBoundingClientRect().left < gutterWidth(line)
    },
    html,
    selection,
    onSelectionChange,
  })

  return (
    <div className="code-view" ref={viewRef} style={{ '--gutter-digits': String(lineCount).length } as CSSProperties}>
      <div className="code-lines hljs" ref={linesRef} onMouseDown={onMouseDown} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
})

/** 줄 번호 칸 폭: ::before 의 폭·안쪽 여백·오른쪽 선·글자와의 간격. 이 칸은 sticky 라 가로 스크롤과 무관하게 보기 왼쪽에 있다 */
function gutterWidth(line: HTMLElement): number {
  const before = getComputedStyle(line, '::before')
  return [before.width, before.paddingLeft, before.paddingRight, before.borderRightWidth, before.marginRight].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
}
