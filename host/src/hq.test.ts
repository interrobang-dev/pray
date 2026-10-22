import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addGroup,
  addTeam,
  addWebSession,
  discardWebSession,
  listCharacters,
  listGenders,
  listOffDuty,
  listSessionNames,
  listTeams,
  listWebSessions,
  moveToOffDuty,
  OFF_DUTY_RETENTION_MS,
  OrderMismatchError,
  pruneOffDuty,
  readOffice,
  setDecor,
  removeOffDuty,
  removeWebSession,
  reorderGroups,
  reorderTeams,
  returnFromOffDuty,
  setCharacter,
  setGender,
  setSessionName,
  updateGroup,
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

describe('office positions', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  const anchors = () => Object.fromEntries(readOffice().teams.map((t) => [t.name, { x: t.x, y: t.y }]))

  it('moves the teams of a moved group by the same amount and leaves other groups\' teams', () => {
    const g1 = addGroup('가', { x: 10, y: 10 })
    const g2 = addGroup('나', { x: 40, y: 0 })
    addTeam({ name: 't1', cwd: 'C:/a', groupId: g1.id, x: 12, y: 12 })
    addTeam({ name: 't2', cwd: 'C:/b', groupId: g1.id, x: 20, y: 15 })
    addTeam({ name: 'u1', cwd: 'C:/c', groupId: g2.id, x: 42, y: 2 })
    expect(updateGroup(g1.id, { x: 13, y: 6 })).toMatchObject({ x: 13, y: 6 })
    expect(anchors()).toEqual({ t1: { x: 15, y: 8 }, t2: { x: 23, y: 11 }, u1: { x: 42, y: 2 } })
  })

  it('keeps team anchors when only the name, note or size changes', () => {
    const group = addGroup('가', { x: 10, y: 10 })
    addTeam({ name: 't1', cwd: 'C:/a', groupId: group.id, x: 12, y: 12 })
    updateGroup(group.id, { name: '나', waitingNote: '메모', w: 20, h: 20 })
    updateGroup(group.id, { x: -1, y: 1.5 })
    expect(readOffice().groups[0]).toMatchObject({ name: '나', x: 10, y: 10 })
    expect(anchors()).toEqual({ t1: { x: 12, y: 12 } })
  })

  it('moves less when a team anchor would go below zero, keeping the teams\' layout', () => {
    const group = addGroup('가', { x: 5, y: 5 })
    addTeam({ name: 't1', cwd: 'C:/a', groupId: group.id, x: 2, y: 7 })
    addTeam({ name: 't2', cwd: 'C:/b', groupId: group.id, x: 9, y: 3 })
    expect(updateGroup(group.id, { x: 0, y: 0 })).toMatchObject({ x: 3, y: 2 })
    expect(anchors()).toEqual({ t1: { x: 0, y: 4 }, t2: { x: 7, y: 0 } })
  })

  it('places a new group and team at the given tile position, otherwise by the old rule', () => {
    const g1 = addGroup('가')
    expect(g1).toMatchObject({ x: 0, y: 0 })
    expect(addGroup('나', { x: 3, y: 20 })).toMatchObject({ x: 3, y: 20 })
    expect(addGroup('다', { x: -1, y: 2 })).toMatchObject({ x: 14, y: 0 })
    expect(addTeam({ name: 't1', cwd: 'C:/a', groupId: g1.id, x: 8, y: 4 })).toMatchObject({ x: 8, y: 4 })
    expect(addTeam({ name: 't2', cwd: 'C:/b', groupId: g1.id, x: '3', y: 4 })).toMatchObject({ x: 2, y: 9 })
  })
})

describe('office decor', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))

  it('저장된 꾸밈이 없으면 기본값, 바꾼 값만 덮어쓰고 다른 키는 그대로 둔다', () => {
    addGroup('g')
    expect(readOffice().decor).toEqual({ seed: 1, theme: 'office' })
    expect(setDecor({ theme: 'winter' })).toEqual({ seed: 1, theme: 'winter' })
    expect(setDecor({ seed: 42 })).toEqual({ seed: 42, theme: 'winter' })
    expect(readOffice()).toMatchObject({ decor: { seed: 42, theme: 'winter' } })
    expect(readOffice().groups.map((g) => g.name)).toEqual(['g'])
  })
})

