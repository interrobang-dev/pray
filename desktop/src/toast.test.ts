import { describe, expect, it } from 'vitest'
import { escapeXml, TOAST_OPEN_ARGUMENT, toastXml, type ToastContent } from './toast'

function content(overrides: Partial<ToastContent> = {}): ToastContent {
  return {
    title: '[Lead] Park · Done',
    body: '끝났습니다',
    attribution: 'Pray › Design',
    iconUrl: 'file:///C:/Users/me/AppData/Roaming/@pray/desktop/notice-done-lead-base-base.png',
    ...overrides,
  }
}

describe('escapeXml', () => {
  it('& < > " \' 를 바꾼다', () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
  })

  it('XML 1.0 에 못 넣는 문자를 지우고 탭·줄바꿈·이모지·한글은 둔다', () => {
    expect(escapeXml('a\u0000b\u0001c\u0008d\u000be\u000cf\u001fg\u007f')).toBe('abcdefg\u007f')
    expect(escapeXml('x\uFFFEy\uFFFFz')).toBe('xyz')
    expect(escapeXml('lone \uD800 high \uDC00 low')).toBe('lone  high  low')
    expect(escapeXml('tab\tline\nret\r 😀 한글')).toBe('tab\tline\nret\r 😀 한글')
  })
})

describe('toastXml', () => {
  it('제목 · 본문 · 작은 줄 · 원 그림, 머리줄·버튼 없음', () => {
    expect(toastXml(content())).toBe(
      '<toast launch="open" activationType="foreground">' +
        '<visual><binding template="ToastGeneric">' +
        '<text>[Lead] Park · Done</text>' +
        '<text>끝났습니다</text>' +
        '<text placement="attribution">Pray › Design</text>' +
        '<image placement="appLogoOverride" hint-crop="circle" src="file:///C:/Users/me/AppData/Roaming/@pray/desktop/notice-done-lead-base-base.png"/>' +
        '</binding></visual>' +
        '</toast>',
    )
  })

  it('없는 칸은 뺀다 (본문·작은 줄·그림)', () => {
    const xml = toastXml(content({ body: '', attribution: '', iconUrl: null }))
    expect(xml).not.toContain('<header')
    expect(xml).not.toContain('<actions')
    expect(xml).not.toContain('<image')
    expect(xml).not.toContain('placement="attribution"')
    expect(xml.match(/<text>/g)).toHaveLength(1)
  })

  it('모든 글을 escape 한다', () => {
    const xml = toastXml(
      content({
        title: '<b>Kim</b> & "Lee"',
        body: "it's <done>\u0000",
        attribution: '<Office>',
        iconUrl: 'file:///a&b.png',
      }),
    )
    expect(xml).toContain('<text>&lt;b&gt;Kim&lt;/b&gt; &amp; &quot;Lee&quot;</text>')
    expect(xml).toContain('<text>it&apos;s &lt;done&gt;</text>')
    expect(xml).toContain('<text placement="attribution">&lt;Office&gt;</text>')
    expect(xml).toContain('src="file:///a&amp;b.png"')
  })

  it('클릭 arguments 는 Electron 이 action·reply 로 가르는 글자를 담지 않는다', () => {
    expect(TOAST_OPEN_ARGUMENT).not.toMatch(/type=|tag=/)
  })
})
