// 폰·터치 화면의 PDF 미리보기(PdfPreview, pdf.js canvas)의 크기·확대·쪽 번호 순수 함수 (이름이 pdfPreview.ts 가 아닌 것은 Windows 가 대소문자를 가리지 않아 ./PdfPreview 와 겹쳐서다)

/** 받기 상한. 넘으면 받다 말고 "Too large to preview" — 폰 망으로 받는 시간·worker 가 통째로 쥐는 메모리 때문 */
export const PDF_PREVIEW_LIMIT_BYTES = 50 * 1024 ** 2

/** 확대 단계. 1 = 칸 폭에 맞춤 */
export const PDF_ZOOM_STEPS = [1, 1.25, 1.5, 2, 3]

/** canvas 배율 상한 (devicePixelRatio 가 이보다 커도 여기까지) */
export const MAX_PIXEL_RATIO = 3

/** 쪽 하나의 canvas 화소 상한 (RGBA 라 약 32MB). 크게 확대하면 배율을 낮춰 맞춘다 */
export const MAX_CANVAS_PIXELS = 8_000_000

/** CSS 크기의 쪽을 그릴 canvas 배율: 화면 배율(상한 MAX_PIXEL_RATIO)이되 화소가 MAX_CANVAS_PIXELS 를 넘지 않게 */
export function canvasPixelRatio(cssWidth: number, cssHeight: number, devicePixelRatio: number): number {
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_PIXEL_RATIO)
  const cssArea = cssWidth * cssHeight
  if (!(cssArea > 0) || cssArea * ratio * ratio <= MAX_CANVAS_PIXELS) return ratio
  return Math.sqrt(MAX_CANVAS_PIXELS / cssArea)
}

/** 다음 확대 단계 (끝이면 그대로) */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  const index = PDF_ZOOM_STEPS.indexOf(zoom)
  const next = (index < 0 ? 0 : index) + direction
  return PDF_ZOOM_STEPS[Math.min(Math.max(next, 0), PDF_ZOOM_STEPS.length - 1)]
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/** 쪽 위 끝 위치(오름차순)에서 probe(보기 가운데) 가 든 쪽 번호 (1부터) */
export function pageAt(pageTops: number[], probe: number): number {
  let page = 1
  for (let index = 0; index < pageTops.length; index += 1) {
    if (pageTops[index] <= probe) page = index + 1
    else break
  }
  return page
}

export function pageLabel(current: number, total: number): string {
  return `Page ${current} of ${total}`
}
