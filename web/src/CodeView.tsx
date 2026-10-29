import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import hljs from 'highlight.js/lib/common'
import { CodeFindBar } from './CodeFindBar'
import { codeLinesHtml, normalizeText, plainLines, splitHighlightedLines } from './codeLines'
import type { LineRange } from './codeSelection'
import { gutterWidth, scrollLineIntoView } from './codeViewDom'
import { useLineSelection } from './lineSelection'

/** 이보다 긴 글은 문법 강조 없이 보인다 (강조에 시간이 들어 고를 때 멈칫한다. 측정 → workspace.md) */
export const HIGHLIGHT_MAX_CHARS = 512 * 1024

/** 찾기 막대(Ctrl+F) 상태. FilesTab 이 들고 있어 다른 파일을 열어도 같은 글로 이어진다 */
export interface CodeFindState {
  isOpen: boolean
  focusId: number
  query: string
  isCaseSensitive: boolean
}

interface Props {
  text: string
  language: string | null
  /** 고른 줄 범위 (FilesTab 이 파일별로 기억한다) */
  selection: LineRange | null
  onSelectionChange: (range: LineRange | null) => void
  /** 이 줄로 스크롤한다 (Search 결과를 눌렀을 때). stamp 가 바뀔 때만 */
  revealLine: { line: number; stamp: number } | null
  /** 열려 있으면 찾기 막대를 코드 위에 */
  find: CodeFindState | null
  onFindChange: (query: string, isCaseSensitive: boolean) => void
  onFindClose: () => void
}

/**
 * Files 탭의 읽기 전용 코드 보기: 줄 번호 + 문법 강조(highlight.js, 색은 style.css 의 .hljs-* 규칙), 긴 줄은 가로 스크롤.
 * 줄 요소(`.code-line[data-line]`)를 한 번에 innerHTML 로 넣는다 — 몇 천 줄을 React 요소로 만들지 않게.
 * 줄 번호는 `::before { content: attr(data-line) }` 라 선택·복사에 끼지 않는다.
 * 줄 고르기는 useLineSelection (DiffView 와 같다), 찾기는 CodeFindBar. 편집 모드는 이 컴포넌트 자리를 편집기로 바꾼다
 */
export const CodeView = memo(function CodeView({ text, language, selection, onSelectionChange, revealLine, find, onFindChange, onFindClose }: Props) {
  const { html, lines } = useMemo(() => {
    const normalized = normalizeText(text)
    const canHighlight = language !== null && normalized.length <= HIGHLIGHT_MAX_CHARS && hljs.getLanguage(language) !== undefined
    const lineHtml = canHighlight ? splitHighlightedLines(hljs.highlight(normalized, { language, ignoreIllegals: true }).value) : plainLines(normalized)
    return { html: codeLinesHtml(lineHtml), lines: normalized.split('\n') }
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

  const revealedStampRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (!revealLine || revealedStampRef.current === revealLine.stamp) return
    const line = linesRef.current?.children[revealLine.line - 1] as HTMLElement | undefined
    if (!viewRef.current || !line) return
    revealedStampRef.current = revealLine.stamp
    scrollLineIntoView(viewRef.current, line)
  }, [revealLine, html])

  return (
    <>
      {find?.isOpen && (
        <CodeFindBar
          lines={lines}
          html={html}
          viewRef={viewRef}
          linesRef={linesRef}
          focusId={find.focusId}
          initialQuery={find.query}
          initialCaseSensitive={find.isCaseSensitive}
          onChange={onFindChange}
          onClose={onFindClose}
        />
      )}
      <div className="code-view" ref={viewRef} style={{ '--gutter-digits': String(lines.length).length } as CSSProperties}>
        <div className="code-lines hljs" ref={linesRef} onMouseDown={onMouseDown} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>
  )
})
