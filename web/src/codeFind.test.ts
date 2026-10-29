import { describe, expect, it } from 'vitest'
import { codeFindCountLabel, findInLines, firstMatchFrom, matchIndexesBetween } from './codeFind'

describe('find in lines', () => {
  it('finds every match per line, ignoring case unless asked', () => {
    expect(findInLines(['Foo foo', 'bar', 'xFOO'], 'foo', false)).toEqual([
      { line: 1, start: 0, end: 3 },
      { line: 1, start: 4, end: 7 },
      { line: 3, start: 1, end: 4 },
    ])
    expect(findInLines(['Foo foo'], 'foo', true)).toEqual([{ line: 1, start: 4, end: 7 }])
  })

  it('does not overlap, finds whitespace, and finds nothing for an empty query', () => {
    expect(findInLines(['aaaa'], 'aa', true)).toEqual([
      { line: 1, start: 0, end: 2 },
      { line: 1, start: 2, end: 4 },
    ])
    expect(findInLines(['  x'], '  ', false)).toEqual([{ line: 1, start: 0, end: 2 }])
    expect(findInLines(['abc'], '', false)).toEqual([])
  })

  it('keeps original positions when lower-casing changes the length', () => {
    expect(findInLines(['İx'], 'x', false)).toEqual([{ line: 1, start: 1, end: 2 }])
  })
})

describe('positions', () => {
  const matches = findInLines(['a', '', 'a a', '', 'a'], 'a', false)

  it('starts at the first match on or after a line, wrapping to the first', () => {
    expect(firstMatchFrom(matches, 1)).toBe(0)
    expect(firstMatchFrom(matches, 2)).toBe(1)
    expect(firstMatchFrom(matches, 4)).toBe(3)
    expect(firstMatchFrom(matches, 6)).toBe(0)
    expect(firstMatchFrom([], 1)).toBe(-1)
  })

  it('gives the index range of matches between two lines', () => {
    expect(matchIndexesBetween(matches, 2, 3)).toEqual([1, 3])
    expect(matchIndexesBetween(matches, -100, 100)).toEqual([0, 4])
    expect(matchIndexesBetween(matches, 4, 4)).toEqual([3, 3])
  })

  it('labels the count', () => {
    expect(codeFindCountLabel('', -1, 0)).toBe('')
    expect(codeFindCountLabel('x', -1, 0)).toBe('No results')
    expect(codeFindCountLabel('x', 2, 12345)).toBe('3/12,345')
  })
})
