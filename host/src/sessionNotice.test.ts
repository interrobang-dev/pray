import { describe, expect, it } from 'vitest'
import * as trayNotify from '../../desktop/src/notify.js'
import * as trayReminder from '../../desktop/src/reminderNotice.js'
import type { Reminder } from './reminder.js'
import {
  CONTEXT_WARN_TOKENS,
  diffSessions,
  nameOf,
  noticeBody,
  noticeTitle,
  placeOf,
  reminderPlace,
  reminderTarget,
  reminderTitle,
  type NotifyKind,
  type NotifyOffice,
  type NotifySession,
  type StatusBaseline,
} from './sessionNotice.js'

function session(overrides: Partial<NotifySession> = {}): NotifySession {
  return {
    id: 'abcdef1234567890',
    name: null,
    position: null,
    title: null,
    status: 'working',
    isAlive: true,
    lastAssistantText: null,
    pendingTool: null,
    role: null,
    ...overrides,
  }
}

function baseline(entries: [string, string][], isContextWarned = false): StatusBaseline {
  return new Map(entries.map(([id, status]) => [id, { status, isContextWarned }]))
}

describe('diffSessions', () => {
  it('첫 회차(previous null)는 기준만 잡는다', () => {
    const { next, notices } = diffSessions(null, [session({ status: 'done' })])
    expect(notices).toEqual([])
    expect(next.get('abcdef1234567890')).toEqual({ status: 'done', isContextWarned: false })
  })

  it.each([
    ['working', 'done'],
    ['working', 'my-turn'],
    ['waiting', 'done'],
    ['waiting', 'my-turn'],
  ])('%s → %s 면 알린다', (before, after) => {
    const { notices } = diffSessions(baseline([['abcdef1234567890', before]]), [session({ status: after })])
    expect(notices.map((n) => n.kind)).toEqual([after])
  })

  it.each([
    ['idle', 'my-turn'],
    ['unknown', 'done'],
    ['my-turn', 'done'],
    ['needs-approval', 'my-turn'],
    ['working', 'waiting'],
    ['done', 'done'],
  ])('%s → %s 는 알리지 않는다', (before, after) => {
    const { notices } = diffSessions(baseline([['abcdef1234567890', before]]), [session({ status: after })])
    expect(notices).toEqual([])
  })

  it('needs-approval 이 새로 되면 알리고, 이어지면 알리지 않는다', () => {
    const now = [session({ status: 'needs-approval' })]
    expect(diffSessions(baseline([['abcdef1234567890', 'working']]), now).notices.map((n) => n.kind)).toEqual(['needs-approval'])
    expect(diffSessions(baseline([['abcdef1234567890', 'unknown']]), now).notices.map((n) => n.kind)).toEqual(['needs-approval'])
    expect(diffSessions(baseline([['abcdef1234567890', 'needs-approval']]), now).notices).toEqual([])
  })

  it('팀원은 needs-approval 만 알린다', () => {
    const previous = baseline([['abcdef1234567890', 'working']])
    expect(diffSessions(previous, [session({ role: 'member', status: 'done' })]).notices).toEqual([])
    expect(diffSessions(previous, [session({ role: 'member', status: 'my-turn' })]).notices).toEqual([])
    expect(diffSessions(previous, [session({ role: 'member', status: 'needs-approval' })]).notices.map((n) => n.kind)).toEqual(['needs-approval'])
    expect(diffSessions(previous, [session({ role: 'lead', status: 'done' })]).notices.map((n) => n.kind)).toEqual(['done'])
  })

  it('근무 중이 아닌 세션은 알리지 않고 기준에서 빠진다', () => {
    const { next, notices } = diffSessions(baseline([['abcdef1234567890', 'working']]), [session({ status: 'done', isAlive: false })])
    expect(notices).toEqual([])
    expect(next.size).toBe(0)
  })

  it('기준에 없던 세션(새 세션·휴식에서 돌아온 세션)은 기준만 잡는다', () => {
    expect(diffSessions(baseline([]), [session({ status: 'needs-approval' })]).notices).toEqual([])
  })
})

