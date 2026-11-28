import { describe, expect, it } from 'vitest'
import { contextMenuPosition, isHtmlPath, treeMenuEntries } from './treeMenu'

describe('treeMenuEntries', () => {
  it('folder: add to chat and copy paths only', () => {
    expect(treeMenuEntries({ kind: 'dir', path: 'web/src', isLocal: true, hasShareBridge: true })).toEqual([
      'add-to-chat',
      'separator',
      'copy-path',
      'copy-full-path',
    ])
  })

  it('file on another PC: no copy file, chrome, reveal', () => {
    expect(treeMenuEntries({ kind: 'file', path: 'a/index.html', isLocal: false, hasShareBridge: false })).toEqual([
      'open',
      'add-to-chat',
      'separator',
      'copy-path',
      'copy-full-path',
      'separator',
      'download',
      'history',
    ])
  })

  it('html file on this PC with share bridge: everything', () => {
    expect(treeMenuEntries({ kind: 'file', path: 'a/index.HTM', isLocal: true, hasShareBridge: true })).toEqual([
      'open',
      'add-to-chat',
      'separator',
      'copy-path',
      'copy-full-path',
      'copy-file',
      'separator',
      'download',
      'share',
      'open-in-chrome',
      'history',
      'reveal',
    ])
  })

  it('non-html file on this PC: no open in chrome', () => {
    expect(treeMenuEntries({ kind: 'file', path: 'a.ts', isLocal: true, hasShareBridge: false })).not.toContain('open-in-chrome')
  })
})

describe('isHtmlPath', () => {
  it('html and htm only', () => {
    expect(isHtmlPath('x.html')).toBe(true)
    expect(isHtmlPath('x.HTM')).toBe(true)
    expect(isHtmlPath('x.xhtml.txt')).toBe(false)
    expect(isHtmlPath('html')).toBe(false)
  })
})

describe('contextMenuPosition', () => {
  const viewport = { width: 1000, height: 800 }
  const menu = { width: 160, height: 300 }

  it('opens at the point when it fits', () => {
    expect(contextMenuPosition({ x: 100, y: 100 }, menu, viewport)).toEqual({ left: 100, top: 100 })
  })

  it('flips left and up near the right and bottom edges', () => {
    expect(contextMenuPosition({ x: 950, y: 700 }, menu, viewport)).toEqual({ left: 790, top: 400 })
  })

  it('sticks inside the margin when neither side fits', () => {
    expect(contextMenuPosition({ x: 100, y: 200 }, menu, { width: 200, height: 320 })).toEqual({ left: 32, top: 12 })
  })

  it('never goes above or left of the margin', () => {
    expect(contextMenuPosition({ x: 0, y: 0 }, { width: 500, height: 900 }, viewport)).toEqual({ left: 0, top: 8 })
  })
})
