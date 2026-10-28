import { memo, useMemo, type CSSProperties } from 'react'
import hljs from 'highlight.js/lib/common'
import { codeLinesHtml, normalizeText, plainLines, splitHighlightedLines } from './codeLines'

/** 이보다 긴 글은 문법 강조 없이 보인다 (강조에 시간이 들어 고를 때 멈칫한다. 측정 → workspace.md) */
export const HIGHLIGHT_MAX_CHARS = 512 * 1024

/**
 * Files 탭의 읽기 전용 코드 보기: 줄 번호 + 문법 강조(highlight.js, 색은 style.css 의 .hljs-* 규칙), 긴 줄은 가로 스크롤.
 * 줄 요소(`.code-line[data-line]`)를 한 번에 innerHTML 로 넣는다 — 몇 천 줄을 React 요소로 만들지 않게.
 * 줄 번호는 `::before { content: attr(data-line) }` 라 선택·복사에 끼지 않는다.
 * 2단계(줄 고르기)는 data-line 으로 줄을 찾고, 4단계(편집)는 이 컴포넌트 자리를 편집기로 바꾼다
 */
export const CodeView = memo(function CodeView({ text, language }: { text: string; language: string | null }) {
  const { html, lineCount } = useMemo(() => {
    const normalized = normalizeText(text)
    const canHighlight = language !== null && normalized.length <= HIGHLIGHT_MAX_CHARS && hljs.getLanguage(language) !== undefined
    const lines = canHighlight ? splitHighlightedLines(hljs.highlight(normalized, { language, ignoreIllegals: true }).value) : plainLines(normalized)
    return { html: codeLinesHtml(lines), lineCount: lines.length }
  }, [text, language])
  return (
    <div className="code-view" style={{ '--gutter-digits': String(lineCount).length } as CSSProperties}>
      <div className="code-lines hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
})
