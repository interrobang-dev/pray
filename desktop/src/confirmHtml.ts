/**
 * 트레이 확인 창(Quit·Restart host·Restart Pray)의 HTML. 웹 확인 창(web/src/Dialog.tsx)과 같은 모양이다.
 * 트레이 창이 숨겨져 있거나 서버가 꺼져 있어도 떠야 해서 서버 페이지가 아니라 트레이가 만든 글을 data URL 로 넣는다.
 * 답은 document.title 을 `pray-confirm:yes|no` 로 바꿔 알린다 (preload·Node 권한 없이 받으려고. confirmDialog.ts 가 page-title-updated 로 읽는다)
 */

/** 웹 style.css Default 팔레트의 값 사본 (confirmHtml.test.ts 가 같은지 본다 — 같이 고친다). 강조·빨강은 다크에서도 같은 값이다 */
export const CONFIRM_COLORS = {
  light: { panel: '#ffffff', text: '#2b2f3a', muted: '#7a7f8e', surface2: '#eceef3', surface3: '#e2e4eb' },
  dark: { panel: '#1f2228', text: '#e3e5ea', muted: '#9aa0ad', surface2: '#2c3039', surface3: '#373c46' },
  accent: '#3f9c4b',
  redFill: '#c84a3f',
  onRed: '#ffffff',
} as const

export const CONFIRM_TITLE_PREFIX = 'pray-confirm:'

export interface ConfirmContent {
  /** 굵은 제목 한 줄 ("Restart Pray?") */
  title: string
  /** 회색 설명 (줄바꿈 유지) */
  message: string
  /** 빨간 확인 버튼 글자 ("Restart") */
  confirmLabel: string
  /** 제목 왼쪽 Pray 마크 (data:image/png URL). 빈 글이면 그림 없음 */
  iconDataUrl: string
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 창 제목 → 답. 확인 창이 정한 꼴이 아니면 null (처음 <title> 등) */
export function confirmAnswerOf(title: string): boolean | null {
  if (title === `${CONFIRM_TITLE_PREFIX}yes`) return true
  if (title === `${CONFIRM_TITLE_PREFIX}no`) return false
  return null
}

/**
 * 키: 처음 포커스는 Cancel(위험한 동작이라 Enter 한 번에 실행되지 않게 — 웹 isDanger 와 같다), Esc = 취소,
 * Enter = 포커스한 버튼(브라우저 기본 동작), Tab·Shift+Tab 은 두 버튼 사이를 돈다. 빈 곳을 끌면 창이 움직인다
 */
export function confirmHtml(content: ConfirmContent): string {
  const { light, dark, accent, redFill, onRed } = CONFIRM_COLORS
  const icon = content.iconDataUrl ? `<img class="mark" src="${escapeHtml(content.iconDataUrl)}" alt="" draggable="false">` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pray</title>
<style>
:root {
  color-scheme: light dark;
  --panel: ${light.panel}; --text: ${light.text}; --muted: ${light.muted}; --surface-2: ${light.surface2}; --surface-3: ${light.surface3};
}
@media (prefers-color-scheme: dark) {
  :root { --panel: ${dark.panel}; --text: ${dark.text}; --muted: ${dark.muted}; --surface-2: ${dark.surface2}; --surface-3: ${dark.surface3}; }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--panel); color: var(--text); }
body {
  font: 14px/1.5 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif;
  padding: 20px;
  display: flex; flex-direction: column; gap: 14px;
  user-select: none; -webkit-app-region: drag;
}
.head { display: flex; align-items: center; gap: 10px; }
.mark { width: 20px; height: 20px; flex: none; }
.title { margin: 0; font-size: 15px; font-weight: 650; }
.message { margin: 0; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; }
button {
  -webkit-app-region: no-drag;
  font: inherit; color: var(--text); background: var(--surface-2);
  border: 1px solid transparent; border-radius: 999px; padding: 7px 16px; cursor: pointer;
}
button:hover { background: var(--surface-3); }
button:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }
button.danger { background: ${redFill}; color: ${onRed}; border-color: ${redFill}; }
button.danger:focus-visible { outline-color: ${redFill}; }
</style>
</head>
<body>
<div class="head">${icon}<h1 class="title">${escapeHtml(content.title)}</h1></div>
<p class="message">${escapeHtml(content.message)}</p>
<div class="actions">
<button type="button" id="cancel">Cancel</button>
<button type="button" id="confirm" class="danger">${escapeHtml(content.confirmLabel)}</button>
</div>
<script>
const cancel = document.getElementById('cancel')
const confirm = document.getElementById('confirm')
const answer = (isYes) => { document.title = '${CONFIRM_TITLE_PREFIX}' + (isYes ? 'yes' : 'no') }
cancel.addEventListener('click', () => answer(false))
confirm.addEventListener('click', () => answer(true))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); answer(false) }
  else if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel ? confirm : cancel).focus() }
})
cancel.focus()
</script>
</body>
</html>`
}
