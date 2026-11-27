/// <reference types="vite/client" />
// rhwp(@rhwp/core)를 부르는 유일한 파일 — HwpPreview 가 처음 그릴 때만 동적 import 해 메인 번들에 안 든다 (pdfDocument.ts 와 같은 꼴)
import init, { HwpDocument } from '@rhwp/core'
import wasmUrl from '@rhwp/core/rhwp_bg.wasm?url'

export type { HwpDocument }

let ready: Promise<unknown> | null = null

/**
 * wasm 을 한 번 받아 초기화하고(Vite 가 내보낸 같은 출처 파일) 문서를 연다. 메인 스레드에서 통째로 푼다 — rhwp 가 글자 폭을
 * 이 문서의 canvas measureText 로 재서 worker 로 옮길 수 없다 (0.9.1 은 README 의 `globalThis.measureTextWidth` 를 쓰지 않고 스스로 canvas 를 만든다)
 */
export async function openHwp(bytes: Uint8Array): Promise<HwpDocument> {
  ready ??= init({ module_or_path: wasmUrl }).catch((error: unknown) => {
    ready = null
    throw error
  })
  await ready
  return new HwpDocument(bytes)
}

/** 쪽 크기 (SVG 의 px). `getPageInfo` 의 `width`·`height` */
export function pageSizeOf(doc: HwpDocument, pageIndex: number): { width: number; height: number } | null {
  try {
    const info = JSON.parse(doc.getPageInfo(pageIndex)) as { width?: unknown; height?: unknown }
    const width = Number(info.width)
    const height = Number(info.height)
    return width > 0 && height > 0 ? { width, height } : null
  } catch {
    return null
  }
}
