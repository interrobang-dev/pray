import { describe, expect, it } from 'vitest'
import {
  applyScheduled,
  failureText,
  removeScheduled,
  scheduleBlockReason,
  scheduledBandText,
  scheduledFailureMessage,
  scheduledNotice,
  scheduledOf,
  scheduledSections,
  targetLabel,
  unacknowledgedFailureCount,
} from './scheduledMessages'
import type { Office, ScheduledMessage, Session } from './types'

function message(id: string, patch: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id,
    sessionId: 's1',
    text: id,
    at: '2026-11-12T06:00:00.000Z',
    createdAt: '2026-11-12T00:00:00.000Z',
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

/** 이 PC 시각 (어느 시간대에서 돌아도 같은 결과) */
function local(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}
function localIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(local(year, month, day, hour, minute)).toISOString()
}

describe('scheduledOf', () => {
  it('옛 서버 응답은 []', () => {
    expect(scheduledOf({ groups: [], teams: [] } as Office)).toEqual([])
  })
})

describe('scheduledSections', () => {
  it('실패(확인 전, 최근순)·대기(이른 순, sending 포함)·보냄(최근순)으로 나누고 확인한 실패는 뺀다', () => {
    const messages = [
      message('late', { at: '2026-11-12T08:00:00.000Z' }),
      message('early', { at: '2026-11-12T07:00:00.000Z', status: 'sending' }),
      message('f-old', { status: 'failed', failedAt: '2026-11-12T01:00:00.000Z', failure: { code: 'missed' } }),
      message('f-new', { status: 'failed', failedAt: '2026-11-12T02:00:00.000Z', failure: { code: 'off-duty' } }),
      message('f-seen', { status: 'failed', failedAt: '2026-11-12T03:00:00.000Z', failure: { code: 'missed' }, acknowledgedAt: '2026-11-12T04:00:00.000Z' }),
      message('s-old', { status: 'sent', sentAt: '2026-11-12T01:00:00.000Z' }),
      message('s-new', { status: 'sent', sentAt: '2026-11-12T05:00:00.000Z' }),
    ]
    const sections = scheduledSections(messages)
    expect(sections.failed.map((m) => m.id)).toEqual(['f-new', 'f-old'])
    expect(sections.upcoming.map((m) => m.id)).toEqual(['early', 'late'])
    expect(sections.sent.map((m) => m.id)).toEqual(['s-new', 's-old'])
  })

  it('같은 at 이면 먼저 만든 것이 앞', () => {
    const messages = [message('b', { createdAt: '2026-11-12T00:00:02.000Z' }), message('a', { createdAt: '2026-11-12T00:00:01.000Z' })]
    expect(scheduledSections(messages).upcoming.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('unacknowledgedFailureCount', () => {
  it('확인하지 않은 실패만 센다', () => {
    const messages = [
      message('p'),
      message('f', { status: 'failed', failure: { code: 'missed' } }),
      message('seen', { status: 'failed', failure: { code: 'missed' }, acknowledgedAt: '2026-11-12T04:00:00.000Z' }),
      message('s', { status: 'sent' }),
    ]
    expect(unacknowledgedFailureCount(messages)).toBe(1)
  })
})

describe('scheduledBandText', () => {
  const now = local(2026, 11, 12, 10, 0)
  it('그 세션의 대기만, 가장 이른 시각으로', () => {
    const messages = [
      message('a', { at: localIso(2026, 11, 13, 9, 0) }),
      message('b', { at: localIso(2026, 11, 12, 15, 30) }),
      message('other', { sessionId: 's2', at: localIso(2026, 11, 12, 11, 0) }),
      message('sent', { status: 'sent', at: localIso(2026, 11, 12, 9, 0) }),
    ]
    expect(scheduledBandText(messages, 's1', now)).toBe('2 scheduled · Today 15:30')
    expect(scheduledBandText(messages, 's2', now)).toBe('1 scheduled · Today 11:00')
  })
  it('대기가 없으면 null', () => {
    expect(scheduledBandText([message('f', { status: 'failed' })], 's1', now)).toBeNull()
  })
  it('가장 이른 것이 보내는 중이면 Sending now', () => {
    expect(scheduledBandText([message('a', { status: 'sending', at: localIso(2026, 11, 12, 9, 59) })], 's1', now)).toBe('1 scheduled · Sending now')
  })
})

describe('scheduledNotice', () => {
  const now = local(2026, 11, 12, 10, 0)
  it('오늘·내일·그 밖', () => {
    expect(scheduledNotice(localIso(2026, 11, 12, 15, 30), now)).toBe('Scheduled for today at 15:30')
    expect(scheduledNotice(localIso(2026, 11, 13, 9, 0), now)).toBe('Scheduled for tomorrow at 09:00')
    expect(scheduledNotice(localIso(2026, 11, 14, 9, 0), now)).toBe('Scheduled for Sat, Nov 14 at 09:00')
  })
})

describe('scheduleBlockReason', () => {
  it('보낼 수 있으면 null', () => {
    expect(scheduleBlockReason('배포 확인해 줘')).toBeNull()
    expect(scheduleBlockReason('a / b')).toBeNull()
  })
  it('빈 글·슬래시·역슬래시 끝·길이', () => {
    expect(scheduleBlockReason('  \n ')).toBe('Nothing to send')
    expect(scheduleBlockReason('  /compact')).toMatch(/^Slash commands/)
    expect(scheduleBlockReason('끝\\  ')).toMatch(/end with \\/)
    expect(scheduleBlockReason('a'.repeat(10_000))).toBeNull()
    expect(scheduleBlockReason('a'.repeat(10_001))).toBe('Text is over 10,000 characters')
  })
})

describe('failureText', () => {
  it('code 마다 글자, detail 은 글자로', () => {
    expect(failureText({ code: 'off-duty' })).toBe('Not sent: the session was off duty')
    expect(failureText({ code: 'not-found' })).toBe('Not sent: session not found')
    expect(failureText({ code: 'blocked', detail: 'needs-approval' })).toBe('Not sent: blocked for an hour (waiting for approval)')
    expect(failureText({ code: 'blocked' })).toBe('Not sent: blocked for an hour')
    expect(failureText({ code: 'blocked-mid-send', detail: 'session-ended' })).toBe('Not sent: stopped before Enter (session ended) · text left in the input')
    expect(failureText({ code: 'unconfirmed' })).toMatch(/^Unconfirmed/)
    expect(failureText({ code: 'missed' })).toBe('Not sent: the server was off at that time')
    expect(failureText({ code: 'interrupted' })).toBe('Not sent: the server stopped while sending')
  })
  it('모르는 detail·code 는 그대로', () => {
    expect(failureText({ code: 'blocked', detail: 'new-reason' })).toBe('Not sent: blocked for an hour (new-reason)')
    expect(failureText({ code: 'brand-new' as never })).toBe('Not sent: brand-new')
    expect(failureText(null)).toBe('Not sent')
  })
})

describe('targetLabel', () => {
  it('세션 이름, 없으면 ID 앞 8자리', () => {
    const sessions = [{ id: 'abcdef12-0000', name: 'Park', title: null, position: 'FE' } as unknown as Session]
    expect(targetLabel('abcdef12-0000', sessions)).toBe('→ Park')
    expect(targetLabel('99999999-1111', sessions)).toBe('→ 99999999')
  })
})

describe('applyScheduled·removeScheduled', () => {
  it('같은 id 는 바꾸고 없으면 끝에', () => {
    const messages = [message('a'), message('b')]
    expect(applyScheduled(messages, message('a', { status: 'sent' })).map((m) => [m.id, m.status])).toEqual([
      ['a', 'sent'],
      ['b', 'pending'],
    ])
    expect(applyScheduled(messages, message('c')).map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(removeScheduled(messages, 'a').map((m) => m.id)).toEqual(['b'])
  })
})

describe('scheduledFailureMessage', () => {
  it('서버 message 가 있으면 그대로, 없는 404 는 재시작 안내', () => {
    expect(scheduledFailureMessage(404, 'Session not found')).toBe('Session not found')
    expect(scheduledFailureMessage(404, undefined)).toBe('The server needs a restart to support this')
    expect(scheduledFailureMessage(500, undefined)).toBe('HTTP 500')
  })
})
