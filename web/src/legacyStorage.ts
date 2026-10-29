/**
 * localStorage 키 이름 옮기기 (순수). 키는 `pray.<이름>` 이고 이름을 바꾸기 전에는 `jk-corp.<이름>` 이었다.
 * 키를 새로 만들면 이 목록에는 넣지 않는다 — 옛 이름으로 저장된 적이 있는 키만 옮긴다
 */
export const STORAGE_PREFIX = 'pray.'
export const LEGACY_STORAGE_PREFIX = 'jk-corp.'

/** 옛 이름으로 저장된 적이 있는 키 7개의 뒷부분 (appearance.ts 3개·App.tsx 4개) */
export const LEGACY_STORAGE_NAMES = ['theme', 'appearance', 'appearanceBoot', 'isOfficeHidden', 'collapsedGroups', 'isFocusZoneCollapsed', 'isOffDutyOpen'] as const

/**
 * 새 키가 없고 옛 키가 있으면 옛 값을 새 키에 쓴다. 옛 키는 지우지 않는다 (코드를 되돌려도 설정이 남게). 복사한 새 키 목록을 돌려준다.
 * 저장소가 막혀 getItem·setItem 이 던지면 그대로 던진다 (부르는 쪽이 잡는다)
 */
export function copyLegacyKeys(storage: Pick<Storage, 'getItem' | 'setItem'>): string[] {
  const copied: string[] = []
  for (const name of LEGACY_STORAGE_NAMES) {
    const key = STORAGE_PREFIX + name
    if (storage.getItem(key) !== null) continue
    const legacy = storage.getItem(LEGACY_STORAGE_PREFIX + name)
    if (legacy === null) continue
    storage.setItem(key, legacy)
    copied.push(key)
  }
  return copied
}
