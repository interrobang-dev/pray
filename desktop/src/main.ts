import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from 'electron'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Child } from './children'
import { trayIconPng } from './icon'

const SERVER_URL = 'http://127.0.0.1:4710'
const repoDir = resolve(__dirname, '..', '..')
const logDir = join(homedir(), '.claude', 'jk-corp', 'logs')

let tray: Tray | null = null
let window: BrowserWindow | null = null
let isQuitting = false
let status = { working: 0, needsApproval: 0, isServerUp: false }

function findExe(name: string): string {
  try {
    return execSync(`where ${name}`, { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  } catch {
    throw new Error(`${name} 을(를) PATH 에서 찾지 못했습니다`)
  }
}

/** 앱 자체가 Claude 세션 안에서 실행됐을 때 상속되는 변수를 지운다 (자식 claude 가 중첩 실행으로 종료됨) */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  return env
}

function createChildren(): { host: Child; server: Child } {
  mkdirSync(logDir, { recursive: true })
  const node = findExe('node')
  const claude = findExe('claude')
  const env = childEnv()
  const host = new Child(
    { name: 'host', cwd: join(repoDir, 'host'), args: [`--log=${join(logDir, 'jk-corp-host.log')}`, `--claude=${claude}`] },
    node,
    env,
  )
  const server = new Child(
    { name: 'server', cwd: join(repoDir, 'server'), args: [`--log=${join(logDir, 'jk-corp-server.log')}`] },
    node,
    env,
  )
  return { host, server }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'jk-corp',
    autoHideMenuBar: true,
    icon: nativeImage.createFromBuffer(trayIconPng(false)),
    show: false,
  })
  win.once('ready-to-show', () => win.show())
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })
  return win
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVER_URL}/api/auth/me`)
      if (response.ok) return true
    } catch {
      // 아직 안 뜸
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function showWindow(): Promise<void> {
  if (!window || window.isDestroyed()) {
    window = createWindow()
    const isUp = await waitForServer(15_000)
    if (!isUp) {
      dialog.showErrorBox('jk-corp', `서버가 뜨지 않았습니다. 로그를 확인하세요:\n${logDir}`)
    }
    await window.loadURL(SERVER_URL)
  }
  window.show()
  window.focus()
}

async function pollStatus(): Promise<void> {
  try {
    const response = await fetch(`${SERVER_URL}/api/sessions`)
    const data = (await response.json()) as { sessions: { status: string; isAlive: boolean }[] }
    const alive = data.sessions.filter((s) => s.isAlive)
    status = {
      isServerUp: true,
      working: alive.filter((s) => s.status === 'working').length,
      needsApproval: alive.filter((s) => s.status === 'needs-approval').length,
    }
  } catch {
    status = { ...status, isServerUp: false }
  }
  refreshTray()
}

let children: { host: Child; server: Child } | null = null

function refreshTray(): void {
  if (!tray || !children) return
  const isAlert = status.needsApproval > 0
  tray.setImage(nativeImage.createFromBuffer(trayIconPng(isAlert)))
  const summary = status.isServerUp
    ? `작업중 ${status.working} · 승인 대기 ${status.needsApproval}`
    : '서버 응답 없음'
  tray.setToolTip(`jk-corp · ${summary}`)
  const { host, server } = children
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '열기', click: () => void showWindow() },
      { label: summary, enabled: false },
      { type: 'separator' },
      { label: `호스트: ${host.isRunning ? '실행 중' : '꺼짐'}`, enabled: false },
      { label: `서버: ${server.isRunning ? '실행 중' : '꺼짐'}`, enabled: false },
      { label: '서버 재시작', click: () => void server.restart() },
      {
        label: '호스트 재시작 (웹 세션 끊김)',
        click: async () => {
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['재시작', '취소'],
            defaultId: 1,
            message: '호스트를 재시작하면 웹 세션이 모두 끊깁니다. 다시 뜰 때 --resume 으로 복구됩니다.',
          })
          if (response === 0) void host.restart()
        },
      },
      { label: '로그 폴더 열기', click: () => void shell.openPath(logDir) },
      { type: 'separator' },
      {
        label: '로그인 시 자동 실행',
        type: 'checkbox',
        checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
        click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
      },
      { type: 'separator' },
      {
        label: '종료',
        click: async () => {
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['종료', '취소'],
            defaultId: 1,
            message: '종료하면 호스트·서버가 꺼지고 웹 세션이 모두 끊깁니다. 다음 실행 때 --resume 으로 복구됩니다.',
          })
          if (response === 0) quit()
        },
      },
    ]),
  )
}

/** 개발 실행(electron .)에서는 execPath 가 electron.exe 라 앱 경로를 인자로 넘겨야 한다 */
function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [resolve(__dirname, '..')] }
}

async function quit(): Promise<void> {
  isQuitting = true
  if (children) await Promise.all([children.server.stop(), children.host.stop()])
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => void showWindow())
  app.on('window-all-closed', () => {
    // 트레이 앱: 창이 다 닫혀도 종료하지 않는다
  })
  app.on('before-quit', () => {
    isQuitting = true
  })

  void app.whenReady().then(async () => {
    try {
      children = createChildren()
    } catch (error) {
      dialog.showErrorBox('jk-corp', String(error))
      app.quit()
      return
    }
    tray = new Tray(nativeImage.createFromBuffer(trayIconPng(false)))
    tray.on('click', () => void showWindow())
    for (const child of [children.host, children.server]) {
      child.on('change', refreshTray)
      child.on('gaveUp', (name: string) => {
        dialog.showErrorBox('jk-corp', `${name} 가 계속 죽어서 재시작을 멈췄습니다. 로그: ${logDir}`)
      })
    }
    children.host.start()
    children.server.start()
    refreshTray()
    setInterval(() => void pollStatus(), 5000)
    if (!existsSync(join(repoDir, 'web', 'dist'))) {
      dialog.showErrorBox('jk-corp', 'web/dist 가 없습니다. 먼저 npm run build 를 실행하세요.')
    }
    await showWindow()
  })
}
