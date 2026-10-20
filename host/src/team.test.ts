import { describe, expect, it } from 'vitest'
import { normalizeCwd, roleOf, teamOf, type Team } from './team.js'

const team: Team = { id: 't1', name: '개발', cwd: 'D:\\workspace\\foo', roomId: 'lobby', x: 1, y: 1, desks: {}, createdAt: '' }

describe('normalizeCwd', () => {
  it('ignores case, separators and trailing slash', () => {
    expect(normalizeCwd('D:\\Workspace\\Foo\\')).toBe('d:/workspace/foo')
    expect(normalizeCwd('d:/workspace/foo')).toBe('d:/workspace/foo')
  })
})

describe('teamOf', () => {
  it('matches the exact folder only', () => {
    expect(teamOf('d:/workspace/foo/', [team])?.id).toBe('t1')
    expect(teamOf('D:/workspace/foo/sub', [team])).toBeNull()
    expect(teamOf('', [team])).toBeNull()
  })
})

describe('roleOf', () => {
  it('lead, web member, external null', () => {
    const withLead = { ...team, leadSessionId: 'L' }
    expect(roleOf('L', true, withLead)).toBe('lead')
    expect(roleOf('L', false, withLead)).toBe('lead')
    expect(roleOf('M', true, withLead)).toBe('member')
    expect(roleOf('X', false, withLead)).toBeNull()
    expect(roleOf('M', true, null)).toBeNull()
  })
})
