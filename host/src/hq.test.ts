import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addGroup,
  addTeam,
  listTeams,
  listWebSessions,
  OrderMismatchError,
  readOffice,
  removeWebSession,
  reorderGroups,
  reorderTeams,
} from './hq.js'

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

describe('list order', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  it('reorders groups and keeps the file free of temp files', () => {
    const [a, b, c] = ['가', '나', '다'].map((name) => addGroup(name))
    expect(reorderGroups([c.id, a.id, b.id]).map((g) => g.name)).toEqual(['다', '가', '나'])
    expect(JSON.parse(readFileSync(hqPath, 'utf8')).groups.map((g: { name: string }) => g.name)).toEqual(['다', '가', '나'])
    expect(readdirSync(hqDir)).toEqual(['hq.json'])
  })

  it('refuses a group list that is not exactly the current set', () => {
    const [a, b] = ['가', '나'].map((name) => addGroup(name))
    const before = readFileSync(hqPath, 'utf8')
    for (const ids of [[a.id], [a.id, b.id, 'zzz'], [a.id, 'zzz'], [a.id, a.id]]) {
      expect(() => reorderGroups(ids)).toThrow(OrderMismatchError)
    }
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('reorders teams of one group without moving other groups\' teams in the array', () => {
    const [g1, g2] = ['가', '나'].map((name) => addGroup(name))
    const t1 = addTeam({ name: 't1', cwd: 'C:/a', groupId: g1.id })
    const u1 = addTeam({ name: 'u1', cwd: 'C:/b', groupId: g2.id })
    const t2 = addTeam({ name: 't2', cwd: 'C:/c', groupId: g1.id })
    const u2 = addTeam({ name: 'u2', cwd: 'C:/d', groupId: g2.id })
    const t3 = addTeam({ name: 't3', cwd: 'C:/e', groupId: g1.id })
    expect(reorderTeams(g1.id, [t3.id, t1.id, t2.id])?.map((t) => t.name)).toEqual(['t3', 't1', 't2'])
    expect(readOffice().teams.map((t) => t.name)).toEqual(['t3', 'u1', 't1', 'u2', 't2'])
    reorderTeams(g2.id, [u2.id, u1.id])
    expect(readOffice().teams.map((t) => t.name)).toEqual(['t3', 'u2', 't1', 'u1', 't2'])
  })

  it('refuses teams of another group and returns null for a missing group', () => {
    const [g1, g2] = ['가', '나'].map((name) => addGroup(name))
    const t1 = addTeam({ name: 't1', cwd: 'C:/a', groupId: g1.id })
    const u1 = addTeam({ name: 'u1', cwd: 'C:/b', groupId: g2.id })
    const before = readFileSync(hqPath, 'utf8')
    expect(() => reorderTeams(g1.id, [t1.id, u1.id])).toThrow(OrderMismatchError)
    expect(() => reorderTeams(g1.id, [u1.id])).toThrow(OrderMismatchError)
    expect(reorderTeams('nope', [t1.id])).toBeNull()
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })
})
