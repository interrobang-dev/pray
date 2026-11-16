import { BrowserWindow, nativeTheme } from 'electron'
import { appIconPng } from './icon'
import { CONFIRM_COLORS, confirmAnswerOf, confirmHtml, type ConfirmContent } from './confirmHtml'

const WIDTH = 400

let current: BrowserWindow | null = null

/**
 * 트레이 확인 창 (앱 모양. HTML·키 규칙은 confirmHtml.ts). 테두리 없는 작은 창을 늘 위·작업 표시줄 밖에 띄우고,
 * 트레이 창이 보이면 그 가운데, 아니면 화면 가운데에 둔다. 확인 = true, Cancel·Esc·창 닫기 = false.
 * 이미 하나가 떠 있으면 새로 띄우지 않고 그 창을 앞으로 가져온 뒤 이번 요청은 false (두 동작이 한 번의 확인으로 같이 실행되지 않게)
 */
export function confirmDialog(content: Omit<ConfirmContent, 'iconDataUrl'>, parent: BrowserWindow | null): Promise<boolean> {
  if (current && !current.isDestroyed()) {
    current.show()
    current.focus()
    return Promise.resolve(false)
  }
  const isDark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: WIDTH,
    height: 180,
    useContentSize: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Pray',
    backgroundColor: isDark ? CONFIRM_COLORS.dark.panel : CONFIRM_COLORS.light.panel,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  current = win
  return new Promise((resolve) => {
    let isDone = false
    const finish = (isYes: boolean) => {
      if (isDone) return
      isDone = true
      if (current === win) current = null
      if (!win.isDestroyed()) win.destroy()
      resolve(isYes)
    }
    win.on('closed', () => finish(false))
    win.webContents.on('page-title-updated', (event, title) => {
      const answer = confirmAnswerOf(title)
      if (answer === null) return
      event.preventDefault()
      finish(answer)
    })
    // 이 창은 data URL 한 장만 보여 준다 — 다른 곳으로 가거나 새 창을 열지 않는다
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.once('did-finish-load', async () => {
      try {
        // body 는 내용 높이다 (documentElement.scrollHeight 는 창보다 작으면 창 높이를 준다)
        const height = Number(await win.webContents.executeJavaScript('document.body.getBoundingClientRect().height'))
        if (win.isDestroyed()) return
        if (Number.isFinite(height) && height > 0) win.setContentSize(WIDTH, Math.ceil(height))
      } catch {
        // 높이를 못 재면 처음 크기 그대로 띄운다
      }
      if (win.isDestroyed()) return
      placeOver(win, parent)
      win.show()
      win.focus()
    })
    const iconDataUrl = `data:image/png;base64,${appIconPng(40).toString('base64')}`
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(confirmHtml({ ...content, iconDataUrl }))}`)
  })
}

/** 트레이 창이 보이면(최소화 아님) 그 가운데, 아니면 화면 가운데 */
function placeOver(win: BrowserWindow, parent: BrowserWindow | null): void {
  if (!parent || parent.isDestroyed() || !parent.isVisible() || parent.isMinimized()) {
    win.center()
    return
  }
  const outer = parent.getBounds()
  const [width, height] = win.getSize()
  win.setPosition(Math.round(outer.x + (outer.width - width) / 2), Math.round(outer.y + (outer.height - height) / 2))
}
