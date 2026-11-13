import { describe, expect, it } from 'vitest'
import {
  COMMIT_PREVIEW,
  commitsNote,
  dailyStats,
  dayTitle,
  hasActivity,
  heatLevel,
  hourTitle,
  nowShare,
  outputShare,
  outputText,
  shiftDate,
  splitTeams,
  teamCountsText,
  teamsByOutput,
  teamTimeline,
  tokenTitle,
  visibleCommits,
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

const commit = (hash: string, at = '2026-11-13T01:00:00Z') => ({ hash, shortHash: hash.slice(0, 7), subject: 's', authorName: 'Kim', at, partId: null })
const task = (id: string, status: 'running' | 'done' | 'failed' = 'done', createdAt = '2026-11-13T00:00:00Z', finishedAt: string | null = '2026-11-13T01:00:00Z') => ({
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
  createdAt,
  finishedAt: status === 'running' ? null : finishedAt,
  usage: null,
  model: null,
})

function report(teams: TeamDaily[]): DailyReport {
  return { today: '2026-11-13', oldestDate: '2026-11-06', date: '2026-11-13', from: '2026-11-12T15:00:00.000Z', to: '2026-11-13T15:00:00.000Z', myDesk: { todosDone: [] }, teams }
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

describe('숫자 칸·팀 줄', () => {
  const busy = team('a', {
    commits: { kind: 'git', items: [commit('1'), commit('2')], isTruncated: false, error: null },
    tasks: [task('t1'), task('t2', 'running')],
    tokens: { lead: usage(1000), members: null, other: null, sessions: [] },
    todosDone: [{ id: 'd', text: 'x', priority: null, doneAt: '' }],
  })
  const other = team('b', { tasks: [task('t3', 'failed')], tokens: { lead: null, members: usage(3000), other: usage(500), sessions: [] } })

  it('커밋 수·끝난 task 수·토큰 합·한 일이 있는 팀 수', () => {
    const stats = dailyStats(report([busy, other, team('quiet')]))
    expect(stats.commits).toBe(2)
    expect(stats.tasks).toBe(2)
    expect(stats.usage?.outputTokens).toBe(4500)
    expect(stats.teams).toBe(2)
    expect(dailyStats(report([team('x')])).usage).toBeNull()
  })

  it('출력 토큰 많은 순, 같으면 받은 순서', () => {
    const none = team('c', { commits: { kind: 'git', items: [commit('9')], isTruncated: false, error: null } })
    const none2 = team('d', { events: { joined: 1, released: 0 } })
    expect(teamsByOutput([none, busy, none2, other]).map((item) => item.teamId)).toEqual(['b', 'a', 'c', 'd'])
    expect(outputShare(busy, [busy, other])).toBeCloseTo(1000 / 3500)
    expect(outputShare(none, [none])).toBe(0)
    expect(outputText(other)).toBe('3.5k')
    expect(outputText(none)).toBeNull()
  })

  it('팀 줄 글자·막대 title', () => {
    expect(teamCountsText(busy)).toBe('2 commits · 1 task · 1 TODO done')
    expect(teamCountsText(team('x'))).toBe('')
    expect(
      tokenTitle(
        team('b', {
          tokens: {
            lead: usage(4000),
            members: usage(2000),
            other: null,
            sessions: [
              { sessionId: 'l', name: 'Minho', position: null, kind: 'lead', usage: usage(4000), model: null },
              { sessionId: 'm1', name: 'Jisoo', position: 'FE', kind: 'member', usage: usage(1500), model: null },
              { sessionId: 'm2', name: null, position: null, kind: 'member', usage: usage(500), model: null },
            ],
          },
        }),
      ).split('\n'),
    ).toEqual(['Total: 6k out · 200 in · 90% cached', 'Lead: 4k out · 100 in · 90% cached', 'Members (2): 2k out · 100 in · 90% cached'])
    expect(tokenTitle(team('x'))).toBe('No tokens')
  })

  it('커밋은 3개까지, 나머지는 수', () => {
    const items = ['1', '2', '3', '4', '5'].map((hash) => commit(hash))
    expect(visibleCommits(items, false).shown.map((item) => item.hash)).toEqual(['1', '2', '3'])
    expect(visibleCommits(items, false).hiddenCount).toBe(2)
    expect(visibleCommits(items, true)).toEqual({ shown: items, hiddenCount: 0 })
    expect(visibleCommits(items.slice(0, COMMIT_PREVIEW), false).hiddenCount).toBe(0)
  })

  it('SVN 만 안내', () => {
    expect(commitsNote({ kind: 'svn', items: [], isTruncated: false, error: null })).toBe("SVN commits aren't shown")
    expect(commitsNote({ kind: 'git', items: [], isTruncated: false, error: null })).toBeNull()
    expect(commitsNote({ kind: 'none', items: [], isTruncated: false, error: null })).toBeNull()
  })
})

describe('시간대 타임라인', () => {
  // 하루 = 2026-11-12T15:00Z ~ 2026-11-13T15:00Z, 시간 칸 0 = 15:00Z
  const day = report([])
  const at = (hour: number, minute = 0) => new Date(Date.parse(day.from) + hour * 3_600_000 + minute * 60_000).toISOString()
  const now = Date.parse(at(14, 30))

  it('task 는 겹치는 시간마다, 끝이 칸 경계면 다음 칸은 빼고, 진행 중은 지금까지', () => {
    const line = teamTimeline(
      team('a', {
        tasks: [
          task('t1', 'done', at(9), at(10)),
          task('t2', 'done', at(9, 30), at(11, 15)),
          task('t3', 'running', at(13, 50)),
          // 어제 시작해 오늘 끝남 → 0 칸부터
          task('t4', 'done', '2026-11-12T10:00:00Z', at(0, 20)),
        ],
      }),
      day,
      now,
    )
    expect(line.hours.map((hour) => hour.tasks).slice(0, 16)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 0, 1, 1, 0])
    expect(line.hours).toHaveLength(24)
  })

  it('커밋은 그 칸 수와 하루 안 자리, 하루 밖은 뺀다', () => {
    const line = teamTimeline(
      team('a', { commits: { kind: 'git', items: [commit('1', at(6, 0)), commit('2', at(6, 59)), commit('3', '2026-11-12T14:59:00Z')], isTruncated: false, error: null } }),
      day,
      now,
    )
    expect(line.hours[6].commits).toBe(2)
    expect(line.commitMarks).toEqual([6 / 24, (6 + 59 / 60) / 24])
  })

  it('지난날의 진행 중 task 는 하루 끝까지', () => {
    const line = teamTimeline(team('a', { tasks: [task('t', 'running', at(22))] }), day, Date.parse(day.to) + 5 * 3_600_000)
    expect(line.hours.slice(21).map((hour) => hour.tasks)).toEqual([0, 1, 1])
  })

  it('칸 진하기·title·지금 선', () => {
    expect([0, 1, 3, 4, 9].map(heatLevel)).toEqual([0, 1, 3, 4, 4])
    expect(hourTitle(14, { tasks: 3, commits: 2 })).toBe('14:00–15:00 · 3 tasks · 2 commits')
    expect(hourTitle(9, { tasks: 1, commits: 0 })).toBe('09:00–10:00 · 1 task')
    expect(hourTitle(23, { tasks: 0, commits: 0 })).toBe('23:00–24:00')
    expect(nowShare(day, Date.parse(at(6)))).toBe(0.25)
    expect(nowShare({ ...day, date: '2026-11-12' }, Date.parse(at(6)))).toBeNull()
    expect(nowShare(day, Date.parse(day.to))).toBeNull()
  })
})
