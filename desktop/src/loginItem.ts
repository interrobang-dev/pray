/**
 * "Launch at login" 의 Run 레지스트리 값 이름. Electron 은 기본으로 알림 ID(AppUserModelId)를 값 이름으로 쓰는데,
 * 알림 ID 를 정하기 전에 등록된 실제 값이 이 이름(그때의 기본 ID)이라 고정한다 — 알림 ID 를 바꿔도 체크 표시가 어긋나지 않게
 */
export const LOGIN_ITEM_NAME = 'electron.app.Electron'

export interface LaunchItem {
  name: string
  path: string
  args: string[]
  enabled: boolean
}

/**
 * Run 값 중 이 이름·이 실행 파일·이 인자로 켜진 것이 있는지. `getLoginItemSettings().openAtLogin` 은 알림 ID 이름의 값만 보고
 * 그마저 맞지 않아(실측: 실제 값이 있어도 false) 쓰지 않는다. launchItems 는 Electron 이 이미 실행 파일 경로로 거른 목록이다
 */
export function isLaunchAtLogin(launchItems: readonly LaunchItem[], args: readonly string[]): boolean {
  return launchItems.some(
    (item) =>
      item.name === LOGIN_ITEM_NAME &&
      item.enabled &&
      item.args.length === args.length &&
      item.args.every((arg, index) => arg.toLowerCase() === args[index].toLowerCase()),
  )
}
