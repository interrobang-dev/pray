import { useEffect, useState } from 'react'
import { formatSize } from './Files'
import { SheetTable } from './SheetTable'
import { SPREADSHEET_LIMIT_BYTES } from './tableData'
import type { WorkbookSheet } from './workbookSheets'

type WorkbookState =
  | { status: 'loading' }
  | { status: 'ready'; sheets: WorkbookSheet[] }
  | { status: 'too-large'; size: number }
  | { status: 'failed' }

/**
 * Files 탭 xlsx·xls 미리보기. `/file/raw` 로 받아 SheetJS(`workbookSheets.ts` 를 처음 그릴 때만 동적 import)로 시트마다 표를 만든다.
 * 시트가 여럿이면 위 칩으로 고른다 (고른 시트는 이 파일을 보는 동안만 남는다)
 */
export function WorkbookPreview({ url }: { url: string }) {
  const [state, setState] = useState<WorkbookState>({ status: 'loading' })
  const [sheetIndex, setSheetIndex] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let isCancelled = false
    setState({ status: 'loading' })
    const show = (next: WorkbookState) => !isCancelled && setState(next)
    ;(async () => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const announced = Number(response.headers.get('content-length'))
      if (announced > SPREADSHEET_LIMIT_BYTES) {
        show({ status: 'too-large', size: announced })
        controller.abort()
        return
      }
      const [buffer, { workbookSheets }] = await Promise.all([response.arrayBuffer(), import('./workbookSheets')])
      if (buffer.byteLength > SPREADSHEET_LIMIT_BYTES) {
        show({ status: 'too-large', size: buffer.byteLength })
        return
      }
      show({ status: 'ready', sheets: workbookSheets(buffer) })
    })().catch(() => show({ status: 'failed' }))
    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [url])

  if (state.status === 'loading') return <p className="hint">Loading…</p>
  if (state.status === 'failed') return <p className="hint ws-error">Couldn't open the spreadsheet</p>
  if (state.status === 'too-large') {
    return (
      <p className="hint">
        Too large to preview · {formatSize(state.size)} (limit {SPREADSHEET_LIMIT_BYTES / 1024 ** 2} MB)
      </p>
    )
  }
  const { sheets } = state
  if (sheets.length === 0) return <p className="hint">No sheets</p>
  const shownIndex = sheetIndex < sheets.length ? sheetIndex : 0
  const sheet = sheets[shownIndex]
  return (
    <div className="ws-sheet">
      {sheets.length > 1 && (
        <div className="ws-sheet-tabs" role="tablist" aria-label="Sheets">
          {sheets.map((each, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === shownIndex}
              className={index === shownIndex ? 'on' : undefined}
              onClick={() => setSheetIndex(index)}
              title={each.name}
            >
              {each.name}
            </button>
          ))}
        </div>
      )}
      <SheetTable key={shownIndex} table={sheet} emptyText="Empty sheet" />
    </div>
  )
}
