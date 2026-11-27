import { read, utils, type WorkSheet } from 'xlsx'
import { TABLE_COLUMN_LIMIT, TABLE_ROW_LIMIT, type TableData } from './tableData'

export interface WorkbookSheet extends TableData {
  name: string
}

/**
 * xlsx·xls 바이트 → 시트마다 표 (SheetJS, `WorkbookPreview` 가 처음 그릴 때만 이 파일을 동적 import 해 메인 번들에 안 든다).
 * `sheetRows` 로 시트마다 앞 줄만 읽고(전체 범위는 `!fullref`), 칸 값은 셀 서식대로 만든 글(`w`: 날짜·통화·%)로 준다 — 화면은 React 글자로만 그린다
 */
export function workbookSheets(data: ArrayBuffer): WorkbookSheet[] {
  const workbook = read(data, { type: 'array', sheetRows: TABLE_ROW_LIMIT })
  return workbook.SheetNames.map((name) => ({ name, ...sheetTable(workbook.Sheets[name]) }))
}

function sheetTable(sheet: WorkSheet | undefined): TableData {
  const ref = sheet?.['!ref']
  if (!sheet || !ref) return { rows: [], totalRows: 0, totalColumns: 0, firstRow: 0, firstColumn: 0 }
  const shown = utils.decode_range(ref)
  const full = utils.decode_range(sheet['!fullref'] ?? ref)
  const lastColumn = Math.min(shown.e.c, shown.s.c + TABLE_COLUMN_LIMIT - 1)
  const rows = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
    range: { s: shown.s, e: { r: shown.e.r, c: lastColumn } },
  })
  return {
    rows: rows.map((row) => row.map((value) => (value === null || value === undefined ? '' : String(value)))),
    totalRows: full.e.r - shown.s.r + 1,
    totalColumns: full.e.c - shown.s.c + 1,
    firstRow: shown.s.r,
    firstColumn: shown.s.c,
  }
}
