import { describe, expect, it } from 'vitest'
import { normalizeCwd, partOfSession, roleOf, teamOf, type Part, type Team } from './team.js'

const team: Team = { id: 't1', name: '개발', cwd: 'D:\\workspace\\foo', groupId: 'lobby', x: 1, y: 1, desks: {}, parts: [], partOf: {}, todos: [], createdAt: '' }

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

  it('also matches a part worktree folder', () => {
    const withWorktree = { ...team, parts: [worktreePart] }
    expect(teamOf('D:\\workspace\\foo.worktrees\\api', [withWorktree])?.id).toBe('t1')
    expect(teamOf('D:/workspace/foo.worktrees/api', [team])).toBeNull()
  })
})

const worktreePart: Part = { id: 'p1', name: 'api', worktree: { cwd: 'D:/workspace/foo.worktrees/api', branch: 'part/api' }, createdAt: '' }
const folderPart: Part = { id: 'p2', name: '문서', leadSessionId: 'PL', createdAt: '' }

describe('partOfSession', () => {
  const withParts: Team = { ...team, parts: [worktreePart, folderPart], partOf: { S: 'p2', W: 'p2', gone: 'deleted' } }

  it('worktree folder decides the part, ignoring partOf', () => {
    expect(partOfSession('W', 'd:/workspace/foo.worktrees/api/', withParts)?.id).toBe('p1')
  })

  it('team folder uses partOf, otherwise direct', () => {
    expect(partOfSession('S', 'D:/workspace/foo', withParts)?.id).toBe('p2')
    expect(partOfSession('X', 'D:/workspace/foo', withParts)).toBeNull()
    expect(partOfSession('S', 'D:/workspace/foo', null)).toBeNull()
  })

  it('stale partOf falls back to direct', () => {
    expect(partOfSession('gone', 'D:/workspace/foo', withParts)).toBeNull()
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

  it('part lead leads only its part, team lead only direct', () => {
    const withLead = { ...team, leadSessionId: 'L', parts: [folderPart] }
    expect(roleOf('PL', true, withLead, folderPart)).toBe('lead')
    expect(roleOf('PL', true, withLead, null)).toBe('member')
    expect(roleOf('L', true, withLead, folderPart)).toBe('member')
  })
})