describe('hand-over 알림', () => {
  const id = 'abcdef1234567890'
  const kindsOf = (previous: StatusBaseline | null, overrides: Partial<NotifySession>) =>
    diffSessions(previous, [session({ role: 'lead', ...overrides })]).notices.map((n) => n.kind)

  it('처음 넘을 때 한 번, 계속 넘어 있으면 다시 안 나온다', () => {
    const first = diffSessions(baseline([[id, 'my-turn']]), [session({ role: 'lead', status: 'my-turn', contextTokens: CONTEXT_WARN_TOKENS })])
    expect(first.notices.map((n) => n.kind)).toEqual(['hand-over'])
    expect(kindsOf(first.next, { status: 'my-turn', contextTokens: 160_000 })).toEqual([])
  })

  it('내려갔다 다시 넘으면 또 나온다', () => {
    const high = diffSessions(baseline([[id, 'my-turn']]), [session({ role: 'lead', status: 'my-turn', contextTokens: 152_000 })])
    const low = diffSessions(high.next, [session({ role: 'lead', status: 'my-turn', contextTokens: 40_000 })])
    expect(low.notices).toEqual([])
    expect(kindsOf(low.next, { status: 'my-turn', contextTokens: 151_000 })).toEqual(['hand-over'])
  })

  it('15만 미만·팀원·역할 없음·contextTokens 없음은 안 나온다', () => {
    const previous = baseline([[id, 'my-turn']])
    expect(kindsOf(previous, { status: 'my-turn', contextTokens: 149_999 })).toEqual([])
    expect(kindsOf(previous, { role: 'member', status: 'my-turn', contextTokens: 200_000 })).toEqual([])
    expect(kindsOf(previous, { role: null, status: 'my-turn', contextTokens: 200_000 })).toEqual([])
    expect(kindsOf(previous, { status: 'my-turn', contextTokens: null })).toEqual([])
  })

  it('done 판정과 같은 회차에 둘 다 나온다', () => {
    expect(kindsOf(baseline([[id, 'working']]), { status: 'done', contextTokens: 155_000 })).toEqual(['done', 'hand-over'])
  })

  it('제목·본문 글자 (팀장은 lead, 파트장은 part lead)', () => {
    const lead = session({ name: 'Park', position: 'Lead', role: 'lead', contextTokens: 152_400 })
    expect(noticeTitle(lead, 'hand-over')).toBe('[Lead] Park · Hand over')
    expect(noticeBody(lead, 'hand-over')).toBe("Context 152k · Start a new lead with this one's history")
    expect(noticeBody({ ...lead, partId: 'p1' }, 'hand-over')).toBe("Context 152k · Start a new part lead with this one's history")
  })
})

describe('noticeTitle·noticeBody', () => {
  it('역할·이름, 없으면 자동 제목·ID 앞 8자리', () => {
    expect(noticeTitle(session({ name: 'Park', position: 'Lead' }), 'done')).toBe('[Lead] Park · Done')
    expect(noticeTitle(session({ name: '[FE] Kim' }), 'my-turn')).toBe('[FE] Kim · My turn')
    expect(noticeTitle(session({ title: 'Fix login' }), 'needs-approval')).toBe('Fix login · Needs approval')
    expect(noticeTitle(session(), 'done')).toBe('abcdef12 · Done')
    expect(nameOf(session({ name: '[FE] Kim' }))).toBe('Kim')
  })

  it('승인 대기는 도구 이름, 그 밖은 마지막 말의 첫 줄 120자', () => {
    expect(noticeBody(session({ pendingTool: 'Bash', lastAssistantText: 'hi' }), 'needs-approval')).toBe('Tool: Bash')
    expect(noticeBody(session(), 'needs-approval')).toBe('')
    expect(noticeBody(session({ lastAssistantText: '\n## **결과**\n둘째 줄' }), 'done')).toBe('결과')
    expect(noticeBody(session({ lastAssistantText: 'a'.repeat(130) }), 'done')).toBe(`${'a'.repeat(120)}…`)
    expect(noticeBody(session(), 'my-turn')).toBe('')
  })
})

const office: NotifyOffice = {
  teams: [
    { id: 't1', name: 'Pray', leadSessionId: 'lead-2', parts: [{ id: 'p1', name: 'Design', leadSessionId: 'part-lead-2' }, { id: 'p2', name: 'QA' }] },
    { id: 't2', name: 'Solo' },
  ],
}

describe('placeOf', () => {
  it('팀·파트 ID 로 이름을 찾는다, 못 찾으면 팀만·null', () => {
    expect(placeOf({ teamId: 't1', partId: 'p1' }, office)).toEqual({ team: 'Pray', part: 'Design' })
    expect(placeOf({ teamId: 't1', partId: 'gone' }, office)).toEqual({ team: 'Pray', part: null })
    expect(placeOf({ teamId: 't2', partId: null }, office)).toEqual({ team: 'Solo', part: null })
    expect(placeOf({ teamId: null, partId: null }, office)).toBeNull()
    expect(placeOf({ teamId: 'nope' }, office)).toBeNull()
    expect(placeOf({ teamId: 't1' }, null)).toBeNull()
  })
})

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    text: 'Check the deploy',
    at: '2026-11-12T06:30:00.000Z',
    createdAt: '2026-11-12T06:00:00.000Z',
    createdBy: { kind: 'user' },
    firedAt: '2026-11-12T06:30:10.000Z',
    acknowledgedAt: null,
    ...overrides,
  }
}

