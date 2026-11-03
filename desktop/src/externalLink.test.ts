import { describe, expect, it } from 'vitest'
import { isExternalUrl } from './externalLink'

const SERVER = 'http://127.0.0.1:4710'

describe('isExternalUrl', () => {
  it('hands web links to the default browser', () => {
    expect(isExternalUrl('https://github.com/interrobang-dev/pray', SERVER)).toBe(true)
    expect(isExternalUrl('http://example.com/a?b=1', SERVER)).toBe(true)
    expect(isExternalUrl('http://127.0.0.1:4711/', SERVER)).toBe(true)
  })

  it('keeps the Pray server itself in Electron', () => {
    expect(isExternalUrl('http://127.0.0.1:4710/api/sessions/x/image?path=a.png', SERVER)).toBe(false)
    expect(isExternalUrl('http://127.0.0.1:4710/', SERVER)).toBe(false)
  })

  it('ignores other protocols and broken URLs', () => {
    expect(isExternalUrl('file:///C:/a.html', SERVER)).toBe(false)
    expect(isExternalUrl('mailto:a@b.c', SERVER)).toBe(false)
    expect(isExternalUrl('javascript:alert(1)', SERVER)).toBe(false)
    expect(isExternalUrl('not a url', SERVER)).toBe(false)
  })
})
