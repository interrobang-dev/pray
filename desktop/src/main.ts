import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, nativeTheme, shell, type NativeImage } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packagedLaunch, sourceLaunch, updateConfirmMessage, updateMenuLabel, updateReadyToast, type ChildLaunch } from './appUpdate'
import { Child } from './children'
import { confirmDialog } from './confirmDialog'
import { moveAppDataOnce, resolveDataDir } from './dataDir'
import { dotLookOf } from './dotCharacter'
import { isExternalUrl, navigationDecision, parseMachines, type PrayMachine } from './externalLink'
import { appIconIco, noticeIconPng, trayIconIco, trayIconPng, type NoticeRingKind } from './icon'
import { isPipeAlive, LEGACY_PIPE_PATH } from './legacyHost'
import { hasArgLessLoginItem, needsAppArg } from './launchShortcut'
import { isLaunchAtLogin, LOGIN_ITEM_NAME } from './loginItem'
import { HOOK_MENU_LABEL, hookWarningOf, hookWarningToast, shouldNotifyHookWarning } from './hookNotice'
import {
  allowedNotices,
  isNoticeAllowed,
  legacyNotificationFile,
  readNotificationSettings,
  writeNotificationPatch,
  type NotificationSettings,
} from './notificationSettings'
import {
  buildFaceArt,
  FACE_SHEET,
  faceFileKey,
  facePixels,
  rgbaFromBgra,
  type FaceArt,
  type FaceRecolorJson,
  type FaceSheetJson,
  type RgbaImage,
} from './noticeFace'
import {
  bundleLine,
  bundleToast,
  diffSessions,
  noticeToast,
  placeOf,
  urgentKind,
  type NotifyKind,
  type NotifySession,
  type SessionNotice,
  type StatusBaseline,
} from './notify'
import {
  newlyFiredReminders,
  reminderBundleLine,
  reminderBundleToast,
  reminderSession,
  reminderTarget,
  reminderToast,
  type NotifyReminder,
  type ReminderOffice,
} from './reminderNotice'
import {
  newlyFailedScheduled,
  scheduledBundleLine,
  scheduledBundleToast,
  scheduledSession,
  scheduledToast,
  type NotifyScheduled,
} from './scheduledNotice'
import { DEFAULT_SYMBOL_COLORS, followTitleBarColor, titleBarOverlay } from './titleBar'
import { toastXml, type ToastContent } from './toast'

const SERVER_URL = 'http://127.0.0.1:4710'
/** 저장소 실행(electron desktop)일 때의 저장소 폴더. 설치판에서는 쓰지 않는다 (__dirname 이 app.asar 안이다) */
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
/** sourceDir: 설치판에서 호스트·서버를 저장소 코드(node + tsx)로 띄울 저장소 폴더 ("Run host & server from source", 개발용). null 이면 앱에 묶인 것 */
let settings: { sourceDir: string | null } = { sourceDir: null }
/**
 * 알림 설정 파일 `~/.claude/pray/notifications.json` (전체·종류별·소리. 화면은 서버 API 로 바꾼다). 설정 폴더를 정한 뒤 채운다.
 * 알림을 띄우기 직전·메뉴를 만들 때 매번 읽는다 (작은 파일)
 */
let notificationsPath = ''
/** 이 시각(트레이를 켠 때) 이후에 울린 알림(Reminders)만 Windows 알림으로 띄운다. 켜기 전에 울린 것은 화면 배지로 본다 */
const REMINDER_NOTIFY_FROM = Date.now()
/** 이미 알린(알림을 꺼 둬서 건너뛴 것 포함) 알림 ID. 폴링이 실패해도 그대로 둔다 */
const notifiedReminderIds = new Set<string>()
/** 이 시각(트레이를 켠 때) 이후에 실패한 예약 보내기만 Windows 알림으로 띄운다. 켜기 전에 실패한 것은 화면 배지로 본다 */
const SCHEDULED_NOTIFY_FROM = Date.now()
/** 이미 알린(알림을 꺼 둬서 건너뛴 것 포함) 예약 보내기 ID. 폴링이 실패해도 그대로 둔다 */
const notifiedScheduledIds = new Set<string>()
/** 서버가 settings.json 에 Pray 훅을 못 넣었을 때의 이유 (메뉴 맨 위 줄·알림). 없으면 null */
let hookWarning: string | null = null
/** 훅 상태는 서버가 1분마다 보므로 상태 폴링(5초) 12번에 한 번 받는다 */
const HOOK_POLL_EVERY = 12
let hookPollCount = 0

/** 트레이 전용 설정 (hq.json·config.json 과 따로) */
function settingsPath(): string {
  return join(app.getPath('userData'), 'tray-settings.json')
}

