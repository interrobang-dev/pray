/**
 * Files 탭 Changes(변경 보기) 순수 함수: 상태 글자·이름, diff 를 화면 줄로 펴기, 고른 줄 → 새 파일 줄 범위
 */
import { escapeHtml } from './codeLines'
import type { LineRange } from './codeSelection'
import type { ChangeStatus, DiffHunk } from './types'

/** 목록의 상태 글자 (VS Code 와 같은 글자: 추적 안 함 U, 충돌 C. SVN 의 없어진 파일은 svn 글자 그대로 !) */
export const STATUS_LETTERS: Record<ChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
  missing: '!',
}

export const STATUS_LABELS: Record<ChangeStatus, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
  conflicted: 'Conflicted',
  missing: 'Missing (deleted without svn delete)',
}

/** 파일 보기로 열 수 있는 상태 (작업 트리에 파일이 있다) */
export function isOpenable(status: ChangeStatus): boolean {
  return status !== 'deleted' && status !== 'missing'
}

/** 화면 줄 하나. 번호(row)는 1부터 diff 전체에서 이어진다 — 고르기 범위가 이 번호다 */
export type DiffRow =
  | { kind: 'hunk'; row: number; header: string }
  | { kind: 'context' | 'add' | 'del'; row: number; text: string; oldLine: number | null; newLine: number | null; hasNoNewline: boolean }

export function diffRowsOf(hunks: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', row: rows.length + 1, header: hunk.header })
    for (const line of hunk.lines) {
      rows.push({ kind: line.kind, row: rows.length + 1, text: line.text, oldLine: line.oldLine, newLine: line.newLine, hasNoNewline: Boolean(line.hasNoNewline) })
    }
  }
  return rows
}

const MARKS = { context: ' ', add: '+', del: '-' } as const

/**
 * diff 줄 HTML (innerHTML 한 번 — CodeView 처럼 몇 천 줄을 React 요소로 만들지 않게). 번호 칸 `.diff-gutter`(옛·새 번호, sticky)와
 * 표시 글자는 user-select none 이라 복사에 끼지 않는다. 끝 줄바꿈 없음은 줄 끝 회색 표시
 */
export function diffRowsHtml(rows: DiffRow[]): string {
  return rows
    .map((row) => {
      if (row.kind === 'hunk') {
        return `<div class="diff-row diff-hunk" data-row="${row.row}"><span class="diff-gutter"><span class="diff-num"></span><span class="diff-num"></span></span><span class="diff-text">${escapeHtml(row.header)}</span></div>`
      }
      const noNewline = row.hasNoNewline ? '<span class="diff-eof" title="No newline at end of file">⊘</span>' : ''
      return (
        `<div class="diff-row diff-${row.kind}" data-row="${row.row}"><span class="diff-gutter">` +
        `<span class="diff-num">${row.oldLine ?? ''}</span><span class="diff-num">${row.newLine ?? ''}</span></span>` +
        `<span class="diff-mark">${MARKS[row.kind]}</span><span class="diff-text">${escapeHtml(row.text)}</span>${noNewline}</div>`
      )
    })
    .join('')
}

/**
 * 고른 diff 줄(row 범위) → 새 파일 줄 범위 (공유할 위치). 새 번호가 있는 줄(문맥·추가)의 처음~끝.
 * 지운 줄만 골랐으면 지운 자리 바로 뒤의 새 줄(파일 끝이면 바로 앞 줄)을 한 줄로 — 새 파일에는 그 줄이 없어서다.
 * 새 줄이 하나도 없으면(지운 파일) null = 경로만
 */
export function diffLineRange(rows: DiffRow[], range: LineRange | null): LineRange | null {
  if (!range) return null
  const picked = rows.slice(range.start - 1, range.end)
  const newLines = picked.flatMap((row) => (row.kind !== 'hunk' && row.newLine !== null ? [row.newLine] : []))
  if (newLines.length > 0) return { start: Math.min(...newLines), end: Math.max(...newLines) }
  if (!picked.some((row) => row.kind === 'del')) return null
  const after = rows.slice(range.end).find((row) => row.kind !== 'hunk' && row.newLine !== null)
  const before = rows
    .slice(0, range.start - 1)
    .reverse()
    .find((row) => row.kind !== 'hunk' && row.newLine !== null)
  const anchor = after ?? before
  return anchor && anchor.kind !== 'hunk' && anchor.newLine !== null ? { start: anchor.newLine, end: anchor.newLine } : null
}

/** 추가·삭제 줄 수 ("+12 −3" 표시용) */
export function diffStats(hunks: DiffHunk[]): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') added++
      else if (line.kind === 'del') deleted++
    }
  }
  return { added, deleted }
}
