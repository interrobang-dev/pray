/**
 * 사무실이 보일 때 오른쪽 세션 패널 폭. 사용자가 패널 왼쪽 가장자리를 끌어 바꾸고 localStorage 에 남긴다.
 * style.css 의 `.layout.with-panel` 도 같은 최소·여백 값으로 창 폭에 맞춰 다시 줄인다 (창을 줄여도 사무실이 사라지지 않게).
 */

/** 저장값이 없을 때의 폭 (예전 고정 폭) */
export const DEFAULT_PANEL_WIDTH = 520
/** 패널 최소 폭 */
export const MIN_PANEL_WIDTH = 360
/** 패널 말고 남겨 둘 폭: 목록 300px + 사무실 최소 320px. style.css 의 `calc(100% - 620px)` 와 같은 값 */
export const RESERVED_WIDTH = 620
/** 키보드 ←→ 한 번에 바뀌는 폭 */
export const KEY_STEP = 16

/** layoutWidth(목록·사무실·패널 전체 폭) 안에서 쓸 수 있는 폭으로 줄인다. 너무 좁으면 최소 폭이 이긴다 */
export function clampPanelWidth(width: number, layoutWidth: number): number {
  const max = Math.max(MIN_PANEL_WIDTH, layoutWidth - RESERVED_WIDTH)
  return Math.round(Math.min(max, Math.max(MIN_PANEL_WIDTH, width)))
}

/** 저장된 글을 폭으로. 없거나 숫자가 아니거나 최소보다 작으면 기본 폭 */
export function parsePanelWidth(stored: string | null): number {
  if (stored === null) return DEFAULT_PANEL_WIDTH
  const width = Number(stored)
  if (!Number.isFinite(width) || width < MIN_PANEL_WIDTH) return DEFAULT_PANEL_WIDTH
  return Math.round(width)
}
