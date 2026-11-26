/** 폰 터미널 탭 아래 특수 키 줄 (폰 키보드에 없는 키). 바이트는 xterm.js 가 같은 키에 보내는 값과 같다 */
export type TerminalKeyId = 'escape' | 'tab' | 'shift-tab' | 'up' | 'down' | 'left' | 'right' | 'ctrl-c'

export interface TerminalKey {
  id: TerminalKeyId
  label: string
  ariaLabel: string
}

export const TERMINAL_KEYS: readonly TerminalKey[] = [
  { id: 'escape', label: 'Esc', ariaLabel: 'Escape' },
  { id: 'tab', label: 'Tab', ariaLabel: 'Tab' },
  { id: 'shift-tab', label: '⇧Tab', ariaLabel: 'Shift+Tab' },
  { id: 'up', label: '↑', ariaLabel: 'Up' },
  { id: 'down', label: '↓', ariaLabel: 'Down' },
  { id: 'left', label: '←', ariaLabel: 'Left' },
  { id: 'right', label: '→', ariaLabel: 'Right' },
  { id: 'ctrl-c', label: 'Ctrl+C', ariaLabel: 'Ctrl+C' },
]

const ARROW_FINAL: Partial<Record<TerminalKeyId, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' }

/** 화살표는 애플리케이션 커서 모드(DECCKM)면 `ESC O A` 꼴, 아니면 `ESC [ A` 꼴 — xterm.js 와 같다 */
export function terminalKeyData(id: TerminalKeyId, isApplicationCursor: boolean): string {
  const arrow = ARROW_FINAL[id]
  if (arrow) return (isApplicationCursor ? '\x1bO' : '\x1b[') + arrow
  switch (id) {
    case 'escape':
      return '\x1b'
    case 'tab':
      return '\t'
    case 'shift-tab':
      return '\x1b[Z'
    case 'ctrl-c':
      return '\x03'
    default:
      throw new Error(`Unknown terminal key: ${id}`)
  }
}