/** tray-settings.json 을 읽는다. 옛 알림 메뉴 값 isNotifying 은 notifications.json 으로 한 번 옮길 때만 쓰려고 돌려준다 (없거나 깨졌으면 undefined) */
function loadSettings(): unknown {
  try {
    const saved = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { isNotifying?: unknown; sourceDir?: unknown }
    if (typeof saved.sourceDir === 'string' && saved.sourceDir) settings = { ...settings, sourceDir: saved.sourceDir }
    return saved.isNotifying
  } catch {
    // 없거나 깨졌으면 기본값
    return undefined
  }
}

/** 지금 알림 설정 (없음·깨짐 = 모두 켜짐) */
function notificationSettings(): NotificationSettings {
  return readNotificationSettings(notificationsPath)
}

/** 옛 트레이 메뉴(tray-settings.json 의 isNotifying)에서 알림을 꺼 뒀고 notifications.json 이 아직 없으면 enabled false 로 옮긴다 (한 번) */
function migrateLegacyNotifying(legacyIsNotifying: unknown): void {
  const patch = legacyNotificationFile(existsSync(notificationsPath), legacyIsNotifying)
  if (!patch) return
  try {
    writeNotificationPatch(notificationsPath, patch)
    console.log('트레이 알림 꺼짐을 notifications.json 으로 옮겼다')
  } catch (error) {
    console.error('Failed to move the tray Notifications setting', error)
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

/** 호스트·서버를 무엇으로 띄울지: 설치판은 앱에 묶인 스크립트(Pray.exe node 모드), 설정에서 저장소를 골랐거나 저장소 실행이면 node + tsx */
function childLaunch(): ChildLaunch {
  if (app.isPackaged && !settings.sourceDir) return packagedLaunch(process.execPath, process.resourcesPath)
  return sourceLaunch(findExe('node'), app.isPackaged ? settings.sourceDir! : repoDir)
}

function createChildren(): { host: Child; server: Child } {
  mkdirSync(logDir, { recursive: true })
  const launch = childLaunch()
  const claude = findExe('claude')
  const env = { ...childEnv(), ...launch.env }
  const host = new Child(
    { name: 'host', ...launch.host, args: [`--log=${join(logDir, 'host.log')}`, `--claude=${claude}`] },
    launch.command,
    env,
  )
  const server = new Child({ name: 'server', ...launch.server, args: [`--log=${join(logDir, 'server.log')}`] }, launch.command, env)
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

/** 트레이 아이콘 .ico 경로 (평소·승인 대기). 띄울 때 한 번 앱 데이터 폴더에 쓴다 — .ico 경로면 Electron 이 화면 배율에 맞는 크기(16·20·24·32…)를 고른다 */
const trayIconPaths = new Map<boolean, string | null>()

function trayIcon(isAlert: boolean): string | NativeImage {
  if (!trayIconPaths.has(isAlert)) {
    const path = join(app.getPath('userData'), isAlert ? 'tray-alert.ico' : 'tray.ico')
    try {
      writeFileSync(path, trayIconIco(isAlert))
      trayIconPaths.set(isAlert, path)
    } catch (error) {
      console.warn(`트레이 아이콘 ${path} 를 못 써서 32px PNG 로 띄운다: ${String(error)}`)
      trayIconPaths.set(isAlert, null)
    }
  }
  return trayIconPaths.get(isAlert) ?? nativeImage.createFromBuffer(trayIconPng(isAlert))
}

/** Tailscale 로 이어진 PC 목록 (서버 `GET /api/machines`). 창이 다른 PC 의 Pray 로 옮겨 갈 때 받고, 못 받으면 마지막 값 */
let prayMachines: PrayMachine[] = []
const MACHINES_TIMEOUT_MS = 3_000

async function refreshPrayMachines(): Promise<PrayMachine[]> {
  try {
    const response = await fetch(`${SERVER_URL}/api/machines`, { signal: AbortSignal.timeout(MACHINES_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const machines = parseMachines(await response.json())
    if (machines) prayMachines = machines
  } catch (error) {
    console.warn(`PC 목록을 못 받아 지난 값을 쓴다: ${String(error)}`)
  }
  return prayMachines
}

/**
 * 창 안 이동(`will-navigate`): 이 PC 서버는 그대로, Tailscale 로 이어진 다른 PC 의 Pray 는 같은 창에서 열고,
 * 이 PC 자신의 Tailscale 주소는 127.0.0.1 로 다시 연다 (loopback 이라 로그인 없이 이 PC 전용 기능을 쓴다). 그 밖의 http(s) 는 기본 브라우저로
 */
function handleNavigation(win: BrowserWindow, url: string): void {
  void (async () => {
    const decision = navigationDecision(url, SERVER_URL, await refreshPrayMachines())
    if (win.isDestroyed()) return
    if (decision === 'allow') await win.loadURL(url).catch((error: unknown) => console.error(`Failed to load ${url}`, error))
    else if (decision === 'self') await win.loadURL(SERVER_URL + new URL(url).hash).catch((error: unknown) => console.error(`Failed to load ${SERVER_URL}`, error))
    else if (decision === 'external') await shell.openExternal(url).catch((error: unknown) => console.error(`Failed to open ${url}`, error))
  })()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Pray',
    autoHideMenuBar: true,
    icon: windowIcon(),
    show: false,
    // Windows 기본 제목 표시줄 대신 웹 화면이 띠를 그린다 (− □ × 만 오버레이, 바탕 투명 → titleBar.ts)
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors ? DEFAULT_SYMBOL_COLORS.dark : DEFAULT_SYMBOL_COLORS.light),
  })
  win.once('ready-to-show', () => win.show())
  followTitleBarColor(win)
  // 작업 표시줄에 고정할 때 쓸 명령: 없으면 인자 없는 electron.exe 가 고정돼 꺼진 상태에서 누르면 Electron 기본 앱이 뜬다
  if (!app.isPackaged) {
    win.setAppDetails({ appId: 'pray', relaunchCommand: launchCommand(), relaunchDisplayName: 'Pray', appIconPath: process.execPath })
  }
  // 대화 속 웹 링크(target=_blank)가 새 Pray 창이 아니라 기본 브라우저로 열리게
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isExternalUrl(url, SERVER_URL, prayMachines)) return { action: 'allow' }
    shell.openExternal(url).catch((error: unknown) => console.error(`Failed to open ${url}`, error))
    return { action: 'deny' }
  })
  // 이 PC 서버 안 이동은 그대로 두고, 그 밖은 일단 막은 뒤 PC 목록을 받아 정한다 (막기는 이벤트 안에서 바로 해야 한다)
  win.webContents.on('will-navigate', (event) => {
    if (new URL(SERVER_URL).origin === originOf(event.url)) return
    event.preventDefault()
    handleNavigation(win, event.url)
  })
  // F5 새로고침: Ctrl+R 은 숨긴 기본 메뉴(View → Reload)에 있지만 F5 는 없어 따로 받는다 (브라우저처럼 조합 키 없는 F5 만)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F5' || input.control || input.shift || input.alt || input.meta) return
    event.preventDefault()
    win.webContents.reload()
  })
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })
  return win
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * 창을 열 때 서버를 기다리는 시간. 부팅 직후(로그인 시 자동 실행)는 node·tsx 가 느려 서버가 20초 넘게 걸렸다(실측 21초) —
 * 15초일 때 서버는 결국 떴는데 "didn't start" 창이 떴다. 자식이 계속 죽는 경우는 gaveUp 창이 따로 알린다
 */
