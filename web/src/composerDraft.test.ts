import { beforeEach, describe, expect, it } from 'vitest'
import { addToComposerDraft, composerDraft, insertSnippet, restoreToComposerDraft } from './composerDraft'

describe('composerDraft', () => {
  beforeEach(() => {
    composerDraft.text = ''
    composerDraft.selection = null
    composerDraft.isFocusPending = false
  })

  it('inserts into an empty input with a trailing space', () => {
    expect(insertSnippet('', 0, 0, '`a.ts:3`')).toEqual({ text: '`a.ts:3` ', caret: 9 })
  })

  it('adds spaces only where the neighbours are not spaces', () => {
    expect(insertSnippet('look at', 7, 7, '`a.ts`')).toEqual({ text: 'look at `a.ts` ', caret: 15 })
    expect(insertSnippet('look at ', 8, 8, '`a.ts`')).toEqual({ text: 'look at `a.ts` ', caret: 15 })
    expect(insertSnippet('see and fix', 3, 3, '`a.ts`')).toEqual({ text: 'see `a.ts` and fix', caret: 10 })
    expect(insertSnippet('seeand', 3, 3, '`a.ts`')).toEqual({ text: 'see `a.ts` and', caret: 11 })
    expect(insertSnippet('line\n', 5, 5, '`a.ts`')).toEqual({ text: 'line\n`a.ts` ', caret: 12 })
  })

  it('replaces a selected part', () => {
    expect(insertSnippet('fix THIS now', 4, 8, '`a.ts:1`')).toEqual({ text: 'fix `a.ts:1` now', caret: 12 })
  })

  it('adds at the saved caret, or at the end when unknown, and asks for focus', () => {
    composerDraft.text = 'check'
    addToComposerDraft('`a.ts`')
    expect(composerDraft).toEqual({ text: 'check `a.ts` ', selection: { start: 13, end: 13 }, isFocusPending: true, quote: null })

    composerDraft.text = 'one two'
    composerDraft.selection = { start: 3, end: 3 }
    addToComposerDraft('`b.ts`')
    expect(composerDraft.text).toBe('one `b.ts` two')
    expect(composerDraft.selection).toEqual({ start: 10, end: 10 })
  })

  it('clamps a stale caret after the input was cleared', () => {
    composerDraft.text = ''
    composerDraft.selection = { start: 40, end: 40 }
    addToComposerDraft('`a.ts`')
    expect(composerDraft.text).toBe('`a.ts` ')
  })

  it('puts restored text in front of the draft with the caret at its end, and asks for focus', () => {
    restoreToComposerDraft('sent\nline two')
    expect(composerDraft).toEqual({ text: 'sent\nline two', selection: { start: 13, end: 13 }, isFocusPending: true, quote: null })

    composerDraft.text = 'typing'
    composerDraft.selection = { start: 2, end: 2 }
    composerDraft.isFocusPending = false
    restoreToComposerDraft('queued')
    expect(composerDraft).toEqual({ text: 'queued\ntyping', selection: { start: 6, end: 6 }, isFocusPending: true, quote: null })
  })
})
