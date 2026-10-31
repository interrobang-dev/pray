import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from './types'
import { ancestorFolders, joinPath, nameOf, splitFileName, treeRows, type FolderState } from './workspaceTree'

const dir = (name: string): WorkspaceEntry => ({ name, kind: 'dir', size: 0, mtime: '2026-10-28T00:00:00.000Z' })
const file = (name: string): WorkspaceEntry => ({ name, kind: 'file', size: 1, mtime: '2026-10-28T00:00:00.000Z' })
const ok = (entries: WorkspaceEntry[], hiddenCount = 0, isTruncated = false): FolderState => ({ status: 'ok', listing: { entries, hiddenCount, isTruncated } })

const summary = (rows: ReturnType<typeof treeRows>) => rows.map((row) => `${'  '.repeat(row.depth)}${row.kind === 'entry' ? row.path : `(${row.note})`}`)

describe('workspaceTree', () => {
  it('joins, splits and names paths', () => {
    expect(joinPath('', 'a')).toBe('a')
    expect(joinPath('a/b', 'c.ts')).toBe('a/b/c.ts')
    expect(ancestorFolders('a/b/c.ts')).toEqual(['a', 'a/b'])
    expect(ancestorFolders('c.ts')).toEqual([])
    expect(nameOf('a/b/c.ts')).toBe('c.ts')
  })

  it('splits a file name into a stem to shorten and a tail to keep', () => {
    expect(splitFileName('workspaceSearch.test.ts')).toEqual(['workspaceSearch', '.test.ts'])
    expect(splitFileName('App.tsx')).toEqual(['App', '.tsx'])
    expect(splitFileName('README')).toEqual(['README', ''])
    expect(splitFileName('.gitignore')).toEqual(['.gitignore', ''])
    expect(splitFileName('.eslintrc.json')).toEqual(['.eslintrc', '.json'])
    // 꼬리가 길면 마지막 점부터만
    expect(splitFileName('2026-10-20-session.office-design.md')).toEqual(['2026-10-20-session.office-design', '.md'])
    // 마지막 점 뒤도 길면 나누지 않는다
    expect(splitFileName('a.verylongextension')).toEqual(['a.verylongextension', ''])
    expect(splitFileName('trailing.')).toEqual(['trailing', '.'])
  })

  it('flattens only expanded folders, with loading and error notes', () => {
    const folders: Record<string, FolderState> = {
      '': ok([dir('src'), dir('web'), dir('docs'), file('README.md')], 2),
      src: ok([dir('deep'), file('index.ts')]),
      'src/deep': { status: 'loading' },
      docs: { status: 'error', message: 'Not found' },
      web: ok([file('a.ts')]),
    }
    const rows = treeRows(folders, new Set(['src', 'src/deep', 'docs']))
    expect(summary(rows)).toEqual(['src', '  src/deep', '    (loading)', '  src/index.ts', 'web', 'docs', '  (error)', 'README.md', '(hidden)'])
    expect(rows.find((row) => row.kind === 'note' && row.note === 'hidden')).toMatchObject({ text: '2 hidden' })
    expect(rows.find((row) => row.kind === 'entry' && row.path === 'web')).toMatchObject({ isExpanded: false })
  })

  it('shows empty and truncated folders', () => {
    const rows = treeRows({ '': ok([dir('empty')], 0, true), empty: ok([]) }, new Set(['empty']))
    expect(summary(rows)).toEqual(['empty', '  (empty)', '(truncated)'])
    expect(rows[2]).toMatchObject({ text: 'Showing the first 1 items' })
  })

  it('shows loading for a root that has not arrived', () => {
    expect(summary(treeRows({}, new Set()))).toEqual(['(loading)'])
  })
})
