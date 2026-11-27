/// <reference types="vite/client" />
// pdf.js 를 부르는 유일한 파일 — PdfPreview 가 처음 그릴 때만 동적 import 해 메인 번들에 안 든다 (CodeEditor 의 codeMirrorEditor.ts 와 같은 꼴)
import { AnnotationMode, getDocument, GlobalWorkerOptions, RenderingCancelledException, VerbosityLevel } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfAssetUrl } from './pdfAssets'

// worker 는 Vite 가 내보낸 같은 출처 파일 (CDN 을 부르지 않는다)
GlobalWorkerOptions.workerSrc = workerUrl

/** worker 가 CMap·표준 글꼴·wasm 을 달라고 하면 Vite 가 내보낸 파일(pdfAssets.ts)에서 준다 — pdf.js 는 폴더 주소를 바라지만 Vite 파일 이름에는 해시가 붙어서 */
class BundledDataFactory {
  constructor(_options: unknown) {}

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = pdfAssetUrl(kind, filename)
    if (!url) throw new Error(`No bundled pdf.js file: ${filename}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * 받은 PDF 바이트를 연다 (worker 가 푼다. data 는 worker 로 넘어가 이 ArrayBuffer 는 비워진다).
 * 스크립트는 돌지 않는다: pdf.js 6 은 글꼴에 eval 을 쓰지 않아(`isEvalSupported` 옵션이 없어졌다) 끌 것이 없고,
 * 문서 JavaScript 는 pdf.sandbox 를 불러야 도는데 불러오지 않는다. XFA 끔, 글자 층·주석 층은 만들지 않는다 (canvas 만)
 */
export function openPdf(data: ArrayBuffer): PDFDocumentLoadingTask {
  return getDocument({
    data,
    enableXfa: false,
    useWorkerFetch: false,
    BinaryDataFactory: BundledDataFactory,
    // BundledDataFactory 는 파일 이름만 보지만 pdf.js 가 값이 있어야 달라고 해서 이름표만 둔다
    cMapUrl: 'bundled/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'bundled/standard_fonts/',
    wasmUrl: 'bundled/wasm/',
    disableWorkerRendering: true,
    verbosity: VerbosityLevel.ERRORS,
  })
}

/** 쪽을 새 canvas 에 그린다. scale = CSS 크기 배율, pixelRatio = 그 위 화면 배율 */
export function renderPage(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number, pixelRatio: number): RenderTask {
  const viewport = page.getViewport({ scale })
  canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
  canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
  return page.render({
    canvas,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    annotationMode: AnnotationMode.ENABLE,
  })
}

export function isRenderCancelled(error: unknown): boolean {
  return error instanceof RenderingCancelledException
}