const SERVER_START_TIMEOUT_MS = 60_000

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
    const isUp = await waitForServer(SERVER_START_TIMEOUT_MS)
    if (!isUp) {
      dialog.showErrorBox('Pray', `The server didn't start. Check the logs:\n${logDir}`)
    }
    await window.loadURL(SERVER_URL + hash)
  } else if (hash && originOf(window.webContents.getURL()) !== new URL(SERVER_URL).origin) {
    // 다른 PC 의 Pray 를 보고 있으면 이 PC 화면으로 돌아와 그 세션을 연다 (세션은 이 PC 것이다)
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

/**
 * 알림 그림 file:// URL. 이 실행에서 그 조합(종류, 인물·색)을 처음 쓸 때 앱 데이터 폴더에 PNG 로 쓰고 다시 쓴다 (코드가 바뀌면 따라가게).
 * face 가 없으면 Pray 마크 `notice-<종류>.png`, 있으면 그 인물 머리 `notice-<종류>-<인물>-<머리색>-<윗옷색>.png`. 못 쓰면 null (그림 없이)
 */
const noticeIconUrls = new Map<string, string | null>()
function noticeIconUrl(kind: NoticeRingKind, face: { key: string; pixels: Uint8Array; size: number } | null = null): string | null {
  const name = face ? `notice-${kind}-${face.key}.png` : `notice-${kind}.png`
  if (noticeIconUrls.has(name)) return noticeIconUrls.get(name) ?? null
  const path = join(app.getPath('userData'), name)
  let url: string | null = null
  try {
    writeFileSync(path, noticeIconPng(kind, face ? { pixels: face.pixels, size: face.size } : null))
    url = pathToFileURL(path).href
  } catch (error) {
    console.warn(`알림 그림 ${path} 를 못 써서 그림 없이 띄운다: ${String(error)}`)
  }
  noticeIconUrls.set(name, url)
  return url
}

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(`${SERVER_URL}${path}`)
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`)
  return response
}

async function fetchImage(path: string): Promise<RgbaImage> {
  const image = nativeImage.createFromBuffer(Buffer.from(await (await fetchOk(path)).arrayBuffer()))
  if (image.isEmpty()) throw new Error(`GET ${path}: not an image`)
  const { width, height } = image.getSize()
  // toBitmap 은 BGRA (Windows)
  return rgbaFromBgra(image.toBitmap(), width, height)
}

/**
 * 화면 목록 아바타와 같은 정면 아틀라스·마스크를 서버에서 받아 인물마다 머리 칸만 잘라 메모리에 둔다 (한 번만. 실패하면 다음 알림 때 다시).
 * 아틀라스 전체 픽셀은 들고 있지 않는다
 */
let faceArtPromise: Promise<FaceArt> | null = null
function loadFaceArt(): Promise<FaceArt> {
  faceArtPromise ??= (async () => {
    const [sheet, recolor] = await Promise.all([
      fetchOk(`/office/${FACE_SHEET}.json`).then((response) => response.json() as Promise<FaceSheetJson>),
      fetchOk(`/office/${FACE_SHEET}-recolor.json`).then((response) => response.json() as Promise<FaceRecolorJson>),
    ])
    const [atlas, mask] = await Promise.all([fetchImage(`/office/${FACE_SHEET}.png`), fetchImage(`/office/${encodeURIComponent(recolor.mask)}`)])
    return buildFaceArt(sheet, recolor, atlas, mask)
  })().catch((error: unknown) => {
    faceArtPromise = null
    throw error
  })
  return faceArtPromise
}

/** 세션 도트 인물 머리 그림 (화면과 같은 dotLookOf 규칙). 아틀라스를 못 받았거나 인물이 아틀라스·마스크에 없으면 null (Pray 마크) */
async function sessionFace(session: NotifySession | undefined): Promise<{ key: string; pixels: Uint8Array; size: number } | null> {
  if (!session) return null
  let art: FaceArt
  try {
    art = await loadFaceArt()
  } catch (error) {
    console.warn(`알림 인물 그림을 못 받아 Pray 마크로 띄운다: ${String(error)}`)
    return null
  }
  const look = dotLookOf(session, art.characters)
  const face = look ? facePixels(art, look) : null
  return look && face ? { key: faceFileKey(look), ...face } : null
}

/**
 * toastXml 로 띄우고, XML 을 못 만들거나 failed 가 오면 평범한 title·body 알림으로 한 번 다시 띄운다.
 * 토스트(본문) 클릭은 click 이벤트다 (Electron 44 windows_toast_notification.cc).
 * 누르면 target 세션을 연다 — 함수면 누를 때 불러 정한다 (알림(Reminders)의 지금 리드). 없거나 null 이면 창만
 */
function showNotification(content: ToastContent, target?: string | (() => Promise<string | null>), isPlain = false): void {
  const isSilent = !notificationSettings().sound
  let xml: string | null = null
  if (!isPlain) {
    try {
      xml = toastXml(content, { isSilent })
    } catch (error) {
      console.warn(`알림 XML 을 못 만들어 평범한 알림으로 띄운다: ${String(error)}`)
    }
  }
  const notification = xml
    ? new Notification({ toastXml: xml })
    : new Notification({ title: content.title, body: content.body, icon: nativeImage.createFromBuffer(trayIconPng(false)), silent: isSilent })
  shownNotifications.add(notification)
  const release = () => shownNotifications.delete(notification)
  notification.on('click', () => {
    release()
    void (typeof target === 'function' ? target() : Promise.resolve(target ?? null)).then((sessionId) => showWindow(sessionId ?? undefined))
  })
  notification.on('close', release)
  notification.on('failed', (_event, error) => {
    release()
    if (!xml) return
    console.warn(`토스트 XML 알림이 실패해 평범한 알림으로 다시 띄운다: ${error}`)
    showNotification(content, target, true)
  })
  notification.show()
  // Electron 은 알림을 띄울 때 시작 메뉴 Pray.lnk 를 인자 없이 만들 수 있다 — 바로 다시 고친다
  setTimeout(fixLaunchShortcuts, 3000)
}

/** 알림에 팀·파트 이름을 붙이려고 알릴 것이 있을 때만 받는다. 못 받으면 null (이름 없이 알린다) */
async function fetchOffice(): Promise<ReminderOffice | null> {
  try {
    const response = await fetch(`${SERVER_URL}/api/office`)
    return response.ok ? ((await response.json()) as ReminderOffice) : null
  } catch {
    return null
  }
}

/** 알림 설정(전체·종류별)으로 거르고, 창이 앞에 있고 그 세션이 열려 있으면 빼고 띄운다. 남은 것이 많으면 한 장으로 묶고 누르면 창만 연다 */
async function notify(notices: SessionNotice[], sessions: NotifySession[]): Promise<void> {
  if (notices.length === 0 || !Notification.isSupported()) return
  const allowed = allowedNotices(notices, notificationSettings())
  if (allowed.length === 0) return
  const openId = await focusedSessionId()
  const shown = allowed.filter((notice) => notice.sessionId !== openId)
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
    const face = await sessionFace(sessionOf(notice.sessionId))
    showNotification(noticeToast(notice, placeFor(notice.sessionId), noticeIconUrl(notice.kind, face)), notice.sessionId)
  }
}

/**
 * 새로 울린 알림(Reminders)을 띄운다. 창이 앞에 있어도 띄운다 (화면에는 배지뿐이라). 많으면 한 장으로 묶고 누르면 창만 연다.
 * 하나짜리를 누르면 그때 /api/office 를 다시 받아 그 지휘 단위의 지금 리드를 연다 (Hand over 로 바뀌었을 수 있다)
 */
async function notifyReminders(reminders: NotifyReminder[], sessions: NotifySession[]): Promise<void> {
  if (reminders.length === 0 || !Notification.isSupported() || !isNoticeAllowed(notificationSettings(), 'reminders')) return
  if (reminders.length > MAX_SEPARATE_NOTICES) {
    const lines = reminders.map((reminder) => reminderBundleLine(reminder, sessions))
    showNotification(reminderBundleToast(lines, noticeIconUrl('reminder')))
    return
  }
  const office = await fetchOffice()
  for (const reminder of reminders) {
    const face = await sessionFace(reminderSession(reminder, sessions))
    const target = async () => reminderTarget(reminder, await fetchOffice())
    showNotification(reminderToast(reminder, sessions, office, noticeIconUrl('reminder', face)), target)
  }
}

/** 알림 목록을 받아 새로 울린 것을 고른다. 고른 것은 바로 알린 것으로 적는다 (알림(전체·reminders)을 꺼 뒀으면 띄우지 않고 적기만 — 다시 켤 때 몰아서 안 뜨게) */
async function pollReminders(sessions: NotifySession[]): Promise<void> {
  let reminders: NotifyReminder[]
  try {
    const response = await fetch(`${SERVER_URL}/api/reminders`)
    if (!response.ok) return
    reminders = ((await response.json()) as { reminders?: NotifyReminder[] }).reminders ?? []
  } catch {
    return
  }
  const fired = newlyFiredReminders(notifiedReminderIds, REMINDER_NOTIFY_FROM, reminders)
  for (const reminder of fired) notifiedReminderIds.add(reminder.id)
  await notifyReminders(fired, sessions)
}

/**
 * 새로 실패한 예약 보내기를 띄운다. 알림(Reminders)처럼 창이 앞에 있어도 띄운다 (화면에는 배지뿐이라). 성공 알림은 없다.
 * 하나짜리는 받을 세션의 인물 머리, 누르면 그 세션 패널 (목록에 없으면 Pray 마크·창만). 많으면 한 장으로 묶고 누르면 창만
 */
async function notifyScheduled(items: NotifyScheduled[], sessions: NotifySession[]): Promise<void> {
  if (items.length === 0 || !Notification.isSupported() || !isNoticeAllowed(notificationSettings(), 'scheduledFailed')) return
  if (items.length > MAX_SEPARATE_NOTICES) {
    const lines = items.map((item) => scheduledBundleLine(item, sessions))
    showNotification(scheduledBundleToast(lines, noticeIconUrl('scheduled-failed')))
    return
  }
  for (const item of items) {
    const session = scheduledSession(item, sessions)
    const face = await sessionFace(session)
    showNotification(scheduledToast(item, sessions, noticeIconUrl('scheduled-failed', face)), session?.id)
  }
}

/** 예약 보내기 목록을 받아 새로 실패한 것을 고른다. 404(옛 서버)·실패면 그 회차만 건너뛴다. 고른 것은 바로 알린 것으로 적는다 (알림(전체·scheduledFailed)을 꺼 뒀으면 적기만) */
async function pollScheduled(sessions: NotifySession[]): Promise<void> {
  let items: NotifyScheduled[]
  try {
    const response = await fetch(`${SERVER_URL}/api/scheduled-messages`)
    if (!response.ok) return
    items = ((await response.json()) as { scheduledMessages?: NotifyScheduled[] }).scheduledMessages ?? []
  } catch {
    return
  }
  const failed = newlyFailedScheduled(notifiedScheduledIds, SCHEDULED_NOTIFY_FROM, items)
  for (const item of failed) notifiedScheduledIds.add(item.id)
  await notifyScheduled(failed, sessions)
}

/** 훅 경고를 바꾸고, 새로 생겼으면 알린다 (알림을 꺼 뒀으면 메뉴 줄만) */
function applyHookStatus(value: unknown): void {
  const next = hookWarningOf(value)
  if (shouldNotifyHookWarning(hookWarning, next) && Notification.isSupported() && isNoticeAllowed(notificationSettings())) showNotification(hookWarningToast(next!))
  if (next !== hookWarning) {
    hookWarning = next
    refreshTray()
  }
}

/** `GET /api/system/hooks`. 실패·옛 서버(404)면 그대로 둔다 */
async function pollHooks(): Promise<void> {
  try {
    const response = await fetch(`${SERVER_URL}/api/system/hooks`)
    if (response.ok) applyHookStatus(await response.json())
  } catch {
    // 서버가 꺼져 있으면 다음 회차에
  }
}

/** 메뉴 줄: 서버에 지금 다시 넣어 보라고 한다. 또 실패하면 이유를 확인 창 없이 오류 창으로 */
async function retryHookInstall(): Promise<void> {
  try {
    const response = await fetch(`${SERVER_URL}/api/system/hooks/install`, { method: 'POST' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body: unknown = await response.json()
    hookWarning = null // 같은 실패라도 다시 눌렀으니 알림 대신 창으로 보인다
    applyHookStatus(body)
    if (hookWarning) dialog.showErrorBox('Pray hooks missing', hookWarning)
  } catch (error) {
    dialog.showErrorBox('Pray hooks missing', `Couldn't reach the server: ${String(error)}`)
  }
}

