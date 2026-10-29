import { describe, expect, it } from 'vitest'
import { explorerArgument, openFolderRejection } from './openFolder.js'

describe('openFolderRejection', () => {
  it('passes a local request for an existing team folder', () => {
    expect(openFolderRejection({ isLocal: true, hasTeam: true, isDirectory: true })).toBeNull()
  })

  it('rejects another PC first, before telling whether the team exists', () => {
    expect(openFolderRejection({ isLocal: false, hasTeam: false, isDirectory: false })).toEqual({ status: 403, message: 'Folders open only on this PC' })
  })

  it('404 when the team or its folder is missing', () => {
    expect(openFolderRejection({ isLocal: true, hasTeam: false, isDirectory: false })).toEqual({ status: 404, message: 'Team not found' })
    expect(openFolderRejection({ isLocal: true, hasTeam: true, isDirectory: false })).toEqual({ status: 404, message: 'Team folder not found' })
  })
})

describe('explorerArgument', () => {
  it('uses Windows separators and always quotes', () => {
    expect(explorerArgument('D:/workspace/@private/jk-corp')).toBe('"D:\\workspace\\@private\\jk-corp"')
    expect(explorerArgument('D:\\a b\\c,d')).toBe('"D:\\a b\\c,d"')
  })

  it('drops trailing separators but keeps a drive root', () => {
    expect(explorerArgument('D:\\work\\app\\')).toBe('"D:\\work\\app"')
    expect(explorerArgument('D:/work/app//')).toBe('"D:\\work\\app"')
    expect(explorerArgument('D:/')).toBe('"D:\\"')
  })
})
