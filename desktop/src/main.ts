import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell, type NativeImage } from 'electron'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Child } from './children'
import { moveAppDataOnce, resolveDataDir } from './dataDir'
import { isExternalUrl } from './externalLink'
import { appIconIco, noticeIconPng, trayIconPng } from './icon'
import { isPipeAlive, LEGACY_PIPE_PATH } from './legacyHost'
import { isLaunchAtLogin, LOGIN_ITEM_NAME } from './loginItem'
import {
  bundleLine,
  bundleToast,
  diffSessions,
  noticeToast,
  placeOf,
  urgentKind,
  type NotifyKind,
  type NotifyOffice,
  type NotifySession,
  type SessionNotice,
  type StatusBaseline,
} from './notify'
import { toastXml, type ToastContent } from './toast'

const SERVER_URL = 'http://127.0.0.1:4710'
const repoDir = resolve(__dirname, '..', '..')
/** `~/.claude/pray/logs`. 잠금을 얻은 뒤 자식을 띄우기 전에 설정 폴더를 옮기며 정한다 */
let logDir = ''

let tray: Tray | null = null
let window: BrowserWindow | null = null
let isQuitting = false
let status = { working: 0, needsApproval: 0, isServerUp: false }
/**
 * 세션별 직전 표시 상태. null 이면 다음 폴링은 기준만 잡는다: 시작·서버 무응답·호스트나 서버 자식이 바뀐 뒤
 * (서버가 새로 뜨면 훅 상태가 없어 jsonl 로 다시 만든 상태라 그 전환을 믿지 않는다)
 */
let baseline: StatusBaseline | null = null
/** 한 번 폴링에 이보다 많으면 한 장으로 묶는다 */
const MAX_SEPARATE_NOTICES = 3
/** 클릭 처리기가 GC 로 사라지지 않게 떠 있는 알림을 잡아 둔다 */
const shownNotifications = new Set<Notification>()
let settings = { isNotifying: true }

/** 트레이 전용 설정 (hq.json·config.json 과 따로) */
function settingsPath(): string {
  return join(app.getPath('userData'), 'tray-settings.json')
}

function loadSettings(): void {
  try {
    const saved = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { isNotifying?: unknown }
    if (typeof saved.isNotifying === 'boolean') settings = { ...settings, isNotifying: saved.isNotifying }
  } catch {
    // 없거나 깨졌으면 기본값
  }
}

function saveSettings(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings))
  } catch (error) {
    console.error('Failed to save tray settings', error)
  }
}

function findExe(name: string): string {
  try {
    return execSync(`where ${name}`, { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  } catch {
    throw new Error(`Couldn't find ${name} on PATH`)
  }
}

/** 앱 자체가 Claude 세션 안에서 실행됐을 때 상속되는 변수를 지운다 (CLAUDE* 는 중첩 실행 종료, NO_COLOR 는 무색 렌더링) */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_') || key.startsWith('ELECTRON_') || key === 'NO_COLOR') continue
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
    { name: 'host', cwd: join(repoDir, 'host'), args: [`--log=${join(logDir, 'host.log')}`, `--claude=${claude}`] },
    node,
    env,
  )
  const server = new Child(
    { name: 'server', cwd: join(repoDir, 'server'), args: [`--log=${join(logDir, 'server.log')}`] },
    node,
    env,
  )
  return { host, server }
}

/**
 * 창 아이콘. .ico 파일 경로로 줘야 Electron 이 작은(제목 표시줄)·큰(작업 표시줄) 아이콘을 ico 안의 그 크기 항목에서 고른다 —
 * PNG 버퍼는 여러 배율을 넣어도 1배 한 장을 둘 다에 쓴다 (사본 electron.exe 로 WM_GETICON 실측: 버퍼 32·32, ico 32·16).
 * 코드가 바뀌면 따라가게 띄울 때마다 앱 데이터 폴더에 새로 쓴다
 */
