import { describe, expect, it } from 'vitest'
import { chatLocationText, clampLineRange, clickLine, fullPathOf, isSameRange, lineCountOf, locationText, rangeBetween, selectionLineRange } from './codeSelection'

describe('codeSelection', () => {
  it('orders a range', () => {
    expect(rangeBetween(20, 12)).toEqual({ start: 12, end: 20 })
    expect(isSameRange({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true)
    expect(isSameRange({ start: 1, end: 2 }, null)).toBe(false)
    expect(isSameRange(null, null)).toBe(true)
  })

  it('counts lines like CodeView', () => {
    expect(lineCountOf('a\nb\n')).toBe(2)
    expect(lineCountOf('a\r\nb')).toBe(2)
    expect(lineCountOf('a\n\n')).toBe(2)
    expect(lineCountOf('')).toBe(1)
  })

  it('clamps a range to a shorter file', () => {
    expect(clampLineRange({ start: 3, end: 8 }, 10)).toEqual({ start: 3, end: 8 })
    expect(clampLineRange({ start: 3, end: 8 }, 5)).toEqual({ start: 3, end: 5 })
    expect(clampLineRange({ start: 6, end: 8 }, 5)).toBeNull()
  })

  it('selects, toggles and extends with line number clicks', () => {
    expect(clickLine(null, 5, null, false)).toEqual({ range: { start: 5, end: 5 }, anchor: 5 })
    expect(clickLine({ start: 5, end: 5 }, 5, 5, false)).toEqual({ range: null, anchor: null })
    expect(clickLine({ start: 5, end: 9 }, 5, 5, false)).toEqual({ range: { start: 5, end: 5 }, anchor: 5 })
    // Shift: 앞서 고른 줄부터, 위로도
    expect(clickLine({ start: 5, end: 5 }, 9, 5, true)).toEqual({ range: { start: 5, end: 9 }, anchor: 5 })
    expect(clickLine({ start: 5, end: 9 }, 2, 5, true)).toEqual({ range: { start: 2, end: 5 }, anchor: 5 })
    // anchor 를 모르면(다시 연 파일) 범위 시작, 범위도 없으면 그 줄만
    expect(clickLine({ start: 7, end: 9 }, 12, null, true)).toEqual({ range: { start: 7, end: 12 }, anchor: 7 })
    expect(clickLine(null, 4, null, true)).toEqual({ range: { start: 4, end: 4 }, anchor: 4 })
  })

  it('maps a text selection to the lines it covers', () => {
    expect(selectionLineRange(3, 6, false)).toEqual({ start: 3, end: 6 })
    // 끝이 다음 줄 맨 앞(줄 전체 고르기)이면 그 줄은 빼고
    expect(selectionLineRange(3, 7, true)).toEqual({ start: 3, end: 6 })
    // 한 줄 안이면 맨 앞이어도 그 줄
    expect(selectionLineRange(3, 3, true)).toEqual({ start: 3, end: 3 })
  })

  it('formats a location', () => {
    expect(locationText('src/App.tsx', { start: 12, end: 20 })).toBe('src/App.tsx:12-20')
    expect(locationText('src/App.tsx', { start: 12, end: 12 })).toBe('src/App.tsx:12')
    expect(locationText('README.md', null)).toBe('README.md')
    expect(chatLocationText('web/src/a_b.ts', { start: 1, end: 3 })).toBe('`web/src/a_b.ts:1-3`')
  })
})

describe('fullPathOf', () => {
  it('joins the session folder and the relative path with Windows separators', () => {
    expect(fullPathOf('D:\\workspace\\@private\\jk-corp', 'web/src/App.tsx')).toBe('D:\\workspace\\@private\\jk-corp\\web\\src\\App.tsx')
    expect(fullPathOf('d:/repo/', 'a.ts')).toBe('d:\\repo\\a.ts')
    expect(fullPathOf('D:\\', 'a.ts')).toBe('D:\\a.ts')
    expect(fullPathOf('D:\\repo\\', '')).toBe('D:\\repo')
  })
})
