import { describe, expect, it } from 'vitest'
import { failLeftSending, pruneScheduled, type ScheduledMessage } from '@pray/host/scheduledMessage'
import {
  enterBlocker,
  RECENT_INPUT_MS,
  ScheduledSender,
  SEND_CONFIRM_MS,
  sendDecision,
  type EnterContext,
  type SendContext,
  type SubmitOutcome,
} from './scheduledSend.js'

const at = new Date('2026-11-13T05:00:00.000Z')
const after = (ms: number) => new Date(at.getTime() + ms)

function context(patch: Partial<SendContext> = {}): SendContext {
  return {
    now: after(10_000),
    isHostReachable: true,
    attendance: 'present',
    hookStatus: 'my-turn',
    hasHeldQuestion: false,
    activity: null,
    lastInputAt: null,
    lastDeferReason: null,
    ...patch,
  }
}

const target = { at: at.toISOString() }

describe('sendDecision', () => {
  it.each(['idle', 'my-turn', 'unknown', 'working', 'ended'] as const)('sends to an on-duty session that is %s', (hookStatus) => {
    expect(sendDecision(target, context({ hookStatus }))).toEqual({ kind: 'send' })
  })

  it('sends with no hook state (after a server restart)', () => {
    expect(sendDecision(target, context({ hookStatus: null }))).toEqual({ kind: 'send' })
  })

  it.each([
    [{ hookStatus: 'needs-approval' as const }, 'needs-approval'],
    [{ hasHeldQuestion: true }, 'question'],
    [{ activity: 'handover' as const }, 'handover'],
    [{ activity: 'unqueue' as const }, 'unqueue'],
    [{ activity: 'interrupt' as const }, 'interrupt'],
    [{ activity: 'btw' as const }, 'btw'],
    [{ activity: 'approval' as const }, 'approval'],
    [{ lastInputAt: after(10_000).getTime() - RECENT_INPUT_MS + 1 }, 'recent-input'],
    [{ attendance: 'break' as const }, 'break'],
    [{ isHostReachable: false }, 'host-unreachable'],
    [{ isHostReachable: false, attendance: 'break' as const }, 'host-unreachable'],
  ])('defers when %o', (patch, reason) => {
    expect(sendDecision(target, context(patch))).toEqual({ kind: 'defer', reason })
  })

  it('sends once the last input is 2 seconds old', () => {
    expect(sendDecision(target, context({ lastInputAt: after(10_000).getTime() - RECENT_INPUT_MS }))).toEqual({ kind: 'send' })
  })

  it('fails off duty and missing sessions right away, even with the host down', () => {
    expect(sendDecision(target, context({ attendance: 'off' }))).toEqual({ kind: 'fail', failure: { code: 'off-duty' } })
    expect(sendDecision(target, context({ attendance: 'missing', isHostReachable: false }))).toEqual({ kind: 'fail', failure: { code: 'not-found' } })
  })

  it('sends late up to 60 minutes after at, then fails as missed or blocked', () => {
    const edge = after(60 * 60 * 1000)
    expect(sendDecision(target, context({ now: edge }))).toEqual({ kind: 'send' })
    const past = after(60 * 60 * 1000 + 1)
    expect(sendDecision(target, context({ now: past }))).toEqual({ kind: 'fail', failure: { code: 'missed' } })
    expect(sendDecision(target, context({ now: past, hookStatus: 'needs-approval', lastDeferReason: 'question' }))).toEqual({
      kind: 'fail',
      failure: { code: 'blocked', detail: 'needs-approval' },
    })
    // 마지막 회차에는 풀렸어도 한도를 넘었으면 앞 회차의 이유로 실패
    expect(sendDecision(target, context({ now: past, lastDeferReason: 'break' }))).toEqual({ kind: 'fail', failure: { code: 'blocked', detail: 'break' } })
  })
})

describe('enterBlocker', () => {
  const ok: EnterContext = { isHostReachable: true, isOnHost: true, hookStatus: 'working', hasHeldQuestion: false }
  it('lets Enter through unless an approval or question showed up or the session is gone', () => {
    expect(enterBlocker(ok)).toBeNull()
    expect(enterBlocker({ ...ok, hookStatus: 'needs-approval' })).toBe('needs-approval')
    expect(enterBlocker({ ...ok, hasHeldQuestion: true })).toBe('question')
    expect(enterBlocker({ ...ok, isOnHost: false })).toBe('session-ended')
    expect(enterBlocker({ ...ok, isHostReachable: false })).toBe('host-unreachable')
  })
})

