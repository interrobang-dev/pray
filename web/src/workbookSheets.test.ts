import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { TABLE_ROW_LIMIT } from './tableData'
import { workbookSheets } from './workbookSheets'

function workbookBytes(bookType: 'xlsx' | 'biff8', sheets: Record<string, ReturnType<typeof utils.aoa_to_sheet>>): ArrayBuffer {
  const workbook = utils.book_new()
  for (const [name, sheet] of Object.entries(sheets)) utils.book_append_sheet(workbook, sheet, name)
  return write(workbook, { type: 'array', bookType })
}

describe('workbookSheets', () => {
  it('reads every sheet as display text, with empty cells as empty text', () => {
    const people = utils.aoa_to_sheet([
      ['Name', 'Count', 'Ratio'],
      ['김철수', 1234.5, null],
      ['', true, 0.25],
    ])
    people.C3.z = '0%'
    const dates = utils.aoa_to_sheet([['Day'], [new Date(Date.UTC(2026, 10, 27))]], { cellDates: true, dateNF: 'yyyy-mm-dd' })
    for (const bookType of ['xlsx', 'biff8'] as const) {
      const sheets = workbookSheets(workbookBytes(bookType, { People: people, Dates: dates }))
      expect(sheets.map((sheet) => sheet.name), bookType).toEqual(['People', 'Dates'])
      expect(sheets[0].rows, bookType).toEqual([
        ['Name', 'Count', 'Ratio'],
        ['김철수', '1234.5', ''],
        ['', 'TRUE', '25%'],
      ])
      expect(sheets[1].rows[1][0], bookType).toBe('2026-11-27')
    }
  })

  it('reads only the first rows but knows the full size, and keeps the sheet offset', () => {
    const tall = utils.aoa_to_sheet(Array.from({ length: TABLE_ROW_LIMIT + 50 }, (_, index) => [index]))
    const offset = { C3: { t: 's' as const, v: 'x' }, '!ref': 'C3:C3' }
    const [tallSheet, offsetSheet] = workbookSheets(workbookBytes('xlsx', { Tall: tall, Offset: offset }))
    expect(tallSheet.rows).toHaveLength(TABLE_ROW_LIMIT)
    expect(tallSheet.totalRows).toBe(TABLE_ROW_LIMIT + 50)
    expect(offsetSheet).toMatchObject({ rows: [['x']], firstRow: 2, firstColumn: 2, totalRows: 1, totalColumns: 1 })
  })

  it('gives an empty table for an empty sheet and throws on a broken file', () => {
    expect(workbookSheets(workbookBytes('xlsx', { Empty: utils.aoa_to_sheet([]) }))[0].rows).toEqual([])
    expect(() => workbookSheets(new TextEncoder().encode('PK\u0003\u0004 not really').buffer as ArrayBuffer)).toThrow()
  })
})
