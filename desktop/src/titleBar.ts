import type { BrowserWindow } from 'electron'

/**
 * 트레이 창의 제목 띠. Windows 기본 제목 표시줄을 숨기고(titleBarStyle 'hidden') − □ × 만 오버레이로 남긴다 (스냅 레이아웃·더블클릭 최대화는 Windows 그대로).
 * 띠 자체(로고·"Pray"·끌기 자리)는 웹 화면이 그린다 — web/src/TitleBar.tsx 가 `navigator.windowControlsOverlay.visible` 로 이 창임을 알아보고
 * style.css `.titlebar` 를 이 높이(`env(titlebar-area-height)`)로 둔다
 */
export const TITLE_BAR_HEIGHT = 32

/**
 * 오버레이 바탕은 투명이다 — 버튼 뒤로 웹 띠 색(그 아래 칸 색)이 그대로 비치고, hover 면은 그 위에 옅게 덮인다 (Electron 44 시험 앱으로 실측).
 * 그래서 바탕색은 화면을 따라갈 필요가 없고 기호 색만 맞춘다
 */
export const TITLE_BAR_COLOR = 'rgba(0, 0, 0, 0)'

/** 웹이 기호 색을 알려 주기 전(창을 막 띄웠을 때)의 기호 색: style.css Default 의 `--muted` 라이트·다크 값. 같이 고친다 (titleBar.test.ts 가 본다) */
export const DEFAULT_SYMBOL_COLORS = { light: '#7a7f8e', dark: '#9aa0ad' } as const

export function titleBarOverlay(symbolColor: string): { color: string; symbolColor: string; height: number } {
  return { color: TITLE_BAR_COLOR, symbolColor, height: TITLE_BAR_HEIGHT }
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value)
}

/**
 * 창에서 돌릴 스크립트: 웹 띠(`.titlebar`)의 글자색(= `--muted`)이 `last` 와 달라지면 `#rrggbb` 로 끝나는 Promise.
 * 테마·팔레트·모드는 `<html>` 의 속성·인라인 style 을 바꾸므로 그 변화를 보고, 띠가 아직 없을 때·놓친 변화는 1초마다 다시 본다.
 * 색은 canvas 에 칠해 픽셀로 읽는다 — 계산값이 `color(srgb …)` 같은 꼴이어도 Electron 이 읽는 #rrggbb 가 되게.
 * 페이지를 다시 읽으면 이 Promise 는 끝나지 않고 남는다(실측) — 부르는 쪽이 읽을 때마다 새로 시작하고 옛 것은 버린다
 */
export function symbolColorScript(last: string): string {
  return `new Promise((resolve) => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const hex = (color) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000000'
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return '#' + [r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')
  }
  let observer = null
  let timer = null
  const check = () => {
    const bar = document.querySelector('.titlebar')
    if (!bar) return
    const color = hex(getComputedStyle(bar).color)
    if (color === ${JSON.stringify(last)}) return
    observer.disconnect()
    clearInterval(timer)
    resolve(color)
  }
  observer = new MutationObserver(check)
  observer.observe(document.documentElement, { attributes: true })
  timer = setInterval(check, 1000)
  check()
})`
}

/**
 * 오버레이 버튼 기호 색을 웹 띠 글자색(`--muted`)에 맞춘다 — 테마·팔레트·모드를 바꾸면 따라간다.
 * 페이지를 읽을 때마다 기다리기를 새로 시작한다: 창에서 색이 바뀔 때 끝나는 Promise(symbolColorScript)를 돌리고, 받으면 바꾸고 또 기다린다.
 * 다시 읽은 페이지의 옛 Promise 는 끝나지 않고 남으므로 회차(generation)로 옛 기다리기를 버린다
 */
export function followTitleBarColor(win: BrowserWindow): void {
  let generation = 0
  win.webContents.on('did-finish-load', () => {
    const mine = ++generation
    void (async () => {
      let last = ''
      while (mine === generation && !win.isDestroyed()) {
        let color: unknown
        try {
          color = await win.webContents.executeJavaScript(symbolColorScript(last))
        } catch {
          return
        }
        if (mine !== generation || win.isDestroyed() || !isHexColor(color)) return
        last = color
        win.setTitleBarOverlay(titleBarOverlay(color))
      }
    })()
  })
}
