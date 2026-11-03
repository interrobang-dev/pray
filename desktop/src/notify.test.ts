import { describe, expect, it } from 'vitest'
import {
  bundleLine,
  bundleToast,
  diffSessions,
  noticeAttribution,
  noticeBody,
  noticeHeader,
  noticeTitle,
  noticeToast,
  placeOf,
  urgentKind,
  type NotifyOffice,
  type NotifySession,
  type StatusBaseline,
} from './notify'

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
  it('첫 폴링(previous null)은 기준만 잡는다', () => {
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
    const { notices } = diffSessions(baseline([]), [session({ status: 'needs-approval' })])
    expect(notices).toEqual([])
  })
})

describe('hand-over 알림', () => {
  const id = 'abcdef1234567890'
  const kindsOf = (previous: StatusBaseline | null, overrides: Partial<NotifySession>) =>
    diffSessions(previous, [session({ role: 'lead', ...overrides })]).notices.map((n) => n.kind)

  it('처음 넘을 때 한 번', () => {
    expect(kindsOf(baseline([[id, 'my-turn']]), { status: 'my-turn', contextTokens: 150_000 })).toEqual(['hand-over'])
  })

  it('계속 넘어 있으면 다시 안 나온다', () => {
    const first = diffSessions(baseline([[id, 'my-turn']]), [session({ role: 'lead', status: 'my-turn', contextTokens: 152_000 })])
    expect(kindsOf(first.next, { status: 'my-turn', contextTokens: 160_000 })).toEqual([])
  })

  it('내려갔다 다시 넘으면 또 나온다', () => {
    const high = diffSessions(baseline([[id, 'my-turn']]), [session({ role: 'lead', status: 'my-turn', contextTokens: 152_000 })])
    const low = diffSessions(high.next, [session({ role: 'lead', status: 'my-turn', contextTokens: 40_000 })])
    expect(low.notices).toEqual([])
    expect(kindsOf(low.next, { status: 'my-turn', contextTokens: 151_000 })).toEqual(['hand-over'])
  })

  it('15만 미만은 안 나온다', () => {
    expect(kindsOf(baseline([[id, 'my-turn']]), { status: 'my-turn', contextTokens: 149_999 })).toEqual([])
  })

  it('팀원·역할 없음은 안 나온다', () => {
    const previous = baseline([[id, 'my-turn']])
    expect(kindsOf(previous, { role: 'member', status: 'my-turn', contextTokens: 200_000 })).toEqual([])
    expect(kindsOf(previous, { role: null, status: 'my-turn', contextTokens: 200_000 })).toEqual([])
  })

  it('첫 폴링은 기준만 잡고, 이미 넘은 채 시작하면 이어서 안 나온다', () => {
    const first = diffSessions(null, [session({ role: 'lead', status: 'my-turn', contextTokens: 170_000 })])
    expect(first.notices).toEqual([])
    expect(first.next.get(id)?.isContextWarned).toBe(true)
    expect(kindsOf(first.next, { status: 'my-turn', contextTokens: 171_000 })).toEqual([])
  })

  it('contextTokens 없는 옛 응답은 안 나온다', () => {
    expect(kindsOf(baseline([[id, 'my-turn']]), { status: 'my-turn' })).toEqual([])
    expect(kindsOf(baseline([[id, 'my-turn']]), { status: 'my-turn', contextTokens: null })).toEqual([])
  })

  it('done 판정과 같은 폴링에 둘 다 나온다', () => {
    expect(kindsOf(baseline([[id, 'working']]), { status: 'done', contextTokens: 155_000 })).toEqual(['done', 'hand-over'])
  })

  it('제목·본문 글자 (팀장은 lead, 파트장은 part lead)', () => {
    const lead = session({ name: 'Park', position: 'Lead', role: 'lead', contextTokens: 152_400 })
    expect(noticeTitle(lead, 'hand-over')).toBe('[Lead] Park · Hand over')
    expect(noticeBody(lead, 'hand-over')).toBe("Context 152k · Start a new lead with this one's history")
    expect(noticeBody({ ...lead, partId: 'p1' }, 'hand-over')).toBe("Context 152k · Start a new part lead with this one's history")
  })
})

describe('noticeTitle', () => {
  it('역할·이름, 없으면 자동 제목·ID 앞 8자리', () => {
    expect(noticeTitle(session({ name: 'Park', position: 'Lead' }), 'done')).toBe('[Lead] Park · Done')
    expect(noticeTitle(session({ name: '[FE] Kim' }), 'my-turn')).toBe('[FE] Kim · My turn')
    expect(noticeTitle(session({ title: 'Fix login' }), 'needs-approval')).toBe('Fix login · Needs approval')
    expect(noticeTitle(session(), 'done')).toBe('abcdef12 · Done')
  })
})

describe('noticeBody', () => {
  it('승인 대기는 도구 이름', () => {
    expect(noticeBody(session({ pendingTool: 'Bash', lastAssistantText: 'hi' }), 'needs-approval')).toBe('Tool: Bash')
    expect(noticeBody(session(), 'needs-approval')).toBe('')
  })

  it('마지막 말의 첫 줄(빈 줄·마크다운 머리 뗌), 120자에서 자른다', () => {
    expect(noticeBody(session({ lastAssistantText: '\n## **결과**\n둘째 줄' }), 'done')).toBe('결과')
    const long = 'a'.repeat(130)
    expect(noticeBody(session({ lastAssistantText: long }), 'done')).toBe(`${'a'.repeat(120)}…`)
    expect(noticeBody(session(), 'my-turn')).toBe('')
  })
})

