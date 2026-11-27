import { describe, expect, it } from 'vitest'
import { hasSourceView, isRawOnlyKind, previewKindOf, rawPathUrl } from './filePreview'

describe('previewKindOf', () => {
  it('picks the kind from the extension, ignoring case and folders', () => {
    expect(previewKindOf('a/b/logo.PNG')).toBe('image')
    expect(previewKindOf('icon.svg')).toBe('svg')
    expect(previewKindOf('site/index.html')).toBe('html')
    expect(previewKindOf('old.HTM')).toBe('html')
    expect(previewKindOf('docs/spec.pdf')).toBe('pdf')
    expect(previewKindOf('clip.MOV')).toBe('video')
    expect(previewKindOf('clip.webm')).toBe('video')
    expect(previewKindOf('sound.mp3')).toBe('audio')
    expect(previewKindOf('sound.wav')).toBe('audio')
  })

  it('has no preview for other files, dot files and folders with dots', () => {
    expect(previewKindOf('a.ts')).toBeNull()
    expect(previewKindOf('a.xhtml')).toBeNull()
    expect(previewKindOf('.png')).toBeNull()
    expect(previewKindOf('a.png/readme')).toBeNull()
    expect(previewKindOf('Makefile')).toBeNull()
    expect(previewKindOf(null)).toBeNull()
  })

  it('fetches text only for kinds with a source view (SVG, HTML)', () => {
    expect(hasSourceView('svg')).toBe(true)
    expect(hasSourceView('html')).toBe(true)
    expect(hasSourceView('image')).toBe(false)
    expect(hasSourceView(null)).toBe(false)
    expect(isRawOnlyKind('image')).toBe(true)
    expect(isRawOnlyKind('pdf')).toBe(true)
    expect(isRawOnlyKind('video')).toBe(true)
    expect(isRawOnlyKind('svg')).toBe(false)
    expect(isRawOnlyKind('html')).toBe(false)
    expect(isRawOnlyKind(null)).toBe(false)
  })
})

describe('rawPathUrl', () => {
  it('keeps folders as URL path segments so relative links resolve beside the file', () => {
    expect(rawPathUrl('abc', 'site/index.html')).toBe('/api/sessions/abc/raw/site/index.html')
    expect(new URL('css/site.css', `http://h${rawPathUrl('abc', 'site/index.html')}`).pathname).toBe('/api/sessions/abc/raw/site/css/site.css')
  })

  it('encodes each segment, not the separators', () => {
    expect(rawPathUrl('abc', '한글 폴더/a#b?c%.html')).toBe('/api/sessions/abc/raw/%ED%95%9C%EA%B8%80%20%ED%8F%B4%EB%8D%94/a%23b%3Fc%25.html')
  })
})
