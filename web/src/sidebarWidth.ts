import { MIN_OFFICE_WIDTH, MIN_PANEL_WIDTH } from './panelWidth'

/**
 * 왼쪽 사이드바(목록) 폭. 사용자가 사이드바 오른쪽 가장자리를 끌어 바꾸고 localStorage 에 남긴다.
 * App.tsx 가 창 폭으로 줄인 값을 `<html>` 의 `--sidebar-width` 로 건다 — 3열 grid 와 트레이 창 제목 띠 버튼 자리가 같이 본다.
 */

/** 저장값이 없을 때의 폭 (예전 고정 폭) */
export const DEFAULT_SIDEBAR_WIDTH = 300
export const MIN_SIDEBAR_WIDTH = 260
export const MAX_SIDEBAR_WIDTH = 480

/**
 * 창이 좁을 때 사이드바 말고 남겨 둘 폭: 사무실이 보이면 사무실 + 패널 최소 폭, 숨기면 패널(또는 첫 화면) 최소 폭.
 * 사무실이 보일 때는 패널이 닫혀 있어도 패널 자리까지 남긴다 — 세션을 고를 때마다 사이드바 폭이 바뀌지 않게
 */
export function reservedWidth(isOfficeHidden: boolean): number {
  return isOfficeHidden ? MIN_PANEL_WIDTH : MIN_OFFICE_WIDTH + MIN_PANEL_WIDTH
}

/** 260~480 안에서, layoutWidth(목록·사무실·패널 전체 폭)에 남길 자리를 남긴다. 너무 좁으면 최소 폭이 이긴다 */
export function clampSidebarWidth(width: number, layoutWidth: number, isOfficeHidden: boolean): number {
  const max = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, layoutWidth - reservedWidth(isOfficeHidden)))
  return Math.round(Math.min(max, Math.max(MIN_SIDEBAR_WIDTH, width)))
}

/** 저장된 글을 폭으로. 없거나 숫자가 아니면 기본 폭, 범위 밖이면 범위 안으로 */
export function parseSidebarWidth(stored: string | null): number {
  if (stored === null || stored.trim() === '') return DEFAULT_SIDEBAR_WIDTH
  const width = Number(stored)
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)))
}
