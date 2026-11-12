import { describe, expect, it } from 'vitest'
import type { NotifySession } from './notify'
import {
  newlyFiredReminders,
  reminderBundleLine,
  reminderBundleToast,
  reminderSession,
  reminderTarget,
  reminderTitle,
  reminderToast,
  type NotifyReminder,
  type ReminderOffice,
} from './reminderNotice'

const TRAY_STARTED = Date.parse('2026-11-12T06:00:00.000Z')

function reminder(overrides: Partial<NotifyReminder> = {}): NotifyReminder {
  return {
    id: 'r1',
    text: 'Check the deploy',
    at: '2026-11-12T06:30:00.000Z',
    createdAt: '2026-11-12T05:00:00.000Z',
    createdBy: { kind: 'user' },
    firedAt: '2026-11-12T06:30:10.000Z',
    isLate: false,
    acknowledgedAt: null,
    ...overrides,
  }
}

function leadBy(sessionId: string | null, partId: string | null = null): NotifyReminder['createdBy'] {
  return { kind: 'lead', teamId: 't1', partId, sessionId }
}

function session(overrides: Partial<NotifySession> = {}): NotifySession {
  return {
    id: 'lead-1',
    name: 'Park',
    position: 'Lead',
    title: null,
    status: 'my-turn',
    isAlive: true,
    lastAssistantText: null,
    pendingTool: null,
    role: 'lead',
    ...overrides,
  }
}

const office: ReminderOffice = {
  teams: [
    {
      id: 't1',
      name: 'Pray',
      leadSessionId: 'lead-2',
      parts: [
        { id: 'p1', name: 'Web', leadSessionId: 'part-lead-2' },
        { id: 'p2', name: 'Server' },
      ],
    },
  ],
}

describe('newlyFiredReminders', () => {
  it('트레이를 켠 뒤 울렸고 확인 전이고 아직 알리지 않은 것만, 넣은 순서대로', () => {
    const reminders = [
      reminder({ id: 'fired' }),
      reminder({ id: 'upcoming', firedAt: null }),
      reminder({ id: 'acknowledged', acknowledgedAt: '2026-11-12T06:31:00.000Z' }),
      reminder({ id: 'notified' }),
      reminder({ id: 'before-start', firedAt: '2026-11-12T05:59:59.999Z' }),
      reminder({ id: 'at-start', firedAt: '2026-11-12T06:00:00.000Z' }),
      reminder({ id: 'broken', firedAt: 'not a time' }),
    ]
    const ids = newlyFiredReminders(new Set(['notified']), TRAY_STARTED, reminders).map((each) => each.id)
    expect(ids).toEqual(['fired', 'at-start'])
  })

  it('첫 폴링에서도 고른다 — 서버가 켜지자마자 늦음으로 울린 것', () => {
    const late = reminder({ at: '2026-11-11T09:00:00.000Z', firedAt: '2026-11-12T06:00:20.000Z', isLate: true })
    expect(newlyFiredReminders(new Set(), TRAY_STARTED, [late])).toEqual([late])
  })
})

describe('reminderTitle', () => {
  it('사람이 등록한 것은 "Reminder", 늦었으면 "Late reminder"', () => {
    expect(reminderTitle(reminder(), [])).toBe('Reminder')
    expect(reminderTitle(reminder({ isLate: true }), [])).toBe('Late reminder')
  })

  it('리드가 등록한 것은 "[Lead] 이름 · Reminder", 파트장은 "[Part lead]"', () => {
    const sessions = [session(), session({ id: 'part-lead-1', name: '[Lead] Kim', position: null })]
    expect(reminderTitle(reminder({ createdBy: leadBy('lead-1') }), sessions)).toBe('[Lead] Park · Reminder')
    expect(reminderTitle(reminder({ createdBy: leadBy('part-lead-1', 'p1'), isLate: true }), sessions)).toBe('[Part lead] Kim · Late reminder')
  })

  it('리드 세션을 못 찾거나 sessionId 가 없으면 이름 없이', () => {
    expect(reminderTitle(reminder({ createdBy: leadBy('gone') }), [session()])).toBe('[Lead] Reminder')
    expect(reminderTitle(reminder({ createdBy: leadBy(null, 'p2') }), [session()])).toBe('[Part lead] Reminder')
  })
})

