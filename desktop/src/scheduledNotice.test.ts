import { describe, expect, it } from 'vitest'
import type { NotifySession } from './notify'
import {
  newlyFailedScheduled,
  scheduledBundleLine,
  scheduledBundleToast,
  scheduledFailureText,
  scheduledSession,
  scheduledTitle,
  scheduledToast,
  type NotifyScheduled,
} from './scheduledNotice'

const TRAY_STARTED = Date.parse('2026-11-12T06:00:00.000Z')

function item(overrides: Partial<NotifyScheduled> = {}): NotifyScheduled {
  return {
    id: 's1',
    sessionId: 'session-1-abcdef',
    text: 'Run the tests',
    status: 'failed',
    failedAt: '2026-11-12T06:30:10.000Z',
    failure: { code: 'off-duty' },
    acknowledgedAt: null,
    ...overrides,
  }
}

function session(overrides: Partial<NotifySession> = {}): NotifySession {
  return {
    id: 'session-1-abcdef',
    name: 'Park',
    position: 'FE',
    title: null,
    status: 'my-turn',
    isAlive: true,
    lastAssistantText: null,
    pendingTool: null,
    role: 'member',
    ...overrides,
  }
}

describe('newlyFailedScheduled', () => {
  it('트레이를 켠 뒤 실패했고 확인 전이고 아직 안 알린 것만, 넣은 순서대로', () => {
    const items = [
      item({ id: 'before', failedAt: '2026-11-12T05:59:59.999Z' }),
      item({ id: 'edge', failedAt: '2026-11-12T06:00:00.000Z' }),
      item({ id: 'seen', acknowledgedAt: '2026-11-12T06:40:00.000Z' }),
      item({ id: 'notified' }),
      item({ id: 'pending', status: 'pending', failedAt: null, failure: null }),
      item({ id: 'sent', status: 'sent', failedAt: null, failure: null }),
      item({ id: 'bad-time', failedAt: 'not a date' }),
      item({ id: 'new' }),
    ]
    expect(newlyFailedScheduled(new Set(['notified']), TRAY_STARTED, items).map((each) => each.id)).toEqual(['edge', 'new'])
  })
})

describe('scheduledTitle', () => {
  it('unconfirmed 만 "unconfirmed", 그 밖은 "not sent"', () => {
    expect(scheduledTitle(item())).toBe('Scheduled message not sent')
    expect(scheduledTitle(item({ failure: { code: 'unconfirmed' } }))).toBe('Scheduled message unconfirmed')
    expect(scheduledTitle(item({ failure: null }))).toBe('Scheduled message not sent')
  })
})

describe('scheduledFailureText', () => {
  it('화면 failureText 와 같은 글자', () => {
    expect(scheduledFailureText({ code: 'off-duty' })).toBe('Not sent: the session was off duty')
    expect(scheduledFailureText({ code: 'not-found' })).toBe('Not sent: session not found')
    expect(scheduledFailureText({ code: 'blocked', detail: 'needs-approval' })).toBe('Not sent: blocked for an hour (waiting for approval)')
    expect(scheduledFailureText({ code: 'blocked' })).toBe('Not sent: blocked for an hour')
    expect(scheduledFailureText({ code: 'blocked-mid-send', detail: 'session-ended' })).toBe(
      'Not sent: stopped before Enter (session ended) · text left in the input',
    )
    expect(scheduledFailureText({ code: 'unconfirmed' })).toBe("Unconfirmed: sent, but claude didn't pick it up")
    expect(scheduledFailureText({ code: 'missed' })).toBe('Not sent: the server was off at that time')
    expect(scheduledFailureText({ code: 'interrupted' })).toBe('Not sent: the server stopped while sending')
  })

  it('모르는 code·detail 은 그대로, 실패 정보가 없으면 "Not sent"', () => {
    expect(scheduledFailureText({ code: 'blocked', detail: 'new-reason' })).toBe('Not sent: blocked for an hour (new-reason)')
    expect(scheduledFailureText({ code: 'brand-new' as never })).toBe('Not sent: brand-new')
    expect(scheduledFailureText(null)).toBe('Not sent')
  })
})

describe('scheduledToast', () => {
  it('제목 · 한 줄로 자른 글(줄바꿈은 공백) · 회색 줄 "이름 · 이유"', () => {
    const text = '테스트를 돌리고\n  결과를 정리해 주세요 그리고 실패한 것은 고쳐 주세요'
    expect(scheduledToast(item({ text }), [session()], 'file:///icon.png')).toEqual({
      title: 'Scheduled message not sent',
      body: '테스트를 돌리고 결과를 정리해 주…',
      attribution: 'Park · Not sent: the session was off duty',
      iconUrl: 'file:///icon.png',
    })
  })

  it('받을 세션이 목록에 없으면 ID 앞 8자리', () => {
    expect(scheduledToast(item({ failure: { code: 'not-found' } }), [], null).attribution).toBe('session- · Not sent: session not found')
  })
})

describe('scheduledSession', () => {
  it('받을 세션을 찾고, 없으면 undefined', () => {
    expect(scheduledSession(item(), [session({ id: 'other' }), session()])?.id).toBe('session-1-abcdef')
    expect(scheduledSession(item(), [session({ id: 'other' })])).toBeUndefined()
  })
})

describe('묶음', () => {
  it('줄은 "이름 · 글"(자르지 않음), 제목은 개수', () => {
    const lines = [item(), item({ id: 's2', sessionId: 'gone-session', text: 'a\nb' })].map((each) => scheduledBundleLine(each, [session()]))
    expect(lines).toEqual(['Park · Run the tests', 'gone-ses · a b'])
    expect(scheduledBundleToast(lines, null)).toEqual({
      title: 'Pray · 2 scheduled messages failed',
      body: 'Park · Run the tests\ngone-ses · a b',
      attribution: '',
      iconUrl: null,
    })
    expect(scheduledBundleToast(['x'], null).title).toBe('Pray · 1 scheduled message failed')
  })
})
