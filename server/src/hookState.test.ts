import { describe, expect, it } from 'vitest'
import { applyHook, applyInterrupted, applyQuestionDenied } from './hookState.js'

const base = { session_id: 's1', cwd: 'D:/x' }
const now = new Date('2026-10-20T00:00:00Z')

describe('applyHook', () => {
  it('maps events to status', () => {
    expect(applyHook(undefined, { ...base, hook_event_name: 'UserPromptSubmit' }, now)?.status).toBe('working')
    expect(applyHook(undefined, { ...base, hook_event_name: 'Stop' }, now)?.status).toBe('my-turn')
    expect(applyHook(undefined, { ...base, hook_event_name: 'SessionEnd' }, now)?.status).toBe('ended')
  })

  it('keeps pending tool only while approval is needed', () => {
    const waiting = applyHook(undefined, { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, now)
    expect(waiting).toMatchObject({ status: 'needs-approval', pendingTool: 'Bash' })
    const resumed = applyHook(waiting, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, now)
    expect(resumed).toMatchObject({ status: 'working', pendingTool: null })
  })

  it('stores last assistant message on Stop and keeps it afterwards', () => {
    const stopped = applyHook(undefined, { ...base, hook_event_name: 'Stop', last_assistant_message: '끝' }, now)
    const working = applyHook(stopped, { ...base, hook_event_name: 'UserPromptSubmit' }, now)
    expect(working?.lastAssistantText).toBe('끝')
  })

  it('ignores unknown events', () => {
    const previous = applyHook(undefined, { ...base, hook_event_name: 'Stop' }, now)
    expect(applyHook(previous, { ...base, hook_event_name: 'PreCompact' }, now)).toBe(previous)
  })
})

describe('applyHook workingSince', () => {
  const at = (iso: string) => new Date(iso)

  it('starts on UserPromptSubmit and keeps it through tool use and approval in the same turn', () => {
    const started = applyHook(undefined, { ...base, hook_event_name: 'UserPromptSubmit' }, at('2026-10-21T00:00:00Z'))
    const tooled = applyHook(started, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, at('2026-10-21T00:00:30Z'))
    const asking = applyHook(tooled, { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, at('2026-10-21T00:01:00Z'))
    const resumed = applyHook(asking, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, at('2026-10-21T00:01:30Z'))
    expect([started, tooled, asking, resumed].map((s) => s?.workingSince)).toEqual(Array(4).fill('2026-10-21T00:00:00.000Z'))
    expect(resumed?.updatedAt).toBe('2026-10-21T00:01:30.000Z')
  })

  it('clears on Stop, SessionEnd and SessionStart', () => {
    const started = applyHook(undefined, { ...base, hook_event_name: 'UserPromptSubmit' }, now)
    for (const event of ['Stop', 'SessionEnd', 'SessionStart']) {
      expect(applyHook(started, { ...base, hook_event_name: event }, now)?.workingSince).toBeNull()
    }
  })

  it('does not invent a start when the turn began before the server saw it', () => {
    expect(applyHook(undefined, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, now)?.workingSince).toBeNull()
    const stopped = applyHook(undefined, { ...base, hook_event_name: 'Stop' }, now)
    expect(applyHook(stopped, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, now)?.workingSince).toBeNull()
  })

  it('restarts on the next UserPromptSubmit', () => {
    const first = applyHook(undefined, { ...base, hook_event_name: 'UserPromptSubmit' }, at('2026-10-21T00:00:00Z'))
    const second = applyHook(first, { ...base, hook_event_name: 'UserPromptSubmit' }, at('2026-10-21T00:05:00Z'))
    expect(second?.workingSince).toBe('2026-10-21T00:05:00.000Z')
  })
})

describe('applyQuestionDenied', () => {
  const at = (iso: string) => new Date(iso)
  /** 앞 차례가 끝나고 새 차례에서 질문을 띄운 상태 */
  const asking = () => {
    const stopped = applyHook(undefined, { ...base, hook_event_name: 'Stop', last_assistant_message: '앞 차례' }, now)
    const started = applyHook(stopped, { ...base, hook_event_name: 'UserPromptSubmit' }, at('2026-10-21T00:00:00Z'))
    return applyHook(started, { ...base, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' }, at('2026-10-21T00:00:10Z'))
  }

  it('turns a waiting question into working in the same turn, clearing the pending tool', () => {
    const denied = applyQuestionDenied(asking(), at('2026-10-21T00:00:20Z'))
    expect(denied).toEqual({
      status: 'working',
      cwd: 'D:/x',
      lastAssistantText: '앞 차례',
      pendingTool: null,
      updatedAt: '2026-10-21T00:00:20.000Z',
      workingSince: '2026-10-21T00:00:00.000Z',
    })
  })

  it('lets the next hook change it as usual', () => {
    const denied = applyQuestionDenied(asking(), at('2026-10-21T00:00:20Z'))
    const stopped = applyHook(denied, { ...base, hook_event_name: 'Stop', last_assistant_message: '취소됨' }, at('2026-10-21T00:00:25Z'))
    expect(stopped).toMatchObject({ status: 'my-turn', pendingTool: null, workingSince: null, lastAssistantText: '취소됨' })
  })

  it('leaves other states and unknown sessions alone', () => {
    const stopped = applyHook(undefined, { ...base, hook_event_name: 'Stop' }, now)
    expect(applyQuestionDenied(stopped, now)).toBe(stopped)
    expect(applyQuestionDenied(undefined, now)).toBeUndefined()
  })
})

describe('applyInterrupted', () => {
  const at = (iso: string) => new Date(iso)
  /** 앞 차례가 끝나고 새 차례에서 도구를 쓰는 중 */
  const working = () => {
    const stopped = applyHook(undefined, { ...base, hook_event_name: 'Stop', last_assistant_message: '앞 차례' }, now)
    const started = applyHook(stopped, { ...base, hook_event_name: 'UserPromptSubmit' }, at('2026-10-21T00:00:00Z'))
    return applyHook(started, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, at('2026-10-21T00:00:10Z'))
  }
  const turnStartedAt = '2026-10-21T00:00:00.000Z'

  it('turns the interrupted turn into my-turn, keeping the last words of the previous turn', () => {
    expect(applyInterrupted(working(), turnStartedAt, at('2026-10-21T00:00:20Z'))).toEqual({
      status: 'my-turn',
      cwd: 'D:/x',
      lastAssistantText: '앞 차례',
      pendingTool: null,
      updatedAt: '2026-10-21T00:00:20.000Z',
      workingSince: null,
    })
  })

  it('leaves it alone when another turn started or a hook already changed it', () => {
    const next = applyHook(working(), { ...base, hook_event_name: 'UserPromptSubmit' }, at('2026-10-21T00:00:15Z'))
    expect(applyInterrupted(next, turnStartedAt, now)).toBe(next)
    const stopped = applyHook(working(), { ...base, hook_event_name: 'Stop' }, at('2026-10-21T00:00:15Z'))
    expect(applyInterrupted(stopped, turnStartedAt, now)).toBe(stopped)
    expect(applyInterrupted(undefined, null, now)).toBeUndefined()
  })

  it('matches a turn whose start was not seen (server restarted mid-turn)', () => {
    const resumed = applyHook(undefined, { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash' }, now)
    expect(applyInterrupted(resumed, null, now)?.status).toBe('my-turn')
  })
})
