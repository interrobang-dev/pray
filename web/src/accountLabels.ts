import { formatDateTime, type Account } from './types'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** 남은 날이 이 이하로 보이면 노랑 */
const WARN_DAYS = 3

/** 요금제 표시 "max" → "Max", "max 5x" → "Max 5x" */
export function planLabel(plan: string): string {
  return `${plan[0].toUpperCase()}${plan.slice(1)}`
}

/** 계정 줄의 이름: 이메일, 없으면 표시 이름 */
export function accountName(account: Account): string {
  return account.email ?? account.displayName ?? 'Unknown account'
}

/** 계정 줄 이름의 툴팁: 이메일·표시 이름·조직과 저장한 시각 */
export function accountTitle(account: Account): string {
  const savedAt = Number.isNaN(Date.parse(account.savedAt)) ? null : `Saved ${formatDateTime(account.savedAt)}`
  return [account.email, account.displayName, account.organizationName, savedAt].filter(Boolean).join('\n')
}

/**
 * 코드 확인(`POST /api/accounts/login/:loginId/code`)이 실패한 뒤 로그인이 끝났는지 — true 면 입력칸 대신 [Start again].
 * 404 = 로그인이 없음(만료 등), 500 = 서버가 로그인을 끝냄(30초 시간 초과·저장 실패), 400 은 `isLoginEnded: true`(claude 가 코드를 거절해 끝남)일 때만.
 * 400 에 필드가 없거나 false 면(서버가 먼저 거름) 로그인은 살아 있어 다시 넣는다. 409(확인 중)·네트워크 오류(0)도 살아 있는 것으로 본다
 */
export function isLoginOver(status: number, body: unknown): boolean {
  if (status === 404 || status === 500) return true
  return status === 400 && (body as { isLoginEnded?: unknown } | null)?.isLoginEnded === true
}

export interface ReloginLabel {
  text: string
  /** '' = 보통(회색), warn = 남은 날 3일 이하(노랑), danger = 지남(빨강) */
  level: '' | 'warn' | 'danger'
  /** 툴팁: 만료 시각 (이 PC 시각) */
  title: string
}

/**
 * 재로그인까지 "Re-login in 12d" (하루 미만이면 "Re-login in 5h"·"Re-login in 20m"), 지났으면 "Expired".
 * 보이는 날 수가 3 이하면 노랑. 만료 시각을 모르거나 날짜가 아니면 null (표시 없음)
 */
export function reloginLabel(refreshExpiresAt: string | null, now: number): ReloginLabel | null {
  if (!refreshExpiresAt) return null
  const expiresAt = Date.parse(refreshExpiresAt)
  if (Number.isNaN(expiresAt)) return null
  const remaining = expiresAt - now
  if (remaining <= 0) return { text: 'Expired', level: 'danger', title: `Sign-in expired ${formatDateTime(refreshExpiresAt)}` }
  const title = `Sign-in expires ${formatDateTime(refreshExpiresAt)}`
  const days = Math.floor(remaining / DAY_MS)
  if (days >= 1) return { text: `Re-login in ${days}d`, level: days <= WARN_DAYS ? 'warn' : '', title }
  const hours = Math.floor(remaining / HOUR_MS)
  if (hours >= 1) return { text: `Re-login in ${hours}h`, level: 'warn', title }
  return { text: `Re-login in ${Math.max(1, Math.floor(remaining / MINUTE_MS))}m`, level: 'warn', title }
}
