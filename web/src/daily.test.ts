import { describe, expect, it } from 'vitest'
import {
  commitsNote,
  dayTitle,
  eventsText,
  hasActivity,
  reportTotalText,
  sessionLabel,
  shiftDate,
  splitTeams,
  teamSummaryText,
  tokenRows,
  type DailyReport,
  type TeamDaily,
} from './daily'
import type { Office } from './types'

const usage = (outputTokens: number, cacheReadTokens = 90) => ({ inputTokens: 5, outputTokens, cacheCreationTokens: 5, cacheReadTokens, turns: 1 })

function team(teamId: string, partial: Partial<TeamDaily> = {}): TeamDaily {
  return {
    teamId,
    name: teamId.toUpperCase(),
    commits: { kind: 'git', items: [], isTruncated: false, error: null },
    tasks: [],
    tokens: { lead: null, members: null, other: null, sessions: [] },
    todosDone: [],
    events: { joined: 0, released: 0 },
    ...partial,
  }
}

const commit = (hash: string) => ({ hash, shortHash: hash.slice(0, 7), subject: 's', authorName: 'Kim', at: '2026-11-13T01:00:00Z', partId: null })
const task = (id: string, status: 'running' | 'done' | 'failed' = 'done') => ({
  id,
  partId: null,
  memberSessionId: 'm',
  memberName: null,
  memberPosition: null,
  status,
  isAcknowledged: true,
  instructionHead: null,
  resultHead: null,
  hasError: false,
  createdAt: '2026-11-13T00:00:00Z',
  finishedAt: status === 'running' ? null : '2026-11-13T01:00:00Z',
  usage: null,
  model: null,
})

function report(teams: TeamDaily[]): DailyReport {
  return { today: '2026-11-13', oldestDate: '2026-11-06', date: '2026-11-13', from: '', to: '', myDesk: { todosDone: [] }, teams }
}

describe('날짜', () => {
  it('하루씩 옮긴다 (달·해 넘김)', () => {
    expect(shiftDate('2026-11-13', -1)).toBe('2026-11-12')
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('제목은 Today·Yesterday·요일', () => {
    expect(dayTitle('2026-11-13', '2026-11-13')).toBe('Today · Fri, Nov 13')
    expect(dayTitle('2026-11-12', '2026-11-13')).toBe('Yesterday · Thu, Nov 12')
    expect(dayTitle('2026-11-10', '2026-11-13')).toBe('Tue, Nov 10')
  })
})

describe('팀 나누기', () => {
  it('한 일이 있는지', () => {
    expect(hasActivity(team('a'))).toBe(false)
    expect(hasActivity(team('a', { commits: { kind: 'git', items: [], isTruncated: false, error: 'git log failed' } }))).toBe(true)
    expect(hasActivity(team('a', { events: { joined: 1, released: 0 } }))).toBe(true)
    expect(hasActivity(team('a', { todosDone: [{ id: 't', text: 'x', priority: null, doneAt: '' }] }))).toBe(true)
  })

  it('목록 순서대로, office 에 없는 팀은 뒤에', () => {
    const office = {
      groups: [{ id: 'g2' }, { id: 'g1' }],
      teams: [{ id: 'a', groupId: 'g1' }, { id: 'b', groupId: 'g2' }, { id: 'c', groupId: 'g1' }],
    } as unknown as Office
    const busy = { commits: { kind: 'git' as const, items: [commit('h')], isTruncated: false, error: null } }
    const result = splitTeams(report([team('a', busy), team('gone', busy), team('b', busy), team('c')]), office)
    expect(result.active.map((item) => item.teamId)).toEqual(['b', 'a', 'gone'])
    expect(result.quiet.map((item) => item.teamId)).toEqual(['c'])
  })
})

describe('글자', () => {
  it('맨 위 합계: 커밋·끝난 task·토큰', () => {
    const teams = [
      team('a', { commits: { kind: 'git', items: [commit('1'), commit('2')], isTruncated: false, error: null }, tasks: [task('t1'), task('t2', 'running')], tokens: { lead: usage(1000), members: null, other: null, sessions: [] } }),
      team('b', { tasks: [task('t3', 'failed')], tokens: { lead: null, members: usage(500), other: usage(500), sessions: [] } }),
    ]
    expect(reportTotalText(report(teams))).toBe('2 commits · 2 tasks · 2k out · 300 in · 90% cached')
    expect(reportTotalText(report([team('x')]))).toBeNull()
    expect(teamSummaryText(teams[0])).toBe('2 commits · 1 task · 1k out')
    expect(teamSummaryText(team('x'))).toBe('')
  })

  it('커밋 칸 안내', () => {
    expect(commitsNote({ kind: 'svn', items: [], isTruncated: false, error: null })).toBe("SVN commits aren't shown")
    expect(commitsNote({ kind: 'none', items: [], isTruncated: false, error: null })).toBeNull()
    expect(commitsNote({ kind: 'git', items: [], isTruncated: false, error: null })).toBe('No commits')
    expect(commitsNote({ kind: 'git', items: [], isTruncated: false, error: 'x' })).toBeNull()
    expect(commitsNote({ kind: 'git', items: [commit('1')], isTruncated: false, error: null })).toBeNull()
  })

  it('토큰 줄은 있는 갈래만, 여럿이면 수, title 에 세션 줄', () => {
    const rows = tokenRows({
      lead: usage(4000),
      members: usage(2000),
      other: null,
      sessions: [
        { sessionId: 'lead-id-1', name: 'Minho', position: null, kind: 'lead', usage: usage(4000), model: 'claude-opus-5-5' },
        { sessionId: 'm1', name: 'Jisoo', position: 'FE', kind: 'member', usage: usage(1500), model: 'claude-sonnet-5-5' },
        { sessionId: 'abcdef1234', name: null, position: null, kind: 'member', usage: usage(500), model: null },
      ],
    })
    expect(rows.map((row) => [row.label, row.text])).toEqual([
      ['Lead', '4k out · 100 in · 90% cached'],
      ['Members (2)', '2k out · 100 in · 90% cached'],
    ])
    expect(rows[1].title.split('\n').slice(1)).toEqual(['[FE] Jisoo: Sonnet · 1.5k out · 100 in · 90% cached', 'abcdef12: 500 out · 100 in · 90% cached'])
  })

  it('세션 이름·들고 남', () => {
    expect(sessionLabel({ name: 'A', position: 'BE', sessionId: 'x' })).toBe('[BE] A')
    expect(sessionLabel({ name: null, position: null, sessionId: '1234567890' })).toBe('12345678')
    expect(eventsText({ joined: 2, released: 0 })).toBe('Joined 2')
    expect(eventsText({ joined: 1, released: 3 })).toBe('Joined 1 · Released 3')
    expect(eventsText({ joined: 0, released: 0 })).toBeNull()
  })
})
