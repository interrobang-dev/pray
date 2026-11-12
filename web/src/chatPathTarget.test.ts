import { describe, expect, it } from 'vitest'
import { inlineCodeTarget, isOpenablePath } from './chatPathTarget'

describe('isOpenablePath', () => {
  it('accepts drive absolute and cwd relative paths, with :line', () => {
    for (const path of ['C:\\Users\\me\\a.png', 'D:/work/app', 'web/src/Chat.tsx', './a.ts', '../x/y.md', 'web/Chat.tsx:422', 'C:\\a\\b.ts:12:3', '.claude/rules/chat.md']) {
      expect(isOpenablePath(path), path).toBe(true)
    }
  })

  it('refuses a bare file name without a folder', () => {
    for (const path of ['Chat.tsx', 'Chat.tsx:422', '.gitignore', 'package.json']) {
      expect(isOpenablePath(path), path).toBe(false)
    }
  })

  it('refuses rooted, home, UNC, drive-relative and odd shapes', () => {
    for (const path of ['/api/sessions', '\\x', '~/a.md', '\\\\server\\share', '\\\\?\\C:\\a', 'C:x', 'C:\\a:b', 'a?b', 'a|b', '', 'a\nb', 'a.ts:x']) {
      expect(isOpenablePath(path), path).toBe(false)
    }
  })
})

describe('inlineCodeTarget', () => {
  it('a whole http(s) URL is a link', () => {
    expect(inlineCodeTarget('https://example.com/a?b=1#c')).toEqual({ kind: 'url', url: 'https://example.com/a?b=1#c' })
    expect(inlineCodeTarget('http://127.0.0.1:4710')).toEqual({ kind: 'url', url: 'http://127.0.0.1:4710' })
  })

  it('a URL with spaces, other schemes or text around is not', () => {
    for (const text of ['see https://e.com', 'https://e.com x', 'ftp://e.com/a', 'javascript:alert(1)', 'https://']) {
      expect(inlineCodeTarget(text), text).toBe(null)
    }
  })

  it('the whole code being one openable path is a path', () => {
    for (const text of ['web/src/Chat.tsx', 'D:\\workspace\\@private\\jk-corp', 'C:/a/b.png', 'web/Chat.tsx:422', '.claude/rules/chat.md']) {
      expect(inlineCodeTarget(text), text).toEqual({ kind: 'path', path: text })
    }
  })

  it('code that is only partly a path, or a path the server refuses, is plain code', () => {
    for (const text of ['npm run build', 'cd web/src', 'web/src/Chat.tsx 에', 'a.ts.', '/api/sessions', '~/x/y.md', 'isOpenable', 'v1.2.3', 'and/or', 'Node.js', 'Chat.tsx:422', 'package.json', '']) {
      expect(inlineCodeTarget(text), text).toBe(null)
    }
  })
})
