import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { nextZoom, pageAt, pageLabel, ZOOM_STEPS, zoomLabel } from './pageLayout'

export type PageSize = { width: number; height: number }

/**
 * 쪽 하나 그리기: `holder` 에 그림을 다 만든 뒤 바꿔 끼우고(그리는 동안 앞 그림이 남는다), 알게 된 쪽 크기를 `onSize` 로 알린다.
 * 돌려준 함수는 그리기를 그만둔다 (멀어지거나 폭이 바뀌어 다시 그릴 때)
 */
export type DrawPage = (job: { pageNumber: number; width: number; holder: HTMLDivElement; onSize: (size: PageSize) => void }) => () => void

/** 쪽 사이·칸 가장자리 여백 (CSS `.ws-paged-pages` padding·`.ws-paged-page` margin 과 같다) */
const PAGE_GAP = 8

/**
 * 쪽 단위 미리보기 공용 틀 (폰 PDF·hwp·hwpx): 위 막대 "Page N of M"·− 100% +, 아래 쪽 목록. 쪽은 칸 폭에 맞추고(×확대),
 * 보기 위아래 한 화면 안의 쪽만 `drawPage` 로 그리고 멀어지면 비우고 `releasePage` 를 부른다.
 * `drawPage`·`releasePage` 는 바뀌지 않는 함수여야 한다 (바뀌면 보이는 쪽을 다시 그린다).
 * `isScalable` 이면(SVG 그림처럼 늘려도 선명한 것) 확대·폭이 바뀌어도 다시 그리지 않는다
 */
export function PagedView({
  pageCount,
  firstSize,
  drawPage,
  releasePage,
  isScalable,
}: {
  pageCount: number
  firstSize: PageSize
  drawPage: DrawPage
  releasePage?: (pageNumber: number) => void
  isScalable: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [zoom, setZoom] = useState(ZOOM_STEPS[0])
  const [currentPage, setCurrentPage] = useState(1)
  // 그려 본 쪽의 크기. 아직 모르는 쪽은 첫 쪽 비율로 자리를 잡는다
  const [sizes, setSizes] = useState<Record<number, PageSize>>({ 1: firstSize })
  const [nearPages, setNearPages] = useState<ReadonlySet<number>>(() => new Set())
  // 확대를 바꾸기 직전 보기 가운데가 문서 높이·폭의 어디였는지 (바꾼 뒤 그 자리로 되돌린다)
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
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
    for (const element of scroller.querySelectorAll('.ws-paged-page')) observer.observe(element)
    return () => observer.disconnect()
  }, [pageCount])

  const updateCurrentPage = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const tops = Array.from(scroller.querySelectorAll<HTMLElement>('.ws-paged-page'), (element) => element.offsetTop)
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
    pages.push(
      <PageSlot
        key={pageNumber}
        pageNumber={pageNumber}
        width={cssWidth}
        height={(cssWidth / size.width) * size.height}
        isNear={nearPages.has(pageNumber)}
        isScalable={isScalable}
        drawPage={drawPage}
        releasePage={releasePage}
        onSize={onSize}
      />,
    )
  }

  const maxZoom = ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return (
    <div className="ws-paged">
      <div className="ws-paged-bar">
        <span className="ws-paged-label">{pageLabel(currentPage, pageCount)}</span>
        <button type="button" onClick={() => changeZoom((current) => nextZoom(current, -1))} disabled={zoom === ZOOM_STEPS[0]} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" className="ws-paged-zoom" onClick={() => changeZoom(() => ZOOM_STEPS[0])} disabled={zoom === ZOOM_STEPS[0]} title="Fit to width">
          {zoomLabel(zoom)}
        </button>
        <button type="button" onClick={() => changeZoom((current) => nextZoom(current, 1))} disabled={zoom === maxZoom} title="Zoom in" aria-label="Zoom in">
          +
        </button>
      </div>
      <div className="ws-paged-scroll" ref={scrollRef}>
        <div className="ws-paged-pages">{pages}</div>
      </div>
    </div>
  )
}

/** 쪽 자리 하나: 가까우면 그리고, 멀어지면 비운다 */
function PageSlot({
  pageNumber,
  width,
  height,
  isNear,
  isScalable,
  drawPage,
  releasePage,
  onSize,
}: {
  pageNumber: number
  width: number
  height: number
  isNear: boolean
  isScalable: boolean
  drawPage: DrawPage
  releasePage?: (pageNumber: number) => void
  onSize: (pageNumber: number, size: PageSize) => void
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const wasDrawnRef = useRef(false)
  const widthRef = useRef(width)
  widthRef.current = width
  const hasWidth = width > 0
  // 늘려도 선명한 그림은 처음 한 번만 그린다 (폭은 CSS 가 맞춘다)
  const drawWidth = isScalable ? 0 : width

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    if (!isNear) {
      holder.replaceChildren()
      // 그린 적 없는 쪽은 놓을 것도 없다
      if (wasDrawnRef.current) {
        wasDrawnRef.current = false
        releasePage?.(pageNumber)
      }
      return
    }
    if (!hasWidth) return
    wasDrawnRef.current = true
    return drawPage({ pageNumber, width: widthRef.current, holder, onSize: (size) => onSize(pageNumber, size) })
  }, [pageNumber, isNear, hasWidth, drawWidth, drawPage, releasePage, onSize])

  return <div className="ws-paged-page" data-page={pageNumber} ref={holderRef} style={{ width, height }} role="img" aria-label={`Page ${pageNumber}`} />
}
