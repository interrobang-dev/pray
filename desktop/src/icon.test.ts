import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  APP_ICON_SIZES,
  appIconIco,
  appIconPng,
  flattenPath,
  icoFromPngs,
  LOGO_PATHS,
  NOTICE_ICON_SIZE,
  NOTICE_RING_COLORS,
  noticeIconPng,
  TRAY_ICON_SIZES,
  trayIconIco,
  trayIconPng,
} from './icon'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** RGBA 픽셀 (filter 0 만 쓰는 이 모듈의 PNG 전용) */
function pngPixels(png: Buffer): { size: number; pixels: Buffer } {
  const size = png.readUInt32BE(16)
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) raw.copy(pixels, y * size * 4, y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1))
  return { size, pixels }
}

function pixelAt(image: { size: number; pixels: Buffer }, x: number, y: number): number[] {
  const offset = (y * image.size + x) * 4
  return [...image.pixels.subarray(offset, offset + 4)]
}

describe('appIconPng', () => {
  it('makes a PNG of each size', () => {
    for (const size of APP_ICON_SIZES) {
      const png = appIconPng(size)
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      expect(pngSize(png)).toEqual({ width: size, height: size })
    }
  })

  it('draws the same 32px as the tray icon', () => {
    expect(appIconPng(32).equals(trayIconPng(false))).toBe(true)
  })

  it('draws logo.svg as vector: transparent corners, solid colors inside, blended edges (no blocks of the 32 grid)', () => {
    for (const size of APP_ICON_SIZES.filter((size) => size !== 16)) {
      const image = pngPixels(appIconPng(size))
      const at = (x: number, y: number) => pixelAt(image, Math.floor((x / 32) * size), Math.floor((y / 32) * size))
      expect(at(0.2, 0.2)[3]).toBe(0)
      expect(at(31.8, 31.8)[3]).toBe(0)
      expect(at(4, 16)).toEqual([0x23, 0x26, 0x2e, 255])
      expect(at(14, 8)).toEqual([0xf5, 0xb8, 0x41, 255])
      expect(at(12, 16)).toEqual([0xff, 0xff, 0xff, 255])
      expect(at(12, 24)).toEqual([0xff, 0xff, 0xff, 255])
      expect(at(20, 24)).toEqual([0x3c, 0x42, 0x50, 255])
    }
    // 256 의 둥근 바깥 모서리(왼쪽 위 40×40)는 여러 단계의 반투명 픽셀로 섞인다 — 32 격자를 8배 한 것이면 반투명이 128 한 가지뿐이었다
    const large = pngPixels(appIconPng(256))
    const partial = new Set<number>()
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const alpha = pixelAt(large, x, y)[3]
        if (alpha > 0 && alpha < 255) partial.add(alpha)
      }
    }
    expect(partial.size).toBeGreaterThan(20)
  })

  it('keeps the hand-tuned 16 grid at 16px', () => {
    const image = pngPixels(appIconPng(16))
    expect(pixelAt(image, 0, 0)[3]).toBe(0)
    expect(pixelAt(image, 6, 3)).toEqual([0xf5, 0xb8, 0x41, 255])
    expect(pixelAt(image, 5, 6)).toEqual([0xff, 0xff, 0xff, 255])
  })
})

describe('LOGO_PATHS', () => {
  it('is the same as web/public/logo.svg', () => {
    const svg = readFileSync(join(__dirname, '../../web/public/logo.svg'), 'utf8')
    const paths = [...svg.matchAll(/<path d="([^"]+)"(?: transform="translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\)")? fill="([^"]+)"\/>/g)].map(
      ([, d, x, y, scale, fill]) => ({ d, fill, ...(x !== undefined && { transform: { translate: [Number(x), Number(y)], scale: Number(scale) } }) }),
    )
    expect(paths).toHaveLength((svg.match(/<path /g) ?? []).length)
    expect(LOGO_PATHS).toEqual(paths)
  })
})

describe('flattenPath', () => {
  it('turns lines, curves and arcs into closed polygons that stay on the outline', () => {
    const [square] = flattenPath('M0,0H10V10H0Z')
    expect(square).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
    // 원 (logo.svg 의 작은 원): 모든 점이 중심 (20, 24) 에서 반지름 2.25
    const circle = flattenPath('M17.75,24A2.25,2.25 0 1 0 22.25,24A2.25,2.25 0 1 0 17.75,24Z')
    expect(circle).toHaveLength(1)
    for (const [x, y] of circle[0]) expect(Math.hypot(x - 20, y - 24)).toBeCloseTo(2.25, 6)
  })
})