describe('알림 자리 (그룹 › 팀 › 파트)', () => {
  const office: NotifyOffice = {
    groups: [{ id: 'g1', name: 'Office' }],
    teams: [
      { id: 't1', name: 'Pray', groupId: 'g1', parts: [{ id: 'p1', name: 'Design' }] },
      { id: 't2', name: 'Orphan', groupId: 'gone' },
    ],
  }

  it('팀·파트 ID 로 이름을 찾는다', () => {
    expect(placeOf({ teamId: 't1', partId: 'p1' }, office)).toEqual({ group: 'Office', team: 'Pray', part: 'Design' })
    expect(placeOf({ teamId: 't1', partId: null }, office)).toEqual({ group: 'Office', team: 'Pray', part: null })
    expect(placeOf({ teamId: 't2', partId: null }, office)).toEqual({ group: null, team: 'Orphan', part: null })
  })

  it('팀이 없거나 모르거나 사무실 정보가 없으면 null', () => {
    expect(placeOf({ teamId: null, partId: null }, office)).toBeNull()
    expect(placeOf({}, office)).toBeNull()
    expect(placeOf({ teamId: 'nope' }, office)).toBeNull()
    expect(placeOf({ teamId: 't1' }, null)).toBeNull()
  })

  it('머리줄은 팀 › 파트, id 는 팀ID[:파트ID], 팀이 없으면 null', () => {
    const design = { group: 'Office', team: 'Pray', part: 'Design' }
    expect(noticeHeader({ teamId: 't1', partId: 'p1' }, design)).toEqual({ id: 't1:p1', title: 'Pray › Design' })
    expect(noticeHeader({ teamId: 't1', partId: null }, { group: 'Office', team: 'Pray', part: null })).toEqual({ id: 't1', title: 'Pray' })
    // 파트 이름을 못 찾으면 팀 묶음으로
    expect(noticeHeader({ teamId: 't1', partId: 'gone' }, { group: 'Office', team: 'Pray', part: null })).toEqual({ id: 't1', title: 'Pray' })
    expect(noticeHeader({ teamId: null }, null)).toBeNull()
  })

  it('작은 회색 줄은 그룹 · 역할, 없는 칸은 뺀다', () => {
    const place = { group: 'Office', team: 'Pray', part: null }
    expect(noticeAttribution({ role: 'lead', partId: null }, place)).toBe('Office · Lead')
    expect(noticeAttribution({ role: 'lead', partId: 'p1' }, place)).toBe('Office · Part lead')
    expect(noticeAttribution({ role: 'member', partId: null }, { ...place, group: null })).toBe('Member')
    expect(noticeAttribution({ role: null, partId: null }, place)).toBe('Office')
    expect(noticeAttribution({ role: null, partId: null }, null)).toBe('')
  })

  it('묶음 줄은 그룹 없이 팀 › 파트 · 제목', () => {
    expect(bundleLine('[Lead] Park · Done', { group: 'Office', team: 'Pray', part: 'Design' })).toBe('Pray › Design · [Lead] Park · Done')
    expect(bundleLine('[Lead] Park · Done', { group: 'Office', team: 'Pray', part: null })).toBe('Pray · [Lead] Park · Done')
    expect(bundleLine('Kim · My turn', null)).toBe('Kim · My turn')
  })
})

describe('알림 토스트 내용', () => {
  const place = { group: 'Office', team: 'Pray', part: null }
  const lead = session({ id: 's1', name: 'Park', position: 'Lead', role: 'lead', teamId: 't1', partId: null })

  it('한 세션: 머리줄·작은 줄·그림, 승인 대기는 Review', () => {
    const notice = { sessionId: 's1', kind: 'done' as const, title: '[Lead] Park · Done', body: '끝났습니다' }
    expect(noticeToast(notice, lead, place, 'file:///icon.png')).toEqual({
      title: '[Lead] Park · Done',
      body: '끝났습니다',
      header: { id: 't1', title: 'Pray' },
      attribution: 'Office · Lead',
      iconUrl: 'file:///icon.png',
      openLabel: 'Open',
    })
    expect(noticeToast({ ...notice, kind: 'needs-approval' }, lead, place, null).openLabel).toBe('Review')
  })

  it('Focus Zone 세션·세션을 못 찾으면 머리줄 없이', () => {
    const notice = { sessionId: 's2', kind: 'my-turn' as const, title: 'Kim · My turn', body: '' }
    expect(noticeToast(notice, session({ id: 's2', name: 'Kim' }), null, null)).toMatchObject({ header: null, attribution: '' })
    expect(noticeToast(notice, undefined, null, null)).toMatchObject({ header: null, attribution: '' })
  })

  it('묶음은 머리줄 없이 줄마다', () => {
    expect(bundleToast(['a', 'b', 'c', 'd'], null)).toEqual({
      title: 'Pray · 4 sessions',
      body: 'a\nb\nc\nd',
      header: null,
      attribution: '',
      iconUrl: null,
      openLabel: 'Open',
    })
  })

  it('묶음 그림은 가장 급한 종류', () => {
    expect(urgentKind(['done', 'my-turn', 'needs-approval'])).toBe('needs-approval')
    expect(urgentKind(['done', 'hand-over', 'my-turn'])).toBe('my-turn')
    expect(urgentKind(['done', 'hand-over'])).toBe('hand-over')
    expect(urgentKind(['done'])).toBe('done')
  })
})
