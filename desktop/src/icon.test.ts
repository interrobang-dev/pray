import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { APP_ICON_SIZES, appIconIco, appIconPng, icoFromPngs, NOTICE_ICON_SIZE, NOTICE_RING_COLORS, noticeIconPng, trayIconPng } from './icon'

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

  it('draws the 32 grid one to one, the same as the tray icon', () => {
    expect(appIconPng(32).equals(trayIconPng(false))).toBe(true)
  })

  it('scales by whole cells so each grid cell stays one solid block', () => {
    const base = pngPixels(appIconPng(32))
    const large = pngPixels(appIconPng(256))
    for (const [x, y] of [[0, 0], [5, 0], [10, 6], [12, 15], [19, 23], [31, 31]]) {
      const color = pixelAt(base, x, y)
      for (const [dx, dy] of [[0, 0], [7, 0], [0, 7], [7, 7]]) expect(pixelAt(large, x * 8 + dx, y * 8 + dy)).toEqual(color)
    }
  })

  it('uses no colors that are not in the 32 grid for 24 and 48', () => {
    const colors = new Set<string>()
    const base = pngPixels(appIconPng(32))
    for (let i = 0; i < base.pixels.length; i += 4) colors.add(base.pixels.subarray(i, i + 4).join())
    for (const size of [24, 48]) {
      const image = pngPixels(appIconPng(size))
      for (let i = 0; i < image.pixels.length; i += 4) expect(colors.has(image.pixels.subarray(i, i + 4).join())).toBe(true)
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