describe('reminderSession', () => {
  it('등록한 리드 세션. 사람 등록·못 찾음은 undefined', () => {
    const lead = session()
    expect(reminderSession(reminder({ createdBy: leadBy('lead-1') }), [lead])).toBe(lead)
    expect(reminderSession(reminder({ createdBy: leadBy('gone') }), [lead])).toBeUndefined()
    expect(reminderSession(reminder({ createdBy: leadBy(null) }), [lead])).toBeUndefined()
    expect(reminderSession(reminder(), [lead])).toBeUndefined()
  })
})

describe('reminderToast', () => {
  it('제목 · 한 줄로 자른 글 · "팀 › 파트"', () => {
    const text = '배포가 끝났는지 확인하고 결과를 팀장에게 알려 주세요'
    const toast = reminderToast(reminder({ text, createdBy: leadBy('lead-1', 'p1') }), [session()], office, 'file:///icon.png')
    expect(toast).toEqual({ title: '[Part lead] Park · Reminder', body: '배포가 끝났는지 확인하고 결과를…', attribution: 'Pray › Web', iconUrl: 'file:///icon.png' })
  })

  it('팀 직속은 팀 이름, 사람 등록·사무실 정보 없음은 회색 줄 없음', () => {
    expect(reminderToast(reminder({ createdBy: leadBy('lead-1') }), [], office, null).attribution).toBe('Pray')
    expect(reminderToast(reminder({ createdBy: leadBy('lead-1') }), [], null, null).attribution).toBe('')
    expect(reminderToast(reminder(), [], office, null)).toEqual({ title: 'Reminder', body: 'Check the deploy', attribution: '', iconUrl: null })
  })
})

describe('reminderBundleToast', () => {
  it('"Pray · N reminders", 줄마다 보낸 이 · 글 (사람 등록은 글만, 자르지 않는다)', () => {
    const sessions = [session()]
    const lines = [
      reminderBundleLine(reminder({ createdBy: leadBy('lead-1') }), sessions),
      reminderBundleLine(reminder({ text: 'Stand-up' }), sessions),
      reminderBundleLine(reminder({ createdBy: leadBy('gone', 'p1'), text: 'Merge the part branch' }), sessions),
      reminderBundleLine(reminder({ text: 'Lunch' }), sessions),
    ]
    expect(reminderBundleToast(lines, 'file:///mark.png')).toEqual({
      title: 'Pray · 4 reminders',
      body: '[Lead] Park · Check the deploy\nStand-up\n[Part lead] · Merge the part branch\nLunch',
      attribution: '',
      iconUrl: 'file:///mark.png',
    })
  })
})

describe('reminderTarget', () => {
  it('그 지휘 단위의 지금 리드 (Hand over 로 바뀌었을 수 있다)', () => {
    expect(reminderTarget(reminder({ createdBy: leadBy('lead-1') }), office)).toBe('lead-2')
    expect(reminderTarget(reminder({ createdBy: leadBy('part-lead-1', 'p1') }), office)).toBe('part-lead-2')
  })

  it('지금 리드가 없거나 팀·파트·사무실 정보가 없으면 등록한 리드', () => {
    expect(reminderTarget(reminder({ createdBy: leadBy('part-lead-1', 'p2') }), office)).toBe('part-lead-1')
    expect(reminderTarget(reminder({ createdBy: leadBy('part-lead-1', 'gone') }), office)).toBe('part-lead-1')
    expect(reminderTarget(reminder({ createdBy: { kind: 'lead', teamId: 'gone', partId: null, sessionId: 'lead-1' } }), office)).toBe('lead-1')
    expect(reminderTarget(reminder({ createdBy: leadBy('lead-1') }), null)).toBe('lead-1')
    expect(reminderTarget(reminder({ createdBy: leadBy(null, 'p2') }), office)).toBeNull()
  })

  it('사람이 등록한 것은 null (창만 연다)', () => {
    expect(reminderTarget(reminder(), office)).toBeNull()
  })
})
