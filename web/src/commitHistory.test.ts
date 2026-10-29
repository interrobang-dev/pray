import { describe, expect, it } from 'vitest'
import { appendCommits, commitChatText, commitFileNotes, historyNote, parentNote, refChips } from './commitHistory'
import type { HistoryCommit } from './types'

const commit = (hash: string): HistoryCommit => ({ hash, shortHash: hash.slice(0, 7), subject: hash, authorName: 'a', authorDate: '2026-10-29T00:00:00Z', refs: [], isHead: false })

describe('commitHistory', () => {
  it('turns refs into chips with the current branch and tags', () => {
    expect(refChips({ refs: ['main', 'origin/main', 'tag: v1'], isHead: true })).toEqual([
      { text: 'main', isTag: false, isCurrent: true },
      { text: 'origin/main', isTag: false, isCurrent: false },
      { text: 'v1', isTag: true, isCurrent: false },
    ])
    expect(refChips({ refs: ['feature/x'], isHead: false })[0].isCurrent).toBe(false)
  })

  it('appends the next page without commits that shifted into it', () => {
    expect(appendCommits([commit('a'), commit('b')], [commit('b'), commit('c')]).map((item) => item.hash)).toEqual(['a', 'b', 'c'])
  })

  it('builds the chat text', () => {
    expect(commitChatText({ shortHash: 'abc1234', subject: 'feat(x): 추가' })).toBe('`abc1234` feat(x): 추가')
    expect(commitChatText({ shortHash: 'abc1234', subject: '' })).toBe('`abc1234`')
  })

  it('explains empty, svn, none and error lists', () => {
    const base = { commits: [], hasMore: false, error: null }
    expect(historyNote({ ...base, kind: 'svn' }, false)?.text).toBe('Commit history is available for git only')
    expect(historyNote({ ...base, kind: 'none' }, false)?.text).toBe('Not a git repository')
    expect(historyNote({ ...base, kind: 'git', error: 'git log failed' }, false)).toEqual({ text: 'git log failed', isError: true })
    expect(historyNote({ ...base, kind: 'git' }, true)?.text).toBe('No commits for this file')
    expect(historyNote({ ...base, kind: 'git' }, false)?.text).toBe('No commits yet')
    expect(historyNote({ ...base, kind: 'git', commits: [commit('a')] }, false)).toBeNull()
  })

  it('notes first and merge commits and hidden files', () => {
    expect(parentNote({ parents: [] })).toBe('Initial commit')
    expect(parentNote({ parents: ['a'.repeat(40)] })).toBeNull()
    expect(parentNote({ parents: ['1234567890', 'b'] })).toBe('Merge commit · changes against the first parent 1234567')
    expect(commitFileNotes({ files: [], outsideCount: 2, isTruncated: false })).toEqual(['No changes in this folder', '2 files outside this folder not shown'])
    expect(commitFileNotes({ files: [], outsideCount: 0, isTruncated: false })).toEqual(['No file changes'])
  })
})
