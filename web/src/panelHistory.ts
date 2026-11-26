/**
 * 폰 폭에서 세션 패널을 열면 브라우저 기록을 하나 쌓아 "뒤로 가기"(폰 브라우저·안드로이드 앱 WebView 의 goBack)가 목록으로 돌아가게 한다.
 * 쌓은 기록은 state 로 알아본다. App 이 이 판정대로 pushState·history.back 을 부른다
 */

/** 패널 기록의 history.state */
export const PANEL_STATE = { prayPanel: true } as const

export function isPanelState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { prayPanel?: unknown }).prayPanel === true
}

/**
 * 화면(폰 폭·패널 열림)과 쌓은 기록이 어긋날 때 할 일. 폰 폭에서 패널이 열려 있으면 기록이 하나 있어야 하고, 아니면 없어야 한다.
 * 패널이 열린 채 다른 세션으로 바꾸면 그대로라 더 쌓지 않는다. 데스크톱 폭에서 쌓은 기록이 남아 있으면(폰 → 데스크톱 폭) 되돌린다
 */
export function panelHistoryStep(isNarrow: boolean, hasPanel: boolean, isPushed: boolean): 'push' | 'back' | null {
  const wantsEntry = isNarrow && hasPanel
  if (wantsEntry && !isPushed) return 'push'
  if (!wantsEntry && isPushed) return 'back'
  return null
}

/**
 * popstate 때 패널을 닫을지. 쌓아 둔 기록에서 사람이 뒤로 가 패널 기록을 벗어났을 때만 닫는다.
 * 앱이 스스로 되돌린 뒤의 popstate 는 그 전에 isPushed 를 내려 두므로 아무 일 없다
 */
export function shouldClosePanelOnPop(isPushed: boolean, state: unknown): boolean {
  return isPushed && !isPanelState(state)
}
