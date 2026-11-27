/// <reference types="vite/client" />
// pdf.js 가 문서에 따라 더 부르는 파일 (Adobe CMap·표준 글꼴·이미지 wasm). Vite 가 빌드 결과에 따로 내보내고
// (url&no-inline: 작은 것도 data URI 로 청크에 넣지 않는다) 여기에는 이름 → 주소만 남는다. 실제로 받는 것은 문서가 그 파일을 쓸 때뿐이다

const CMAPS = import.meta.glob('../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url&no-inline', import: 'default', eager: true })
const STANDARD_FONTS = import.meta.glob('../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
})
// 그림 해독(JBIG2·JPEG 2000)만. qcms(ICC 색)는 useWorkerFetch false 라 pdf.js 가 쓰지 않고, quickjs(문서 JavaScript)는 일부러 뺀다
const WASM = import.meta.glob('../../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm', { query: '?url&no-inline', import: 'default', eager: true })

export type PdfAssetKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

const BY_KIND: Record<PdfAssetKind, Map<string, string>> = {
  cMapUrl: byFileName(CMAPS),
  standardFontDataUrl: byFileName(STANDARD_FONTS),
  wasmUrl: byFileName(WASM),
}

function byFileName(modules: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [path, url] of Object.entries(modules)) map.set(path.slice(path.lastIndexOf('/') + 1), String(url))
  return map
}

/** pdf.js 가 달라는 파일(`UniKS-UCS2-H.bcmap`·`FoxitSymbol.pfb`·`openjpeg.wasm`)의 주소, 없으면 null */
export function pdfAssetUrl(kind: string, fileName: string): string | null {
  const map = BY_KIND[kind as PdfAssetKind]
  return map?.get(fileName) ?? null
}
