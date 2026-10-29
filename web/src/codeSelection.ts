/**
 * Files 탭 줄 고르기·위치 글 (순수 함수). 줄 번호는 1부터, 범위는 양끝을 넣는다 (start ≤ end)
 */
import { normalizeText } from './codeLines'

export interface LineRange {
  start: number
  end: number
}

/** 두 줄 사이 범위 (순서 무관) */
export function rangeBetween(first: number, second: number): LineRange {
  return { start: Math.min(first, second), end: Math.max(first, second) }
}

export function isSameRange(a: LineRange | null, b: LineRange | null): boolean {
  return a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end)
}

/** CodeView 가 그리는 줄 수 (normalizeText 규칙: 끝 줄바꿈 뒤 빈 줄은 세지 않는다) */
export function lineCountOf(text: string): number {
  return normalizeText(text).split('\n').length
}

/** 다시 읽은 파일이 줄었으면 범위를 자른다. 시작 줄까지 없어졌으면 null */
export function clampLineRange(range: LineRange, lineCount: number): LineRange | null {
  if (range.start > lineCount) return null
  return range.end > lineCount ? { start: range.start, end: lineCount } : range
}

/**
 * 줄 번호 클릭. 그냥 클릭 = 그 줄 (이미 그 한 줄만 골라 있으면 풀기), Shift+클릭 = 앞서 고른 줄(anchor, 없으면 범위 시작)부터 그 줄까지.
 * 돌려준 anchor 를 다음 Shift+클릭에 쓴다
 */
export function clickLine(current: LineRange | null, line: number, anchor: number | null, isShift: boolean): { range: LineRange | null; anchor: number | null } {
  if (isShift) {
    const from = anchor ?? current?.start ?? line
    return { range: rangeBetween(from, line), anchor: from }
  }
  if (current && current.start === line && current.end === line) return { range: null, anchor: null }
  return { range: { start: line, end: line }, anchor: line }
}

/**
 * 글자 드래그 선택이 걸친 줄 범위. 끝이 다음 줄 맨 앞이면(줄 전체를 끌어 고르거나 세 번 클릭) 그 줄은 넣지 않는다.
 * startLine ≤ endLine 은 DOM Range 의 앞·끝 순서다
 */
export function selectionLineRange(startLine: number, endLine: number, isEndAtLineStart: boolean): LineRange {
  const end = isEndAtLineStart && endLine > startLine ? endLine - 1 : endLine
  return rangeBetween(startLine, end)
}

/** 위치 글: `src/App.tsx:12-20`, 한 줄이면 `:12`, 고른 줄이 없으면 경로만. path 는 세션 cwd 기준 `/` 구분 */
export function locationText(path: string, range: LineRange | null): string {
  if (!range) return path
  return range.start === range.end ? `${path}:${range.start}` : `${path}:${range.start}-${range.end}`
}

/** 대화 입력칸에 넣는 위치: 백틱으로 감싼다 (마크다운 코드로 보이고, 경로의 `_`·`*` 가 서식이 되지 않는다) */
export function chatLocationText(path: string, range: LineRange | null): string {
  return `\`${locationText(path, range)}\``
}
