import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chatImagePathKind, resolveChatImage } from './chatImage.js'

describe('chat image path shape', () => {
  it('accepts drive-letter absolute paths and relative paths', () => {
    expect(chatImagePathKind('C:\\Users\\me\\a.png')).toBe('absolute')
    expect(chatImagePathKind('d:/work/shot.png')).toBe('absolute')
    expect(chatImagePathKind('scratchpad/a.png')).toBe('relative')
    expect(chatImagePathKind('./a.png')).toBe('relative')
    expect(chatImagePathKind('..\\a.png')).toBe('relative') // 꼴은 통과. 범위는 resolveChatImage 가 본다
    expect(chatImagePathKind('설계/화면 1.png')).toBe('relative')
  })

  it('rejects empty, control characters, UNC, drive-relative, root-relative and stream paths', () => {
    for (const path of [
      '',
      'a\0.png',
      'a\n.png',
      '\\\\server\\share\\a.png',
      '\\\\?\\C:\\a.png',
      '//server/share/a.png',
      '\\Windows\\a.png',
      '/etc/a.png',
      'C:a.png',
      'C:\\a.png:stream',
      'a.png:stream',
      'C:\\a?.png',
      'C:\\a|b.png',
      'x'.repeat(2049),
    ]) {
      expect(chatImagePathKind(path), JSON.stringify(path).slice(0, 40)).toBe(null)
    }
    expect(chatImagePathKind(undefined)).toBe(null)
    expect(chatImagePathKind(['a.png'])).toBe(null)
  })
})

describe('chat image resolve', () => {
  let base: string
  let root: string
  let temp: string
  let outside: string

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'pray-chat-image-')))
    root = join(base, 'work')
    temp = join(base, 'temp-claude')
    outside = join(base, 'outside')
    for (const dir of [root, join(root, 'docs'), join(temp, 'slug', 'session', 'scratchpad'), outside]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(root, 'docs', 'shot.png'), 'png')
    writeFileSync(join(root, 'notes.txt'), 'text')
    writeFileSync(join(root, 'icon.SVG'), '<svg/>')
    writeFileSync(join(temp, 'slug', 'session', 'scratchpad', 'cap.jpg'), 'jpg')
    writeFileSync(join(outside, 'secret.png'), 'png')
    mkdirSync(join(root, 'folder.png'))
    // junction 은 관리자 권한 없이 만들 수 있다
    symlinkSync(outside, join(root, 'out-link'), 'junction')
    symlinkSync(outside, join(temp, 'out-link'), 'junction')
    symlinkSync(join(root, 'docs'), join(root, 'docs-link'), 'junction')
  })

  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('serves images inside the session folder by relative or absolute path', async () => {
    const shot = join(root, 'docs', 'shot.png')
    expect(await resolveChatImage('docs/shot.png', root, temp)).toBe(shot)
    expect(await resolveChatImage('./docs\\shot.png', root, temp)).toBe(shot)
    expect(await resolveChatImage(shot, root, temp)).toBe(shot)
    expect(await resolveChatImage(shot.replaceAll('\\', '/'), root, temp)).toBe(shot)
    expect(await resolveChatImage('icon.SVG', root, temp)).toBe(join(root, 'icon.SVG'))
    // 안쪽을 가리키는 junction 은 된다
    expect(await resolveChatImage('docs-link/shot.png', root, temp)).toBe(shot)
  })

  it('serves anything under the Claude temp folder, even without a session folder', async () => {
    const cap = join(temp, 'slug', 'session', 'scratchpad', 'cap.jpg')
    expect(await resolveChatImage(cap, root, temp)).toBe(cap)
    expect(await resolveChatImage(cap, null, temp)).toBe(cap)
    // 상대 경로로 작업 폴더를 벗어나도 임시 폴더 안이면 된다
    expect(await resolveChatImage('../temp-claude/slug/session/scratchpad/cap.jpg', root, temp)).toBe(cap)
  })

  it('refuses paths outside both ranges, including through junctions', async () => {
    expect(await resolveChatImage(join(outside, 'secret.png'), root, temp)).toBe(null)
    expect(await resolveChatImage('../outside/secret.png', root, temp)).toBe(null)
    expect(await resolveChatImage('out-link/secret.png', root, temp)).toBe(null)
    expect(await resolveChatImage(join(temp, 'out-link', 'secret.png'), root, temp)).toBe(null)
  })

  it('refuses non-images, folders, missing files, bad shapes and relative paths without a session folder', async () => {
    expect(await resolveChatImage('notes.txt', root, temp)).toBe(null)
    expect(await resolveChatImage('folder.png', root, temp)).toBe(null)
    expect(await resolveChatImage('missing.png', root, temp)).toBe(null)
    expect(await resolveChatImage('docs/shot.png:x', root, temp)).toBe(null)
    expect(await resolveChatImage('docs/shot.png', null, temp)).toBe(null)
  })
})
