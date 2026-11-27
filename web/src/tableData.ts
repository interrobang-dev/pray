/** 표 미리보기(csv·tsv·xlsx·xls)가 그리는 줄·칸 상한. 넘는 것은 그리지 않고 아래에 "Showing first …" 로 알린다 (칸이 수십만 개면 화면이 멈춘다) */
export const TABLE_ROW_LIMIT = 1000
export const TABLE_COLUMN_LIMIT = 100
/** xlsx·xls 를 받는 크기 상한. SheetJS 가 메인 스레드에서 통째로 풀어 그보다 크면 화면이 오래 멈춘다 */
export const SPREADSHEET_LIMIT_BYTES = 10 * 1024 * 1024

/** 그릴 표: 앞 줄·칸만(`rows`, 칸은 다 글자) + 전체 크기 + 시트에서 시작하는 줄·칸(0부터, 행 번호·열 문자에 더한다) */
export interface TableData {
  rows: string[][]
  totalRows: number
  totalColumns: number
  firstRow: number
  firstColumn: number
}

/** 0 → A, 25 → Z, 26 → AA (엑셀 열 문자) */
export function columnName(index: number): string {
  let name = ''
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name
  return name
}

/** tsv 는 탭, 그 밖(csv)은 쉼표 */
export function delimiterOf(path: string): string {
  return path.toLowerCase().endsWith('.tsv') ? '\t' : ','
}

/**
 * csv·tsv 글 → 표. RFC 4180 꼴: 큰따옴표로 감싼 칸 안의 구분자·줄바꿈은 글자, `""` 는 `"` 하나. 따옴표로 시작하지 않은 칸의 따옴표는 글자 그대로.
 * 줄 끝은 LF·CRLF·CR, 앞 BOM 은 뗀다, 마지막 줄바꿈 뒤 빈 줄은 줄로 세지 않는다. 줄은 다 세지만 앞 TABLE_ROW_LIMIT 줄·TABLE_COLUMN_LIMIT 칸만 남긴다
 */
export function parseDelimited(text: string, delimiter: string): TableData {
  const rows: string[][] = []
  let totalRows = 0
  let totalColumns = 0
  let row: string[] = []
  let field = ''
  let isFieldStarted = false
  let isQuoted = false
  const endField = () => {
    row.push(field)
    field = ''
    isFieldStarted = false
  }
  const endRow = () => {
    endField()
    totalRows += 1
    totalColumns = Math.max(totalColumns, row.length)
    if (rows.length < TABLE_ROW_LIMIT) rows.push(row.length > TABLE_COLUMN_LIMIT ? row.slice(0, TABLE_COLUMN_LIMIT) : row)
    row = []
  }
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (isQuoted) {
      if (char !== '"') field += char
      else if (text[index + 1] === '"') {
        field += '"'
        index++
      } else isQuoted = false
    } else if (char === '"' && !isFieldStarted) {
      isQuoted = true
      isFieldStarted = true
    } else if (char === delimiter) endField()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      endRow()
    } else {
      field += char
      isFieldStarted = true
    }
  }
  if (isFieldStarted || row.length > 0) endRow()
  return { rows, totalRows, totalColumns, firstRow: 0, firstColumn: 0 }
}

/** 표 아래 알림: 줄·칸을 다 못 그렸을 때만 ("Showing first 1,000 of 5,321 rows · 100 of 240 columns") */
export function tableNote(table: TableData): string | null {
  const shownColumns = Math.min(table.totalColumns, TABLE_COLUMN_LIMIT)
  const parts = [
    table.rows.length < table.totalRows ? `${table.rows.length.toLocaleString('en')} of ${table.totalRows.toLocaleString('en')} rows` : null,
    shownColumns < table.totalColumns ? `${shownColumns.toLocaleString('en')} of ${table.totalColumns.toLocaleString('en')} columns` : null,
  ].filter((part) => part !== null)
  return parts.length > 0 ? `Showing first ${parts.join(' · ')}` : null
}

/** 숫자처럼 보이는 글(오른쪽 맞춤): 1,234 · -3.5 · 12% · 1e5 */
export function isNumberText(text: string): boolean {
  return /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?%?$/.test(text) && /\d/.test(text)
}