async function pollStatus(): Promise<void> {
  if (hookPollCount++ % HOOK_POLL_EVERY === 0) void pollHooks()
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
    void pollReminders(data.sessions)
    void pollScheduled(data.sessions)
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
  tray.setImage(trayIcon(isAlert))
  const summary = status.isServerUp
    ? `Working ${status.working} · Needs approval ${status.needsApproval}`
    : 'Server not responding'
  tray.setToolTip(`Pray · ${summary}`)
  const { host, server } = children
  // 평소에는 자주 쓰는 것만 보이고 재시작·로그는 Troubleshoot 안에 둔다. 호스트·서버가 꺼져 있으면 맨 위 한 줄로 알린다 (하위 메뉴에 숨지 않게)
  const stopped = [host.isRunning ? null : 'Host stopped', server.isRunning ? null : 'Server stopped'].filter((text) => text !== null)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(stopped.length > 0 ? [{ label: `⚠ ${stopped.join(' · ')}`, enabled: false }] : []),
      ...(hookWarning && server.isRunning ? [{ label: HOOK_MENU_LABEL, toolTip: hookWarning, click: () => void retryHookInstall() }] : []),
      ...(downloadedUpdate ? [{ label: updateMenuLabel(downloadedUpdate), click: () => void installUpdate() }] : []),
      { label: 'Open', click: () => void showWindow() },
      { type: 'separator' },
      // notifications.json 의 enabled (화면 설정 창에서 바꾼 값은 다음 메뉴 다시 만들기 — 5초 폴링 — 때 보인다). 누르면 enabled 만 바꿔 쓴다
      {
        label: 'Notifications',
        type: 'checkbox',
        checked: notificationSettings().enabled,
        click: (item) => {
          try {
            writeNotificationPatch(notificationsPath, { enabled: item.checked })
          } catch (error) {
            console.error('Failed to save the notification setting', error)
            refreshTray()
          }
        },
      },
      {
        label: 'Launch at login',
        type: 'checkbox',
        checked: isLaunchAtLogin(app.getLoginItemSettings(loginItemOptions()).launchItems, loginItemOptions().args ?? []),
        click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), name: LOGIN_ITEM_NAME, openAtLogin: item.checked }),
      },
      {
        label: 'Troubleshoot',
        submenu: [
          { label: `Host ${host.isRunning ? 'running' : 'stopped'} · Server ${server.isRunning ? 'running' : 'stopped'}`, enabled: false },
          { label: `Pray ${app.getVersion()}${app.isPackaged ? (settings.sourceDir ? ' · running from source' : '') : ' · repo'}`, enabled: false },
          ...(app.isPackaged
            ? [
                { label: 'Check for updates', click: () => void autoUpdater.checkForUpdates().catch((error) => dialog.showErrorBox('Pray', `Couldn't check for updates: ${String(error)}`)) },
                {
                  label: 'Run host & server from source…',
                  type: 'checkbox' as const,
                  checked: settings.sourceDir !== null,
                  click: (item: Electron.MenuItem) => void toggleSourceMode(item.checked),
                },
              ]
            : []),
          { type: 'separator' },
          { label: 'Restart server', click: () => void server.restart() },
          {
            label: 'Restart host…',
            click: async () => {
              const isYes = await confirmDialog(
                {
                  title: 'Restart the host?',
                  message: 'All web sessions disconnect. They come back with --resume when the host starts again.',
                  confirmLabel: 'Restart',
                },
                window,
              )
              if (isYes) void host.restart()
            },
          },
          {
            label: 'Restart Pray…',
            click: async () => {
              const isYes = await confirmDialog(
                {
                  title: 'Restart Pray?',
                  message: 'The tray, host and server restart. Web sessions disconnect and come back with --resume.',
                  confirmLabel: 'Restart',
                },
                window,
              )
              if (isYes) void restartApp()
            },
          },
          { label: 'Open log folder', click: () => void shell.openPath(logDir) },
        ],
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: async () => {
          const isYes = await confirmDialog(
            {
              title: 'Quit Pray?',
              message: 'The host and server stop and all web sessions disconnect. They come back with --resume on next launch.',
              confirmLabel: 'Quit',
            },
            window,
          )
          if (isYes) void quit()
        },
      },
    ]),
  )
}

