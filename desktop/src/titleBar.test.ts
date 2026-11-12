import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SYMBOL_COLORS, isHexColor, symbolColorScript, TITLE_BAR_COLOR, TITLE_BAR_HEIGHT, titleBarOverlay } from './titleBar'

const styleCss = readFileSync(join(__dirname, '..', '..', 'web', 'src', 'style.css'), 'utf8')

/** style.css 의 한 선택자 블록 안 변수 값 */
function cssVar(selector: string, name: string): string | undefined {
  const start = styleCss.indexOf(`${selector} {`)
  const body = styleCss.slice(start, styleCss.indexOf('\n}', start))
  return body.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))?.[1].trim()
}

describe('titleBar', () => {
  it('첫 기호 색은 style.css Default 의 --muted 와 같다', () => {
    expect(DEFAULT_SYMBOL_COLORS.light).toBe(cssVar(':root', 'muted'))
    expect(DEFAULT_SYMBOL_COLORS.dark).toBe(cssVar(":root[data-theme='dark']", 'muted'))
  })

  it('오버레이는 투명 바탕·32px', () => {
    expect(titleBarOverlay('#123456')).toEqual({ color: TITLE_BAR_COLOR, symbolColor: '#123456', height: TITLE_BAR_HEIGHT })
    expect(TITLE_BAR_HEIGHT).toBe(32)
  })

  it('#rrggbb 만 받는다', () => {
    expect(isHexColor('#9aa0ad')).toBe(true)
    expect(isHexColor('rgb(1, 2, 3)')).toBe(false)
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor(null)).toBe(false)
  })

  it('스크립트는 JS 로 읽히고 last 를 글자로 넣는다', () => {
    const script = symbolColorScript('#7a7f8e')
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain('"#7a7f8e"')
    expect(() => new Function(`return ${symbolColorScript('')}`)).not.toThrow()
  })
})
