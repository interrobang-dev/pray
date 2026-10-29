import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveDataDir } from './dataDir'

// 규칙 전체(ENOENT·재시도·동시 경쟁)는 host/src/dataDir.test.ts 가 본다. 여기는 트레이 쪽 사본이 같은 답을 내는지만
let claudeDir: string
let dir: string
let legacyDir: string

beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), 'pray-tray-data-dir-'))
  dir = join(claudeDir, 'pray')
  legacyDir = join(claudeDir, 'jk-corp')
})

afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true })
})

function seedLegacy(): void {
  mkdirSync(join(legacyDir, 'logs'), { recursive: true })
  writeFileSync(join(legacyDir, 'hq.json'), '{}')
}

describe('resolveDataDir (tray)', () => {
  it('uses pray/ when neither folder exists', () => {
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
    expect(existsSync(dir)).toBe(false)
  })

  it('moves jk-corp/ to pray/', () => {
    seedLegacy()
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
    expect(readFileSync(join(dir, 'hq.json'), 'utf8')).toBe('{}')
    expect(existsSync(legacyDir)).toBe(false)
  })

  it('uses pray/ and warns when both exist', () => {
    mkdirSync(dir)
    seedLegacy()
    const result = resolveDataDir(claudeDir)
    expect(result.dir).toBe(dir)
    expect(result.warning).toContain(legacyDir)
    expect(existsSync(join(legacyDir, 'hq.json'))).toBe(true)
  })

  it('keeps jk-corp/ for this run when a file inside is held open', async () => {
    seedLegacy()
    const path = join(legacyDir, 'logs', 'host.log')
    const holder = spawn(process.execPath, ['-e', `require('fs').openSync(${JSON.stringify(path)}, 'a'); console.log('ready'); setInterval(() => {}, 1000)`], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    await new Promise((resolve) => holder.stdout.once('data', resolve))
    try {
      const result = resolveDataDir(claudeDir)
      expect(result.dir).toBe(legacyDir)
      expect(result.warning).not.toBeNull()
    } finally {
      await new Promise((resolve) => {
        holder.once('exit', resolve)
        holder.kill()
      })
    }
  })
})
