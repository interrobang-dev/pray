import { describe, expect, it } from 'vitest'
import { isRawOnlyKind, previewKindOf } from './filePreview'

describe('previewKindOf', () => {
  it('picks the kind from the extension, ignoring case and folders', () => {
    expect(previewKindOf('a/b/logo.PNG')).toBe('image')
    expect(previewKindOf('icon.svg')).toBe('svg')
    expect(previewKindOf('docs/spec.pdf')).toBe('pdf')
    expect(previewKindOf('clip.MOV')).toBe('video')
    expect(previewKindOf('clip.webm')).toBe('video')
    expect(previewKindOf('sound.mp3')).toBe('audio')
    expect(previewKindOf('sound.wav')).toBe('audio')
  })

  it('has no preview for other files, dot files and folders with dots', () => {
    expect(previewKindOf('a.ts')).toBeNull()
    expect(previewKindOf('a.html')).toBeNull()
    expect(previewKindOf('.png')).toBeNull()
    expect(previewKindOf('a.png/readme')).toBeNull()
    expect(previewKindOf('Makefile')).toBeNull()
    expect(previewKindOf(null)).toBeNull()
  })

  it('fetches text only for SVG (source view)', () => {
    expect(isRawOnlyKind('image')).toBe(true)
    expect(isRawOnlyKind('pdf')).toBe(true)
    expect(isRawOnlyKind('video')).toBe(true)
    expect(isRawOnlyKind('svg')).toBe(false)
    expect(isRawOnlyKind(null)).toBe(false)
  })
})
