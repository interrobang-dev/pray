import { describe, expect, it } from 'vitest'
import { TERMINAL_KEYS, terminalKeyData } from './terminalKeys'

describe('terminalKeyData', () => {
  it('보통 모드 바이트', () => {
    const bytes = Object.fromEntries(TERMINAL_KEYS.map((key) => [key.id, terminalKeyData(key.id, false)]))
    expect(bytes).toEqual({
      escape: '\x1b',
      tab: '\t',
      'shift-tab': '\x1b[Z',
      up: '\x1b[A',
      down: '\x1b[B',
      left: '\x1b[D',
      right: '\x1b[C',
      'ctrl-c': '\x03',
    })
  })

  it('애플리케이션 커서 모드는 화살표만 ESC O 꼴', () => {
    expect(terminalKeyData('up', true)).toBe('\x1bOA')
    expect(terminalKeyData('down', true)).toBe('\x1bOB')
    expect(terminalKeyData('left', true)).toBe('\x1bOD')
    expect(terminalKeyData('right', true)).toBe('\x1bOC')
    expect(terminalKeyData('shift-tab', true)).toBe('\x1b[Z')
    expect(terminalKeyData('escape', true)).toBe('\x1b')
  })
})
