import { describe, expect, it } from 'vitest'
import { hslToRgb, parseHex, recolorPixel, recolorPixels, rgbToHsl, type Rgb } from './recolor'

const lightnessOf = (color: Rgb) => rgbToHsl(color)[2]

describe('recolor', () => {
  it('HSL 을 왕복해도 색이 같다', () => {
    for (const hex of ['#c6defa', '#22211f', '#e57622', '#808080', '#ffffff', '#000000', '#3c8a4a']) {
      expect(hslToRgb(rgbToHsl(parseHex(hex)))).toEqual(parseHex(hex))
    }
  })

  it('기본색 픽셀은 고른 색이 된다', () => {
    const target = parseHex('#c83a3a')
    const changed = recolorPixel(parseHex('#2a5437'), parseHex('#2a5437'), target)
    changed.forEach((value, channel) => expect(Math.abs(value - target[channel])).toBeLessThanOrEqual(1))
  })

  it('기본색보다 어두운 음영은 바꾼 뒤에도 어둡고, 밝은 쪽은 밝다', () => {
    const base = parseHex('#22211f')
    const target = parseHex('#e3b860')
    const shadow = recolorPixel(parseHex('#141312'), base, target)
    const highlight = recolorPixel(parseHex('#3a3835'), base, target)
    const middle = recolorPixel(base, base, target)
    expect(lightnessOf(shadow)).toBeLessThan(lightnessOf(middle))
    expect(lightnessOf(highlight)).toBeGreaterThan(lightnessOf(middle))
  })

  it('밝기는 0~1 밖으로 나가지 않는다', () => {
    expect(recolorPixel(parseHex('#ffffff'), parseHex('#22211f'), parseHex('#f2f2f0'))).toEqual([255, 255, 255])
    expect(recolorPixel(parseHex('#000000'), parseHex('#fac12d'), parseHex('#2f2f34'))).toEqual([0, 0, 0])
  })

  it('마스크 가중치만큼 섞고 투명 픽셀·마스크 밖은 그대로 둔다', () => {
    const pixels = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 0, 100, 100, 100, 255])
    const mask = new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255])
    recolorPixels(pixels, mask, [
      { channel: 0, base: [100, 100, 100], target: [200, 0, 0] },
      { channel: 1, base: [100, 100, 100], target: [0, 0, 200] },
    ])
    expect(Array.from(pixels.slice(0, 4))).toEqual([200, 0, 0, 255])
    expect(Array.from(pixels.slice(4, 8))).toEqual([50, 50, 150, 255])
    expect(Array.from(pixels.slice(8, 16))).toEqual([100, 100, 100, 0, 100, 100, 100, 255])
  })
})