function windowIcon(): string | NativeImage {
  const path = join(app.getPath('userData'), 'icon.ico')
  try {
    writeFileSync(path, appIconIco())
    return path
  } catch (error) {
    console.warn(`창 아이콘 ${path} 를 못 써서 32px PNG 로 띄운다: ${String(error)}`)
    return nativeImage.createFromBuffer(trayIconPng(false))
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Pray',
    autoHideMenuBar: true,
    icon: windowIcon(),
    show: false,
  })
  win.once('ready-to-show', () => win.show())
  // 대화 속 웹 링크(target=_blank)가 새 Pray 창이 아니라 기본 브라우저로 열리게
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isExternalUrl(url, SERVER_URL)) return { action: 'allow' }
    shell.openExternal(url).catch((error: unknown) => console.error(`Failed to open ${url}`, error))
    return { action: 'deny' }
  })
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

/** sessionId 가 있으면 그 세션 패널을 연다: 웹 화면이 `#session=<id>` 를 읽어 고르고 해시를 지운다 (떠 있는 창은 hashchange) */
async function showWindow(sessionId?: string): Promise<void> {
  const hash = sessionId ? `#session=${encodeURIComponent(sessionId)}` : ''
  if (!window || window.isDestroyed()) {
    window = createWindow()
    const isUp = await waitForServer(15_000)
    if (!isUp) {
      dialog.showErrorBox('Pray', `The server didn't start. Check the logs:\n${logDir}`)
    }
    await window.loadURL(SERVER_URL + hash)
  } else if (hash) {
    void window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => undefined)
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** 창이 앞에 있을 때 화면에 열린 세션 ID (웹이 `<html data-open-session>` 에 둔다). 창이 뒤에 있거나 못 읽으면 null */
async function focusedSessionId(): Promise<string | null> {
  if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized() || !window.isFocused()) return null
  try {
    const id: unknown = await window.webContents.executeJavaScript('document.documentElement.dataset.openSession ?? null')
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

/** 종류별 알림 그림 file:// URL. 이 실행에서 처음 쓸 때 앱 데이터 폴더에 PNG 로 쓴다 (코드가 바뀌면 따라가게). 못 쓰면 null (그림 없이) */
const noticeIconUrls = new Map<NotifyKind, string | null>()
function noticeIconUrl(kind: NotifyKind): string | null {
  if (noticeIconUrls.has(kind)) return noticeIconUrls.get(kind) ?? null
  const path = join(app.getPath('userData'), `notice-${kind}.png`)
  let url: string | null = null
  try {
    writeFileSync(path, noticeIconPng(kind))
    url = pathToFileURL(path).href
  } catch (error) {
    console.warn(`알림 그림 ${path} 를 못 써서 그림 없이 띄운다: ${String(error)}`)
  }
  noticeIconUrls.set(kind, url)
  return url
}

/**
 * toastXml 로 띄우고, XML 을 못 만들거나 failed 가 오면 평범한 title·body 알림으로 한 번 다시 띄운다.
 * 본문·[Open] 클릭은 click 이벤트, [Dismiss] 는 Windows 가 닫아 close 이벤트다 (Electron 44 windows_toast_notification.cc)
 */
function showNotification(content: ToastContent, sessionId?: string, isPlain = false): void {
  let xml: string | null = null
  if (!isPlain) {
    try {
      xml = toastXml(content)
    } catch (error) {
      console.warn(`알림 XML 을 못 만들어 평범한 알림으로 띄운다: ${String(error)}`)
    }
  }
  const notification = xml
    ? new Notification({ toastXml: xml })
    : new Notification({ title: content.title, body: content.body, icon: nativeImage.createFromBuffer(trayIconPng(false)) })
  shownNotifications.add(notification)
  const release = () => shownNotifications.delete(notification)
  notification.on('click', () => {
    release()
    void showWindow(sessionId)
  })
  notification.on('close', release)
  notification.on('failed', (_event, error) => {
    release()
    if (!xml) return
    console.warn(`토스트 XML 알림이 실패해 평범한 알림으로 다시 띄운다: ${error}`)
    showNotification(content, sessionId, true)
  })
  notification.show()
}

/** 알림에 그룹·팀·파트 이름을 붙이려고 알릴 것이 있을 때만 받는다. 못 받으면 null (이름 없이 알린다) */
async function fetchOffice(): Promise<NotifyOffice | null> {
  try {
    const response = await fetch(`${SERVER_URL}/api/office`)
    return response.ok ? ((await response.json()) as NotifyOffice) : null
  } catch {
    return null
  }
}

/** 창이 앞에 있고 그 세션이 열려 있으면 빼고 띄운다. 많으면 한 장으로 묶고 누르면 창만 연다 */
async function notify(notices: SessionNotice[], sessions: NotifySession[]): Promise<void> {
  if (!settings.isNotifying || notices.length === 0 || !Notification.isSupported()) return
  const openId = await focusedSessionId()
  const shown = notices.filter((notice) => notice.sessionId !== openId)
  if (shown.length === 0) return
  const office = await fetchOffice()
  const sessionOf = (sessionId: string) => sessions.find((each) => each.id === sessionId)
  const placeFor = (sessionId: string) => {
    const session = sessionOf(sessionId)
    return session ? placeOf(session, office) : null
  }
  if (shown.length > MAX_SEPARATE_NOTICES) {
    const lines = shown.map((notice) => bundleLine(notice.title, placeFor(notice.sessionId)))
    showNotification(bundleToast(lines, noticeIconUrl(urgentKind(shown.map((notice) => notice.kind)))))
    return
  }
  for (const notice of shown) {
    const content = noticeToast(notice, sessionOf(notice.sessionId), placeFor(notice.sessionId), noticeIconUrl(notice.kind))
    showNotification(content, notice.sessionId)
  }
}

async function pollStatus(): Promise<void> {
  try {
    const response = await fetch(`${SERVER_URL}/api/sessions`)
    const data = (await response.json()) as { sessions: NotifySession[] }
    const alive = data.sessions.filter((s) => s.isAlive)
    status = {
      isServerUp: true,
      working: alive.filter((s) => s.status === 'working').length,
      needsApproval: alive.filter((s) => s.status === 'needs-approval').length,
    }
    const { next, notices } = diffSessions(baseline, data.sessions)
    baseline = next
    void notify(notices, data.sessions)
  } catch {
    status = { ...status, isServerUp: false }
    baseline = null
  }
  refreshTray()
}

let children: { host: Child; server: Child } | null = null

function refreshTray(): void {
  if (!tray || !children) return
  const isAlert = status.needsApproval > 0
  tray.setImage(nativeImage.createFromBuffer(trayIconPng(isAlert)))
  const summary = status.isServerUp
    ? `Working ${status.working} · Needs approval ${status.needsApproval}`
    : 'Server not responding'
  tray.setToolTip(`Pray · ${summary}`)
  const { host, server } = children
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => void showWindow() },
      { label: summary, enabled: false },
      { type: 'separator' },
      { label: `Host: ${host.isRunning ? 'Running' : 'Stopped'}`, enabled: false },
      { label: `Server: ${server.isRunning ? 'Running' : 'Stopped'}`, enabled: false },
      { label: 'Restart server', click: () => void server.restart() },
      {
        label: 'Restart host (disconnects web sessions)',
        click: async () => {
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['Restart', 'Cancel'],
            defaultId: 1,
            message: 'Restarting the host disconnects all web sessions. They come back with --resume when it starts again.',
          })
          if (response === 0) void host.restart()
        },
      },
      { label: 'Open log folder', click: () => void shell.openPath(logDir) },
      { type: 'separator' },
      {
        label: 'Launch at login',
        type: 'checkbox',
        checked: isLaunchAtLogin(app.getLoginItemSettings(loginItemOptions()).launchItems, loginItemOptions().args ?? []),
        click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), name: LOGIN_ITEM_NAME, openAtLogin: item.checked }),
      },
      {
        label: 'Notifications',
        type: 'checkbox',
        checked: settings.isNotifying,
        click: (item) => {
          settings = { ...settings, isNotifying: item.checked }
          saveSettings()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: async () => {
          const { response } = await dialog.showMessageBox({
            type: 'warning',
            buttons: ['Quit', 'Cancel'],
            defaultId: 1,
            message: 'Quitting stops the host and server and disconnects all web sessions. They come back with --resume on next launch.',
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

// 앱 데이터 폴더는 패키지 이름을 따라 %APPDATA%\@pray\desktop 이다. 옛 @jk-corp\desktop(창 설정·tray-settings.json)을 잠금 전에 옮긴다.
// 못 옮기면(옛 트레이가 잠금을 쥐고 있음) 옛 폴더를 그대로 써서 같은 잠금으로 옛 트레이와 같이 뜨지 않는다
const appData = moveAppDataOnce(join(app.getPath('appData'), '@jk-corp', 'desktop'), app.getPath('userData'))
const isLegacyAppData = appData.dir !== app.getPath('userData')
if (isLegacyAppData) app.setPath('userData', appData.dir)
if (appData.warning) console.warn(appData.warning)
const OLD_TRAY_MESSAGE = 'An older version is still running. Quit the old tray first, then start Pray again.'

if (!app.requestSingleInstanceLock()) {
  // 옛 폴더의 잠금을 못 얻었으면 옛 트레이가 떠 있다 (옛 트레이는 second-instance 로 자기 창을 연다)
  if (isLegacyAppData) dialog.showErrorBox('Pray', OLD_TRAY_MESSAGE)
  app.quit()
} else {
  // 알림을 Windows 에 'pray' ID 로 올린다 (알림 기록·설정이 이 ID 로 묶인다. 대소문자는 가리지 않는다).
  // 알림 머리의 앱 이름은 이 ID 를 가진 시작 메뉴 바로가기 이름, 아이콘은 exe 아이콘이다 — Electron 이 알림을 띄울 때
  // `<exe 제품 이름>.lnk` 를 만들어 ID 를 넣는다(실측). 제품 이름·아이콘은 postinstall 의 scripts/brand-electron.mts 가 Pray 로 바꾼다.
  // 로그인 시 자동 실행의 Run 값 이름은 이 ID 를 따르지 않게 LOGIN_ITEM_NAME 으로 고정한다
  app.setAppUserModelId('pray')
  app.on('second-instance', () => void showWindow())
  app.on('window-all-closed', () => {
    // 트레이 앱: 창이 다 닫혀도 종료하지 않는다
  })
  app.on('before-quit', () => {
    isQuitting = true
  })

  void app.whenReady().then(async () => {
    // 옛 이름의 트레이(또는 스케줄러 호스트)가 떠 있으면 뜨지 않는다 — pipe·잠금 폴더 이름이 달라 서로를 못 보고 같은 웹 세션을 두 번 resume 한다
    if (await isPipeAlive(LEGACY_PIPE_PATH)) {
      dialog.showErrorBox('Pray', OLD_TRAY_MESSAGE)
      app.quit()
      return
    }
    // 호스트·서버보다 먼저 옛 설정 폴더 ~/.claude/jk-corp 를 옮긴다 (자식은 --log 로 받은 폴더에 로그를 연다)
    const dataDir = resolveDataDir(join(homedir(), '.claude'))
    if (dataDir.warning) console.warn(dataDir.warning)
    logDir = join(dataDir.dir, 'logs')
    try {
      children = createChildren()
    } catch (error) {
      dialog.showErrorBox('Pray', String(error))
      app.quit()
      return
    }
    loadSettings()
    tray = new Tray(nativeImage.createFromBuffer(trayIconPng(false)))
    tray.on('click', () => void showWindow())
    for (const child of [children.host, children.server]) {
      child.on('change', () => {
        baseline = null
        refreshTray()
      })
      child.on('gaveUp', (name: string) => {
        dialog.showErrorBox('Pray', `The ${name} keeps crashing, so it won't be restarted again. Logs: ${logDir}`)
      })
    }
    children.host.start()
    children.server.start()
    refreshTray()
    setInterval(() => void pollStatus(), 5000)
    if (!existsSync(join(repoDir, 'web', 'dist'))) {
      dialog.showErrorBox('Pray', 'web/dist not found. Run npm run build first.')
    }
    await showWindow()
  })
}
