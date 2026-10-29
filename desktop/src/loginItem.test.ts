import { describe, expect, it } from 'vitest'
import { isLaunchAtLogin, LOGIN_ITEM_NAME, type LaunchItem } from './loginItem'

const EXE = 'D:\\workspace\\@private\\jk-corp\\node_modules\\electron\\dist\\electron.exe'
const ARGS = ['D:\\workspace\\@private\\jk-corp\\desktop']

function item(overrides: Partial<LaunchItem> = {}): LaunchItem {
  return { name: LOGIN_ITEM_NAME, path: EXE, args: ARGS, enabled: true, ...overrides }
}

describe('isLaunchAtLogin', () => {
  it('is on for the registered value with the same args (as getLoginItemSettings returns it)', () => {
    expect(isLaunchAtLogin([item()], ARGS)).toBe(true)
    expect(isLaunchAtLogin([item({ args: ['d:\\workspace\\@private\\JK-CORP\\desktop'] })], ARGS)).toBe(true)
  })

  it('is off without the value, under another name, disabled in Task Manager, or for another checkout', () => {
    expect(isLaunchAtLogin([], ARGS)).toBe(false)
    expect(isLaunchAtLogin([item({ name: 'pray' })], ARGS)).toBe(false)
    expect(isLaunchAtLogin([item({ enabled: false })], ARGS)).toBe(false)
    expect(isLaunchAtLogin([item()], ['D:\\workspace\\@private\\jk-corp.worktrees\\design\\desktop'])).toBe(false)
  })
})
