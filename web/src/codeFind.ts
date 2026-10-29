/** Files 탭 코드 보기 안 찾기(Ctrl+F)의 순수 함수 (막대 → CodeFindBar.tsx, 칠하기·스크롤 → codeViewDom.ts) */
import { findTextRanges } from './chatSearch'

/** 맞은 곳 하나. line 은 1부터(코드 보기 줄 번호), start·end 는 그 줄 글 안 [시작, 끝) */
export interface CodeMatch {
  line: number
  start: number
  end: number
}

/**
 * 줄마다 query 가 든 곳 (겹치지 않게 앞에서부터, 줄 순서). 빈 글이면 없음 — 공백만인 글도 찾는다 (코드의 들여쓰기 등).
 * 대소문자 무시는 대화 검색과 같은 `toLocaleLowerCase` 비교
 */
export function findInLines(lines: string[], query: string, isCaseSensitive: boolean): CodeMatch[] {
  if (query === '') return []
  const matches: CodeMatch[] = []
  // 공백만인 글은 대소문자가 없고, findTextRanges 는 공백만인 검색어를 없는 것으로 본다
  const isPlain = isCaseSensitive || query.trim() === ''
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]
    if (isPlain) {
      for (let from = text.indexOf(query); from !== -1; from = text.indexOf(query, from + query.length)) matches.push({ line: index + 1, start: from, end: from + query.length })
    } else {
      for (const [start, end] of findTextRanges(text, query)) matches.push({ line: index + 1, start, end })
    }
  }
  return matches
}

/** line 줄이나 그 뒤의 첫 맞은 곳 번호. 뒤에 없으면 처음(0)으로 돈다. 맞은 곳이 없으면 -1 */
export function firstMatchFrom(matches: CodeMatch[], line: number): number {
  if (matches.length === 0) return -1
  const index = lowerBound(matches, line)
  return index < matches.length ? index : 0
}

/** fromLine~toLine 줄의 맞은 곳 번호 범위 [start, end) (칠할 곳만 고르려고) */
export function matchIndexesBetween(matches: CodeMatch[], fromLine: number, toLine: number): [number, number] {
  return [lowerBound(matches, fromLine), lowerBound(matches, toLine + 1)]
}

/** line 줄 이상인 첫 맞은 곳 번호 (줄 순서라 이분 찾기) */
function lowerBound(matches: CodeMatch[], line: number): number {
  let low = 0
  let high = matches.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (matches[middle].line < line) low = middle + 1
    else high = middle
  }
  return low
}

/** 개수 글자: 검색어 없으면 빈 글, 없으면 "No results", 있으면 "3/17" (index 는 0부터) */
export function codeFindCountLabel(query: string, index: number, count: number): string {
  if (query === '') return ''
  if (count === 0) return 'No results'
  return `${index + 1}/${count.toLocaleString('en')}`
}
