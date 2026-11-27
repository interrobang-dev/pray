import { useCallback, useEffect, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { formatSize } from './Files'
import { PagedView, type DrawPage, type PageSize } from './PagedView'
import { canvasPixelRatio, PDF_PREVIEW_LIMIT_BYTES } from './pageLayout'

type PdfModule = typeof import('./pdfDocument')

type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: PdfModule; doc: PDFDocumentProxy; firstSize: PageSize }
  | { status: 'too-large'; size: number }
  | { status: 'password' }
  | { status: 'failed' }

/**
 * 폰·터치 화면의 PDF 미리보기 (데스크톱은 FilesTab 의 iframe — Chrome 내장 뷰어). `/file/raw` 로 받아 pdf.js(처음 그릴 때만 동적 import)로
 * 쪽마다 canvas 에 칸 폭에 맞춰 그린다 (쪽 목록·확대·보이는 쪽 근처만 그리기는 PagedView). 멀어진 쪽은 canvas 를 버리고 page.cleanup()
 */
export function PdfPreview({ url }: { url: string }) {
  const [state, setState] = useState<PdfState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let isCancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null
    setState({ status: 'loading' })
    const show = (next: PdfState) => !isCancelled && setState(next)
    ;(async () => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const announced = Number(response.headers.get('content-length'))
      if (announced > PDF_PREVIEW_LIMIT_BYTES) {
        show({ status: 'too-large', size: announced })
        controller.abort()
        return
      }
      const [buffer, pdf] = await Promise.all([response.arrayBuffer(), import('./pdfDocument')])
      if (buffer.byteLength > PDF_PREVIEW_LIMIT_BYTES) {
        show({ status: 'too-large', size: buffer.byteLength })
        return
      }
      if (isCancelled) return
      loadingTask = pdf.openPdf(buffer)
      const doc = await loadingTask.promise
      const first = (await doc.getPage(1)).getViewport({ scale: 1 })
      show({ status: 'ready', pdf, doc, firstSize: { width: first.width, height: first.height } })
    })().catch((error: unknown) => show(error instanceof Error && error.name === 'PasswordException' ? { status: 'password' } : { status: 'failed' }))
    return () => {
      isCancelled = true
      controller.abort()
      void loadingTask?.destroy()
    }
  }, [url])

  if (state.status === 'loading') return <p className="hint">Loading…</p>
  if (state.status === 'failed') return <p className="hint ws-error">Couldn't open the PDF</p>
  if (state.status === 'password') return <p className="hint">Password-protected PDF · No preview</p>
  if (state.status === 'too-large') {
    return (
      <p className="hint">
        Too large to preview · {formatSize(state.size)} (limit {PDF_PREVIEW_LIMIT_BYTES / 1024 ** 2} MB)
      </p>
    )
  }
  return <PdfPages pdf={state.pdf} doc={state.doc} firstSize={state.firstSize} />
}

function PdfPages({ pdf, doc, firstSize }: { pdf: PdfModule; doc: PDFDocumentProxy; firstSize: PageSize }) {
  // 폭이 바뀔 때마다 새 canvas 에 다시 그린다 (배율·화소 상한은 canvasPixelRatio)
  const drawPage = useCallback<DrawPage>(
    ({ pageNumber, width, holder, onSize }) => {
      let isCancelled = false
      let task: RenderTask | null = null
      ;(async () => {
        const page = await doc.getPage(pageNumber)
        if (isCancelled) return
        const base = page.getViewport({ scale: 1 })
        onSize({ width: base.width, height: base.height })
        const scale = width / base.width
        const canvas = document.createElement('canvas')
        task = pdf.renderPage(page, canvas, scale, canvasPixelRatio(width, base.height * scale, window.devicePixelRatio))
        await task.promise
        if (!isCancelled) holder.replaceChildren(canvas)
      })().catch((error: unknown) => {
        if (!pdf.isRenderCancelled(error) && !isCancelled) holder.replaceChildren()
      })
      return () => {
        isCancelled = true
        task?.cancel()
      }
    },
    [pdf, doc],
  )
  // 멀어진 쪽은 worker 쪽 자원도 놓는다
  const releasePage = useCallback((pageNumber: number) => void doc.getPage(pageNumber).then((page) => page.cleanup(), () => {}), [doc])
  return <PagedView pageCount={doc.numPages} firstSize={firstSize} drawPage={drawPage} releasePage={releasePage} isScalable={false} />
}
