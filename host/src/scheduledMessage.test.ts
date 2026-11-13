import { describe, expect, it } from 'vitest'
import {
  dueMessages,
  failLeftSending,
  markBackToPending,
  markFailed,
  markSending,
  markSent,
  parseScheduledText,
  pruneScheduled,
  SCHEDULED_RETENTION_MS,
  SCHEDULED_SEND_WINDOW_MS,
  sendDeadline,
  type ScheduledMessage,
} from './scheduledMessage.js'

const now = new Date('2026-11-13T05:00:00.000Z')
const later = (ms: number) => new Date(now.getTime() + ms)

function message(patch: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    text: '안녕',
    at: now.toISOString(),
    createdAt: now.toISOString(),
    createdBy: { kind: 'user' },
    status: 'pending',
    sendingAt: null,
    sentAt: null,
    failedAt: null,
    failure: null,
    acknowledgedAt: null,
    ...patch,
  }
}

describe('parseScheduledText', () => {
  it('keeps line breaks, turns CR into LF and trims', () => {
    expect(parseScheduledText('  첫 줄\r\n둘째 줄\r셋째  ')).toEqual({ text: '첫 줄\n둘째 줄\n셋째' })
  })

  it('takes 1 to 10,000 characters', () => {
    expect(parseScheduledText('a'.repeat(10_000))).toEqual({ text: 'a'.repeat(10_000) })
    expect(parseScheduledText('a'.repeat(10_001))).toEqual({ error: 'length' })
    expect(parseScheduledText('   \n ')).toEqual({ error: 'length' })
    expect(parseScheduledText(3)).toEqual({ error: 'length' })
    expect(parseScheduledText(undefined)).toEqual({ error: 'length' })
  })

  it('refuses a slash command and a trailing backslash', () => {
    expect(parseScheduledText(' /compact')).toEqual({ error: 'slash' })
    expect(parseScheduledText('끝이 \\')).toEqual({ error: 'backslash' })
    expect(parseScheduledText('가운데 / 와 \\ 는 괜찮다')).toEqual({ text: '가운데 / 와 \\ 는 괜찮다' })
  })
})

describe('dueMessages', () => {
  it('takes the earliest due pending message per session, by at then createdAt', () => {
    const messages = [
      message({ id: 'b', at: later(-1000).toISOString(), createdAt: later(-5000).toISOString() }),
      message({ id: 'a', at: later(-1000).toISOString(), createdAt: later(-9000).toISOString() }),
      message({ id: 'c', at: later(-9000).toISOString(), sessionId: 's2' }),
      message({ id: 'd', at: later(60_000).toISOString(), sessionId: 's3' }),
      message({ id: 'e', at: later(-9000).toISOString(), sessionId: 's4', status: 'sent' }),
    ]
    expect(dueMessages(messages, now).map((m) => m.id)).toEqual(['c', 'a'])
  })

  it('waits behind an earlier pending message of the same session even if it is not due', () => {
    // 같은 at·createdAt 이면 넣은 순서
    const messages = [message({ id: 'x' }), message({ id: 'y' })]
    expect(dueMessages(messages, now).map((m) => m.id)).toEqual(['x'])
  })

  it('skips a session that has a message being sent', () => {
    const messages = [message({ id: 'a', status: 'sending' }), message({ id: 'b' }), message({ id: 'c', sessionId: 's2' })]
    expect(dueMessages(messages, now).map((m) => m.id)).toEqual(['c'])
  })
})

describe('pruneScheduled', () => {
  it('drops sent messages 7 days after sending and failed ones 7 days after acknowledging', () => {
    const old = later(-SCHEDULED_RETENTION_MS - 1).toISOString()
    const edge = later(-SCHEDULED_RETENTION_MS).toISOString()
    const messages = [
      message({ id: 'sent-old', status: 'sent', sentAt: old }),
      message({ id: 'sent-edge', status: 'sent', sentAt: edge }),
      message({ id: 'failed-ack-old', status: 'failed', failedAt: old, acknowledgedAt: old }),
      message({ id: 'failed-unack', status: 'failed', failedAt: old }),
      message({ id: 'pending-old', at: old }),
    ]
    const result = pruneScheduled(messages, now)
    expect(result.messages.map((m) => m.id)).toEqual(['sent-edge', 'failed-unack', 'pending-old'])
    expect(result.prunedCount).toBe(2)
    expect(messages).toHaveLength(5)
  })
})

describe('status changes', () => {
  it('fails messages left sending as interrupted', () => {
    const messages = [message({ id: 'a', status: 'sending', sendingAt: now.toISOString() }), message({ id: 'b' })]
    const result = failLeftSending(messages, later(1000))
    expect(result.failed.map((m) => [m.id, m.status, m.failure])).toEqual([['a', 'failed', { code: 'interrupted' }]])
    expect(result.messages.map((m) => m.status)).toEqual(['failed', 'pending'])
    expect(messages[0].status).toBe('sending')
  })

  it('marks sending, back to pending, sent with isLate over 90 seconds, failed', () => {
    const sending = markSending(message({}), later(10_000))
    expect(sending).toMatchObject({ status: 'sending', sendingAt: later(10_000).toISOString() })
    expect(markBackToPending(sending)).toMatchObject({ status: 'pending', sendingAt: null })
    expect(markSent(sending, later(90_000))).toMatchObject({ status: 'sent', sentAt: later(90_000).toISOString(), isLate: false })
    expect(markSent(sending, later(90_001)).isLate).toBe(true)
    expect(markFailed(sending, { code: 'blocked', detail: 'needs-approval' }, later(1))).toMatchObject({
      status: 'failed',
      failedAt: later(1).toISOString(),
      failure: { code: 'blocked', detail: 'needs-approval' },
    })
  })

  it('allows deferring or sending late until 60 minutes after at', () => {
    expect(sendDeadline(message({}))).toBe(now.getTime() + SCHEDULED_SEND_WINDOW_MS)
  })
})
