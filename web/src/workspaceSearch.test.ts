import { describe, expect, it } from 'vitest'
import type { WorkspaceSearchResult } from './types'
import { escapeRegExp, previewPieces, searchKey, searchNotes, searchParams, searchSummary, selectionQuery } from './workspaceSearch'

const result = (fields: Partial<WorkspaceSearchResult>): WorkspaceSearchResult => ({
  files: [],
  matchCount: 0,
  fileCount: 0,
  searchedFileCount: 0,
  isTruncated: false,
  isIndexPartial: false,
  elapsedMs: 0,
  ...fields,
})

describe('request', () => {
  it('sends flags as 0/1 and keys a search by all four inputs', () => {
    const input = { query: 'a b', isCaseSensitive: true, isWholeWord: false, isRegex: true }
    expect(searchParams(input)).toEqual({ q: 'a b', case: '1', word: '0', regex: '1' })
    expect(searchKey(input)).not.toBe(searchKey({ ...input, isWholeWord: true }))
    expect(searchKey(input)).toBe(searchKey({ ...input }))
  })
})

describe('selection query', () => {
  it('uses a one-line selection, escaped when regex is on', () => {
    expect(selectionQuery('foo.bar', false)).toBe('foo.bar')
    expect(selectionQuery('foo.bar(x)', true)).toBe('foo\\.bar\\(x\\)')
    expect(new RegExp(escapeRegExp('a+b?[c]{1}|/\\'), 'u').test('a+b?[c]{1}|/\\')).toBe(true)
  })

  it('ignores empty, multi-line and too long selections', () => {
    expect(selectionQuery('', false)).toBeNull()
    expect(selectionQuery('a\nb', false)).toBeNull()
    expect(selectionQuery('a\r', false)).toBeNull()
    expect(selectionQuery('x'.repeat(501), false)).toBeNull()
    expect(selectionQuery('.'.repeat(300), true)).toBeNull()
  })
})

describe('preview pieces', () => {
  it('splits text into plain and matched pieces and drops leading indentation', () => {
    expect(
      previewPieces({
        line: 3,
        column: 0,
        text: '    const foo = foo()',
        ranges: [
          [10, 13],
          [16, 19],
        ],
        hasMoreAfter: false,
      }),
    ).toEqual({
      pieces: [
        { text: 'const ', isMatch: false },
        { text: 'foo', isMatch: true },
        { text: ' = ', isMatch: false },
        { text: 'foo', isMatch: true },
        { text: '()', isMatch: false },
      ],
      isCutBefore: false,
      isCutAfter: false,
    })
  })

  it('keeps indentation that is part of a match and marks cut lines', () => {
    expect(previewPieces({ line: 1, column: 0, text: '  x', ranges: [[1, 3]], hasMoreAfter: true })).toEqual({
      pieces: [{ text: ' x', isMatch: true }],
      isCutBefore: false,
      isCutAfter: true,
    })
    expect(previewPieces({ line: 1, column: 40, text: '  x', ranges: [[2, 3]], hasMoreAfter: false }).pieces[0]).toEqual({ text: '  ', isMatch: false })
    expect(previewPieces({ line: 1, column: 40, text: 'ab', ranges: [], hasMoreAfter: false }).isCutBefore).toBe(true)
  })

  it('keeps only a few characters before a far match so it shows in a narrow column', () => {
    const text = `${'x'.repeat(50)}needle tail`
    expect(previewPieces({ line: 1, column: 0, text, ranges: [[50, 56]], hasMoreAfter: false })).toEqual({
      pieces: [
        { text: 'x'.repeat(10), isMatch: false },
        { text: 'needle', isMatch: true },
        { text: ' tail', isMatch: false },
      ],
      isCutBefore: true,
      isCutAfter: false,
    })
  })
})

describe('summary', () => {
  it('counts results and files', () => {
    expect(searchSummary(result({}))).toBe('No results')
    expect(searchSummary(result({ matchCount: 1, fileCount: 1 }))).toBe('1 result in 1 file')
    expect(searchSummary(result({ matchCount: 1234, fileCount: 5 }))).toBe('1,234 results in 5 files')
  })

  it('explains why results are incomplete', () => {
    expect(searchNotes(result({}))).toEqual([])
    expect(searchNotes(result({ isTruncated: true, matchCount: 2000 }))).toEqual(['Showing the first 2,000 results'])
    expect(searchNotes(result({ isTruncated: true, matchCount: 12, isIndexPartial: true }))).toEqual([
      'Stopped after 5 seconds · results are incomplete',
      'Folder too large · searched only part of it',
    ])
  })
})
