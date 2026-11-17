import { describe, expect, it } from 'vitest'
import { hasArgLessLoginItem, needsAppArg } from './launchShortcut'
import { LOGIN_ITEM_NAME, type LaunchItem } from './loginItem'

const EXE = 'D:\\workspace\\pray\\node_modules\\electron\\dist\\pray.exe'

describe('needsAppArg', () => {
  it('fixes a shortcut to this exe without args (Electron writes the notification shortcut that way)', () => {
    expect(needsAppArg({ target: EXE, args: '' }, EXE)).toBe(true)
    expect(needsAppArg({ target: EXE }, EXE)).toBe(true)
    expect(needsAppArg({ target: 'd:/workspace/PRAY/node_modules/electron/dist/pray.exe', args: '  ' }, EXE)).toBe(true)
  })

  it('leaves shortcuts with args and shortcuts to other programs alone', () => {
    expect(needsAppArg({ target: EXE, args: '"D:\\workspace\\pray\\desktop"' }, EXE)).toBe(false)
    expect(needsAppArg({ target: 'C:\\Program Files\\Other\\other.exe', args: '' }, EXE)).toBe(false)
    expect(needsAppArg({ target: 'D:\\workspace\\pray\\node_modules\\electron\\dist\\electron.exe', args: '' }, EXE)).toBe(false)
  })
})

describe('hasArgLessLoginItem', () => {
  const item = (overrides: Partial<LaunchItem> = {}): LaunchItem => ({ name: LOGIN_ITEM_NAME, path: EXE, args: [], enabled: true, ...overrides })

  it('finds the enabled Run value without args', () => {
    expect(hasArgLessLoginItem([item()])).toBe(true)
  })

  it('ignores values with args, other names and values disabled in Task Manager', () => {
    expect(hasArgLessLoginItem([])).toBe(false)
    expect(hasArgLessLoginItem([item({ args: ['D:\\workspace\\pray\\desktop'] })])).toBe(false)
    expect(hasArgLessLoginItem([item({ name: 'Other' })])).toBe(false)
    expect(hasArgLessLoginItem([item({ enabled: false })])).toBe(false)
  })
})