/** 개발 실행(electron .)에서는 execPath 가 electron.exe 라 앱 경로를 인자로 넘겨야 한다 */
/** 트레이 앱 폴더 (`desktop`). 저장소에서 실행하므로 electron.exe 에 이 폴더를 인자로 줘야 Pray 가 뜬다 (없으면 Electron 기본 앱) */
const appDir = resolve(__dirname, '..')

function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [appDir] }
}

function launchCommand(): string {
  return `"${process.execPath}" "${appDir}"`
}

/** 바로가기를 다시 확인하는 주기. 시작 때 한 번만 고쳤더니 그 뒤 인자 없는 바로가기로 다시 덮인 채 남았다 */
const SHORTCUT_CHECK_MS = 60_000

/**
 * 저장소 실행의 바로가기에 앱 폴더 인자를 넣는다 (`launchShortcut.ts`): 시작 메뉴 `Pray.lnk`(Electron 이 알림 때 인자 없이 만든다),
 * 작업 표시줄 고정(시작 메뉴에서 복사되면 인자가 없다), "Launch at login" Run 값. 인자가 없으면 누를 때 Electron 기본 앱이 뜬다.
 * 'update' 는 알림 ID 등 다른 값을 그대로 둔다. 시작 때·알림을 띄운 뒤·1분마다 부른다
 */
