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

/**
 * 웹에서 질문을 거절(취소·대화로 답하기 = deny)한 직후의 상태. deny 에는 PostToolUse 가 오지 않아 Stop 까지 몇 초 동안
 * needs-approval 로 남으므로 서버가 바로 working 으로 돌린다. 같은 차례라 workingSince 는 잇고, 다음 훅이 오면 평소대로 바뀐다.
 * 승인 대기가 아니면(이미 다른 훅이 왔거나 훅을 못 받았으면) 그대로 둔다
 */
export function applyQuestionDenied(previous: HookState | undefined, now: Date = new Date()): HookState | undefined {
  if (previous?.status !== 'needs-approval') return previous
  return { ...previous, status: 'working', pendingTool: null, updatedAt: now.toISOString() }
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
