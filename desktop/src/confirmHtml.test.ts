import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIRM_COLORS, CONFIRM_TITLE_PREFIX, confirmAnswerOf, confirmHtml, escapeHtml } from './confirmHtml'

const styleCss = readFileSync(join(__dirname, '..', '..', 'web', 'src', 'style.css'), 'utf8')

/** style.css 의 한 선택자 블록 안 변수 값 */
function cssVar(selector: string, name: string): string | undefined {
  const start = styleCss.indexOf(`${selector} {`)
  const body = styleCss.slice(start, styleCss.indexOf('\n}', start))
  return body.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm'))?.[1].trim()
}

const content = { title: 'Restart Pray?', message: 'Line 1\nLine 2', confirmLabel: 'Restart', iconDataUrl: 'data:image/png;base64,AAAA' }

describe('confirmHtml', () => {
  it('색은 style.css Default 팔레트와 같다', () => {
    const names = { panel: 'panel', text: 'text', muted: 'muted', surface2: 'surface-2', surface3: 'surface-3' } as const
    for (const [key, name] of Object.entries(names) as [keyof typeof names, string][]) {
      expect(CONFIRM_COLORS.light[key]).toBe(cssVar(':root', name))
      expect(CONFIRM_COLORS.dark[key]).toBe(cssVar(":root[data-theme='dark']", name))
    }
    expect(CONFIRM_COLORS.accent).toBe(cssVar(':root', 'accent'))
    expect(CONFIRM_COLORS.redFill).toBe(cssVar(':root', 'red-fill'))
    expect(CONFIRM_COLORS.onRed).toBe(cssVar(':root', 'on-red'))
    // 다크 블록이 강조·빨강을 따로 정하면 사본도 모드별로 나눠야 한다
    expect(cssVar(":root[data-theme='dark']", 'accent')).toBeUndefined()
    expect(cssVar(":root[data-theme='dark']", 'red-fill')).toBeUndefined()
    expect(cssVar(":root[data-theme='dark']", 'on-red')).toBeUndefined()
  })

  it('글자를 이스케이프한다', () => {
    expect(escapeHtml(`<b>"a" & 'b'</b>`)).toBe('&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;')
    const html = confirmHtml({ ...content, title: '<script>x</script>', confirmLabel: 'A & B' })
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('>A &amp; B</button>')
    expect(html).not.toContain('<script>x</script>')
  })

  it('제목·설명·버튼·그림을 넣고 처음 포커스는 Cancel', () => {
    const html = confirmHtml(content)
    expect(html).toContain('<h1 class="title">Restart Pray?</h1>')
    expect(html).toContain('<p class="message">Line 1\nLine 2</p>')
    expect(html).toContain('id="confirm" class="danger">Restart</button>')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('cancel.focus()')
    expect(confirmHtml({ ...content, iconDataUrl: '' })).not.toContain('<img')
  })

  it('페이지 스크립트는 JS 로 읽힌다', () => {
    const script = confirmHtml(content).match(/<script>([\s\S]*)<\/script>/)?.[1] ?? ''
    expect(script).toContain(CONFIRM_TITLE_PREFIX)
    expect(() => new Function(script)).not.toThrow()
  })

  it('제목으로 답을 읽는다', () => {
    expect(confirmAnswerOf('pray-confirm:yes')).toBe(true)
    expect(confirmAnswerOf('pray-confirm:no')).toBe(false)
    expect(confirmAnswerOf('Pray')).toBeNull()
  })
})
