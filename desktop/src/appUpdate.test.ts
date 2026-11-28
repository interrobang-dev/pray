import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isRefreshKey,
  packagedLaunch,
  sourceLaunch,
  updateBandScript,
  updateConfirmMessage,
  updateMenuLabel,
  updateReadyToast,
  type KeyInput,
} from './appUpdate'

describe('update text', () => {
  it('toast and menu name the version', () => {
    expect(updateReadyToast('0.2.0').title).toBe('Pray 0.2.0 is ready')
    expect(updateMenuLabel('0.2.0')).toBe('Restart to update (0.2.0)')
  })

  it('confirm warns about working sessions first', () => {
    expect(updateConfirmMessage('0.2.0', 0, 0)).toMatch(/^Pray installs 0\.2\.0/)
    expect(updateConfirmMessage('0.2.0', 1, 0)).toMatch(/^1 session is working/)
    expect(updateConfirmMessage('0.2.0', 2, 1)).toMatch(/^3 sessions are working/)
  })
})

describe('refresh key', () => {
  const key = (over: Partial<KeyInput>): KeyInput => ({ type: 'keyDown', key: '', code: '', control: false, shift: false, alt: false, meta: false, ...over })

  it('F5 without modifiers and Ctrl+R', () => {
    expect(isRefreshKey(key({ key: 'F5', code: 'F5' }))).toBe(true)
    expect(isRefreshKey(key({ key: 'r', code: 'KeyR', control: true }))).toBe(true)
    expect(isRefreshKey(key({ key: 'R', code: 'KeyR', control: true }))).toBe(true)
    // 한글 입력 상태
    expect(isRefreshKey(key({ key: 'ㄱ', code: 'KeyR', control: true }))).toBe(true)
  })

  it('ignores other keys, modifiers and key up', () => {
    expect(isRefreshKey(key({ key: 'F5', control: true }))).toBe(false)
    expect(isRefreshKey(key({ key: 'F5', shift: true }))).toBe(false)
    expect(isRefreshKey(key({ key: 'F5', type: 'keyUp' }))).toBe(false)
    expect(isRefreshKey(key({ key: 'r', code: 'KeyR' }))).toBe(false)
    expect(isRefreshKey(key({ key: 'R', code: 'KeyR', control: true, shift: true }))).toBe(false)
    expect(isRefreshKey(key({ key: 'r', code: 'KeyR', control: true, alt: true }))).toBe(false)
    expect(isRefreshKey(key({ key: 't', code: 'KeyT', control: true }))).toBe(false)
  })
})

describe('update band script', () => {
  it('sets or clears the html data attribute', () => {
    expect(updateBandScript('0.2.0')).toBe('document.documentElement.dataset.updateReady = "0.2.0"')
    expect(updateBandScript(null)).toBe('delete document.documentElement.dataset.updateReady')
  })
})

describe('child launch', () => {
  it('packaged: bundled scripts with the app exe in node mode', () => {
    const launch = packagedLaunch('C:/Pray/Pray.exe', 'C:/Pray/resources')
    expect(launch.command).toBe('C:/Pray/Pray.exe')
    expect(launch.host.entry).toEqual([join('C:/Pray/resources', 'pray', 'host.mjs')])
    expect(launch.server.entry).toEqual([join('C:/Pray/resources', 'pray', 'server.mjs')])
    expect(launch.env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      PRAY_APP_WEB_DIST: join('C:/Pray/resources', 'web'),
      PRAY_APP_MOD_DIR: join('C:/Pray/resources', 'mod'),
      PRAY_APP_MCP_ENTRY: join('C:/Pray/resources', 'pray', 'mcp.mjs'),
    })
  })

  it('source: node + tsx in the repo folders, no extra env', () => {
    const launch = sourceLaunch('C:/node.exe', 'D:/pray')
    expect(launch.host).toEqual({ cwd: join('D:/pray', 'host'), entry: ['--import', 'tsx', 'src/index.ts'] })
    expect(launch.server.cwd).toBe(join('D:/pray', 'server'))
    expect(launch.env).toEqual({})
  })
})
