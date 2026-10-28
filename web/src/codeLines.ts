/**
 * Files 탭 코드 보기의 줄 만들기 (순수 함수). highlight.js 가 만든 HTML 을 줄마다 끊어
 * `<div class="code-line" data-line="N">` 줄로 만든다 — 줄 요소가 있어야 2단계(줄 고르기)가 줄 번호로 붙는다
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 화면 줄로 나눌 글: CR 은 지우고, 끝 줄바꿈 하나 뒤의 빈 줄은 줄로 세지 않는다 */
export function normalizeText(text: string): string {
  const withoutCr = text.replace(/\r/g, '')
  return withoutCr.endsWith('\n') ? withoutCr.slice(0, -1) : withoutCr
}

/**
 * highlight.js 결과 HTML(`<span class>`·`</span>`·이스케이프된 글만 있다)을 줄로 나눈다.
 * 줄을 넘는 span(여러 줄 주석·문자열)은 줄 끝에서 닫고 다음 줄 앞에서 다시 열어 줄마다 짝이 맞는다
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let current = ''
  let at = 0
  const tokens = /<span[^>]*>|<\/span>|\n/g
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    current += html.slice(at, match.index)
    at = match.index + match[0].length
    if (match[0] === '\n') {
      lines.push(current + '</span>'.repeat(open.length))
      current = open.join('')
    } else if (match[0] === '</span>') {
      open.pop()
      current += match[0]
    } else {
      open.push(match[0])
      current += match[0]
    }
  }
  lines.push(current + html.slice(at))
  return lines
}

/** 강조 없는 글을 줄마다 이스케이프 */
export function plainLines(text: string): string[] {
  return text.split('\n').map(escapeHtml)
}

/** 줄 HTML 들 → 줄 요소 HTML 하나 (React 가 줄마다 요소를 만들지 않게 한 번에 innerHTML 로 넣는다) */
export function codeLinesHtml(lines: string[]): string {
  return lines.map((line, i) => `<div class="code-line" data-line="${i + 1}">${line}</div>`).join('')
}