describe('trayIconPng · trayIconIco', () => {
  it('draws the alert square on whole pixels at every tray size', () => {
    for (const size of TRAY_ICON_SIZES) {
      const plain = pngPixels(trayIconPng(false, size))
      const alert = pngPixels(trayIconPng(true, size))
      expect(pngSize(trayIconPng(true, size))).toEqual({ width: size, height: size })
      const center = Math.round((26 / 32) * size)
      expect(pixelAt(alert, center, Math.round((6 / 32) * size))).toEqual([0xe0, 0x5a, 0x5a, 255])
      // 점 밖(왼쪽 아래)은 평소 그림 그대로
      expect(pixelAt(alert, Math.floor(size / 4), Math.floor((3 * size) / 4))).toEqual(pixelAt(plain, Math.floor(size / 4), Math.floor((3 * size) / 4)))
      // 점의 모든 픽셀은 흰색이나 빨강 (섞인 색 없음)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const before = pixelAt(plain, x, y).join()
          const after = pixelAt(alert, x, y).join()
          if (before !== after) expect(['255,255,255,255', '224,90,90,255']).toContain(after)
        }
      }
    }
  })

  it('holds every tray size', () => {
    for (const isAlert of [false, true]) {
      const ico = trayIconIco(isAlert)
      expect(ico.readUInt16LE(4)).toBe(TRAY_ICON_SIZES.length)
      TRAY_ICON_SIZES.forEach((size, index) => expect(ico[6 + index * 16]).toBe(size))
    }
  })
})

describe('icoFromPngs', () => {
  it('writes the header, one entry per PNG and the PNGs after the entries', () => {
    const pngs = [appIconPng(16), appIconPng(48), appIconPng(256)]
    const ico = icoFromPngs(pngs)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(3)
    let expectedOffset = 6 + 3 * 16
    pngs.forEach((png, index) => {
      const entry = 6 + index * 16
      const size = pngSize(png).width
      expect(ico[entry]).toBe(size === 256 ? 0 : size)
      expect(ico[entry + 1]).toBe(size === 256 ? 0 : size)
      expect(ico.readUInt16LE(entry + 4)).toBe(1)
      expect(ico.readUInt16LE(entry + 6)).toBe(32)
      expect(ico.readUInt32LE(entry + 8)).toBe(png.length)
      expect(ico.readUInt32LE(entry + 12)).toBe(expectedOffset)
      expect(ico.subarray(expectedOffset, expectedOffset + png.length).equals(png)).toBe(true)
      expectedOffset += png.length
    })
    expect(ico.length).toBe(expectedOffset)
  })
})

describe('appIconIco', () => {
  it('holds every app icon size in order', () => {
    const ico = appIconIco()
    expect(ico.readUInt16LE(4)).toBe(APP_ICON_SIZES.length)
    APP_ICON_SIZES.forEach((size, index) => {
      const entry = 6 + index * 16
      const png = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8))
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      expect(pngSize(png)).toEqual({ width: size, height: size })
    })
  })
})

describe('noticeIconPng', () => {
  it.each(Object.keys(NOTICE_RING_COLORS) as (keyof typeof NOTICE_RING_COLORS)[])('%s: 투명 바깥 · 상태 색 고리 · 먹색 원판 · 가운데 2배 마크', (kind) => {
    const png = noticeIconPng(kind)
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(pngSize(png)).toEqual({ width: NOTICE_ICON_SIZE, height: NOTICE_ICON_SIZE })
    const image = pngPixels(png)
    expect(pixelAt(image, 0, 0)[3]).toBe(0)
    expect(pixelAt(image, 95, 95)[3]).toBe(0)
    expect(pixelAt(image, 48, 2)).toEqual([...NOTICE_RING_COLORS[kind]])
    expect(pixelAt(image, 2, 48)).toEqual([...NOTICE_RING_COLORS[kind]])
    expect(pixelAt(image, 48, 10)).toEqual([0x23, 0x26, 0x2e, 255])
    // 32 격자 (10, 6) 의 금색 막대 → 2배, 16 만큼 밀림
    expect(pixelAt(image, 36, 28)).toEqual([0xf5, 0xb8, 0x41, 255])
    expect(pixelAt(image, 37, 29)).toEqual([0xf5, 0xb8, 0x41, 255])
  })

  it('face 가 있으면 마크 대신 머리를 2배로 가운데에 놓고 고리 안쪽 원으로 자른다', () => {
    const faceSize = 44
    const pixels = new Uint8Array(faceSize * faceSize * 4)
    for (let index = 0; index < pixels.length; index += 4) pixels.set([200, 10, 10, 255], index)
    // 머리 (22, 10) 은 투명 → 먹색 바탕, (23, 10) 은 반투명 → 먹색 위에 섞음
    pixels.set([0, 0, 0, 0], (10 * faceSize + 22) * 4)
    pixels.set([255, 255, 255, 128], (10 * faceSize + 23) * 4)
    const image = pngPixels(noticeIconPng('needs-approval', { pixels, size: faceSize }))
    expect(pngSize(noticeIconPng('done', { pixels, size: faceSize }))).toEqual({ width: NOTICE_ICON_SIZE, height: NOTICE_ICON_SIZE })
    // 2배, (96 - 88) / 2 = 4 만큼 밀림
    expect(pixelAt(image, 48, 48)).toEqual([200, 10, 10, 255])
    expect(pixelAt(image, 36, 28)).toEqual([200, 10, 10, 255])
    expect(pixelAt(image, 48, 24)).toEqual([0x23, 0x26, 0x2e, 255])
    expect(pixelAt(image, 50, 25)).toEqual([145, 147, 151, 255])
    // 고리는 머리 위에 그대로, 원 바깥(머리 네모의 모서리)은 투명
    expect(pixelAt(image, 48, 2)).toEqual([...NOTICE_RING_COLORS['needs-approval']])
    expect(pixelAt(image, 5, 5)[3]).toBe(0)
    expect(pixelAt(image, 0, 0)[3]).toBe(0)
  })
})
