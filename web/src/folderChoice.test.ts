import { describe, expect, it } from 'vitest'
import { chosenFolderInfo, folderNameOf, gitInitBlockReason, isSameFolder, type FolderListing } from './folderChoice'

const listing: FolderListing = {
  path: 'D:\\workspace',
  parent: 'D:\\',
  entries: [
    { name: 'repo', path: 'D:\\workspace\\repo', vcs: 'git', teamName: 'Repo' },
    { name: 'plain', path: 'D:\\workspace\\plain', vcs: null, teamName: null },
  ],
  isTruncated: false,
  hiddenCount: 0,
  vcsAbove: null,
  teamName: null,
}

describe('folderNameOf', () => {
  it('takes the last folder name, and nothing for a drive root', () => {
    expect(folderNameOf('D:\\workspace\\foo')).toBe('foo')
    expect(folderNameOf('D:/workspace/foo/')).toBe('foo')
    expect(folderNameOf('D:\\')).toBe('')
    expect(folderNameOf('')).toBe('')
  })
})

describe('chosenFolderInfo', () => {
  it('uses the row itself for a picked folder, else the current folder', () => {
    expect(chosenFolderInfo(listing, listing.entries[0])).toEqual({ path: 'D:\\workspace\\repo', vcs: { kind: 'git', root: 'D:\\workspace\\repo' }, teamName: 'Repo' })
    expect(chosenFolderInfo(listing, listing.entries[1])).toEqual({ path: 'D:\\workspace\\plain', vcs: null, teamName: null })
    expect(chosenFolderInfo(listing, null)).toEqual({ path: 'D:\\workspace', vcs: null, teamName: null })
  })

  it('a folder inside a repository inherits the repository above', () => {
    const inside = { ...listing, vcsAbove: { kind: 'svn' as const, root: 'D:\\' } }
    expect(chosenFolderInfo(inside, inside.entries[1])?.vcs).toEqual({ kind: 'svn', root: 'D:\\' })
  })

  it('nothing to choose in the drive list without a row', () => {
    expect(chosenFolderInfo({ ...listing, path: null, parent: null }, null)).toBeNull()
  })
})

describe('gitInitBlockReason', () => {
  it('allows only a checked folder outside a repository', () => {
    expect(gitInitBlockReason({ kind: 'folder', path: 'D:\\a', vcs: null, teamName: null })).toBeNull()
    expect(gitInitBlockReason({ kind: 'folder', path: 'D:\\a', vcs: { kind: 'git', root: 'D:\\' }, teamName: null })).toBe('Already inside a git repository: D:\\')
    expect(gitInitBlockReason({ kind: 'empty' })).toBe('Choose a work folder first')
    expect(gitInitBlockReason({ kind: 'checking', path: 'D:\\a' })).toBe('Checking the folder…')
    expect(gitInitBlockReason({ kind: 'error', path: 'D:\\a', message: 'Folder not found: D:\\a' })).toBe('Folder not found: D:\\a')
  })
})

describe('isSameFolder', () => {
  it('ignores case, separators and the trailing separator', () => {
    expect(isSameFolder('D:\\Workspace\\Foo\\', 'd:/workspace/foo')).toBe(true)
    expect(isSameFolder('D:\\a', 'D:\\ab')).toBe(false)
  })
})
