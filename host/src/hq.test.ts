import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addGroup, listTeams, listWebSessions, removeWebSession } from './hq.js'

// hq.ts 는 import 때 homedir() 로 경로를 정한다. 실제 ~/.claude/jk-corp/hq.json 대신 임시 폴더를 쓴다
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  const { mkdtempSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const { join } = await import('node:path')
  const home = mkdtempSync(join(os.tmpdir(), 'jk-corp-hq-'))
  return { ...os, homedir: () => home }
})

// Windows rename 실패를 흉내 내려고 감싼다. 기본은 실제 renameSync
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

// 모킹이 안 먹었으면 실제 기록을 지우게 되므로 시작하지 않는다
if (!homedir().startsWith(tmpdir())) throw new Error(`테스트 홈이 임시 폴더가 아님: ${homedir()}`)

const hqDir = join(homedir(), '.claude', 'jk-corp')
const hqPath = join(hqDir, 'hq.json')

function systemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('hq.json storage', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterEach(() => vi.mocked(renameSync).mockReset())
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  it('starts from defaults when the file does not exist', () => {
    expect(listWebSessions()).toEqual([])
    addGroup('개발')
    expect(JSON.parse(readFileSync(hqPath, 'utf8')).groups).toHaveLength(1)
  })

  it('refuses to read or write a broken file and leaves it as is', () => {
    mkdirSync(hqDir, { recursive: true })
    const broken = '{"webSessions": [{"sessionId": "a"'
    writeFileSync(hqPath, broken)
    expect(() => listTeams()).toThrow(/읽을 수 없어/)
    expect(() => removeWebSession('a')).toThrow(/읽을 수 없어/)
    expect(() => addGroup('개발')).toThrow(/읽을 수 없어/)
    expect(readFileSync(hqPath, 'utf8')).toBe(broken)
  })

  it('leaves no temp file after writing', () => {
    addGroup('개발')
    removeWebSession('a')
    expect(readdirSync(hqDir)).toEqual(['hq.json'])
  })

  it('retries rename while Windows reports the target busy', () => {
    addGroup('개발')
    vi.mocked(renameSync)
      .mockImplementationOnce(() => {
        throw systemError('EPERM')
      })
      .mockImplementationOnce(() => {
        throw systemError('EBUSY')
      })
    addGroup('기획')
    expect(JSON.parse(readFileSync(hqPath, 'utf8')).groups).toHaveLength(2)
    expect(readdirSync(hqDir)).toEqual(['hq.json'])
  })

  it('keeps the old file and removes the temp file when rename keeps failing', () => {
    addGroup('개발')
    const before = readFileSync(hqPath, 'utf8')
    vi.mocked(renameSync).mockImplementation(() => {
      throw systemError('EBUSY')
    })
    expect(() => addGroup('기획')).toThrow('EBUSY')
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
    expect(readdirSync(hqDir)).toEqual(['hq.json'])
  })
})
