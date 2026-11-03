import { describe, expect, it } from 'vitest'
import { localHtmlPath, rawLinkUrl } from './chatLinkUrl'

describe('rawLinkUrl', () => {
  it('takes the destination from the markdown source, keeping backslashes', () => {
    const markdown = 'see [report](D:\\workspace\\@private\\jk-corp\\r.html) now'
    const start = markdown.indexOf('[')
    const end = markdown.indexOf(' now')
    expect(rawLinkUrl(markdown, start, end, 'D:%5Cworkspace@private%5Cjk-corp%5Cr.html')).toBe('D:\\workspace\\@private\\jk-corp\\r.html')
  })

  it('uses the last "](" so images or brackets in the link text do not confuse it', () => {
    const source = '[![shot](a.png)](C:\\r\\report.html)'
    expect(rawLinkUrl(source, 0, source.length, '')).toBe('C:\\r\\report.html')
    const brackets = '[a [b] c](<C:\\My Files\\r.html> "Title")'
    expect(rawLinkUrl(brackets, 0, brackets.length, '')).toBe('C:\\My Files\\r.html')
  })

  it('falls back to the parsed address (decoded unless it is a web address)', () => {
    expect(rawLinkUrl(null, undefined, undefined, 'C:%5Cr%5Ca.html')).toBe('C:\\r\\a.html')
    expect(rawLinkUrl('<https://e.com/a%2Fb>', 0, 21, 'https://e.com/a%2Fb')).toBe('https://e.com/a%2Fb')
    expect(rawLinkUrl(null, undefined, undefined, 'mailto:a%40b.com')).toBe('mailto:a%40b.com')
  })
})

describe('localHtmlPath', () => {
  it('accepts drive paths, file URLs and relative paths to .html/.htm', () => {
    expect(localHtmlPath('C:\\Users\\me\\report.html')).toBe('C:\\Users\\me\\report.html')
    expect(localHtmlPath('d:/work/Old.HTM')).toBe('d:/work/Old.HTM')
    expect(localHtmlPath('file:///C:/Users/me/a%20b.html')).toBe('C:/Users/me/a b.html')
    expect(localHtmlPath('docs/report.html')).toBe('docs/report.html')
    expect(localHtmlPath('./out/index.htm')).toBe('./out/index.htm')
  })

  it('leaves web links, other files, anchors and odd shapes as normal links', () => {
    for (const raw of [
      'https://example.com/a.html',
      'http://127.0.0.1:4710/a.html',
      'mailto:a@b.com',
      'javascript:alert(1)//.html',
      'C:\\r\\notes.md',
      'report.html#section',
      '#a.html',
      '/abs/a.html',
      '\\\\server\\share\\a.html',
      'file://server/share/a.html',
      '',
    ]) {
      expect(localHtmlPath(raw), raw).toBe(null)
    }
  })
})
