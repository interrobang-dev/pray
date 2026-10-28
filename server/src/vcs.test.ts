import { describe, expect, it } from 'vitest'
import { detectVcs, makeVcsCache } from './vcs.js'

const existsIn = (...paths: string[]) => (path: string) => paths.includes(path)

describe('detectVcs', () => {
  it('finds .git in the folder itself', () => {
    const exists = existsIn('D:\\work\\app', 'D:\\work\\app\\.git')
    expect(detectVcs('D:\\work\\app', exists)).toEqual({ kind: 'git', root: 'D:\\work\\app' })
  })

  it('walks up to the nearest repository (.git file of a worktree counts)', () => {
    const exists = existsIn('D:\\work\\app\\sub', 'D:\\work\\app\\.git')
    expect(detectVcs('D:/work/app/sub', exists)).toEqual({ kind: 'git', root: 'D:\\work\\app' })
  })

  it('finds svn', () => {
    const exists = existsIn('D:\\svn\\proj', 'D:\\svn\\.svn')
    expect(detectVcs('D:\\svn\\proj', exists)).toEqual({ kind: 'svn', root: 'D:\\svn' })
  })

  it('prefers the nearer one, and git when both are in the same folder', () => {
    const nearerSvn = existsIn('D:\\a\\b', 'D:\\a\\.git', 'D:\\a\\b\\.svn')
    expect(detectVcs('D:\\a\\b', nearerSvn)?.kind).toBe('svn')
    const same = existsIn('D:\\a', 'D:\\a\\.git', 'D:\\a\\.svn')
    expect(detectVcs('D:\\a', same)?.kind).toBe('git')
  })

  it('returns null when none up to the drive root, the folder is missing, or the check throws', () => {
    expect(detectVcs('D:\\a\\b', existsIn('D:\\a\\b'))).toBeNull()
    expect(detectVcs('D:\\gone', existsIn())).toBeNull()
    expect(
      detectVcs('D:\\a', () => {
        throw new Error('EPERM')
      }),
    ).toBeNull()
  })
})

describe('makeVcsCache', () => {
  it('reuses a result per folder until the ttl passes', () => {
    let time = 0
    let calls = 0
    const lookup = makeVcsCache({
      ttlMs: 1000,
      now: () => time,
      detect: () => {
        calls++
        return null
      },
    })
    lookup('D:\\A\\')
    lookup('d:/a')
    expect(calls).toBe(1)
    lookup('D:\\b')
    expect(calls).toBe(2)
    time = 1000
    lookup('D:\\a')
    expect(calls).toBe(3)
  })
})
