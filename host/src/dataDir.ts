import { existsSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 설정 폴더 `~/.claude/pray/` (hq.json·config.json·auth-tokens.json·accounts.json·instructions.jsonl·logs·sprite-src) */
export const DATA_DIR_NAME = 'pray'
/** 옛 이름. 이 폴더만 있으면 처음 쓸 때 한 번 새 이름으로 옮긴다 */
export const LEGACY_DATA_DIR_NAME = 'jk-corp'

/** 다른 프로세스가 안의 파일을 열어 두면 폴더 rename 이 실패한다 (Windows). 잠깐 기다렸다 다시 한다 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

export interface DataDirResult {
  dir: string
  /** 로그에 남길 경고 (옛 폴더가 남아 있음·옮기지 못함). 없으면 null */
  warning: string | null
}

/**
 * `<claudeDir>/pray` 를 쓸지 `<claudeDir>/jk-corp` 를 쓸지 정하고, 새 폴더가 없고 옛 폴더만 있으면 rename 한다.
 * 파일 상태만 보고 정하므로 여러 프로세스(트레이·호스트·서버)가 같은 답을 낸다. 트레이(desktop/src/dataDir.ts)에 같은 규칙이 따로 있다
 */
export function resolveDataDir(claudeDir: string): DataDirResult {
  const dir = join(claudeDir, DATA_DIR_NAME)
  const legacyDir = join(claudeDir, LEGACY_DATA_DIR_NAME)
  if (existsSync(dir)) {
    // 합치지 않는다. 옛 폴더에만 있는 기록은 손으로 옮긴다
    const warning = existsSync(legacyDir) ? `설정 폴더 ${dir} 를 쓴다. 옛 폴더 ${legacyDir} 도 남아 있다 (합치지 않음)` : null
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
        // 호출부가 전부 동기라 동기로 기다린다
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS)
        continue
      }
      // 이번 실행은 옛 폴더를 쓴다. rename 은 성공 아니면 변화가 없어 되돌릴 것이 없다
      return { dir: legacyDir, warning: `설정 폴더를 ${legacyDir} 에서 ${dir} 로 옮기지 못해 옛 폴더를 쓴다: ${code || String(error)}` }
    }
  }
}

let resolved: DataDirResult | null = null

/** 이 프로세스의 설정 폴더. 처음 부를 때 한 번 정한다 (필요하면 옮긴다). import 때가 아니라 쓸 때 부른다 — 시험이 실제 폴더를 옮기지 않게 */
export function dataDirResult(): DataDirResult {
  resolved ??= resolveDataDir(join(homedir(), '.claude'))
  return resolved
}

export function dataDir(): string {
  return dataDirResult().dir
}