/** 메모리 hq·가짜 시계로 ScheduledSender 를 돌린다 */
function harness(initial: Partial<ScheduledMessage>[], contextPatch: Partial<SendContext> = {}) {
  let clock = after(0).getTime()
  let messages: ScheduledMessage[] = initial.map((patch, index) => ({
    id: `m${index + 1}`,
    sessionId: 's1',
    text: `글 ${index + 1}`,
    at: at.toISOString(),
    createdAt: after(-60_000).toISOString(),
    createdBy: { kind: 'user' },
    status: 'pending',
    sendingAt: null,
    sentAt: null,
    failedAt: null,
    failure: null,
    acknowledgedAt: null,
    ...patch,
  }))
  const state = {
    context: { ...context(), ...contextPatch } as Omit<SendContext, 'now' | 'lastDeferReason'>,
    enter: { isHostReachable: true, isOnHost: true, hookStatus: 'my-turn', hasHeldQuestion: false } as EnterContext,
    /** 글을 쓴 뒤 UserPromptSubmit 이 올지 (null 이면 안 온다) */
    promptDelayMs: 500 as number | null,
    submitOutcome: null as SubmitOutcome | null,
    lastPromptAt: null as string | null,
    submitted: [] as { sessionId: string; text: string; blockedBy: string | null }[],
    changes: 0,
    logs: [] as string[],
  }
  const sender = new ScheduledSender({
    now: () => new Date(clock),
    sleep: async (ms) => {
      clock += ms
    },
    tidy: (now, isStartup) => {
      const pruned = pruneScheduled(messages, now)
      const left = isStartup ? failLeftSending(pruned.messages, now) : { messages: pruned.messages, failed: [] }
      messages = left.messages
      return { messages, prunedCount: pruned.prunedCount, interrupted: left.failed }
    },
    update: (id, change) => {
      const index = messages.findIndex((m) => m.id === id)
      if (index < 0) return null
      const next = change(messages[index])
      if (!next) return null
      messages = messages.map((m, i) => (i === index ? next : m))
      return next
    },
    contextOf: () => state.context,
    submit: async (sessionId, text, shouldBlockEnter) => {
      // 글을 쓰고 Enter 까지 1초 (submitText 의 조용함 기다리기 흉내)
      clock += 1000
      const blockedBy = shouldBlockEnter()
      state.submitted.push({ sessionId, text, blockedBy })
      if (state.submitOutcome) return state.submitOutcome
      if (blockedBy) return { kind: 'blocked', reason: blockedBy }
      if (state.promptDelayMs !== null) state.lastPromptAt = new Date(clock + state.promptDelayMs).toISOString()
      return { kind: 'entered' }
    },
    enterContextOf: () => state.enter,
    lastPromptAt: () => (state.lastPromptAt !== null && Date.parse(state.lastPromptAt) <= clock ? state.lastPromptAt : null),
    onChange: () => {
      state.changes++
    },
    log: (line) => state.logs.push(line),
    logError: (line) => state.logs.push(`ERROR ${line}`),
  })
  return {
    sender,
    state,
    messages: () => messages,
    setClock: (date: Date) => {
      clock = date.getTime()
    },
    tick: async (isStartup = false) => {
      await Promise.all(sender.tick(isStartup))
    },
  }
}

