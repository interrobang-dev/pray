import { describe, expect, it } from 'vitest'
import * as web from '../../web/src/headRect'
import { buildFaceArt, cutRgba, faceFileKey, facePixels, headRectOf, rgbaFromBgra, type FaceRecolorJson, type FaceSheetJson, type RgbaImage } from './noticeFace'
import { parseHex, recolorPixels } from './recolor'

function image(width: number, height: number, pixelAt: (x: number, y: number) => number[]): RgbaImage {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(pixelAt(x, y), (y * width + x) * 4)
  return { width, height, pixels }
}

describe('rgbaFromBgra', () => {
  it('BGRA → RGBA, 불투명은 그대로, 투명은 0', () => {
    const bitmap = new Uint8Array([10, 20, 30, 255, 99, 99, 99, 0])
    expect([...rgbaFromBgra(bitmap, 2, 1).pixels]).toEqual([30, 20, 10, 255, 0, 0, 0, 0])
  })

  it('반투명은 premultiplied 를 되돌린다', () => {
    const bitmap = new Uint8Array([50, 25, 100, 128])
    expect([...rgbaFromBgra(bitmap, 1, 1).pixels]).toEqual([199, 50, 100, 128])
  })
})

describe('cutRgba', () => {
  const source = image(4, 3, (x, y) => [x, y, 0, 255])
  it('사각형을 잘라낸다', () => {
    expect([...cutRgba(source, { x: 1, y: 1, w: 2, h: 2 })!]).toEqual([1, 1, 0, 255, 2, 1, 0, 255, 1, 2, 0, 255, 2, 2, 0, 255])
  })
  it('이미지 밖이면 null', () => {
    expect(cutRgba(source, { x: 3, y: 0, w: 2, h: 1 })).toBeNull()
    expect(cutRgba(source, { x: 0, y: 2, w: 1, h: 2 })).toBeNull()
  })
})

describe('headRectOf (web/src/headRect.ts 사본)', () => {
  it('무작위 머리·몸통 칸에서 web 과 같은 사각형', () => {
    let seed = 7
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % max
    }
    for (let round = 0; round < 300; round++) {
      const headLeft = random(60)
      const headTop = random(40)
      const headRight = Math.min(80, headLeft + 1 + random(60))
      const bodyLeft = random(40)
      const picture = image(160, 132, (x, y) => {
        const cellX = x - 80
        const isHead = cellX >= headLeft && cellX < headRight && y >= headTop && y < headTop + 20
        const isBody = cellX >= bodyLeft && cellX < bodyLeft + 40 && y >= headTop + 30 && y < 132
        return [0, 0, 0, round % 5 !== 0 && (isHead || isBody) ? 255 : 0]
      })
      const frame = { x: 80, y: 0, w: 80, h: 132 }
      expect(headRectOf(picture.pixels, 160, frame)).toEqual(web.headRectOf(picture.pixels, 160, frame))
    }
  })
})

describe('buildFaceArt·facePixels', () => {
  // 셀 80×132 두 칸, 칸마다 머리만 불투명(x 27~53, y 20~46) → 머리 자리 x 19·y 18·44px. a 는 idle 첫 칸, b 는 typing 첫 칸만, c 는 첫 칸 없음, d 는 기본색 없음
  const isHead = (x: number, y: number) => x % 80 >= 27 && x % 80 < 54 && y >= 20 && y < 47
  const atlas = image(160, 132, (x, y) => [x, y, x < 80 ? 10 : 20, isHead(x, y) ? 255 : 0])
  const mask = image(160, 132, (x) => (x < 80 ? [255, 0, 0, 255] : [0, 128, 0, 255]))
  const sheet: FaceSheetJson = {
    frames: {
      'char/a/idle/0': { frame: { x: 0, y: 0, w: 80, h: 132 } },
      'char/a/typing/0': { frame: { x: 80, y: 0, w: 80, h: 132 } },
      'char/b/typing/0': { frame: { x: 80, y: 0, w: 80, h: 132 } },
      'char/d/idle/0': { frame: { x: 0, y: 0, w: 80, h: 132 } },
    },
    meta: {
      jkCorp: {
        characters: [
          { id: 'a', pool: 'lead' },
          { id: 'b', pool: 'member' },
          { id: 'c', pool: 'member' },
          { id: 'd', pool: 'member' },
        ],
      },
    },
  }
  const recolor: FaceRecolorJson = {
    mask: 'x-recolor.png',
    characters: { a: { hair: '#202020', top: '#808080' }, b: { hair: '#303030', top: '#606060' }, c: { hair: '#000000', top: '#000000' } },
  }
  const art = buildFaceArt(sheet, recolor, atlas, mask)

  it('idle 첫 칸(없으면 typing 첫 칸) 안 머리 정사각형(headRectOf)을 자른다. 첫 칸·기본색이 없는 인물은 빠진다', () => {
    expect(art.characters.map((each) => each.id)).toEqual(['a', 'b', 'c', 'd'])
    expect([...art.heads.keys()]).toEqual(['a', 'b'])
    expect(art.heads.get('a')!.size).toBe(44)
    expect(art.heads.get('a')!.pixels.length).toBe(44 * 44 * 4)
    expect([...art.heads.get('a')!.pixels.subarray(0, 4)]).toEqual([19, 18, 10, 0])
    expect([...art.heads.get('b')!.pixels.subarray(0, 4)]).toEqual([80 + 19, 18, 20, 0])
  })

  it('색이 null 이면 그대로, 고른 색이면 recolorPixels 와 같게 바꾼다. 잘라 둔 칸은 그대로 둔다', () => {
    const head = art.heads.get('a')!
    const before = [...head.pixels]
    expect(facePixels(art, { id: 'a', hair: null, top: null })).toEqual({ pixels: new Uint8Array(before), size: 44 })
    const expected = head.pixels.slice()
    recolorPixels(expected, head.mask, [
      { channel: 0, base: parseHex('#202020'), target: parseHex('#e3b860') },
      { channel: 1, base: parseHex('#808080'), target: parseHex('#c83a3a') },
    ])
    const changed = facePixels(art, { id: 'a', hair: '#e3b860', top: '#c83a3a' })!.pixels
    expect([...changed]).toEqual([...expected])
    expect([...changed]).not.toEqual(before)
    expect([...head.pixels]).toEqual(before)
  })

  it('아틀라스·마스크에 없는 인물이면 null', () => {
    expect(facePixels(art, { id: 'c', hair: null, top: null })).toBeNull()
    expect(facePixels(art, { id: 'zzz', hair: null, top: null })).toBeNull()
  })
})

describe('faceFileKey', () => {
  it('인물·머리·윗옷 조합마다 다른 이름, null 은 base', () => {
    expect(faceFileKey({ id: 'lead-suit', hair: null, top: null })).toBe('lead-suit-base-base')
    expect(faceFileKey({ id: 'afro', hair: '#e3b860', top: '#2E3A66' })).toBe('afro-e3b860-2E3A66')
    expect(faceFileKey({ id: '../x', hair: null, top: null })).toBe('___x-base-base')
  })
})
