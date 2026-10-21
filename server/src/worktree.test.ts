import { describe, expect, it } from 'vitest'
import { withTrust, worktreePath, worktreeSlug } from './worktree.js'

describe('worktree', () => {
  it('slug keeps ascii letters, digits and hyphens, else falls back to part id', () => {
    expect(worktreeSlug('API Server', 'p1')).toBe('api-server')
    expect(worktreeSlug('웹 v2!', 'p1')).toBe('v2')
    expect(worktreeSlug('문서', 'p1')).toBe('p1')
  })

  it('path is a sibling folder of the repo with forward slashes', () => {
    expect(worktreePath('D:/workspace/@private/jk-corp', 'api')).toBe('D:/workspace/@private/jk-corp.worktrees/api')
    expect(worktreePath('D:\\workspace\\foo\\', 'web')).toBe('D:/workspace/foo.worktrees/web')
  })

  it('trust adds only the folder key and keeps the rest', () => {
    const before = JSON.stringify({ numStartups: 3, projects: { 'D:/a': { hasTrustDialogAccepted: true, allowedTools: ['x'] } } })
    const after = JSON.parse(withTrust(before, 'D:/a.worktrees/api')!)
    expect(after.numStartups).toBe(3)
    expect(after.projects['D:/a']).toEqual({ hasTrustDialogAccepted: true, allowedTools: ['x'] })
    expect(after.projects['D:/a.worktrees/api']).toEqual({ hasTrustDialogAccepted: true })
    expect(JSON.parse(withTrust('{}', 'D:/b')!).projects).toEqual({ 'D:/b': { hasTrustDialogAccepted: true } })
  })

  it('trust refuses unparsable files', () => {
    expect(withTrust('{ broken', 'D:/a')).toBeNull()
    expect(withTrust('null', 'D:/a')).toBeNull()
  })
})