describe('off duty records', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  const record = { sessionId: 'a', cwd: 'D:/repo', createdAt: '2026-10-01T00:00:00.000Z', extraArgs: ['--name', '팀장'] }
  const end = { endedAt: '2026-10-20T00:00:00.000Z', reason: 'error' as const, exitCode: 1 }

  it('moves a web session to off duty and back with its spawn args', () => {
    addWebSession(record)
    expect(moveToOffDuty('a', end)).toBe(true)
    expect(listWebSessions()).toEqual([])
    expect(listOffDuty()).toEqual([{ ...record, ...end }])
    expect(returnFromOffDuty('a')).toEqual(record)
    expect(listWebSessions()).toEqual([record])
    expect(listOffDuty()).toEqual([])
    expect(readdirSync(hqDir)).toEqual(['hq.json'])
  })

  it('does nothing for sessions without a record', () => {
    addGroup('개발')
    const before = readFileSync(hqPath, 'utf8')
    expect(moveToOffDuty('nope', end)).toBe(false)
    expect(returnFromOffDuty('nope')).toBeNull()
    expect(removeOffDuty('nope')).toBe(false)
    expect(discardWebSession('nope')).toBe(false)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('removes the session name together with the off duty record', () => {
    addWebSession(record)
    setSessionName('a', '서버 개발자')
    setSessionName('other', '남의 이름')
    setCharacter('a', { id: 'afro', hair: null, top: '#c4453c' })
    setCharacter('other', { id: 'lead', hair: null, top: null })
    setGender('a', 'female')
    setGender('other', 'male')
    moveToOffDuty('a', end)
    expect(removeOffDuty('a')).toBe(true)
    expect(listOffDuty()).toEqual([])
    expect(listSessionNames()).toEqual({ other: '남의 이름' })
    expect(listCharacters()).toEqual({ other: { id: 'lead', hair: null, top: null } })
    expect(listGenders()).toEqual({ other: 'male' })
  })

  it('sets and clears a gender', () => {
    setGender('a', 'female')
    expect(listGenders()).toEqual({ a: 'female' })
    setGender('a', null)
    expect(listGenders()).toEqual({})
  })

  it('sets and clears a chosen character', () => {
    setCharacter('a', { id: 'afro', hair: '#2b2622', top: null })
    expect(listCharacters()).toEqual({ a: { id: 'afro', hair: '#2b2622', top: null } })
    setCharacter('a', null)
    expect(listCharacters()).toEqual({})
  })

  it('discards a web session that cannot be resumed together with its name', () => {
    addWebSession(record)
    setSessionName('a', '서버 개발자')
    setCharacter('a', { id: 'afro', hair: null, top: null })
    setGender('a', 'male')
    expect(discardWebSession('a')).toBe(true)
    expect(listWebSessions()).toEqual([])
    expect(listOffDuty()).toEqual([])
    expect(listSessionNames()).toEqual({})
    expect(listCharacters()).toEqual({})
    expect(listGenders()).toEqual({})
  })

  it('prunes records older than the retention period with their names', () => {
    const now = Date.parse('2026-10-22T00:00:00.000Z')
    for (const [sessionId, endedAt] of [
      ['old', new Date(now - OFF_DUTY_RETENTION_MS - 1).toISOString()],
      ['edge', new Date(now - OFF_DUTY_RETENTION_MS).toISOString()],
      ['new', new Date(now - 1000).toISOString()],
    ]) {
      addWebSession({ ...record, sessionId })
      setSessionName(sessionId, sessionId)
      setCharacter(sessionId, { id: 'lead', hair: null, top: null })
      setGender(sessionId, 'female')
      moveToOffDuty(sessionId, { ...end, endedAt })
    }
    expect(pruneOffDuty(now)).toEqual(['old'])
    expect(listOffDuty().map((r) => r.sessionId)).toEqual(['edge', 'new'])
    expect(listSessionNames()).toEqual({ edge: 'edge', new: 'new' })
    expect(Object.keys(listCharacters())).toEqual(['edge', 'new'])
    expect(Object.keys(listGenders())).toEqual(['edge', 'new'])
    const before = readFileSync(hqPath, 'utf8')
    expect(pruneOffDuty(now)).toEqual([])
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('keeps off duty records when other code writes the file', () => {
    addWebSession(record)
    moveToOffDuty('a', end)
    addGroup('개발')
    expect(listOffDuty()).toHaveLength(1)
  })
})
