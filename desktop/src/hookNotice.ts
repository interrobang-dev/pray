/**
 * Pray 훅을 settings.json 에 못 넣었을 때의 트레이 알림·메뉴 줄 (판정과 글자). Electron 을 쓰지 않는 순수 함수.
 * 서버가 시작할 때와 1분마다 빠진 훅을 넣으므로(`server/src/hookInstall.ts`) 트레이는 서버가 넣지 못한(failed) 때만 알린다
 */
import type { ToastContent } from './toast'

/** `GET /api/system/hooks` 를 보고 정한 경고 글. 문제가 없거나 꼴을 모르면(옛 서버의 404 포함) null */
export function hookWarningOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const { state, message } = value as Record<string, unknown>
  if (state !== 'failed') return null
  return typeof message === 'string' && message ? message : "Pray hooks aren't in ~/.claude/settings.json"
}

/** 새로 알릴지: 경고가 생겼거나 글이 바뀌었을 때만 (1분마다 같은 실패를 다시 띄우지 않게) */
export function shouldNotifyHookWarning(previous: string | null, next: string | null): boolean {
  return next !== null && next !== previous
}

/** 트레이 메뉴 맨 위 줄 (누르면 다시 넣어 본다) */
export const HOOK_MENU_LABEL = '⚠ Pray hooks missing · Try again'

export function hookWarningToast(message: string): ToastContent {
  return {
    title: 'Pray hooks missing',
    body: `${message}. Status, Stop, queued-message cancel and approvals won't work until they're added.`,
    attribution: '',
    iconUrl: null,
  }
}
