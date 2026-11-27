import { describe, expect, it } from 'vitest'
import { docxSrcdoc, withoutExternalLinks } from './docxSrcdoc'

describe('withoutExternalLinks', () => {
  it('drops external hrefs but keeps the address as a title', () => {
    expect(withoutExternalLinks('<p><a href="https://example.com/?a=1&amp;b=2">site</a></p>')).toBe(
      '<p><a title="https://example.com/?a=1&amp;b=2">site</a></p>',
    )
    expect(withoutExternalLinks('<a href="javascript:alert(1)">x</a>')).toBe('<a title="javascript:alert(1)">x</a>')
  })

  it('keeps links inside the document and bookmarks', () => {
    const html = '<a href="#footnote-1" id="footnote-ref-1">[1]</a><a id="_Toc1"></a>'
    expect(withoutExternalLinks(html)).toBe(html)
  })
})

describe('docxSrcdoc', () => {
  it('wraps the body in a white page that loads nothing from outside', () => {
    const doc = docxSrcdoc('<p>Hello</p>')
    expect(doc).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'")
    expect(doc).toContain('background: #fff')
    expect(doc).toContain('<body><p>Hello</p></body>')
  })
})