const leadBy = (sessionId: string | null, partId: string | null = null): Reminder['createdBy'] => ({ kind: 'lead', teamId: 't1', partId, sessionId })

describe('알림(Reminders) 글자·대상', () => {
  const sessions = [session({ id: 'lead-1', name: 'Park', position: 'Lead' }), session({ id: 'part-lead-1', name: '[Lead] Kim' })]

  it('제목', () => {
    expect(reminderTitle(reminder(), [])).toBe('Reminder')
    expect(reminderTitle(reminder({ isLate: true }), [])).toBe('Late reminder')
    expect(reminderTitle(reminder({ createdBy: leadBy('lead-1') }), sessions)).toBe('[Lead] Park · Reminder')
    expect(reminderTitle(reminder({ createdBy: leadBy('part-lead-1', 'p1'), isLate: true }), sessions)).toBe('[Part lead] Kim · Late reminder')
    expect(reminderTitle(reminder({ createdBy: leadBy('gone') }), sessions)).toBe('[Lead] Reminder')
  })

  it('자리는 등록한 단위, 사람이 등록한 것은 null', () => {
    expect(reminderPlace(reminder({ createdBy: leadBy('lead-1', 'p1') }), office)).toEqual({ team: 'Pray', part: 'Design' })
    expect(reminderPlace(reminder(), office)).toBeNull()
  })

  it('대상은 그 단위의 지금 리드, 없으면 등록한 리드, 사람이 등록한 것은 null', () => {
    expect(reminderTarget(reminder({ createdBy: leadBy('lead-1') }), office)).toBe('lead-2')
    expect(reminderTarget(reminder({ createdBy: leadBy('part-lead-1', 'p1') }), office)).toBe('part-lead-2')
    expect(reminderTarget(reminder({ createdBy: leadBy('part-lead-1', 'p2') }), office)).toBe('part-lead-1')
    expect(reminderTarget(reminder({ createdBy: leadBy('lead-1') }), null)).toBe('lead-1')
    expect(reminderTarget(reminder({ createdBy: leadBy(null, 'p2') }), office)).toBeNull()
    expect(reminderTarget(reminder(), office)).toBeNull()
  })
})

describe('트레이 사본(desktop/src/notify.ts·reminderNotice.ts)과 같은 결과', () => {
  const statuses = ['working', 'waiting', 'done', 'my-turn', 'needs-approval', 'idle', 'unknown']
  const roles = [null, 'lead', 'member'] as const

  it('CONTEXT_WARN_TOKENS', () => {
    expect(CONTEXT_WARN_TOKENS).toBe(trayNotify.CONTEXT_WARN_TOKENS)
  })

  it('diffSessions: 모든 상태 전환 × 역할 × 문맥', () => {
    for (const before of statuses)
      for (const after of statuses)
        for (const role of roles)
          for (const [wasWarned, tokens] of [[false, 160_000], [true, 160_000], [false, 10_000]] as const) {
            const now = [session({ role, status: after, contextTokens: tokens, name: '[FE] Kim', pendingTool: 'Bash', lastAssistantText: '## 끝\n둘째', partId: 'p1' })]
            const previous = baseline([['abcdef1234567890', before]], wasWarned)
            expect(diffSessions(previous, now)).toEqual(trayNotify.diffSessions(previous, now))
          }
  })

  it('제목·본문·이름·자리', () => {
    const samples = [session(), session({ name: 'Park', position: 'Lead' }), session({ name: '[FE] Kim' }), session({ name: '[] x' }), session({ title: 'Fix', lastAssistantText: '**a**\n' })]
    const kinds: NotifyKind[] = ['done', 'my-turn', 'needs-approval', 'hand-over']
    for (const each of samples) {
      expect(nameOf(each)).toBe(trayNotify.nameOf(each))
      for (const kind of kinds) {
        expect(noticeTitle(each, kind)).toBe(trayNotify.noticeTitle(each, kind))
        expect(noticeBody(each, kind)).toBe(trayNotify.noticeBody(each, kind))
      }
    }
    for (const place of [{ teamId: 't1', partId: 'p1' }, { teamId: 't2', partId: null }, { teamId: null }])
      expect(placeOf(place, office)).toEqual(trayNotify.placeOf(place, office))
  })

  it('알림(Reminders) 제목·대상', () => {
    const sessions = [session({ id: 'lead-1', name: 'Park', position: 'Lead' })]
    const samples = [reminder(), reminder({ isLate: true }), reminder({ createdBy: leadBy('lead-1') }), reminder({ createdBy: leadBy('gone', 'p2') }), reminder({ createdBy: leadBy(null, 'p1') })]
    for (const each of samples) {
      expect(reminderTitle(each, sessions)).toBe(trayReminder.reminderTitle(each, sessions))
      expect(reminderTarget(each, office)).toBe(trayReminder.reminderTarget(each, office))
    }
  })
})
