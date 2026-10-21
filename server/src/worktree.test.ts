import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { markFolderTrusted, trustKey, withTrust, worktreePath, worktreeSlug } from './worktree.js'

describe('worktree', () => {
  it('slug keeps ascii letters, digits and hyphens, else falls back to part id', () => {
    expect(worktreeSlug('API Server', 'p1')).toBe('api-server')
    expect(worktreeSlug('웹 v2!', 'p1')).toBe('v2')
    expect(worktreeSlug('문서', 'p1')).toBe('p1')
  })

  it('path is a sibling folder of the repo with forward slashes', () => {
    expect(worktreePath('D:/workspace/@private/jk-corp', 'api')).toBe('D:/workspace/@private/jk-corp.worktrees/api')
    expect(worktreePath('D:\\workspace\\foo\\', 'web')).toBe('D:/workspace/foo.worktrees/web')
  })

  it('trust adds only the folder key and keeps the rest', () => {
    const before = JSON.stringify({ numStartups: 3, projects: { 'D:/a': { hasTrustDialogAccepted: true, allowedTools: ['x'] } } })
    const after = JSON.parse(withTrust(before, 'D:/a.worktrees/api')!)
    expect(after.numStartups).toBe(3)
    expect(after.projects['D:/a']).toEqual({ hasTrustDialogAccepted: true, allowedTools: ['x'] })
    expect(after.projects['D:/a.worktrees/api']).toEqual({ hasTrustDialogAccepted: true })
    expect(JSON.parse(withTrust('{}', 'D:/b')!).projects).toEqual({ 'D:/b': { hasTrustDialogAccepted: true } })
  })

  it('trust refuses unparsable files', () => {
    expect(withTrust('{ broken', 'D:/a')).toBeNull()
    expect(withTrust('null', 'D:/a')).toBeNull()
  })

  it('trust returns the text as is when the folder is already trusted', () => {
    const before = '{"projects":{"D:/a":{"hasTrustDialogAccepted":true}}}'
    expect(withTrust(before, 'D:/a')).toBe(before)
  })
})

describe('session folder trust', () => {
  // 실제 ~/.claude.json 대신 임시 폴더의 파일을 쓴다
  const root = mkdtempSync(join(tmpdir(), 'jk-corp-trust-'))
  const folder = join(root, 'MixedCase')
  mkdirSync(folder)
  const claudeJsonPath = join(root, '.claude.json')
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('key is the real path with drive letter upper case, disk case and forward slashes, whatever the input looks like', () => {
    const key = trustKey(folder)!
    expect(key).toMatch(/^[A-Z]:\//)
    expect(key).not.toContain('\\')
    expect(key.endsWith('/MixedCase')).toBe(true)
    expect(trustKey(folder.toLowerCase())).toBe(key)
    expect(trustKey(`${folder.toLowerCase().replace(/\\/g, '/')}/`)).toBe(key)
    expect(trustKey(join(folder, '..', 'MixedCase'))).toBe(key)
    expect(trustKey(join(root, 'missing'))).toBeNull()
  })

  it('writes the key once and does not touch the file when it is already trusted', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({ numStartups: 3, projects: { 'D:/other': { allowedTools: ['x'] } } }))
    expect(markFolderTrusted(folder.toLowerCase(), claudeJsonPath)).toBe(true)
    const written = readFileSync(claudeJsonPath, 'utf8')
    expect(JSON.parse(written)).toEqual({
      numStartups: 3,
      projects: { 'D:/other': { allowedTools: ['x'] }, [trustKey(folder)!]: { hasTrustDialogAccepted: true } },
    })

    // 한 줄로 다시 쓴 파일: 다시 쓰면 들여쓰기가 생기므로 글이 같으면 쓰지 않은 것이다
    const compact = JSON.stringify(JSON.parse(written))
    writeFileSync(claudeJsonPath, compact)
    expect(markFolderTrusted(folder, claudeJsonPath)).toBe(true)
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe(compact)
  })

  it('reports failure on a broken file and records nothing for a missing folder', () => {
    writeFileSync(claudeJsonPath, '{ broken')
    expect(markFolderTrusted(folder, claudeJsonPath)).toBe(false)
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe('{ broken')
    writeFileSync(claudeJsonPath, '{}')
    expect(markFolderTrusted(join(root, 'missing'), claudeJsonPath)).toBeNull()
    expect(readFileSync(claudeJsonPath, 'utf8')).toBe('{}')
  })
})