function fixLaunchShortcuts(): void {
  if (app.isPackaged) return
  const appData = app.getPath('appData')
  const pinnedDir = join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  const pinned = existsSync(pinnedDir) ? readdirSync(pinnedDir).filter((name) => name.toLowerCase().endsWith('.lnk')).map((name) => join(pinnedDir, name)) : []
  for (const path of [join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Pray.lnk'), ...pinned]) {
    if (!existsSync(path)) continue
    try {
      const link = shell.readShortcutLink(path)
      if (!needsAppArg(link, process.execPath)) continue
      const isWritten = shell.writeShortcutLink(path, 'update', { target: link.target, args: `"${appDir}"`, cwd: repoDir })
      console.log(isWritten ? `바로가기 ${path} 에 앱 폴더 인자를 넣었다` : `바로가기 ${path} 에 인자를 못 넣었다`)
    } catch (error) {
      console.warn(`바로가기 ${path} 에 인자를 못 넣었다: ${String(error)}`)
    }
  }
  try {
    if (hasArgLessLoginItem(app.getLoginItemSettings(loginItemOptions()).launchItems)) {
      app.setLoginItemSettings({ ...loginItemOptions(), name: LOGIN_ITEM_NAME, openAtLogin: true })
      console.log('로그인 자동 실행 값에 앱 폴더 인자를 넣었다')
    }
  } catch (error) {
    console.warn(`로그인 자동 실행 값을 못 고쳤다: ${String(error)}`)
  }
}

async function quit(): Promise<void> {
  isQuitting = true
  if (children) await Promise.all([children.server.stop(), children.host.stop()])
  app.quit()
}

/** 받아 둔 업데이트 버전 (메뉴 맨 위 "Restart to update"). 없으면 null */
let downloadedUpdate: string | null = null
/** 업데이트 확인 주기. 받기는 뒤에서 하고 적용은 사람이 누를 때(또는 다음 Quit 때 autoInstallOnAppQuit) */
const UPDATE_CHECK_MS = 6 * 60 * 60_000

/** 설치판만: GitHub Releases 에서 새 버전을 확인해 뒤에서 받는다. 받으면 알림과 메뉴 줄. 실패는 로그만 (오프라인·GitHub 장애) */
function setupUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    if (downloadedUpdate === info.version) return
    downloadedUpdate = info.version
    refreshTray()
    if (Notification.isSupported() && isNoticeAllowed(notificationSettings())) showNotification(updateReadyToast(info.version))
  })
  autoUpdater.on('error', (error) => console.warn(`업데이트 확인 실패: ${String(error)}`))
  const check = () => void autoUpdater.checkForUpdates().catch((error) => console.warn(`업데이트 확인 실패: ${String(error)}`))
  check()
  setInterval(check, UPDATE_CHECK_MS)
}

