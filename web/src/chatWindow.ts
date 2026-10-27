import { rowKeyOf, type ChatRow } from './chatRows'

/**
 * 대화 탭은 줄(rows)을 다 그리지 않고 최근 것부터 그린다 (큰 세션은 줄이 수천 개라 열 때 마크다운 파싱이 오래 걸린다).
 * 그리는 범위 = 시작 줄부터 끝까지. 시작은 줄 키로 기억해 새 메시지가 와도 아래쪽만 늘어난다
 */

/** 처음 그리는 줄 수이자 위로 스크롤해 한 번에 더 그리는 줄 수 */
export const RENDER_STEP = 150
/** 점프·검색으로 안 그린 줄에 갈 때 그 줄 위로 같이 그리는 줄 수 (가운데로 스크롤할 자리) */
export const REVEAL_MARGIN = 20

/** 그리는 범위의 시작. index 는 키를 못 찾을 때(줄이 바뀌어 키가 사라짐) 쓴다 */
export interface WindowStart {
  key: string
  index: number
}

/** 시작 줄의 번호. 아직 정하지 않았으면(null) 최근 RENDER_STEP 줄 */
export function resolveStartIndex<S>(rows: ChatRow<S>[], start: WindowStart | null): number {
  if (!start) return Math.max(0, rows.length - RENDER_STEP)
  const index = rows.findIndex((row) => rowKeyOf(row) === start.key)
  return index >= 0 ? index : Math.max(0, Math.min(start.index, rows.length - 1))
}

/** 이 번호부터 그리는 시작 */
export function windowStartAt<S>(rows: ChatRow<S>[], index: number): WindowStart | null {
  const row = rows[index]
  return row ? { key: rowKeyOf(row), index } : null
}

/** 위로 RENDER_STEP 줄 더 */
export function expandedStartIndex(startIndex: number): number {
  return Math.max(0, startIndex - RENDER_STEP)
}

/** target 줄이 안 그린 범위면 그 줄 위 REVEAL_MARGIN 줄부터 그린다. 이미 그렸으면 그대로 */
export function startIndexRevealing(startIndex: number, targetIndex: number): number {
  return targetIndex >= 0 && targetIndex < startIndex ? Math.max(0, targetIndex - REVEAL_MARGIN) : startIndex
}
