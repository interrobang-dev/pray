/**
 * 목록 아바타·트레이 알림에 쓸 인물 머리 사각형 (순수). 인물마다 머리 폭·자리가 달라 정해진 한 자리로 자르면 넓은 머리(afro 등)가 잘려서,
 * 그 칸 그림에서 머리를 찾아 맞춘다. 머리 찾기는 퇴근 거리 창 얼굴 headBox(tools/sprites/street_seats.py)와 같은 규칙:
 * 칸의 맨 위 불투명 줄부터 HEAD_ROWS 줄 안의 불투명 가로 범위.
 * desktop/src/noticeFace.ts 의 headRectOf 가 같은 사본이다 (desktop 은 web 을 import 하지 않는다. 테스트가 같은 결과인지 본다)
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 머리로 보는 줄 수 (street_seats.py 의 HEAD_ROWS) */
export const HEAD_ROWS = 27
/** 머리 정사각형 기본 한 변. 이보다 넓은 머리만 키운다 — 그래야 인물끼리 얼굴 크기가 거의 같다 */
export const HEAD_SIZE = 44
/** 머리 양옆 여유 (합) */
const HEAD_SIDE_ROOM = 4
/** 머리 꼭대기 위 여유 */
const HEAD_TOP_ROOM = 2
/** 머리를 못 찾았을 때(빈 칸): 정면 셀(80×132) 안 예전 고정 자리 */
export const FALLBACK_HEAD_RECT: Rect = { x: 18, y: 14, w: HEAD_SIZE, h: HEAD_SIZE }

/**
 * 아틀라스 RGBA(pixels, 한 줄 width 픽셀) 의 칸 frame 안에서 머리 정사각형 (아틀라스 좌표).
 * 한 변 = max(44, 머리 폭 + 4), 가로는 머리 가운데, 위 끝은 머리 꼭대기 2px 위. 칸 밖으로 나가지 않게 민다
 */
export function headRectOf(pixels: ArrayLike<number>, width: number, frame: Rect): Rect {
  const isOpaque = (x: number, y: number) => pixels[((frame.y + y) * width + frame.x + x) * 4 + 3] > 0
  let top = -1
  for (let y = 0; y < frame.h && top < 0; y++) {
    for (let x = 0; x < frame.w; x++) {
      if (isOpaque(x, y)) {
        top = y
        break
      }
    }
  }
  if (top < 0) return { ...FALLBACK_HEAD_RECT, x: frame.x + FALLBACK_HEAD_RECT.x, y: frame.y + FALLBACK_HEAD_RECT.y }
  let left = frame.w
  let right = 0
  for (let y = top; y < Math.min(frame.h, top + HEAD_ROWS); y++) {
    for (let x = 0; x < frame.w; x++) {
      if (!isOpaque(x, y)) continue
      left = Math.min(left, x)
      right = Math.max(right, x + 1)
    }
  }
  const size = Math.min(frame.w, frame.h, Math.max(HEAD_SIZE, right - left + HEAD_SIDE_ROOM))
  const x = Math.round((left + right - size) / 2)
  const y = top - HEAD_TOP_ROOM
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))
  return { x: frame.x + clamp(x, frame.w - size), y: frame.y + clamp(y, frame.h - size), w: size, h: size }
}