/** 받아 둔 업데이트를 적용한다: 확인 창 → 호스트·서버를 끄고 설치 프로그램을 조용히 돌린 뒤 다시 띄운다 */
async function installUpdate(): Promise<void> {
  if (!downloadedUpdate) return
  const isYes = await confirmDialog(
    {
      title: `Update to ${downloadedUpdate}?`,
      message: updateConfirmMessage(downloadedUpdate, status.working, status.needsApproval),
      confirmLabel: 'Restart & update',
    },
    window,
  )
  if (!isYes) return
  isQuitting = true
  if (children) await Promise.all([children.server.stop(), children.host.stop()])
  autoUpdater.quitAndInstall(true, true)
}

/** 설치판의 "Run host & server from source": 켤 때 저장소 폴더를 고르게 하고, 바꾸면 트레이를 다시 띄운다 (자식을 띄우는 방법이 바뀌어서) */
async function toggleSourceMode(isOn: boolean): Promise<void> {
  let sourceDir: string | null = null
  if (isOn) {
    const picked = await dialog.showOpenDialog({ title: 'Choose the Pray repository', properties: ['openDirectory'] })
    if (picked.canceled || !picked.filePaths[0]) return refreshTray()
    sourceDir = picked.filePaths[0]
    if (!existsSync(join(sourceDir, 'server', 'src', 'index.ts')) || !existsSync(join(sourceDir, 'node_modules', 'tsx'))) {
      dialog.showErrorBox('Pray', `${sourceDir} isn't a Pray repository with dependencies installed (npm install).`)
      return refreshTray()
    }
  }
  const isYes = await confirmDialog(
    {
      title: 'Restart Pray?',
      message: isOn
        ? `The host and server will run from ${sourceDir} with node. Web sessions disconnect and come back with --resume.`
        : 'The host and server will run from this installed version. Web sessions disconnect and come back with --resume.',
      confirmLabel: 'Restart',
    },
    window,
  )
  if (!isYes) return refreshTray()
  settings = { ...settings, sourceDir }
  saveSettings()
  await restartApp()
}

