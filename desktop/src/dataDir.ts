import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'

/** 다른 프로세스가 안의 파일을 열어 두면 폴더 rename 이 실패한다 (Windows). 잠깐 기다렸다 다시 한다 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

export interface FolderResult {
  dir: string
  /** 남길 경고 (옛 폴더가 남아 있음·옮기지 못함). 없으면 null */
  warning: string | null
}

/**
 * 새 폴더가 없고 옛 폴더만 있으면 rename 한다. 새 폴더가 있으면 그것을 쓰고(합치지 않는다), 옮기지 못하면 이번 실행은 옛 폴더를 쓴다.
 * 호스트의 `host/src/dataDir.ts` `resolveDataDir` 와 같은 규칙이다 (트레이는 CommonJS 빌드라 따로 둔다. 같이 고친다)
 */
export function moveFolderOnce(legacyDir: string, dir: string): FolderResult {
  if (existsSync(dir)) {
    const warning = existsSync(legacyDir) ? `Using ${dir}. The old folder ${legacyDir} is still there (not merged)` : null
    return { dir, warning }
  }
  if (!existsSync(legacyDir)) return { dir, warning: null }
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(legacyDir, dir)
      return { dir, warning: null }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      // 다른 프로세스가 먼저 옮겼다
      if (code === 'ENOENT' && existsSync(dir)) return { dir, warning: null }
      if (attempt < RENAME_ATTEMPTS && RENAME_RETRY_CODES.has(code)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS)
        continue
      }
      return { dir: legacyDir, warning: `Couldn't move ${legacyDir} to ${dir}, using the old folder: ${code || String(error)}` }
    }
  }
}

/**
 * Electron 앱 데이터 폴더(userData: 트레이 창 localStorage·tray-settings.json·single-instance 잠금). 같은 규칙인데,
 * Electron 이 main 스크립트보다 먼저 새 폴더를 빈 채로 만들어 두므로(실측) 옛 폴더가 있고 새 폴더가 비어 있으면 지우고 옮긴다.
 * `requestSingleInstanceLock` 전에 부른다 (잠금 파일이 새 폴더에 생기기 전)
 */
export function moveAppDataOnce(legacyDir: string, dir: string): FolderResult {
  if (existsSync(legacyDir) && existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir)
  return moveFolderOnce(legacyDir, dir)
}

/** 설정 폴더 `~/.claude/pray/` (옛 `~/.claude/jk-corp/` 만 있으면 옮긴다) */
export function resolveDataDir(claudeDir: string): FolderResult {
  return moveFolderOnce(join(claudeDir, 'jk-corp'), join(claudeDir, 'pray'))
}
