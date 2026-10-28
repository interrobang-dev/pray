import { describe, expect, it } from 'vitest'
import { codeLinesHtml, escapeHtml, normalizeText, plainLines, splitHighlightedLines } from './codeLines'

describe('codeLines', () => {
  it('escapes HTML', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('drops CR and one trailing newline', () => {
    expect(normalizeText('a\r\nb\r\n')).toBe('a\nb')
    expect(normalizeText('a\n\n')).toBe('a\n')
    expect(normalizeText('')).toBe('')
  })

  it('closes and reopens spans that cross lines', () => {
    const html = 'x <span class="hljs-comment">/* one\ntwo <span class="hljs-doctag">@a</span>\nthree */</span> y'
    expect(splitHighlightedLines(html)).toEqual([
      'x <span class="hljs-comment">/* one</span>',
      '<span class="hljs-comment">two <span class="hljs-doctag">@a</span></span>',
      '<span class="hljs-comment">three */</span> y',
    ])
  })

  it('keeps nested spans open across a line', () => {
    const html = '<span class="a"><span class="b">1\n2</span>3</span>'
    expect(splitHighlightedLines(html)).toEqual(['<span class="a"><span class="b">1</span></span>', '<span class="a"><span class="b">2</span>3</span>'])
  })

  it('keeps empty lines', () => {
    expect(splitHighlightedLines('a\n\nb')).toEqual(['a', '', 'b'])
    expect(plainLines('<\n\n>')).toEqual(['&lt;', '', '&gt;'])
  })

  it('numbers lines from 1', () => {
    expect(codeLinesHtml(['a', 'b'])).toBe('<div class="code-line" data-line="1">a</div><div class="code-line" data-line="2">b</div>')
  })
})