/** Quit 과 같이 끄고 같은 실행 파일·인자로 다시 띄운다 (빌드는 하지 않는다 — desktop/dist 를 그대로 실행). 새 프로세스는 이 프로세스가 끝난 뒤 떠서 잠금과 안 부딪힌다 */
async function restartApp(): Promise<void> {
  app.relaunch()
  await quit()
}

// 설치판은 제품 이름(Pray)을 따라 %APPDATA%\Pray 가 되므로 저장소 실행과 같은 폴더로 고정한다 — 창 설정·tray-settings.json 을 같이 쓰고,
// 같은 single-instance 잠금이라 설치판과 저장소 실행이 같이 떠서 pipe·포트가 부딪히지 않는다
if (app.isPackaged) app.setPath('userData', join(app.getPath('appData'), '@pray', 'desktop'))
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
    notificationsPath = join(dataDir.dir, 'notifications.json')
    migrateLegacyNotifying(loadSettings())
    try {
      children = createChildren()
    } catch (error) {
      dialog.showErrorBox('Pray', String(error))
      app.quit()
      return
    }
    fixLaunchShortcuts()
    setInterval(fixLaunchShortcuts, SHORTCUT_CHECK_MS)
    tray = new Tray(trayIcon(false))
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
    setupUpdater()
    const webDir = app.isPackaged && !settings.sourceDir ? null : app.isPackaged ? settings.sourceDir! : repoDir
    if (webDir && !existsSync(join(webDir, 'web', 'dist'))) {
      dialog.showErrorBox('Pray', 'web/dist not found. Run npm run build first.')
    }
    await showWindow()
  })
}
