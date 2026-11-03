import { describe, expect, it } from 'vitest'
import { FALLBACK_HEAD_RECT, HEAD_SIZE, headRectOf } from './headRect'

/** width×height 투명 RGBA 에 (x0..x1-1, y0..y1-1) 를 불투명으로 칠한다 */
function image(width: number, height: number, boxes: [number, number, number, number][]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels[(y * width + x) * 4 + 3] = 255
  }
  return pixels
}

const CELL = { x: 0, y: 0, w: 80, h: 132 }

describe('headRectOf', () => {
  it('보통 머리는 44 정사각형을 머리 가운데·꼭대기 2px 위에 맞춘다', () => {
    // 머리 x 27~53, 꼭대기 y 20. 그 아래 넓은 몸통(27줄 밖)은 폭에 넣지 않는다
    const pixels = image(80, 132, [[27, 20, 54, 47], [10, 50, 70, 120]])
    expect(headRectOf(pixels, 80, CELL)).toEqual({ x: 19, y: 18, w: HEAD_SIZE, h: HEAD_SIZE })
  })

  it('머리 폭 + 4 가 44 보다 크면 그만큼 키운다 (afro)', () => {
    const pixels = image(80, 132, [[16, 20, 66, 47]])
    expect(headRectOf(pixels, 80, CELL)).toEqual({ x: 14, y: 18, w: 54, h: 54 })
  })

  it('칸 밖으로 나가지 않게 민다', () => {
    const pixels = image(80, 132, [[0, 0, 30, 27]])
    expect(headRectOf(pixels, 80, CELL)).toEqual({ x: 0, y: 0, w: HEAD_SIZE, h: HEAD_SIZE })
  })

  it('아틀라스 안 다른 칸 좌표로 돌려준다', () => {
    const pixels = image(160, 132, [[80 + 27, 20, 80 + 54, 47]])
    expect(headRectOf(pixels, 160, { x: 80, y: 0, w: 80, h: 132 })).toEqual({ x: 99, y: 18, w: HEAD_SIZE, h: HEAD_SIZE })
  })

  it('빈 칸이면 예전 고정 자리', () => {
    expect(headRectOf(image(80, 132, []), 80, CELL)).toEqual(FALLBACK_HEAD_RECT)
  })
})
