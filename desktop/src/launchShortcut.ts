/**
 * 저장소 실행의 바로가기 지키기 판정. 트레이는 `pray.exe "<저장소>\desktop"` 로 돌아야 하고 인자가 없으면 Electron 기본 앱이 뜬다.
 * Electron 이 알림 때 만드는 시작 메뉴 `Pray.lnk`·거기서 복사된 작업 표시줄 고정·Run 값이 인자 없이 남은 적이 있어 main.ts 가 주기적으로 고친다
 */
import { normalize } from 'node:path'
import { LOGIN_ITEM_NAME, type LaunchItem } from './loginItem'

export interface ShortcutLink {
  target: string
  args?: string
}

function samePath(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase()
}

/** 이 트레이의 exe 를 가리키는데 인자가 비어 있는 바로가기인지 (다른 프로그램·이미 인자가 있는 것은 건드리지 않는다) */
export function needsAppArg(link: ShortcutLink, execPath: string): boolean {
  return samePath(link.target, execPath) && !link.args?.trim()
}

/** "Launch at login" Run 값이 켜져 있는데 인자가 없는지. launchItems 는 Electron 이 이미 실행 파일 경로로 거른 목록이다 */
export function hasArgLessLoginItem(launchItems: readonly LaunchItem[]): boolean {
  return launchItems.some((item) => item.name === LOGIN_ITEM_NAME && item.enabled && item.args.length === 0)
}
