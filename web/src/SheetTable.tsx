import { useMemo } from 'react'
import { columnName, isNumberText, parseDelimited, TABLE_COLUMN_LIMIT, tableNote, type TableData } from './tableData'

/** 긴 칸은 말줄임이라 전체 글을 title 로 (짧은 칸에는 안 붙인다) */
const TITLE_MIN_LENGTH = 30

/**
 * 표 미리보기 (csv·tsv·xlsx·xls 공용). 맨 위 열 문자(A, B, …)·왼쪽 행 번호·첫 줄이 붙어 있고 칸 폭을 넘으면 가로로 스크롤한다.
 * 칸 값은 React 글자로만 그린다 (sheet_to_html·innerHTML 을 쓰지 않는다)
 */
export function SheetTable({ table, emptyText }: { table: TableData; emptyText: string }) {
  if (table.rows.length === 0) return <p className="hint">{emptyText}</p>
  const columnCount = Math.min(table.totalColumns, TABLE_COLUMN_LIMIT)
  const columns = Array.from({ length: columnCount }, (_, index) => index)
  const note = tableNote(table)
  return (
    <>
      <div className="ws-sheet-scroll">
        <table className="ws-sheet-table">
          <thead>
            <tr>
              <th className="ws-sheet-corner" />
              {columns.map((column) => (
                <th key={column}>{columnName(table.firstColumn + column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? 'ws-sheet-first' : undefined}>
                <th>{table.firstRow + rowIndex + 1}</th>
                {columns.map((column) => {
                  const value = row[column] ?? ''
                  return (
                    <td
                      key={column}
                      className={isNumberText(value) ? 'num' : undefined}
                      title={value.length >= TITLE_MIN_LENGTH || value.includes('\n') ? value : undefined}
                    >
                      {value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="ws-sheet-note">{note}</p>}
    </>
  )
}

/** Files 탭 csv·tsv 표 미리보기: 받아 둔 글을 그대로 해석한다 (원본 전환과 같은 글) */
export function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }) {
  const table = useMemo(() => parseDelimited(text, delimiter), [text, delimiter])
  return (
    <div className="ws-sheet">
      <SheetTable table={table} emptyText="Empty file" />
    </div>
  )
}
