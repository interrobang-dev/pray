/**
 * 설치판 트레이의 업데이트 알림·메뉴 글자와 자식 실행 방식 (Electron 을 쓰지 않는 순수 함수).
 * 업데이트는 electron-updater 가 GitHub Releases(interrobang-dev/pray)에서 받는다 — 받는 것은 뒤에서, 적용은 사람이 누를 때(또는 다음 Quit)
 */
import { join } from 'node:path'
import type { ToastContent } from './toast'

export function updateReadyToast(version: string): ToastContent {
  return {
    title: `Pray ${version} is ready`,
    body: 'Restart Pray from the tray menu to update. Web sessions resume after the restart.',
    attribution: '',
    iconUrl: null,
  }
}

export function updateMenuLabel(version: string): string {
  return `Restart to update (${version})`
}

/** 업데이트 재시작 확인 창 본문. 일하는 세션이 있으면 끊긴다는 것을 먼저 쓴다 */
export function updateConfirmMessage(version: string, working: number, needsApproval: number): string {
  const busy = working + needsApproval
  const lead = busy > 0 ? `${busy} session${busy === 1 ? ' is' : 's are'} working and will be interrupted. ` : ''
  return `${lead}Pray installs ${version} and starts again. The host and server stop, and web sessions come back with --resume.`
}

/** before-input-event 의 키 입력 중 판정에 쓰는 것 (Electron Input 의 일부) */
export interface KeyInput {
  type: string
  key: string
  code: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

/**
 * 트레이 창의 새로고침 키: 조합 키 없는 F5, Ctrl+R (숨긴 기본 메뉴 View → Reload 단축키 — 받아 둔 업데이트가 있으면 설치 확인을 띄워야 해서 같이 가로챈다).
 * Ctrl+R 은 한글 입력 상태에서도 잡히게 `code` 로도 본다. Ctrl+Shift+R(Force Reload)은 메뉴에 그대로 둔다
 */
export function isRefreshKey(input: KeyInput): boolean {
  if (input.type !== 'keyDown' || input.shift || input.alt || input.meta) return false
  if (input.key === 'F5') return !input.control
  return input.control && (input.code === 'KeyR' || input.key.toLowerCase() === 'r')
}

/**
 * 트레이 창에서 돌릴 스크립트: 받아 둔 업데이트 버전을 `<html data-update-ready>` 로 알린다 (null 이면 지운다).
 * 웹(web/src/UpdateBand.tsx)이 이 속성을 보고 화면 위쪽 띠를 띄운다. 페이지를 다시 읽으면 속성이 없어지므로 읽을 때마다 다시 부른다
 */
export function updateBandScript(version: string | null): string {
  return version === null
    ? 'delete document.documentElement.dataset.updateReady'
    : `document.documentElement.dataset.updateReady = ${JSON.stringify(version)}`
}

/** 호스트·서버를 띄우는 방법 */
export interface ChildLaunch {
  /** 실행 파일 (node.exe 또는 Pray.exe) */
  command: string
  host: { cwd: string; entry: string[] }
  server: { cwd: string; entry: string[] }
  /** 자식 env 에 더할 값 */
  env: Record<string, string>
}

/** 설치판: 앱 리소스의 묶은 스크립트를 Pray.exe 를 node 모드로 돌려 띄운다. 웹 빌드·mod·MCP 도 앱 리소스 것을 쓰게 알린다 */
export function packagedLaunch(execPath: string, resourcesDir: string): ChildLaunch {
  const prayDir = join(resourcesDir, 'pray')
  return {
    command: execPath,
    host: { cwd: prayDir, entry: [join(prayDir, 'host.mjs')] },
    server: { cwd: prayDir, entry: [join(prayDir, 'server.mjs')] },
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      PRAY_APP_WEB_DIST: join(resourcesDir, 'web'),
      PRAY_APP_MOD_DIR: join(resourcesDir, 'mod'),
      PRAY_APP_MCP_ENTRY: join(prayDir, 'mcp.mjs'),
    },
  }
}

/** 저장소 실행(개발, 또는 설치판의 "Run host & server from source"): 지금처럼 node + tsx 로 저장소 코드를 띄운다 */
export function sourceLaunch(nodePath: string, repoDir: string): ChildLaunch {
  const entry = ['--import', 'tsx', 'src/index.ts']
  return { command: nodePath, host: { cwd: join(repoDir, 'host'), entry }, server: { cwd: join(repoDir, 'server'), entry }, env: {} }
}
