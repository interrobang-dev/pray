import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDataDir } from './dataDir.js'

// 다른 프로세스가 먼저 옮긴 경우·잠깐 잠긴 경우를 흉내 내려고 감싼다. 기본은 실제 renameSync
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const realRenameSync = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync
const renameSync = vi.mocked(fs.renameSync)

function systemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

let claudeDir: string
let dir: string
let legacyDir: string

beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), 'pray-data-dir-'))
  dir = join(claudeDir, 'pray')
  legacyDir = join(claudeDir, 'jk-corp')
  renameSync.mockReset()
  renameSync.mockImplementation(realRenameSync)
})

afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true })
})

function seedLegacy(): void {
  mkdirSync(join(legacyDir, 'logs'), { recursive: true })
  mkdirSync(join(legacyDir, 'sprite-src', 'v5'), { recursive: true })
  writeFileSync(join(legacyDir, 'hq.json'), '{"webSessions":[]}')
}

describe('resolveDataDir', () => {
  it('uses pray/ when neither folder exists, without creating anything', () => {
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
    expect(existsSync(dir)).toBe(false)
    expect(renameSync).not.toHaveBeenCalled()
  })

  it('moves jk-corp/ to pray/ with everything inside', () => {
    seedLegacy()
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
    expect(existsSync(legacyDir)).toBe(false)
    expect(readFileSync(join(dir, 'hq.json'), 'utf8')).toBe('{"webSessions":[]}')
    expect(existsSync(join(dir, 'sprite-src', 'v5'))).toBe(true)
  })

  it('uses pray/ as is when it exists', () => {
    mkdirSync(dir)
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
    expect(renameSync).not.toHaveBeenCalled()
  })

  it('uses pray/ and only warns when jk-corp/ is also there (no merge)', () => {
    mkdirSync(dir)
    seedLegacy()
    const result = resolveDataDir(claudeDir)
    expect(result.dir).toBe(dir)
    expect(result.warning).toContain(legacyDir)
    expect(existsSync(join(legacyDir, 'hq.json'))).toBe(true)
    expect(existsSync(join(dir, 'hq.json'))).toBe(false)
    expect(renameSync).not.toHaveBeenCalled()
  })

  it('uses pray/ when another process moved it first (ENOENT)', () => {
    seedLegacy()
    renameSync.mockImplementationOnce((from, to) => {
      realRenameSync(from, to)
      throw systemError('ENOENT')
    })
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
  })

  it('retries a briefly locked folder', () => {
    seedLegacy()
    renameSync.mockImplementationOnce(() => {
      throw systemError('EPERM')
    })
    renameSync.mockImplementationOnce(() => {
      throw systemError('EBUSY')
    })
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
    expect(renameSync).toHaveBeenCalledTimes(3)
    expect(existsSync(join(dir, 'hq.json'))).toBe(true)
  })

  it('keeps using jk-corp/ for this run when another process holds a file inside', async () => {
    seedLegacy()
    const holder = await holdFile(join(legacyDir, 'logs', 'host.log'))
    try {
      const result = resolveDataDir(claudeDir)
      expect(result.dir).toBe(legacyDir)
      expect(result.warning).toMatch(/EPERM|EBUSY|EACCES/)
      expect(renameSync).toHaveBeenCalledTimes(5)
      expect(existsSync(dir)).toBe(false)
      expect(existsSync(join(legacyDir, 'hq.json'))).toBe(true)
    } finally {
      await stop(holder)
    }
    // 잡고 있던 프로세스가 끝나면 다음 실행은 옮긴다
    expect(resolveDataDir(claudeDir)).toEqual({ dir, warning: null })
  })

  it('gives every racing process the same answer and moves exactly once', async () => {
    seedLegacy()
    const go = join(claudeDir, 'go')
    const racers = [1, 2, 3].map(() => race(claudeDir, go))
    await Promise.all(racers.map((racer) => racer.ready))
    writeFileSync(go, '')
    const results = await Promise.all(racers.map((racer) => racer.result))
    expect(results).toEqual([1, 2, 3].map(() => ({ dir, warning: null })))
    expect(existsSync(legacyDir)).toBe(false)
    expect(readFileSync(join(dir, 'hq.json'), 'utf8')).toBe('{"webSessions":[]}')
  }, 30_000)
})

/** 파일을 열어 둔 채 기다리는 자식 node (Windows 는 안의 파일이 열려 있으면 폴더 rename 이 실패한다) */
function holdFile(path: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', `require('fs').openSync(${JSON.stringify(path)}, 'a'); console.log('ready'); setInterval(() => {}, 1000)`], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve, reject) => {
    child.stdout!.once('data', () => resolve(child))
    child.once('error', reject)
  })
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill()
  })
}

/** go 파일이 생기면 바로 resolveDataDir 를 부르는 자식 node. tsx 로 이 모듈을 그대로 불러온다 */
function race(claudeDir: string, go: string): { ready: Promise<void>; result: Promise<unknown> } {
  const moduleUrl = pathToFileURL(join(import.meta.dirname, 'dataDir.ts')).href
  const script = [
    `const { existsSync } = await import('node:fs')`,
    `const { resolveDataDir } = await import(${JSON.stringify(moduleUrl)})`,
    `console.log('ready')`,
    `while (!existsSync(${JSON.stringify(go)})) {}`,
    `console.log(JSON.stringify(resolveDataDir(${JSON.stringify(claudeDir)})))`,
  ].join('\n')
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: join(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let output = ''
  let markReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => (markReady = resolve))
  child.stdout!.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    if (output.includes('ready')) markReady()
  })
  const result = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) return reject(new Error(`racer exited ${code}: ${output}`))
      resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1)!))
    })
  })
  return { ready, result }
}
