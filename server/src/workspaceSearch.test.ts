import { describe, expect, it } from 'vitest'
import {
  buildSearchPattern,
  findInLine,
  MAX_QUERY_CHARS,
  parseSearchQuery,
  previewLine,
  searchText,
  SearchPatternError,
  sortSearchFiles,
  type SearchOptions,
} from './workspaceSearch.js'

const options = (query: string, flags: Partial<SearchOptions> = {}): SearchOptions => ({ query, isCaseSensitive: false, isWholeWord: false, isRegex: false, ...flags })
const rangesOf = (query: string, text: string, flags: Partial<SearchOptions> = {}) => findInLine(buildSearchPattern(options(query, flags)), text, 100)

describe('query parsing', () => {
  it('accepts 1 to 500 characters, spaces included', () => {
    expect(parseSearchQuery({ q: ' ' })).toEqual(options(' '))
    expect(parseSearchQuery({ q: 'x'.repeat(MAX_QUERY_CHARS) })).not.toHaveProperty('message')
    expect(parseSearchQuery({ q: '' })).toHaveProperty('message')
    expect(parseSearchQuery({})).toHaveProperty('message')
    expect(parseSearchQuery({ q: 'x'.repeat(MAX_QUERY_CHARS + 1) })).toHaveProperty('message')
    expect(parseSearchQuery({ q: ['a', 'b'] })).toHaveProperty('message')
  })

  it('reads flags as 0/1 (or true/false) and rejects anything else', () => {
    expect(parseSearchQuery({ q: 'a', case: '1', word: 'true', regex: '0' })).toEqual(options('a', { isCaseSensitive: true, isWholeWord: true }))
    expect(parseSearchQuery({ q: 'a', regex: 'yes' })).toHaveProperty('message')
    expect(parseSearchQuery({ q: 'a', case: ['1', '1'] })).toHaveProperty('message')
  })
})

describe('pattern', () => {
  it('matches plain text literally, ignoring case unless asked', () => {
    expect(rangesOf('a.b', 'axb a.b A.B')).toEqual([
      [4, 7],
      [8, 11],
    ])
    expect(rangesOf('a.b', 'a.b A.B', { isCaseSensitive: true })).toEqual([[0, 3]])
    expect(rangesOf('(x)[y]{z}\\/', '(x)[y]{z}\\/')).toEqual([[0, 11]])
  })

  it('whole word uses letters of every language, digits and _ as word characters', () => {
    expect(rangesOf('cat', 'cat cats bobcat cat_ cat.', { isWholeWord: true })).toEqual([
      [0, 3],
      [21, 24],
    ])
    expect(rangesOf('세션', '세션 세션을 (세션)', { isWholeWord: true })).toEqual([
      [0, 2],
      [8, 10],
    ])
    expect(rangesOf('a|b', 'a ab b', { isWholeWord: true, isRegex: true })).toEqual([
      [0, 1],
      [5, 6],
    ])
  })

  it('runs regular expressions, case-insensitive by default', () => {
    expect(rangesOf('fo+', 'f fo FOO', { isRegex: true })).toEqual([
      [2, 4],
      [5, 8],
    ])
    expect(rangesOf('\\d{2}', 'a1 22 333', { isRegex: true })).toEqual([
      [3, 5],
      [6, 8],
    ])
  })

  it('throws SearchPatternError on a syntax error', () => {
    expect(() => buildSearchPattern(options('(a', { isRegex: true }))).toThrow(SearchPatternError)
    expect(() => buildSearchPattern(options('[', { isRegex: true }))).toThrow(SearchPatternError)
    expect(() => buildSearchPattern(options('(a'))).not.toThrow()
  })

  it('skips empty matches and stops at the limit', () => {
    expect(rangesOf('^', 'abc', { isRegex: true })).toEqual([])
    expect(rangesOf('x*', 'axxbx', { isRegex: true })).toEqual([
      [1, 3],
      [4, 5],
    ])
    expect(rangesOf('a*', '😀a', { isRegex: true })).toEqual([[2, 3]])
    expect(findInLine(buildSearchPattern(options('a')), 'aaaa', 2)).toEqual([
      [0, 1],
      [1, 2],
    ])
  })
})

describe('preview line', () => {
  it('keeps short lines whole', () => {
    expect(previewLine('abc', [[1, 2]], 10)).toEqual({ column: 0, text: 'abc', ranges: [[1, 2]], hasMoreAfter: false })
  })

  it('cuts long lines around the first match and moves ranges with it', () => {
    const text = `${'x'.repeat(100)}MATCH${'y'.repeat(100)}MATCH${'z'.repeat(400)}`
    const preview = previewLine(
      text,
      [
        [100, 105],
        [205, 210],
      ],
      100,
    )
    expect(preview.column).toBe(60)
    expect(preview.text).toHaveLength(100)
    expect(preview.ranges).toEqual([[40, 45]])
    expect(preview.text.slice(40, 45)).toBe('MATCH')
    expect(preview.hasMoreAfter).toBe(true)
  })

  it('clips a range that crosses the end, and shows the line end when the match is near it', () => {
    const text = 'a'.repeat(50) + 'b'.repeat(100)
    expect(previewLine(text, [[45, 70]], 20)).toEqual({ column: 45, text: 'a'.repeat(5) + 'b'.repeat(15), ranges: [[0, 20]], hasMoreAfter: true })
    const near = previewLine(text, [[145, 150]], 20)
    expect(near).toEqual({ column: 130, text: 'b'.repeat(20), ranges: [[15, 20]], hasMoreAfter: false })
  })

  it('does not split a surrogate pair', () => {
    const text = '😀'.repeat(100) + 'X'
    const preview = previewLine(text, [[200, 201]], 11)
    expect(preview.text.endsWith('X')).toBe(true)
    expect(preview.text.startsWith('\udc00')).toBe(false)
    expect(preview.text.slice(preview.ranges[0][0], preview.ranges[0][1])).toBe('X')
  })
})

describe('search text', () => {
  it('numbers lines from 1, drops CR, and counts every match', () => {
    const result = searchText('one\r\nfoo foo\r\n\r\nlast foo', buildSearchPattern(options('foo')), 100)
    expect(result.matchCount).toBe(3)
    expect(result.lines.map(({ line, text, ranges }) => ({ line, text, ranges }))).toEqual([
      {
        line: 2,
        text: 'foo foo',
        ranges: [
          [0, 3],
          [4, 7],
        ],
      },
      { line: 4, text: 'last foo', ranges: [[5, 8]] },
    ])
    expect(result.isStopped).toBe(false)
  })

  it('stops at the match limit', () => {
    const result = searchText('a a\na a\na', buildSearchPattern(options('a')), 3)
    expect(result.matchCount).toBe(3)
    expect(result.lines.map((line) => line.line)).toEqual([1, 2])
  })

  it('stops when told to (time limit), keeping what it found', () => {
    const text = Array.from({ length: 1000 }, () => 'hit').join('\n')
    const result = searchText(text, buildSearchPattern(options('hit')), 10_000, () => true)
    expect(result.isStopped).toBe(true)
    expect(result.matchCount).toBe(255)
  })
})

describe('result order', () => {
  it('sorts files by path, numbers by value', () => {
    const file = (path: string) => ({ path, matchCount: 1, matches: [] })
    expect(sortSearchFiles([file('b/x.ts'), file('a10.ts'), file('a/y.ts'), file('a2.ts')]).map((item) => item.path)).toEqual(['a/y.ts', 'a2.ts', 'a10.ts', 'b/x.ts'])
  })
})
