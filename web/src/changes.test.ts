import { describe, expect, it } from 'vitest'
import { diffLineRange, diffRowsHtml, diffRowsOf, diffStats, isOpenable } from './changes'
import type { DiffHunk } from './types'

const hunks: DiffHunk[] = [
  {
    header: '@@ -1,4 +1,4 @@',
    oldStart: 1,
    oldLines: 4,
    newStart: 1,
    newLines: 4,
    lines: [
      { kind: 'context', text: 'one', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'two', oldLine: 2, newLine: null },
      { kind: 'del', text: 'three', oldLine: 3, newLine: null },
      { kind: 'add', text: 'TWO', oldLine: null, newLine: 2 },
      { kind: 'context', text: 'four', oldLine: 4, newLine: 3 },
      { kind: 'add', text: 'five', oldLine: null, newLine: 4 },
    ],
  },
  {
    header: '@@ -20,2 +20,1 @@',
    oldStart: 20,
    oldLines: 2,
    newStart: 20,
    newLines: 1,
    lines: [
      { kind: 'context', text: 'x', oldLine: 20, newLine: 20 },
      { kind: 'del', text: 'end', oldLine: 21, newLine: null, hasNoNewline: true },
    ],
  },
]

describe('changes', () => {
  it('numbers rows across hunks', () => {
    const rows = diffRowsOf(hunks)
    expect(rows.map((row) => `${row.row}:${row.kind}`)).toEqual(['1:hunk', '2:context', '3:del', '4:del', '5:add', '6:context', '7:add', '8:hunk', '9:context', '10:del'])
    expect(diffStats(hunks)).toEqual({ added: 2, deleted: 3 })
  })

  it('maps picked rows to new-file lines', () => {
    const rows = diffRowsOf(hunks)
    expect(diffLineRange(rows, null)).toBeNull()
    // 문맥·추가 줄의 새 번호 처음~끝 (사이의 지운 줄은 건너뛴다)
    expect(diffLineRange(rows, { start: 2, end: 6 })).toEqual({ start: 1, end: 3 })
    // 지운 줄만: 지운 자리 바로 뒤 새 줄
    expect(diffLineRange(rows, { start: 3, end: 4 })).toEqual({ start: 2, end: 2 })
    // 파일 끝의 지운 줄: 바로 앞 새 줄
    expect(diffLineRange(rows, { start: 10, end: 10 })).toEqual({ start: 20, end: 20 })
    // hunk 머리만
    expect(diffLineRange(rows, { start: 1, end: 1 })).toBeNull()
  })

  it('gives no line for a fully deleted file', () => {
    const rows = diffRowsOf([{ header: '@@ -1,2 +0,0 @@', oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, lines: [
      { kind: 'del', text: 'a', oldLine: 1, newLine: null },
      { kind: 'del', text: 'b', oldLine: 2, newLine: null },
    ] }])
    expect(diffLineRange(rows, { start: 2, end: 3 })).toBeNull()
  })

  it('renders escaped rows with both line numbers', () => {
    const html = diffRowsHtml(diffRowsOf([{ header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ kind: 'add', text: '<b>&', oldLine: null, newLine: 7 }] }]))
    expect(html).toContain('<div class="diff-row diff-add" data-row="2">')
    expect(html).toContain('<span class="diff-num"></span><span class="diff-num">7</span>')
    expect(html).toContain('&lt;b&gt;&amp;')
  })

  it('opens only files that exist in the working tree', () => {
    expect(isOpenable('modified')).toBe(true)
    expect(isOpenable('untracked')).toBe(true)
    expect(isOpenable('deleted')).toBe(false)
    expect(isOpenable('missing')).toBe(false)
  })
})
