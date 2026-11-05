import { describe, expect, it } from 'vitest'
import { docImageTarget, docLinkKind, headingSlug, isMarkdownPath, resolveDocPath } from './markdownDoc'

describe('isMarkdownPath', () => {
  it('matches .md and .markdown only', () => {
    expect(isMarkdownPath('docs/README.MD')).toBe(true)
    expect(isMarkdownPath('a.markdown')).toBe(true)
    expect(isMarkdownPath('a.mdx')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
    expect(isMarkdownPath(null)).toBe(false)
  })
})

describe('docLinkKind', () => {
  it('sorts links into external, anchor, file and other', () => {
    expect(docLinkKind('https://example.com')).toBe('external')
    expect(docLinkKind('mailto:a@b.c')).toBe('external')
    expect(docLinkKind('#setup')).toBe('anchor')
    expect(docLinkKind('./docs/a.md')).toBe('file')
    expect(docLinkKind('src/a.ts#L10')).toBe('file')
    expect(docLinkKind('javascript:alert(1)')).toBe('other')
    expect(docLinkKind('C:\\a.md')).toBe('other')
    expect(docLinkKind('file:///C:/a.md')).toBe('other')
    expect(docLinkKind('//cdn.example.com/a.png')).toBe('other')
    expect(docLinkKind('')).toBe('other')
  })
})

describe('resolveDocPath', () => {
  it('resolves against the folder of the markdown file inside the session folder', () => {
    expect(resolveDocPath('docs/plans/a.md', './b.md')).toBe('docs/plans/b.md')
    expect(resolveDocPath('docs/plans/a.md', '../../web/src/App.tsx#L3')).toBe('web/src/App.tsx')
    expect(resolveDocPath('README.md', 'img/my%20shot.png?raw=1')).toBe('img/my shot.png')
    expect(resolveDocPath('docs/a.md', '/CLAUDE.md')).toBe('CLAUDE.md')
    expect(resolveDocPath('docs/a.md', 'img\\b.png')).toBe('docs/img/b.png')
  })

  it('refuses paths that leave the session folder and non-file links', () => {
    expect(resolveDocPath('README.md', '../secret.txt')).toBeNull()
    expect(resolveDocPath('docs/a.md', '../../x')).toBeNull()
    expect(resolveDocPath('docs/a.md', '#top')).toBeNull()
    expect(resolveDocPath('docs/a.md', 'https://x.y/a.md')).toBeNull()
    expect(resolveDocPath('docs/a.md', '.')).toBe('docs')
    expect(resolveDocPath('a.md', './')).toBeNull()
  })
})

describe('docImageTarget', () => {
  it('keeps web and data images, maps relative ones to a session path and drops the rest', () => {
    expect(docImageTarget('a.md', 'https://x.y/a.png')).toEqual({ url: 'https://x.y/a.png' })
    expect(docImageTarget('a.md', 'data:image/png;base64,AAA')).toEqual({ url: 'data:image/png;base64,AAA' })
    expect(docImageTarget('docs/a.md', 'shots/b.png')).toEqual({ path: 'docs/shots/b.png' })
    expect(docImageTarget('a.md', 'C:\\Users\\a.png')).toBeNull()
    expect(docImageTarget('a.md', '../a.png')).toBeNull()
  })
})

describe('headingSlug', () => {
  it('makes GitHub style anchors', () => {
    expect(headingSlug('Getting Started!')).toBe('getting-started')
    expect(headingSlug('실행·확인')).toBe('실행확인')
    expect(headingSlug('A  b_c-d (e)')).toBe('a--b_c-d-e')
  })
})
