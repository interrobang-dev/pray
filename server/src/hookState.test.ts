import { describe, expect, it } from 'vitest'
import { applyHook } from './hookState.js'

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
