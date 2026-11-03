import { describe, expect, it } from 'vitest'
import * as web from '../../web/src/recolor'
import { parseHex, recolorPixels, type RecolorSlot } from './recolor'

/** 고정 씨앗 의사 난수 (결과가 늘 같게) */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('recolor (web/src/recolor.ts 사본)', () => {
  it('parseHex 가 같다', () => {
    for (const hex of ['#000000', '#ffffff', '#4a6ad2', '#e3b860']) expect(parseHex(hex)).toEqual(web.parseHex(hex))
  })

  it('recolorPixels 가 같은 픽셀을 낸다 (머리·윗옷·둘 다, 가중치 0~255, 투명 픽셀)', () => {
    const next = random(42)
    const count = 4000
    const pixels = new Uint8ClampedArray(count * 4)
    const mask = new Uint8ClampedArray(count * 4)
    for (let index = 0; index < pixels.length; index++) {
      pixels[index] = Math.floor(next() * 256)
      mask[index] = next() < 0.3 ? 0 : Math.floor(next() * 256)
    }
    for (let index = 3; index < pixels.length; index += 40) pixels[index] = 0
    const slotSets: RecolorSlot[][] = [
      [],
      [{ channel: 0, base: parseHex('#292623'), target: parseHex('#e3b860') }],
      [{ channel: 1, base: parseHex('#ee952d'), target: parseHex('#2e3a66') }],
      [
        { channel: 0, base: parseHex('#e0954f'), target: parseHex('#a9a9ad') },
        { channel: 1, base: parseHex('#27583f'), target: parseHex('#f2f2f0') },
      ],
    ]
    for (const slots of slotSets) {
      const mine = new Uint8Array(pixels)
      const theirs = new Uint8ClampedArray(pixels)
      recolorPixels(mine, mask, slots)
      web.recolorPixels(theirs, mask, slots)
      expect([...mine]).toEqual([...theirs])
    }
  })
})
