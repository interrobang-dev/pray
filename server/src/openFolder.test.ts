import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { explorerArgument, explorerSelectArgument, openFolderRejection, revealFileRejection, selectInExplorer } from './openFolder.js'

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

describe('revealFileRejection', () => {
  it('passes a local request from this app', () => {
    expect(revealFileRejection({ isLocal: true, isLocalPage: true })).toBeNull()
  })

  it('rejects another PC first, then a page that is not this app on this PC', () => {
    expect(revealFileRejection({ isLocal: false, isLocalPage: false })).toEqual({ status: 403, message: 'Folders open only on this PC' })
    expect(revealFileRejection({ isLocal: true, isLocalPage: false })).toEqual({ status: 403, message: 'Requests must come from this app on this PC' })
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

describe('selectInExplorer', () => {
  it('quotes the file after /select, so commas and spaces stay in the path', () => {
    expect(explorerSelectArgument('D:/a b/c,d.txt')).toBe('/select,"D:\\a b\\c,d.txt"')
  })

  it('spawns explorer without a shell, verbatim, detached, and listens for errors', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const spawnProcess = vi.fn(() => child) as unknown as typeof spawn
    selectInExplorer('C:\\x\\a.txt', spawnProcess)
    expect(spawnProcess).toHaveBeenCalledWith('explorer.exe', ['/select,"C:\\x\\a.txt"'],{ detached: true, stdio: 'ignore', windowsVerbatimArguments: true })
    expect(child.listenerCount('error')).toBe(1)
    expect(child.unref).toHaveBeenCalled()
  })
})
