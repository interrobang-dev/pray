import { parseHex, recolorPixels, type RecolorSlot } from './recolor'

/** 인물 아틀라스와 색 바꾸기 마스크 (tools/sprites/mask.py). Office.tsx 의 DOT_SHEET_URL 과 같은 판 */
const ATLAS_IMAGE_URL = '/office/office-v1.png'
const RECOLOR_URL = '/office/office-v1-recolor.json'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 인물 id → 부위별 기본색 '#rrggbb' */
export type BaseColors = Record<string, { hair: string; top: string }>

export interface RecolorArt {
  atlas: ImageData
  mask: ImageData
  bases: BaseColors
}

let artPromise: Promise<RecolorArt> | null = null

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`그림을 읽지 못함: ${url}`))
    image.src = url
  })
}

function pixelsOf(image: CanvasImageSource & { width: number; height: number }): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas 2d 를 못 씀')
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, image.width, image.height)
}

/** 아틀라스·마스크 픽셀과 기본색을 한 번만 읽는다 (실패하면 다음에 다시) */
export function loadRecolorArt(): Promise<RecolorArt> {
  artPromise ??= (async () => {
    const response = await fetch(RECOLOR_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { mask: string; characters: BaseColors }
    const base = RECOLOR_URL.slice(0, RECOLOR_URL.lastIndexOf('/') + 1)
    const [atlas, mask] = await Promise.all([loadImage(ATLAS_IMAGE_URL), loadImage(base + data.mask)])
    return { atlas: pixelsOf(atlas), mask: pixelsOf(mask), bases: data.characters }
  })().catch((error: unknown) => {
    artPromise = null
    throw error
  })
  return artPromise
}

function cut(source: ImageData, rect: Rect): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(rect.w * rect.h * 4))
  for (let row = 0; row < rect.h; row++) {
    const start = ((rect.y + row) * source.width + rect.x) * 4
    out.set(source.data.subarray(start, start + rect.w * 4), row * rect.w * 4)
  }
  return out
}

/**
 * 그 인물 칸들(rects)을 색을 바꿔 가로로 이어 붙인 canvas. i 번째 칸은 x = rects 앞 칸 폭 합.
 * 색이 null 이면 그 부위는 그대로다. 마스크에 없는 인물이면 null
 */
export function paintCharacter(art: RecolorArt, character: string, rects: Rect[], hair: string | null, top: string | null): HTMLCanvasElement | null {
  const bases = art.bases[character]
  if (!bases) return null
  const slots: RecolorSlot[] = []
  if (hair) slots.push({ channel: 0, base: parseHex(bases.hair), target: parseHex(hair) })
  if (top) slots.push({ channel: 1, base: parseHex(bases.top), target: parseHex(top) })
  const canvas = document.createElement('canvas')
  canvas.width = rects.reduce((sum, rect) => sum + rect.w, 0)
  canvas.height = Math.max(...rects.map((rect) => rect.h))
  const context = canvas.getContext('2d')
  if (!context) return null
  let x = 0
  for (const rect of rects) {
    const pixels = cut(art.atlas, rect)
    recolorPixels(pixels, cut(art.mask, rect), slots)
    context.putImageData(new ImageData(pixels, rect.w, rect.h), x, 0)
    x += rect.w
  }
  return canvas
}
