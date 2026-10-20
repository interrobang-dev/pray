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
  }
}
