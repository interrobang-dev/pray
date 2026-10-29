/** Files 탭 Search(작업 폴더 전체 내용 찾기, Ctrl+Shift+F)의 순수 함수 (화면 → SearchPanel.tsx, 서버 → server workspaceSearch.ts) */
import type { WorkspaceSearchLine, WorkspaceSearchResult } from './types'

/** 서버 검색어 상한과 같다 */
export const MAX_SEARCH_QUERY_CHARS = 500
/** 서버 맞은 곳 상한과 같다 (잘렸을 때 이유를 가르려고) */
export const MAX_SEARCH_MATCHES = 2000

export interface SearchInput {
  query: string
  isCaseSensitive: boolean
  isWholeWord: boolean
  isRegex: boolean
}

/** 같은 검색인지 가르는 키 (결과·오류가 지금 입력의 것인지) */
export function searchKey({ query, isCaseSensitive, isWholeWord, isRegex }: SearchInput): string {
  return JSON.stringify([query, isCaseSensitive, isWholeWord, isRegex])
}

/** `GET /api/sessions/:id/search` 쿼리 */
export function searchParams({ query, isCaseSensitive, isWholeWord, isRegex }: SearchInput): Record<string, string> {
  return { q: query, case: isCaseSensitive ? '1' : '0', word: isWholeWord ? '1' : '0', regex: isRegex ? '1' : '0' }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** 골라 둔 글자로 찾을 검색어. 비었거나 여러 줄이거나 너무 길면 null. 정규식 켜짐이면 글자 그대로 찾게 이스케이프한다 */
export function selectionQuery(text: string, isRegex: boolean): string | null {
  if (text === '' || /[\r\n]/.test(text)) return null
  const query = isRegex ? escapeRegExp(text) : text
  return query.length <= MAX_SEARCH_QUERY_CHARS ? query : null
}

export interface PreviewPiece {
  text: string
  isMatch: boolean
}

/** 결과 줄에서 첫 맞은 곳 앞에 남기는 글자 수 (왼쪽 칸이 160px 로 좁아도 맞은 곳이 보이게) */
export const PREVIEW_LEAD_CHARS = 10

/**
 * 결과 줄 → 칠할 조각. 앞 들여쓰기는 떼고, 첫 맞은 곳 앞이 PREVIEW_LEAD_CHARS 자보다 길면 그만큼만 남긴다.
 * 원래 줄 앞·뒤가 잘렸으면 isCutBefore·isCutAfter (화면이 "…")
 */
export function previewPieces(line: WorkspaceSearchLine): { pieces: PreviewPiece[]; isCutBefore: boolean; isCutAfter: boolean } {
  const firstStart = line.ranges[0]?.[0] ?? 0
  const indent = line.text.length - line.text.trimStart().length
  const contentStart = line.column === 0 ? Math.min(indent, firstStart) : 0
  const offset = Math.max(contentStart, firstStart - PREVIEW_LEAD_CHARS)
  const pieces: PreviewPiece[] = []
  let at = offset
  for (const [start, end] of line.ranges) {
    if (start > at) pieces.push({ text: line.text.slice(at, start), isMatch: false })
    if (end > Math.max(start, at)) pieces.push({ text: line.text.slice(Math.max(start, at), end), isMatch: true })
    at = Math.max(at, end)
  }
  if (at < line.text.length) pieces.push({ text: line.text.slice(at), isMatch: false })
  return { pieces, isCutBefore: line.column > 0 || offset > contentStart, isCutAfter: line.hasMoreAfter }
}

/** 결과 머리 한 줄: "17 results in 5 files" · "1 result in 1 file" · "No results" */
export function searchSummary(result: WorkspaceSearchResult): string {
  if (result.matchCount === 0) return 'No results'
  const results = `${result.matchCount.toLocaleString('en')} ${result.matchCount === 1 ? 'result' : 'results'}`
  return `${results} in ${result.fileCount.toLocaleString('en')} ${result.fileCount === 1 ? 'file' : 'files'}`
}

/** 결과가 다가 아닐 때의 안내 (회색 한 줄씩) */
export function searchNotes(result: WorkspaceSearchResult): string[] {
  const notes: string[] = []
  if (result.isTruncated) {
    notes.push(result.matchCount >= MAX_SEARCH_MATCHES ? `Showing the first ${MAX_SEARCH_MATCHES.toLocaleString('en')} results` : 'Stopped after 5 seconds · results are incomplete')
  }
  // 빠른 찾기와 같은 파일 목록이 5만 개·3초 상한에서 멈췄다
  if (result.isIndexPartial) notes.push('Folder too large · searched only part of it')
  return notes
}
