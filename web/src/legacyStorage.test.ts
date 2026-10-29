import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APPEARANCE_BOOT_KEY, APPEARANCE_KEY, THEME_KEY } from './appearance'
import { copyLegacyKeys, LEGACY_STORAGE_NAMES, STORAGE_PREFIX } from './legacyStorage'

function fakeStorage(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe('copyLegacyKeys', () => {
  it('새 키가 없으면 옛 값을 새 키에 쓰고 옛 키는 남긴다', () => {
    const storage = fakeStorage({ 'jk-corp.theme': 'dark', 'jk-corp.collapsedGroups': '["g1"]', 'jk-corp.isOffDutyOpen': 'true' })
    expect(copyLegacyKeys(storage)).toEqual(['pray.theme', 'pray.collapsedGroups', 'pray.isOffDutyOpen'])
    expect(Object.fromEntries(storage.values)).toEqual({
      'jk-corp.theme': 'dark',
      'jk-corp.collapsedGroups': '["g1"]',
      'jk-corp.isOffDutyOpen': 'true',
      'pray.theme': 'dark',
      'pray.collapsedGroups': '["g1"]',
      'pray.isOffDutyOpen': 'true',
    })
  })

  it('새 키가 이미 있으면 그대로 두고, 옛 키가 없으면 아무것도 안 쓴다', () => {
    const storage = fakeStorage({ 'jk-corp.theme': 'dark', 'pray.theme': 'light', 'jk-corp.isOfficeHidden': '' })
    expect(copyLegacyKeys(storage)).toEqual(['pray.isOfficeHidden'])
    expect(storage.values.get('pray.theme')).toBe('light')
    expect(storage.values.get('pray.isOfficeHidden')).toBe('')
    expect(copyLegacyKeys(fakeStorage({}))).toEqual([])
  })

  it('목록 밖의 옛 키는 옮기지 않는다', () => {
    const storage = fakeStorage({ 'jk-corp.officeStyle': 'classic' })
    expect(copyLegacyKeys(storage)).toEqual([])
  })

  it('저장소가 막히면 던진다 (부르는 쪽이 잡는다)', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
    }
    expect(() => copyLegacyKeys(blocked)).toThrow('blocked')
  })

  it('목록은 화면이 지금 읽고 쓰는 키와 같다', () => {
    const keys = LEGACY_STORAGE_NAMES.map((name) => STORAGE_PREFIX + name)
    for (const key of [THEME_KEY, APPEARANCE_KEY, APPEARANCE_BOOT_KEY]) expect(keys).toContain(key)
    const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const appKeys = [...appSource.matchAll(/_KEY = '([^']+)'/g)].map((match) => match[1])
    expect(appKeys.sort()).toEqual(keys.filter((key) => ![THEME_KEY, APPEARANCE_KEY, APPEARANCE_BOOT_KEY].includes(key)).sort())
  })
})
