/**
 * GET /api/system/hooks — ~/.claude/settings.json 의 Pray 훅 확인 결과 (서버 `server/src/hookInstall.ts` 의 HookStatus).
 * 서버가 시작할 때와 1분마다 빠진 훅을 넣으므로 화면은 넣지 못했을 때(failed)만 상태 표시줄에 경고를 띄운다
 */
export interface HookStatus {
  state: 'ok' | 'installed' | 'failed'
  missing: string[]
  message: string | null
}

/** 응답이 꼴에 맞을 때만 값으로. 옛 서버(경로 없음)·이상한 꼴은 null — 경고를 띄우지 않는다 */
export function parseHookStatus(value: unknown): HookStatus | null {
  if (typeof value !== 'object' || value === null) return null
  const { state, missing, message } = value as Record<string, unknown>
  if (state !== 'ok' && state !== 'installed' && state !== 'failed') return null
  return {
    state,
    missing: Array.isArray(missing) ? missing.filter((item): item is string => typeof item === 'string') : [],
    message: typeof message === 'string' ? message : null,
  }
}

/** 상태 표시줄 경고의 툴팁: 이유 + 안 되는 기능 + 누르면 다시 해 봄 */
export function hookWarningTitle(status: HookStatus): string {
  const reason = status.message ?? "Pray hooks aren't in ~/.claude/settings.json"
  return `${reason}. Without them, status, Stop, cancelling queued messages, approvals and questions don't work. Click to try again`
}
