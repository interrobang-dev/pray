import type { DotCharacter, DotLook } from './dotCharacter'
import { parseHex, recolorPixels, type RecolorSlot } from './recolor'

/** 인물 아틀라스와 색 바꾸기 마스크 (tools/sprites/mask.py). Office.tsx 의 DOT_SHEET_URL 과 같은 판 */
const ATLAS_SHEET_URL = '/office/office-v1.json'
const ATLAS_IMAGE_URL = '/office/office-v1.png'
/** 머리 그림: 셀(64×128) 안 정사각형. 목록 아바타(22px)는 그 절반, Off Duty 머리는 1/3 (도트 px → 아트 px) */
export const HEAD_RECT: Rect = { x: 10, y: 10, w: 44, h: 44 }
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

export interface CharacterSheet {
  characters: DotCharacter[]
  /** 인물 id → idle 첫 칸 (없으면 typing 첫 칸) */
  frames: Map<string, Rect>
}

let sheetPromise: Promise<CharacterSheet> | null = null
let artPromise: Promise<RecolorArt> | null = null

/** 아틀라스 JSON 의 인물 목록·첫 칸을 한 번만 읽는다 (실패하면 다음에 다시) */
export function loadCharacterSheet(): Promise<CharacterSheet> {
  sheetPromise ??= fetch(ATLAS_SHEET_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    })
    .then((data: { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta: { jkCorp: { characters?: DotCharacter[] } } }) => {
      const characters = data.meta.jkCorp.characters ?? []
      const frames = new Map<string, Rect>()
      for (const { id } of characters) {
        const frame = data.frames[`char/${id}/idle/0`] ?? data.frames[`char/${id}/typing/0`]
        if (frame) frames.set(id, frame.frame)
      }
      return { characters, frames }
    })
    .catch((error: unknown) => {
      sheetPromise = null
      throw error
    })
  return sheetPromise
}

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

const headUrls = new Map<string, string | null>()

/** 그 인물·색의 머리 그림 data URL (목록 아바타). 조합마다 한 번 만든다. 인물이 아틀라스·마스크에 없으면 null */
export function headImageUrl(sheet: CharacterSheet, art: RecolorArt, look: DotLook): string | null {
  const key = `${look.id}|${look.hair}|${look.top}`
  if (headUrls.has(key)) return headUrls.get(key) ?? null
  const frame = sheet.frames.get(look.id)
  const canvas = frame ? paintCharacter(art, look.id, [{ x: frame.x + HEAD_RECT.x, y: frame.y + HEAD_RECT.y, w: HEAD_RECT.w, h: HEAD_RECT.h }], look.hair, look.top) : null
  const url = canvas ? canvas.toDataURL() : null
  headUrls.set(key, url)
  return url
}
