import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectLineEnding, editBlockReason, encodeForSave, isLocalPageRequest, isVcsMetaPath, saveTextFile, sha1Of } from './workspaceSave.js'

describe('workspaceSave', () => {
  it('rejects paths inside .git, .svn and .hg', () => {
    expect(isVcsMetaPath('.git/config')).toBe(true)
    expect(isVcsMetaPath('sub/.SVN/wc.db')).toBe(true)
    expect(isVcsMetaPath('a\\.hg\\hgrc')).toBe(true)
    expect(isVcsMetaPath('.git')).toBe(true)
    expect(isVcsMetaPath('.github/workflows/ci.yml')).toBe(false)
    expect(isVcsMetaPath('node_modules/x.js')).toBe(false)
    expect(isVcsMetaPath('my.git.txt')).toBe(false)
  })

  it('accepts only requests from a loopback page to a loopback host', () => {
    expect(isLocalPageRequest({ origin: 'http://127.0.0.1:4710', host: '127.0.0.1:4710' })).toBe(true)
    expect(isLocalPageRequest({ origin: 'http://localhost:4711', host: 'localhost:4711' })).toBe(true)
    expect(isLocalPageRequest({ origin: 'http://[::1]:4710', host: '[::1]:4710' })).toBe(true)
    // Origin 이 없으면 Referer
    expect(isLocalPageRequest({ referer: 'http://127.0.0.1:4710/?x=1', host: '127.0.0.1:4710' })).toBe(true)
    // 다른 사이트에서
    expect(isLocalPageRequest({ origin: 'https://evil.example', host: '127.0.0.1:4710' })).toBe(false)
    expect(isLocalPageRequest({ origin: 'null', host: '127.0.0.1:4710' })).toBe(false)
    expect(isLocalPageRequest({ host: '127.0.0.1:4710' })).toBe(false)
    // DNS rebinding: 공격 사이트 이름이 127.0.0.1 로 풀려도 Origin·Host 가 그 이름이다
    expect(isLocalPageRequest({ origin: 'http://rebind.example:4710', host: 'rebind.example:4710' })).toBe(false)
    // LAN 주소로 연 화면
    expect(isLocalPageRequest({ origin: 'http://192.168.0.10:4710', host: '192.168.0.10:4710' })).toBe(false)
    expect(isLocalPageRequest({ origin: 'http://127.0.0.1.evil.example', host: '127.0.0.1:4710' })).toBe(false)
  })

  it('detects the dominant line ending', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('crlf')
    expect(detectLineEnding('a\nb\n')).toBe('lf')
    expect(detectLineEnding('a\r\nb\nc\n')).toBe('lf')
    expect(detectLineEnding('single line')).toBe('lf')
  })

  it('restores line endings and the BOM', () => {
    expect([...encodeForSave('a\nb\n', 'utf-8', 'crlf')]).toEqual([...Buffer.from('a\r\nb\r\n')])
    expect([...encodeForSave('a\r\nb', 'utf-8', 'lf')]).toEqual([...Buffer.from('a\nb')])
    expect([...encodeForSave('한\n', 'utf-8-bom', 'crlf')]).toEqual([0xef, 0xbb, 0xbf, ...Buffer.from('한\r\n')])
  })

  it('gives a reason when the file cannot be edited', () => {
    expect(editBlockReason({ isLocal: true, path: 'a.ts', encoding: 'utf-8' })).toBeNull()
    expect(editBlockReason({ isLocal: false, path: 'a.ts', encoding: 'utf-8' })).toMatch(/only on this PC/)
    expect(editBlockReason({ isLocal: true, path: '.git/config', encoding: 'utf-8' })).toMatch(/\.git/)
    expect(editBlockReason({ isLocal: true, path: 'a.txt', encoding: 'euc-kr' })).toMatch(/EUC-KR/)
  })
})

describe('saveTextFile on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'jk-corp-save-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const write = (name: string, data: Buffer | string) => {
    const file = join(root, name)
    writeFileSync(file, data)
    return file
  }

  it('saves keeping CRLF and the BOM, and returns the new hash', async () => {
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')])
    const file = write('bom-crlf.txt', original)
    const result = await saveTextFile(file, 'one\nTWO\nthree\n', sha1Of(original))
    const saved = readFileSync(file)
    expect([...saved]).toEqual([0xef, 0xbb, 0xbf, ...Buffer.from('one\r\nTWO\r\nthree\r\n')])
    expect(result).toMatchObject({ kind: 'saved', hash: sha1Of(saved), size: saved.length })
  })

  it('shrinks a file (no leftover bytes) and keeps LF', async () => {
    const original = Buffer.from('a long line\nanother long line\n')
    const file = write('lf.txt', original)
    await saveTextFile(file, 'x\n', sha1Of(original))
    expect(readFileSync(file, 'utf8')).toBe('x\n')
  })

  it('refuses when the file changed since it was opened', async () => {
    const file = write('conflict.txt', 'now\n')
    const result = await saveTextFile(file, 'mine\n', sha1Of(Buffer.from('before\n')))
    expect(result).toMatchObject({ kind: 'conflict', hash: sha1Of(Buffer.from('now\n')), size: 4 })
    expect(readFileSync(file, 'utf8')).toBe('now\n')
  })

  it('refuses EUC-KR, binary and too-large results', async () => {
    const euc = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x0a])
    expect(await saveTextFile(write('euc.txt', euc), 'x', sha1Of(euc))).toMatchObject({ kind: 'rejected', status: 422 })
    const binary = Buffer.from([0x89, 0x50, 0x00, 0x01])
    expect(await saveTextFile(write('bin.dat', binary), 'x', sha1Of(binary))).toMatchObject({ kind: 'rejected', status: 422 })
    const small = Buffer.from('s\n')
    const file = write('grow.txt', small)
    expect(await saveTextFile(file, 'y'.repeat(1024 * 1024 + 1), sha1Of(small))).toMatchObject({ kind: 'rejected', status: 413 })
    expect(readFileSync(file, 'utf8')).toBe('s\n')
  })

  it('does not create a missing file', async () => {
    await expect(saveTextFile(join(root, 'missing.txt'), 'x', sha1Of(Buffer.from('')))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
