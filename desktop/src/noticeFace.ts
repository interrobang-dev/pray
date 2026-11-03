/**
 * 알림 그림에 넣을 세션 도트 인물 머리 (순수, Electron 없음). 화면 목록 아바타(web/src/characterArt.ts 의 headImageUrl)와 같은 판·같은 자리:
 * 정면 아틀라스(office-v5-down)의 idle 첫 칸(없으면 typing 첫 칸) 안 HEAD_RECT 44px 를 정면 마스크(office-v5-down-recolor)로 색을 바꾼다
 */
import type { DotCharacter, DotLook } from './dotCharacter'
import { parseHex, recolorPixels, type RecolorSlot } from './recolor'

/** 정면 아틀라스 판 이름 (host/src/dotCharacter.ts 의 CHARACTER_SHEET 와 같다) */
export const FACE_SHEET = 'office-v5-down'
/** 머리 그림: 정면 셀(80×132) 안 정사각형. web/src/characterArt.ts 의 HEAD_RECT 와 같아야 한다 */
export const HEAD_RECT = { x: 18, y: 14, w: 44, h: 44 } as const

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 아틀라스 JSON(PixiJS Spritesheet) 중 쓰는 필드 */
export interface FaceSheetJson {
  frames: Record<string, { frame: Rect }>
  meta: { jkCorp: { characters?: DotCharacter[] } }
}

/** `<판>-recolor.json`: 마스크 PNG 이름과 인물별 부위 기본색 */
export interface FaceRecolorJson {
  mask: string
  characters: Record<string, { hair: string; top: string }>
}

/** 디코딩한 이미지: RGBA(straight alpha) 픽셀 */
export interface RgbaImage {
  width: number
  height: number
  pixels: Uint8Array
}

/** 인물마다 잘라 둔 머리 칸 (아틀라스 전체를 메모리에 들고 있지 않으려고) */
export interface FaceArt {
  characters: DotCharacter[]
  heads: Map<string, { pixels: Uint8Array; mask: Uint8Array; bases: { hair: string; top: string } }>
}

/**
 * Electron nativeImage.toBitmap() 의 BGRA → straight RGBA. Skia 비트맵이라 반투명은 premultiplied 로 보고 되돌린다
 * (지금 아틀라스는 알파가 0·255 뿐이라 영향 없다)
 */
export function rgbaFromBgra(bitmap: Uint8Array, width: number, height: number): RgbaImage {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = bitmap[index + 3]
    pixels[index + 3] = alpha
    if (alpha === 0) continue
    const unpremultiply = (value: number) => (alpha === 255 ? value : Math.min(255, Math.round((value * 255) / alpha)))
    pixels[index] = unpremultiply(bitmap[index + 2])
    pixels[index + 1] = unpremultiply(bitmap[index + 1])
    pixels[index + 2] = unpremultiply(bitmap[index])
  }
  return { width, height, pixels }
}

/** RGBA 이미지에서 사각형을 잘라낸다. 이미지 밖으로 나가면 null */
export function cutRgba(image: RgbaImage, rect: Rect): Uint8Array | null {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > image.width || rect.y + rect.h > image.height) return null
  const out = new Uint8Array(rect.w * rect.h * 4)
  for (let row = 0; row < rect.h; row++) {
    const start = ((rect.y + row) * image.width + rect.x) * 4
    out.set(image.pixels.subarray(start, start + rect.w * 4), row * rect.w * 4)
  }
  return out
}

/** 아틀라스·마스크에서 인물마다 머리 칸을 잘라 둔다. 첫 칸·기본색이 없거나 아틀라스 밖인 인물은 빠진다 */
export function buildFaceArt(sheet: FaceSheetJson, recolor: FaceRecolorJson, atlas: RgbaImage, mask: RgbaImage): FaceArt {
  const characters = sheet.meta.jkCorp.characters ?? []
  const heads: FaceArt['heads'] = new Map()
  for (const { id } of characters) {
    const frame = (sheet.frames[`char/${id}/idle/0`] ?? sheet.frames[`char/${id}/typing/0`])?.frame
    const bases = recolor.characters[id]
    if (!frame || !bases) continue
    const rect = { x: frame.x + HEAD_RECT.x, y: frame.y + HEAD_RECT.y, w: HEAD_RECT.w, h: HEAD_RECT.h }
    const pixels = cutRgba(atlas, rect)
    const maskPixels = cutRgba(mask, rect)
    if (pixels && maskPixels) heads.set(id, { pixels, mask: maskPixels, bases })
  }
  return { characters, heads }
}

/** 그 인물·색의 머리 HEAD_RECT 크기 RGBA (색이 null 이면 그 부위는 그대로). 인물이 아틀라스·마스크에 없으면 null */
export function facePixels(art: FaceArt, look: DotLook): Uint8Array | null {
  const head = art.heads.get(look.id)
  if (!head) return null
  const slots: RecolorSlot[] = []
  if (look.hair) slots.push({ channel: 0, base: parseHex(head.bases.hair), target: parseHex(look.hair) })
  if (look.top) slots.push({ channel: 1, base: parseHex(head.bases.top), target: parseHex(look.top) })
  const pixels = head.pixels.slice()
  recolorPixels(pixels, head.mask, slots)
  return pixels
}

/** 알림 그림 파일 이름 조각: 인물·색 조합마다 하나 ('#' 는 빼고 null 은 base. 파일 이름에 못 쓰는 글자는 _) */
export function faceFileKey(look: DotLook): string {
  const color = (value: string | null) => (value ? value.replace(/^#/, '') : 'base')
  return `${look.id}-${color(look.hair)}-${color(look.top)}`.replace(/[^A-Za-z0-9-]/g, '_')
}
