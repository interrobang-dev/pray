/**
 * 도트 인물 머리·윗옷 색 바꾸기 (순수 함수). 마스크·기본색은 tools/sprites/mask.py 가 만든다:
 * 마스크 R = 머리 가중치, G = 윗옷 가중치 (0~255), 기본색 = 그 부위 표본 색의 가운데 값.
 * 바꾼 색 = 고른 색의 색상·채도 + (고른 색 밝기 + 원래 픽셀이 기본색보다 밝거나 어두운 만큼). 그래서 음영이 남는다
 */

export type Rgb = [number, number, number]

export function parseHex(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** 0~255 RGB → [색상 0~1, 채도 0~1, 밝기 0~1] */
export function rgbToHsl([r, g, b]: Rgb): Rgb {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  hue /= 6
  return [hue, saturation, lightness]
}

export function hslToRgb([hue, saturation, lightness]: Rgb): Rgb {
  if (saturation === 0) {
    const gray = Math.round(lightness * 255)
    return [gray, gray, gray]
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset: number) => {
    let t = hue + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    const value = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
    return Math.round(value * 255)
  }
  return [channel(1 / 3), channel(0), channel(-1 / 3)]
}

/**
 * 픽셀 하나를 기본색 → 고른 색으로. 밝기 차이는 고른 색이 기본색보다 밝으면 늘리고(검은 머리를 금발로 해도 음영이 보이게, 3배까지)
 * 어두우면 줄인다(0.6배까지)
 */
export function recolorPixel(pixel: Rgb, base: Rgb, target: Rgb): Rgb {
  const [, , pixelLightness] = rgbToHsl(pixel)
  const [, , baseLightness] = rgbToHsl(base)
  const [hue, saturation, targetLightness] = rgbToHsl(target)
  const scale = Math.min(3, Math.max(0.6, targetLightness / Math.max(baseLightness, 0.05)))
  const lightness = Math.min(1, Math.max(0, targetLightness + (pixelLightness - baseLightness) * scale))
  return hslToRgb([hue, saturation, lightness])
}

export interface RecolorSlot {
  /** 마스크 채널: 0 = 머리(R), 1 = 윗옷(G) */
  channel: 0 | 1
  base: Rgb
  target: Rgb
}

/**
 * RGBA 픽셀 배열을 그 자리에서 바꾼다. mask 는 같은 크기의 RGBA (가중치만큼 섞는다). 알파는 그대로
 */
export function recolorPixels(pixels: Uint8ClampedArray, mask: Uint8ClampedArray, slots: RecolorSlot[]): void {
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue
    for (const slot of slots) {
      const weight = mask[index + slot.channel] / 255
      if (weight === 0) continue
      const original: Rgb = [pixels[index], pixels[index + 1], pixels[index + 2]]
      const changed = recolorPixel(original, slot.base, slot.target)
      for (let channel = 0; channel < 3; channel++) pixels[index + channel] = Math.round(original[channel] * (1 - weight) + changed[channel] * weight)
    }
  }
}
