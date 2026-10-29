import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import { normalizeCwd } from '@jk-corp/host/team'

export interface Vcs {
  kind: 'git' | 'svn'
  /** 저장소 루트 폴더 (`.git`·`.svn` 이 든 폴더) */
  root: string
}

/**
 * 폴더부터 위로 올라가며 가장 가까운 `.git`(폴더 또는 파일 — worktree 는 파일)·`.svn` 을 찾는다.
 * 같은 폴더에 둘 다 있으면 git. 폴더가 없거나 드라이브 루트까지 없으면 null. exists 는 던지면 null 로 본다
 */
export function detectVcs(cwd: string, exists: (path: string) => boolean = existsSync): Vcs | null {
  try {
    let dir = win32.resolve(cwd)
    if (!exists(dir)) return null
    for (;;) {
      if (exists(win32.join(dir, '.git'))) return { kind: 'git', root: dir }
      if (exists(win32.join(dir, '.svn'))) return { kind: 'svn', root: dir }
      const parent = win32.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  } catch {
    return null
  }
}

/**
 * 팀 폴더별 판정을 ttlMs 동안 메모리에 둔다. 서버를 다시 켜면 비고, 새 팀·바뀐 폴더는 키가 달라 바로 새로 판정한다.
 * `forget(cwd)` 은 그 폴더 판정을 지운다 (서버가 git init 한 뒤 — 지운 팀 폴더였으면 옛 null 이 남아 있을 수 있다)
 */
export function makeVcsCache(options: { ttlMs: number; detect?: (cwd: string) => Vcs | null; now?: () => number }) {
  const { ttlMs, detect = detectVcs, now = Date.now } = options
  const cache = new Map<string, { at: number; vcs: Vcs | null }>()
  const vcsOf = (cwd: string): Vcs | null => {
    const key = normalizeCwd(cwd)
    const cached = cache.get(key)
    if (cached && now() - cached.at < ttlMs) return cached.vcs
    const vcs = detect(cwd)
    cache.set(key, { at: now(), vcs })
    return vcs
  }
  return Object.assign(vcsOf, { forget: (cwd: string) => void cache.delete(normalizeCwd(cwd)) })
}
