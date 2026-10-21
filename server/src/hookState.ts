import type { SessionStatus } from './types.js'

export interface HookPayload {
  session_id: string
  cwd: string
  hook_event_name: string
  tool_name?: string
  last_assistant_message?: string
}

export interface HookState {
  status: SessionStatus
  cwd: string
  lastAssistantText: string | null
  pendingTool: string | null
  updatedAt: string
  /** 이번 차례(UserPromptSubmit)를 시작한 시각. updatedAt 은 도구를 쓸 때마다 바뀌어 이걸 따로 둔다. 시작을 못 봤으면 null */
  workingSince: string | null
}

const statusByEvent: Record<string, SessionStatus> = {
  SessionStart: 'idle',
  UserPromptSubmit: 'working',
  PermissionRequest: 'needs-approval',
  PostToolUse: 'working',
  Stop: 'my-turn',
  SessionEnd: 'ended',
}

export function applyHook(
  previous: HookState | undefined,
  payload: HookPayload,
  now: Date = new Date(),
): HookState | undefined {
  const status = statusByEvent[payload.hook_event_name]
  if (!status) return previous
  // 도구 사용·승인 대기는 같은 차례라 시작 시각을 잇는다. 이전 값이 없으면(서버 재시작 직후 등) 지어내지 않고 null
  const isSameTurn = payload.hook_event_name === 'PostToolUse' || payload.hook_event_name === 'PermissionRequest'
  return {
    status,
    cwd: payload.cwd,
    lastAssistantText:
      payload.hook_event_name === 'Stop'
        ? payload.last_assistant_message ?? null
        : previous?.lastAssistantText ?? null,
    pendingTool:
      payload.hook_event_name === 'PermissionRequest'
        ? payload.tool_name ?? null
        : null,
    updatedAt: now.toISOString(),
    workingSince:
      payload.hook_event_name === 'UserPromptSubmit'
        ? now.toISOString()
        : isSameTurn
          ? previous?.workingSince ?? null
          : null,
  }
}
