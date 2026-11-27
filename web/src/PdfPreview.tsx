import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { formatSize } from './Files'
import { canvasPixelRatio, nextZoom, pageAt, pageLabel, PDF_PREVIEW_LIMIT_BYTES, PDF_ZOOM_STEPS, zoomLabel } from './pdfLayout'

type PdfModule = typeof import('./pdfDocument')
type PageSize = { width: number; height: number }

type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; pdf: PdfModule; doc: PDFDocumentProxy; firstSize: PageSize }
  | { status: 'too-large'; size: number }
  | { status: 'password' }
  | { status: 'failed' }

/** 쪽 사이·칸 가장자리 여백 (CSS `.ws-pdf-pages` padding·`.ws-pdf-page` margin 과 같다) */
const PAGE_GAP = 8

/**
 * 폰·터치 화면의 PDF 미리보기 (데스크톱은 FilesTab 의 iframe — Chrome 내장 뷰어). `/file/raw` 로 받아 pdf.js(처음 그릴 때만 동적 import)로
 * 쪽마다 canvas 에 칸 폭에 맞춰 그린다. 보기 위아래 한 화면 안의 쪽만 그리고 멀어지면 canvas 를 버린다
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [zoom, setZoom] = useState(PDF_ZOOM_STEPS[0])
  const [currentPage, setCurrentPage] = useState(1)
  // 그려 본 쪽의 크기(scale 1). 아직 모르는 쪽은 첫 쪽 비율로 자리를 잡는다
  const [sizes, setSizes] = useState<Record<number, PageSize>>({ 1: firstSize })
  const [nearPages, setNearPages] = useState<ReadonlySet<number>>(() => new Set())
  // 확대를 바꾸기 직전 보기 가운데가 문서 높이·폭의 어디였는지 (바꾼 뒤 그 자리로 되돌린다)
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const pageCount = doc.numPages
  const cssWidth = Math.max(0, availableWidth * zoom)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const measure = () => setAvailableWidth(Math.max(0, scroller.clientWidth - PAGE_GAP * 2))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // 보기 위아래 한 화면 안에 걸친 쪽만 그린다
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        setNearPages((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(page)
            else next.delete(page)
          }
          return next
        })
      },
      { root: scroller, rootMargin: '100% 0px' },
    )
    for (const element of scroller.querySelectorAll('.ws-pdf-page')) observer.observe(element)
    return () => observer.disconnect()
  }, [pageCount])

  const updateCurrentPage = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const tops = Array.from(scroller.querySelectorAll<HTMLElement>('.ws-pdf-page'), (element) => element.offsetTop)
    setCurrentPage(pageAt(tops, scroller.scrollTop + scroller.clientHeight / 2))
  }, [])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        updateCurrentPage()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [updateCurrentPage])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const anchor = zoomAnchorRef.current
    if (!scroller || !anchor) return
    zoomAnchorRef.current = null
    scroller.scrollTop = anchor.y * scroller.scrollHeight - scroller.clientHeight / 2
    scroller.scrollLeft = anchor.x * scroller.scrollWidth - scroller.clientWidth / 2
    updateCurrentPage()
  }, [zoom, updateCurrentPage])

  // 그리기 전에 여러 번 눌러도 단계마다 넘어가게 앞 값에서 고른다 (자리는 처음 누를 때의 것)
  const changeZoom = (pick: (current: number) => number) => {
    const scroller = scrollRef.current
    if (!scroller || pick(zoom) === zoom) return
    zoomAnchorRef.current ??= {
      x: (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth,
      y: (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight,
    }
    setZoom(pick)
  }

  const onSize = useCallback((pageNumber: number, size: PageSize) => {
    setSizes((previous) => {
      const known = previous[pageNumber]
      return known && known.width === size.width && known.height === size.height ? previous : { ...previous, [pageNumber]: size }
    })
  }, [])

  const pages = []
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const size = sizes[pageNumber] ?? firstSize
    const height = (cssWidth / size.width) * size.height
    pages.push(
      <PdfPage
        key={pageNumber}
        pdf={pdf}
        doc={doc}
        pageNumber={pageNumber}
        width={cssWidth}
        height={height}
        isNear={nearPages.has(pageNumber)}
        onSize={onSize}
      />,
    )
  }

  const maxZoom = PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1]
  return (
    <div className="ws-pdf">
      <div className="ws-pdf-bar">
        <span className="ws-pdf-page-label">{pageLabel(currentPage, pageCount)}</span>
        <button type="button" onClick={() => changeZoom((current) => nextZoom(current, -1))} disabled={zoom === PDF_ZOOM_STEPS[0]} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" className="ws-pdf-zoom" onClick={() => changeZoom(() => PDF_ZOOM_STEPS[0])} disabled={zoom === PDF_ZOOM_STEPS[0]} title="Fit to width">
          {zoomLabel(zoom)}
        </button>
        <button type="button" onClick={() => changeZoom((current) => nextZoom(current, 1))} disabled={zoom === maxZoom} title="Zoom in" aria-label="Zoom in">
          +
        </button>
      </div>
      <div className="ws-pdf-scroll" ref={scrollRef}>
        <div className="ws-pdf-pages">{pages}</div>
      </div>
    </div>
  )
}

/** 쪽 하나: 가까우면 새 canvas 에 그려 끝나면 바꿔 끼우고(그리는 동안 앞 canvas 가 남는다), 멀어지면 canvas 를 버린다 */
function PdfPage({
  pdf,
  doc,
  pageNumber,
  width,
  height,
  isNear,
  onSize,
}: {
  pdf: PdfModule
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  height: number
  isNear: boolean
  onSize: (pageNumber: number, size: PageSize) => void
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const wasRenderedRef = useRef(false)

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    if (!isNear) {
      holder.replaceChildren()
      // 멀어진 쪽은 worker 쪽 자원도 놓는다 (그린 적 없는 쪽은 getPage 도 부르지 않는다)
      if (wasRenderedRef.current) {
        wasRenderedRef.current = false
        void doc.getPage(pageNumber).then((page) => page.cleanup(), () => {})
      }
      return
    }
    if (!(width > 0)) return
    let isCancelled = false
    let task: RenderTask | null = null
    ;(async () => {
      const page = await doc.getPage(pageNumber)
      if (isCancelled) return
      wasRenderedRef.current = true
      const base = page.getViewport({ scale: 1 })
      onSize(pageNumber, { width: base.width, height: base.height })
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
  }, [pdf, doc, pageNumber, width, isNear, onSize])

  return <div className="ws-pdf-page" data-page={pageNumber} ref={holderRef} style={{ width, height }} role="img" aria-label={`Page ${pageNumber}`} />
}
