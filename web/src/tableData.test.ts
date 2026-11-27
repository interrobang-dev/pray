import { describe, expect, it } from 'vitest'
import { columnName, delimiterOf, isNumberText, parseDelimited, TABLE_COLUMN_LIMIT, TABLE_ROW_LIMIT, tableNote } from './tableData'

describe('parseDelimited', () => {
  it('splits plain rows and ignores the final line break', () => {
    expect(parseDelimited('a,b\n1,2\n', ',').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('handles quoted delimiters, line breaks and doubled quotes', () => {
    const table = parseDelimited('이름,메모\n"김, 철수","첫 줄\n둘째 줄"\n"say ""hi""",x', ',')
    expect(table.rows).toEqual([
      ['이름', '메모'],
      ['김, 철수', '첫 줄\n둘째 줄'],
      ['say "hi"', 'x'],
    ])
    expect(table.totalRows).toBe(3)
  })

  it('keeps quotes inside an unquoted field as text', () => {
    expect(parseDelimited('5" disk,a"b', ',').rows).toEqual([['5" disk', 'a"b']])
  })

  it('accepts CRLF, CR and a BOM', () => {
    expect(parseDelimited('﻿a,b\r\n1,2\r3,4', ',').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('keeps empty fields, empty lines and a quoted empty last field', () => {
    expect(parseDelimited('a,,c\n\n,""', ',').rows).toEqual([['a', '', 'c'], [''], ['', '']])
  })

  it('splits tsv on tabs', () => {
    expect(parseDelimited('a\tb,c\n1\t2', delimiterOf('data/x.TSV')).rows).toEqual([
      ['a', 'b,c'],
      ['1', '2'],
    ])
    expect(delimiterOf('a.csv')).toBe(',')
  })

  it('counts every row and column but keeps only the first ones', () => {
    const wide = Array.from({ length: TABLE_COLUMN_LIMIT + 5 }, (_, index) => `c${index}`).join(',')
    const text = [wide, ...Array.from({ length: TABLE_ROW_LIMIT + 9 }, (_, index) => String(index))].join('\n')
    const table = parseDelimited(text, ',')
    expect(table.rows).toHaveLength(TABLE_ROW_LIMIT)
    expect(table.rows[0]).toHaveLength(TABLE_COLUMN_LIMIT)
    expect(table.totalRows).toBe(TABLE_ROW_LIMIT + 10)
    expect(table.totalColumns).toBe(TABLE_COLUMN_LIMIT + 5)
    expect(tableNote(table)).toBe('Showing first 1,000 of 1,010 rows · 100 of 105 columns')
  })

  it('has no note when everything is shown', () => {
    expect(tableNote(parseDelimited('a,b\n1,2', ','))).toBeNull()
    expect(parseDelimited('', ',')).toEqual({ rows: [], totalRows: 0, totalColumns: 0, firstRow: 0, firstColumn: 0 })
  })
})

describe('columnName', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
  })
})

describe('isNumberText', () => {
  it('right-aligns numbers only', () => {
    for (const text of ['0', '-3.5', '1,234,567', '12%', '.5', '1e5', '+7']) expect(isNumberText(text), text).toBe(true)
    for (const text of ['', '-', '1,23', '2026-11-27', 'abc', '12 kg', '%', '1.2.3']) expect(isNumberText(text), text).toBe(false)
  })
})
