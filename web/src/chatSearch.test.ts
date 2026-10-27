import { describe, expect, it } from 'vitest'
import {
  findMatchingTargets,
  findTextRanges,
  locatePieceRange,
  resolveCurrentIndex,
  searchCountLabel,
  stepIndex,
  type SearchTarget,
} from './chatSearch'

function target(key: string, text: string): SearchTarget {
  return { key, text, workKey: null }
}

describe('findTextRanges', () => {
  it('대소문자를 무시하고 모든 위치를 앞에서부터 겹치지 않게 찾는다', () => {
    expect(findTextRanges('Foo foo FOO', 'foo')).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ])
    expect(findTextRanges('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ])
  })

  it('한글과 섞인 글에서도 위치가 맞다', () => {
    expect(findTextRanges('설정을 Docker 로 바꿈', 'docker')).toEqual([[4, 10]])
  })

  it('빈 검색어·공백뿐인 검색어·없는 글은 빈 목록', () => {
    expect(findTextRanges('abc', '')).toEqual([])
    expect(findTextRanges('abc a', '  ')).toEqual([])
    expect(findTextRanges('abc', 'x')).toEqual([])
  })

  it('소문자로 바꾸면 길이가 달라지는 글자가 있어도 원래 글 위치를 돌려준다', () => {
    // "İ".toLocaleLowerCase() 는 환경에 따라 "i̇" (2글자)
    const text = 'İstanbul ist'
    const ranges = findTextRanges(text, 'ist')
    for (const [start, end] of ranges) expect(text.slice(start, end).toLocaleLowerCase()).toContain('ist')
    expect(ranges.at(-1)).toEqual([9, 12])
  })
})

describe('findMatchingTargets', () => {
  const targets = [target('a', 'Hello World'), target('b', '안녕'), target('c', 'say hello'), target('d', 'nothing')]

  it('대소문자를 무시하고 대화 순서를 지킨다', () => {
    expect(findMatchingTargets(targets, 'HELLO').map((item) => item.key)).toEqual(['a', 'c'])
  })

  it('빈 검색어는 결과가 없다', () => {
    expect(findMatchingTargets(targets, '')).toEqual([])
    expect(findMatchingTargets(targets, '   ')).toEqual([])
  })

  it('공백이 든 검색어는 그대로 비교한다', () => {
    expect(findMatchingTargets(targets, 'o w').map((item) => item.key)).toEqual(['a'])
  })
})

describe('stepIndex', () => {
  it('끝에서 처음으로, 처음에서 끝으로 돈다', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
    expect(stepIndex(0, 1, 1)).toBe(0)
  })

  it('결과가 없으면 -1', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1)
  })
})

describe('resolveCurrentIndex', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

  it('같은 키가 남아 있으면 그 번호 (앞에 결과가 늘어도 같은 대상)', () => {
    expect(resolveCurrentIndex(items, 'c', 0)).toBe(2)
    expect(resolveCurrentIndex([{ key: 'z' }, ...items], 'b', 1)).toBe(2)
  })

  it('없어졌으면 이전 번호에 가장 가까운 번호', () => {
    expect(resolveCurrentIndex(items, 'gone', 1)).toBe(1)
    expect(resolveCurrentIndex(items, 'gone', 9)).toBe(2)
    expect(resolveCurrentIndex(items, null, -1)).toBe(0)
  })

  it('결과가 없으면 -1', () => {
    expect(resolveCurrentIndex([], 'a', 0)).toBe(-1)
  })
})

describe('searchCountLabel', () => {
  it('검색어가 없으면 빈 글, 결과가 없으면 No results, 있으면 번호/개수', () => {
    expect(searchCountLabel('', -1, 0)).toBe('')
    expect(searchCountLabel('  ', -1, 0)).toBe('')
    expect(searchCountLabel('x', -1, 0)).toBe('No results')
    expect(searchCountLabel('x', 2, 12)).toBe('3/12')
  })
})

describe('locatePieceRange', () => {
  // 조각 글자 수 [3, 4, 5] = 글 전체 0..12
  const lengths = [3, 4, 5]

  it('한 조각 안', () => {
    expect(locatePieceRange(lengths, 4, 6)).toEqual({ startIndex: 1, startOffset: 1, endIndex: 1, endOffset: 3 })
  })

  it('조각에 걸친 범위', () => {
    expect(locatePieceRange(lengths, 2, 9)).toEqual({ startIndex: 0, startOffset: 2, endIndex: 2, endOffset: 2 })
  })

  it('경계: 시작은 뒤 조각의 0, 끝은 앞 조각의 끝', () => {
    expect(locatePieceRange(lengths, 3, 7)).toEqual({ startIndex: 1, startOffset: 0, endIndex: 1, endOffset: 4 })
  })

  it('끝까지', () => {
    expect(locatePieceRange(lengths, 10, 12)).toEqual({ startIndex: 2, startOffset: 3, endIndex: 2, endOffset: 5 })
  })

  it('범위 밖·빈 범위는 null', () => {
    expect(locatePieceRange(lengths, 10, 13)).toBeNull()
    expect(locatePieceRange(lengths, 5, 5)).toBeNull()
    expect(locatePieceRange([], 0, 1)).toBeNull()
  })
})
