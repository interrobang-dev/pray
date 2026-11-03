import { describe, expect, it } from 'vitest'
import { chatImageTarget, imageDestinationOf, imageFileName, rawImageUrl } from './chatImageUrl'

const SESSION = '0f3c2a1e-1111-2222-3333-444455556666'
const api = (path: string) => `/api/sessions/${SESSION}/image?path=${encodeURIComponent(path)}`

describe('chatImageTarget', () => {
  it('keeps web and data image addresses', () => {
    expect(chatImageTarget('https://example.com/a.png', SESSION)).toEqual({ src: 'https://example.com/a.png', path: null })
    expect(chatImageTarget('HTTP://example.com/a.png', null)).toEqual({ src: 'HTTP://example.com/a.png', path: null })
    expect(chatImageTarget('data:image/png;base64,AAAA', SESSION)).toEqual({ src: 'data:image/png;base64,AAAA', path: null })
  })

  it('sends drive paths, file URLs and relative paths to the image API', () => {
    expect(chatImageTarget('C:\\Users\\me\\a.png', SESSION)).toEqual({ src: api('C:\\Users\\me\\a.png'), path: 'C:\\Users\\me\\a.png' })
    expect(chatImageTarget('d:/work/@private/a b.png', SESSION).src).toBe(api('d:/work/@private/a b.png'))
    expect(chatImageTarget('file:///C:/Users/me/a%20b.png', SESSION)).toEqual({ src: api('C:/Users/me/a b.png'), path: 'C:/Users/me/a b.png' })
    expect(chatImageTarget('scratchpad/shot.png', SESSION).path).toBe('scratchpad/shot.png')
    expect(chatImageTarget('./shot.png', SESSION).path).toBe('./shot.png')
    expect(chatImageTarget('../shot.png', SESSION).path).toBe('../shot.png')
  })

  it('has no address without a session, but keeps the path for the caption', () => {
    expect(chatImageTarget('C:\\a.png', null)).toEqual({ src: null, path: 'C:\\a.png' })
  })

  it('refuses other schemes and server-relative addresses', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'blob:abc', 'file://server/share/a.png', 'file:///etc/a.png', '//evil.com/a.png', '/api/x.png', '\\\\server\\a.png', '', 'C:a.png']) {
      expect(chatImageTarget(raw, SESSION), raw).toEqual({ src: null, path: null })
    }
  })
})

describe('image destination from markdown source', () => {
  it('reads the address as written, keeping backslashes before punctuation', () => {
    expect(imageDestinationOf('![shot](D:\\workspace\\@private\\jk-corp\\a.png)')).toBe('D:\\workspace\\@private\\jk-corp\\a.png')
    expect(imageDestinationOf('![shot](C:\\Users\\me\\.claude\\a_b.png "Title")')).toBe('C:\\Users\\me\\.claude\\a_b.png')
    expect(imageDestinationOf('![](<C:\\My Files\\a.png>)')).toBe('C:\\My Files\\a.png')
    expect(imageDestinationOf('![a [b] c](docs/a(1).png)')).toBe('docs/a(1).png')
    expect(imageDestinationOf("![a](x.png 'title')")).toBe('x.png')
  })

  it('is null for reference images', () => {
    expect(imageDestinationOf('![a][ref]')).toBe(null)
    expect(imageDestinationOf('![a]')).toBe(null)
  })

  it('falls back to the parsed address when the source is missing', () => {
    const markdown = 'See ![s](D:\\work\\@x\\a.png) here'
    expect(rawImageUrl(markdown, 4, markdown.indexOf(' here'), 'D:%5Cwork@x%5Ca.png')).toBe('D:\\work\\@x\\a.png')
    expect(rawImageUrl(null, undefined, undefined, 'D:%5Cwork@x%5Ca.png')).toBe('D:\\work@x\\a.png')
    expect(rawImageUrl(null, undefined, undefined, 'https://e.com/a%2Fb.png')).toBe('https://e.com/a%2Fb.png')
  })
})

describe('imageFileName', () => {
  it('takes the last path part', () => {
    expect(imageFileName('C:\\Users\\me\\a.png')).toBe('a.png')
    expect(imageFileName('docs/shots/b.jpg')).toBe('b.jpg')
    expect(imageFileName('https://e.com/x/c%20d.png?w=1#t')).toBe('c d.png')
    expect(imageFileName('data:image/png;base64,AAAA')).toBe('image')
    expect(imageFileName('')).toBe('image')
  })
})