describe('ScheduledSender', () => {
  it('sends a due message, confirms it by the prompt hook and is not typing afterwards', async () => {
    const h = harness([{}])
    h.setClock(after(20_000))
    const started = h.sender.tick()
    expect(h.sender.isTyping('s1')).toBe(true)
    expect(h.messages()[0].status).toBe('sending')
    await Promise.all(started)
    expect(h.state.submitted).toEqual([{ sessionId: 's1', text: '글 1', blockedBy: null }])
    expect(h.messages()[0]).toMatchObject({ status: 'sent', sentAt: after(21_000).toISOString(), isLate: false })
    expect(h.sender.isTyping('s1')).toBe(false)
  })

  it('does not send before at', async () => {
    const h = harness([{}])
    h.setClock(after(-1))
    await h.tick()
    expect(h.state.submitted).toEqual([])
    expect(h.messages()[0].status).toBe('pending')
  })

  it('marks a message sent more than 90 seconds late as late (server was off)', async () => {
    const h = harness([{}])
    h.setClock(after(30 * 60 * 1000))
    await h.tick(true)
    expect(h.messages()[0]).toMatchObject({ status: 'sent', isLate: true })
  })

  it('fails as missed on startup when 60 minutes have passed, and as interrupted when it was being sent', async () => {
    const h = harness([{ sessionId: 's1' }, { sessionId: 's2', status: 'sending', sendingAt: after(-1000).toISOString() }])
    h.setClock(after(61 * 60 * 1000))
    await h.tick(true)
    expect(h.state.submitted).toEqual([])
    expect(h.messages().map((m) => [m.id, m.status, m.failure?.code])).toEqual([
      ['m1', 'failed', 'missed'],
      ['m2', 'failed', 'interrupted'],
    ])
  })

  it('fails as unconfirmed when no prompt hook comes within 15 seconds', async () => {
    const h = harness([{}])
    h.state.promptDelayMs = null
    h.setClock(after(1000))
    await h.tick()
    expect(h.messages()[0]).toMatchObject({ status: 'failed', failure: { code: 'unconfirmed' } })
    // 늦은 훅(16초 뒤)도 실패 그대로
    const lateHook = harness([{}])
    lateHook.state.promptDelayMs = SEND_CONFIRM_MS + 1000
    lateHook.setClock(after(1000))
    await lateHook.tick()
    expect(lateHook.messages()[0].failure?.code).toBe('unconfirmed')
  })

  it('does not count a prompt from before the text was written', async () => {
    const h = harness([{}])
    h.state.promptDelayMs = null
    h.state.lastPromptAt = after(0).toISOString()
    h.setClock(after(1000))
    await h.tick()
    expect(h.messages()[0].failure?.code).toBe('unconfirmed')
  })

  it('does not press Enter when an approval shows up mid-send', async () => {
    const h = harness([{}], { hookStatus: 'working' })
    h.state.enter = { ...h.state.enter, hookStatus: 'needs-approval' }
    h.setClock(after(1000))
    await h.tick()
    expect(h.state.submitted[0].blockedBy).toBe('needs-approval')
    expect(h.messages()[0]).toMatchObject({ status: 'failed', failure: { code: 'blocked-mid-send', detail: 'needs-approval' } })
  })

  it('goes back to pending when the text could not be written', async () => {
    const h = harness([{}])
    h.state.submitOutcome = { kind: 'not-written' }
    h.setClock(after(1000))
    await h.tick()
    expect(h.messages()[0]).toMatchObject({ status: 'pending', sendingAt: null })
  })

  it('defers while blocked, sends when it clears, and fails as blocked after 60 minutes', async () => {
    const h = harness([{}, { sessionId: 's2' }], { hookStatus: 'needs-approval' })
    h.setClock(after(1000))
    await h.tick()
    expect(h.messages().map((m) => m.status)).toEqual(['pending', 'pending'])
    h.state.context = { ...h.state.context, hookStatus: 'my-turn' }
    h.setClock(after(31_000))
    await h.tick()
    expect(h.messages().map((m) => m.status)).toEqual(['sent', 'sent'])

    const stuck = harness([{}], { hookStatus: 'needs-approval' })
    stuck.setClock(after(1000))
    await stuck.tick()
    stuck.setClock(after(60 * 60 * 1000 + 1))
    await stuck.tick()
    expect(stuck.messages()[0]).toMatchObject({ status: 'failed', failure: { code: 'blocked', detail: 'needs-approval' } })
  })

  it('fails right away for an off duty session without typing', async () => {
    const h = harness([{}], { attendance: 'off' })
    h.setClock(after(1000))
    await h.tick()
    expect(h.state.submitted).toEqual([])
    expect(h.messages()[0].failure).toEqual({ code: 'off-duty' })
  })

  it('sends one message per session per tick, in at order', async () => {
    const h = harness([{ id: 'late', at: after(5000).toISOString() }, { id: 'early', at: after(0).toISOString() }])
    h.setClock(after(10_000))
    await h.tick()
    expect(h.state.submitted.map((s) => s.text)).toEqual(['글 2'])
    h.setClock(after(40_000))
    await h.tick()
    expect(h.state.submitted.map((s) => s.text)).toEqual(['글 2', '글 1'])
  })

  it('does not throw when the store fails and logs only the change to failing', async () => {
    const h = harness([{}])
    const failing = new ScheduledSender({
      ...(h.sender as unknown as { deps: ConstructorParameters<typeof ScheduledSender>[0] }).deps,
      tidy: () => {
        throw new Error('hq.json 을 읽을 수 없어')
      },
    })
    expect(failing.tick()).toEqual([])
    expect(failing.tick()).toEqual([])
    expect(h.state.logs.filter((line) => line.startsWith('ERROR'))).toHaveLength(1)
  })
})
