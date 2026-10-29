import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addGroup,
  addTeam,
  addTodo,
  addWebSession,
  discardWebSession,
  MAX_TODO_LENGTH,
  migrateGroupTodosToTeams,
  migrateWaitingNotes,
  parseTodoText,
  removeTodo,
  clearDoneTodos,
  reorderTodos,
  splitWaitingNote,
  TodoNotFoundError,
  updateTodo,
  type Todo,
  listCharacters,
  listGenders,
  listOffDuty,
  listPositions,
  listSessionNames,
  migratePositionNames,
  parsePosition,
  splitPositionName,
  listTeams,
  listWebSessions,
  moveToOffDuty,
  OFF_DUTY_RETENTION_MS,
  OrderMismatchError,
  RELEASED_RETENTION_MS,
  pruneOffDuty,
  readOffice,
  removeOffDuty,
  removeWebSession,
  reorderGroups,
  reorderTeams,
  returnFromOffDuty,
  setCharacter,
  setGender,
  setPosition,
  setSessionName,
  setWebSessionArgs,
  updateGroup,
} from './hq.js'

// hq.ts 는 homedir() 아래 설정 폴더(dataDir)를 쓴다. 실제 ~/.claude/pray/hq.json 대신 임시 폴더를 쓴다
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

const hqDir = join(homedir(), '.claude', 'pray')
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

  it('keeps team anchors when only the name or size changes', () => {
    const group = addGroup('가', { x: 10, y: 10 })
    addTeam({ name: 't1', cwd: 'C:/a', groupId: group.id, x: 12, y: 12 })
    updateGroup(group.id, { name: '나', w: 20, h: 20 })
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

  it('replaces the spawn args of a web session record and keeps the rest', () => {
    addWebSession(record)
    addWebSession({ ...record, sessionId: 'b' })
    expect(setWebSessionArgs('a', ['--name', '팀장', '--model', 'opus'])).toBe(true)
    expect(listWebSessions()).toEqual([{ ...record, extraArgs: ['--name', '팀장', '--model', 'opus'] }, { ...record, sessionId: 'b' }])
  })

  it('does nothing for sessions without a record', () => {
    addGroup('개발')
    const before = readFileSync(hqPath, 'utf8')
    expect(setWebSessionArgs('nope', ['--model', 'opus'])).toBe(false)
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
    setPosition('a', 'BE')
    setPosition('other', 'QA')
    moveToOffDuty('a', end)
    expect(removeOffDuty('a')).toBe(true)
    expect(listOffDuty()).toEqual([])
    expect(listSessionNames()).toEqual({ other: '남의 이름' })
    expect(listCharacters()).toEqual({ other: { id: 'lead', hair: null, top: null } })
    expect(listGenders()).toEqual({ other: 'male' })
    expect(listPositions()).toEqual({ other: 'QA' })
  })

  it('sets and clears a position', () => {
    setPosition('a', 'FE')
    expect(listPositions()).toEqual({ a: 'FE' })
    setPosition('a', null)
    expect(listPositions()).toEqual({})
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
    setPosition('a', 'FE')
    expect(discardWebSession('a')).toBe(true)
    expect(listWebSessions()).toEqual([])
    expect(listOffDuty()).toEqual([])
    expect(listSessionNames()).toEqual({})
    expect(listCharacters()).toEqual({})
    expect(listGenders()).toEqual({})
    expect(listPositions()).toEqual({})
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
      setPosition(sessionId, 'FE')
      moveToOffDuty(sessionId, { ...end, endedAt })
    }
    expect(pruneOffDuty(now)).toEqual(['old'])
    expect(listOffDuty().map((r) => r.sessionId)).toEqual(['edge', 'new'])
    expect(listSessionNames()).toEqual({ edge: 'edge', new: 'new' })
    expect(Object.keys(listCharacters())).toEqual(['edge', 'new'])
    expect(Object.keys(listGenders())).toEqual(['edge', 'new'])
    expect(Object.keys(listPositions())).toEqual(['edge', 'new'])
    const before = readFileSync(hqPath, 'utf8')
    expect(pruneOffDuty(now)).toEqual([])
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('keeps a member released by the lead for 6 hours and the other reasons for 7 days', () => {
    expect(RELEASED_RETENTION_MS).toBe(6 * 60 * 60 * 1000)
    expect(OFF_DUTY_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000)
    const now = Date.parse('2026-10-22T00:00:00.000Z')
    const ago = (ms: number) => new Date(now - ms).toISOString()
    const sevenHours = RELEASED_RETENTION_MS + 60 * 60 * 1000
    const cases = [
      ['released-old', 'released', ago(RELEASED_RETENTION_MS + 1)],
      ['released-edge', 'released', ago(RELEASED_RETENTION_MS)],
      ['dismissed-7h', 'dismissed', ago(sevenHours)],
      ['exit-7h', 'exit', ago(sevenHours)],
      ['error-7h', 'error', ago(sevenHours)],
      ['dismissed-old', 'dismissed', ago(OFF_DUTY_RETENTION_MS + 1)],
      ['exit-old', 'exit', ago(OFF_DUTY_RETENTION_MS + 1)],
      ['error-edge', 'error', ago(OFF_DUTY_RETENTION_MS)],
    ] as const
    for (const [sessionId, reason, endedAt] of cases) {
      addWebSession({ ...record, sessionId })
      setSessionName(sessionId, sessionId)
      setCharacter(sessionId, { id: 'lead', hair: null, top: null })
      setGender(sessionId, 'male')
      setPosition(sessionId, 'QA')
      moveToOffDuty(sessionId, { endedAt, reason, exitCode: 1 })
    }
    const kept = ['released-edge', 'dismissed-7h', 'exit-7h', 'error-7h', 'error-edge']
    expect(pruneOffDuty(now)).toEqual(['released-old', 'dismissed-old', 'exit-old'])
    expect(listOffDuty().map((r) => r.sessionId)).toEqual(kept)
    expect(Object.keys(listSessionNames())).toEqual(kept)
    expect(Object.keys(listCharacters())).toEqual(kept)
    expect(Object.keys(listGenders())).toEqual(kept)
    expect(Object.keys(listPositions())).toEqual(kept)
  })

  it('keeps an off duty record with an unknown reason for the default period', () => {
    const now = Date.parse('2026-10-22T00:00:00.000Z')
    mkdirSync(hqDir, { recursive: true })
    const later = { ...record, endedAt: new Date(now - RELEASED_RETENTION_MS - 1).toISOString(), reason: 'later', exitCode: null }
    writeFileSync(hqPath, JSON.stringify({ offDuty: [later] }))
    expect(pruneOffDuty(now)).toEqual([])
    expect(pruneOffDuty(now + OFF_DUTY_RETENTION_MS)).toEqual(['a'])
  })

  it('keeps off duty records when other code writes the file', () => {
    addWebSession(record)
    moveToOffDuty('a', end)
    addGroup('개발')
    expect(listOffDuty()).toHaveLength(1)
  })
})

const REAL_WAITING_NOTE =
  '- 대화 모드 마지막 명령 표현 통일, - Flow 버튼 아이콘, - Github 개인 계정에 올리기, - 메모 기능 강화, - 최신순 정렬 없애기'

describe('group todo text', () => {
  it('turns each line break into one space, trims and takes 1 to 500 characters', () => {
    expect(parseTodoText('  할 일\r\n하나\n둘\r셋  ')).toBe('할 일 하나 둘 셋')
    expect(parseTodoText('가\n\n나')).toBe('가  나')
    expect(parseTodoText(` ${'x'.repeat(MAX_TODO_LENGTH)}\n`)).toHaveLength(MAX_TODO_LENGTH)
    for (const value of ['', ' \r\n ', 'x'.repeat(MAX_TODO_LENGTH + 1), 3, null, undefined, ['가'], { text: '가' }]) {
      expect(parseTodoText(value)).toBeNull()
    }
  })

  it('splits the real waiting note into its five items', () => {
    expect(splitWaitingNote(REAL_WAITING_NOTE)).toEqual([
      '대화 모드 마지막 명령 표현 통일',
      'Flow 버튼 아이콘',
      'Github 개인 계정에 올리기',
      '메모 기능 강화',
      '최신순 정렬 없애기',
    ])
  })

  it('splits dash items on lines and after commas but not on a dash inside an item', () => {
    expect(splitWaitingNote('- 가 - 급함\r\n- 나,\n  - 다 ,')).toEqual(['가 - 급함', '나', '다'])
    expect(splitWaitingNote('- 가, - ')).toEqual(['가'])
    expect(splitWaitingNote('- 가,나')).toEqual(['가,나'])
  })

  it('keeps a note without the dash form as one item and drops an empty note', () => {
    expect(splitWaitingNote('  회의 준비\n자료 정리 ')).toEqual(['회의 준비 자료 정리'])
    expect(splitWaitingNote('-붙은 글, - 나')).toEqual(['-붙은 글, - 나'])
    expect(splitWaitingNote(' \n ')).toEqual([])
  })
})

describe('team todos', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  const at = (iso: string) => new Date(iso)
  /** 새 팀 하나 */
  const newTeam = () => addTeam({ name: '팀', cwd: 'D:/repo', groupId: addGroup('가').id })
  /** 완료 항목은 끝에 ✓ */
  const texts = (teamId: string) =>
    readOffice()
      .teams.find((t) => t.id === teamId)
      ?.todos.map((t) => `${t.text}${t.isDone ? '✓' : ''}`)

  it('starts a new team and an old team record without todos with an empty list, and groups carry none', () => {
    expect(newTeam().todos).toEqual([])
    mkdirSync(hqDir, { recursive: true })
    writeFileSync(
      hqPath,
      JSON.stringify({ groups: [{ id: 'g', name: '가', x: 0, y: 0, w: 10, h: 8 }], teams: [{ id: 't', name: '팀', cwd: 'D:/x' }] }),
    )
    const office = readOffice()
    expect(office.teams[0].todos).toEqual([])
    expect(office.groups[0]).not.toHaveProperty('todos')
  })

  it('adds to the end of the open section, before the done ones', () => {
    const team = newTeam()
    const first = addTodo(team.id, '가', at('2026-10-25T01:00:00.000Z'))
    expect(first).toEqual({ id: first?.id, text: '가', isDone: false, createdAt: '2026-10-25T01:00:00.000Z', doneAt: null })
    expect(first?.id).toMatch(/^[0-9a-f]{8}$/)
    addTodo(team.id, '나')
    updateTodo(team.id, first!.id, { isDone: true })
    addTodo(team.id, '다')
    expect(texts(team.id)).toEqual(['나', '다', '가✓'])
  })

  it('moves a todo to the very end when done and to the end of the open section when undone', () => {
    const team = newTeam()
    const [a, b, , d] = ['가', '나', '다', '라'].map((text) => addTodo(team.id, text)!)
    expect(updateTodo(team.id, b.id, { isDone: true }, at('2026-10-25T02:00:00.000Z'))).toMatchObject({
      isDone: true,
      doneAt: '2026-10-25T02:00:00.000Z',
    })
    updateTodo(team.id, d.id, { isDone: true })
    updateTodo(team.id, a.id, { isDone: true })
    expect(texts(team.id)).toEqual(['다', '나✓', '라✓', '가✓'])
    expect(updateTodo(team.id, d.id, { isDone: false })).toMatchObject({ isDone: false, doneAt: null })
    expect(texts(team.id)).toEqual(['다', '라', '나✓', '가✓'])
  })

  it('keeps the place and done time when the done value stays and changes only the text', () => {
    const team = newTeam()
    const [a, b, c] = ['가', '나', '다'].map((text) => addTodo(team.id, text)!)
    updateTodo(team.id, a.id, { isDone: true }, at('2026-10-25T02:00:00.000Z'))
    updateTodo(team.id, c.id, { isDone: true })
    updateTodo(team.id, a.id, { isDone: true, text: '가2' }, at('2026-10-25T03:00:00.000Z'))
    updateTodo(team.id, b.id, { isDone: false })
    expect(texts(team.id)).toEqual(['나', '가2✓', '다✓'])
    expect(readOffice().teams[0].todos[1].doneAt).toBe('2026-10-25T02:00:00.000Z')
    expect(updateTodo(team.id, b.id, { text: '나2' })).toMatchObject({ text: '나2', isDone: false })
    expect(texts(team.id)).toEqual(['나2', '가2✓', '다✓'])
  })

  it('removes a todo', () => {
    const team = newTeam()
    const [a, b] = ['가', '나'].map((text) => addTodo(team.id, text)!)
    updateTodo(team.id, a.id, { isDone: true })
    expect(removeTodo(team.id, a.id)?.map((t) => t.text)).toEqual(['나'])
    expect(removeTodo(team.id, b.id)).toEqual([])
    expect(texts(team.id)).toEqual([])
  })

  it('clears every done todo, keeps the open order, and does not write when none is done', () => {
    const team = newTeam()
    const [a, b, c, d] = ['가', '나', '다', '라'].map((text) => addTodo(team.id, text)!)
    const before = readFileSync(hqPath, 'utf8')
    expect(clearDoneTodos(team.id)).toBe(0)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
    updateTodo(team.id, b.id, { isDone: true })
    updateTodo(team.id, a.id, { isDone: true })
    reorderTodos(team.id, [d.id, c.id])
    expect(clearDoneTodos(team.id)).toBe(2)
    expect(texts(team.id)).toEqual(['라', '다'])
    expect(clearDoneTodos('nope')).toBeNull()
  })

  it('reorders only the open section and refuses anything but exactly the open IDs', () => {
    const team = newTeam()
    const [a, b, c, d] = ['가', '나', '다', '라'].map((text) => addTodo(team.id, text)!)
    updateTodo(team.id, b.id, { isDone: true })
    expect(reorderTodos(team.id, [d.id, a.id, c.id])?.map((t) => t.text)).toEqual(['라', '가', '다', '나'])
    expect(texts(team.id)).toEqual(['라', '가', '다', '나✓'])
    const before = readFileSync(hqPath, 'utf8')
    for (const ids of [[d.id, a.id], [d.id, a.id, c.id, b.id], [d.id, a.id, a.id], [d.id, a.id, 'zzz']]) {
      expect(() => reorderTodos(team.id, ids)).toThrow(OrderMismatchError)
    }
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('returns null for a missing team and throws for a missing todo without writing', () => {
    const team = newTeam()
    const todo = addTodo(team.id, '가')!
    const before = readFileSync(hqPath, 'utf8')
    expect(addTodo('nope', '나')).toBeNull()
    expect(updateTodo('nope', todo.id, { isDone: true })).toBeNull()
    expect(removeTodo('nope', todo.id)).toBeNull()
    expect(reorderTodos('nope', [todo.id])).toBeNull()
    expect(() => updateTodo(team.id, 'nope', { isDone: true })).toThrow(TodoNotFoundError)
    expect(() => removeTodo(team.id, 'nope')).toThrow(TodoNotFoundError)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('ignores a waiting note sent to updateGroup', () => {
    const group = addGroup('가')
    updateGroup(group.id, { name: '나', waitingNote: '메모' } as Parameters<typeof updateGroup>[1])
    const [saved] = JSON.parse(readFileSync(hqPath, 'utf8')).groups
    expect(saved).toMatchObject({ name: '나' })
    expect(saved).not.toHaveProperty('waitingNote')
    expect(saved).not.toHaveProperty('todos')
  })
})

describe('waiting note migration', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  const box = { x: 0, y: 0, w: 10, h: 8 }
  const openTodo: Todo = { id: 'o1', text: '있던 할 일', isDone: false, createdAt: '2026-10-01T00:00:00.000Z', doneAt: null }
  const doneTodo: Todo = {
    id: 'd1',
    text: '끝난 일',
    isDone: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    doneAt: '2026-10-02T00:00:00.000Z',
  }
  const writeGroups = (groups: unknown[]) => {
    mkdirSync(hqDir, { recursive: true })
    writeFileSync(hqPath, JSON.stringify({ groups, decor: { kept: true } }))
  }
  const savedGroups = () => JSON.parse(readFileSync(hqPath, 'utf8')).groups as (Record<string, unknown> & { todos: Todo[] })[]

  it('moves the real note into five open todos once and removes the key', () => {
    writeGroups([
      { id: 'e7c1b314', name: 'ADE', ...box, waitingNote: REAL_WAITING_NOTE },
      { id: 'b', name: 'B', ...box },
    ])
    expect(migrateWaitingNotes(new Date('2026-10-25T04:00:00.000Z'))).toBe(1)
    const [ade, other] = savedGroups()
    expect(ade).not.toHaveProperty('waitingNote')
    expect(ade.todos.map((t) => t.text)).toEqual(splitWaitingNote(REAL_WAITING_NOTE))
    expect(ade.todos).toHaveLength(5)
    for (const todo of ade.todos) {
      expect(todo).toEqual({ id: todo.id, text: todo.text, isDone: false, createdAt: '2026-10-25T04:00:00.000Z', doneAt: null })
    }
    expect(new Set(ade.todos.map((t) => t.id)).size).toBe(5)
    expect(other).not.toHaveProperty('todos')
    expect(JSON.parse(readFileSync(hqPath, 'utf8')).decor).toEqual({ kept: true })
    const before = readFileSync(hqPath, 'utf8')
    expect(migrateWaitingNotes()).toBe(0)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('appends before the done todos, keeps a plain note whole and drops an empty note', () => {
    writeGroups([
      { id: 'a', name: 'A', ...box, todos: [openTodo, doneTodo], waitingNote: '- 새 일, - 또' },
      { id: 'b', name: 'B', ...box, waitingNote: '그냥 메모\n둘째 줄' },
      { id: 'c', name: 'C', ...box, waitingNote: '  ' },
    ])
    expect(migrateWaitingNotes()).toBe(3)
    const [a, b, c] = savedGroups()
    expect(a.todos.map((t) => t.text)).toEqual(['있던 할 일', '새 일', '또', '끝난 일'])
    expect(a.todos[0]).toEqual(openTodo)
    expect(a.todos[3]).toEqual(doneTodo)
    expect(b.todos.map((t) => t.text)).toEqual(['그냥 메모 둘째 줄'])
    expect(c.todos).toEqual([])
    for (const group of [a, b, c]) expect(group).not.toHaveProperty('waitingNote')
  })

  it('writes nothing when there is no file or nothing to move', () => {
    expect(migrateWaitingNotes()).toBe(0)
    expect(existsSync(hqPath)).toBe(false)
    writeGroups([{ id: 'a', name: 'A', ...box }])
    const before = readFileSync(hqPath, 'utf8')
    expect(migrateWaitingNotes()).toBe(0)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('refuses a broken file and leaves it as is', () => {
    mkdirSync(hqDir, { recursive: true })
    const broken = '{"groups": [{"id": "a", "waitingNote": "- 가"'
    writeFileSync(hqPath, broken)
    expect(() => migrateWaitingNotes()).toThrow(/읽을 수 없어/)
    expect(readFileSync(hqPath, 'utf8')).toBe(broken)
  })

  it('leaves todos and a not yet moved note alone when host code writes the file', () => {
    writeGroups([{ id: 'a', name: 'A', ...box, todos: [openTodo, doneTodo], waitingNote: '- 가' }])
    const record = { sessionId: 's', cwd: 'D:/repo', createdAt: '2026-10-01T00:00:00.000Z' }
    addWebSession(record)
    moveToOffDuty('s', { endedAt: '2026-10-01T00:00:00.000Z', reason: 'exit', exitCode: 0 })
    pruneOffDuty(Date.parse('2026-10-25T00:00:00.000Z'))
    setSessionName('s', '이름')
    expect(savedGroups()[0]).toMatchObject({ waitingNote: '- 가', todos: [openTodo, doneTodo] })
  })
})

describe('group todo migration to teams', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  const box = { x: 0, y: 0, w: 10, h: 8 }
  const todo = (id: string, text: string, isDone = false): Todo => ({
    id,
    text,
    isDone,
    createdAt: '2026-10-01T00:00:00.000Z',
    doneAt: isDone ? '2026-10-02T00:00:00.000Z' : null,
  })
  const team = (id: string, name: string, groupId: string, todos: Todo[] = []) => ({ id, name, cwd: `D:/${id}`, groupId, todos })
  const write = (groups: unknown[], teams: unknown[]) => {
    mkdirSync(hqDir, { recursive: true })
    writeFileSync(hqPath, JSON.stringify({ groups, teams, decor: { kept: true } }))
  }
  const saved = () => JSON.parse(readFileSync(hqPath, 'utf8'))
  const teamTexts = (teamId: string) =>
    (saved().teams as { id: string; todos: Todo[] }[]).find((t) => t.id === teamId)?.todos.map((t) => `${t.text}${t.isDone ? '✓' : ''}`)

  it('moves every todo of a group with one team as is, in order, keeping ids and times', () => {
    const items = [todo('a', 'Shinanui - 접두어도 그대로'), todo('b', '둘째'), todo('c', '끝난 일', true)]
    write([{ id: 'g', name: 'ADE', ...box, todos: items }, { id: 'h', name: 'H', ...box }], [team('t', 'JK Corp.', 'g')])
    expect(migrateGroupTodosToTeams()).toEqual({ moves: [{ groupId: 'g', teamId: 't', count: 3 }], leftBehind: [] })
    expect(saved().teams[0].todos).toEqual(items)
    expect(saved().groups[0]).not.toHaveProperty('todos')
    expect(saved().decor).toEqual({ kept: true })
  })

  it('sends a "<name> - " item to the team whose name contains the name and strips the prefix, the rest to the first team', () => {
    write(
      [{ id: 'g', name: 'ENGSOFT', ...box, todos: [todo('a', 'Shinanui - tracking 정리'), todo('b', '그냥 일'), todo('c', 'nakwol - 낙월 일', true), todo('d', '모르는 - 일')] }],
      [team('t1', 'OCMS Shinanui', 'g'), team('t2', 'Nakwol', 'g'), team('t3', 'OCMS2', 'g')],
    )
    const result = migrateGroupTodosToTeams()
    expect(result.moves).toEqual([
      { groupId: 'g', teamId: 't1', count: 3 },
      { groupId: 'g', teamId: 't2', count: 1 },
    ])
    expect(teamTexts('t1')).toEqual(['tracking 정리', '그냥 일', '모르는 - 일'])
    expect(teamTexts('t2')).toEqual(['낙월 일✓'])
    expect(teamTexts('t3')).toEqual([])
  })

  it('picks the team with the closest (shortest) name when several contain it, and the earlier one on a tie', () => {
    write(
      [{ id: 'g', name: 'G', ...box, todos: [todo('a', 'ocms - 가'), todo('b', 'x - 나')] }],
      [team('t1', 'OCMS Shinanui', 'g'), team('t2', 'OCMS', 'g'), team('t3', 'ABX', 'g'), team('t4', 'XYZ', 'g')],
    )
    migrateGroupTodosToTeams()
    expect(teamTexts('t2')).toEqual(['가'])
    expect(teamTexts('t3')).toEqual(['나'])
    expect(teamTexts('t1')).toEqual([])
  })

  it('does not strip a prefix with nothing after it or an empty name', () => {
    write([{ id: 'g', name: 'G', ...box, todos: [todo('a', 'T1 - '), todo('b', ' - 글')] }], [team('t1', 'T1', 'g'), team('t2', 'T2', 'g')])
    migrateGroupTodosToTeams()
    expect(teamTexts('t1')).toEqual(['T1 - ', ' - 글'])
  })

  it('appends open todos before the done ones of the receiving team and done ones at the very end', () => {
    write(
      [{ id: 'g', name: 'G', ...box, todos: [todo('n1', '새 일'), todo('n2', '새 완료', true)] }],
      [team('t', 'T', 'g', [todo('o1', '있던 일'), todo('o2', '있던 완료', true)])],
    )
    migrateGroupTodosToTeams()
    expect(teamTexts('t')).toEqual(['있던 일', '새 일', '있던 완료✓', '새 완료✓'])
  })

  it('leaves a group without teams as is and reports it, and moves nothing twice', () => {
    const orphan = [todo('x', '고아 일')]
    write([{ id: 'g', name: 'G', ...box, todos: [todo('a', '가')] }, { id: 'o', name: 'O', ...box, todos: orphan }], [team('t', 'T', 'g')])
    expect(migrateGroupTodosToTeams()).toEqual({
      moves: [{ groupId: 'g', teamId: 't', count: 1 }],
      leftBehind: [{ groupId: 'o', count: 1 }],
    })
    expect(saved().groups[1].todos).toEqual(orphan)
    expect(readOffice().groups[1]).not.toHaveProperty('todos')
    const before = readFileSync(hqPath, 'utf8')
    expect(migrateGroupTodosToTeams()).toEqual({ moves: [], leftBehind: [{ groupId: 'o', count: 1 }] })
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
    expect(teamTexts('t')).toEqual(['가'])
  })

  it('writes nothing when there is no file or nothing to move, and refuses a broken file', () => {
    expect(migrateGroupTodosToTeams()).toEqual({ moves: [], leftBehind: [] })
    expect(existsSync(hqPath)).toBe(false)
    write([{ id: 'g', name: 'G', ...box, todos: [] }], [team('t', 'T', 'g')])
    const before = readFileSync(hqPath, 'utf8')
    expect(migrateGroupTodosToTeams().moves).toEqual([])
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
    const broken = '{"groups": [{"id": "g", "todos": [{'
    writeFileSync(hqPath, broken)
    expect(() => migrateGroupTodosToTeams()).toThrow(/읽을 수 없어/)
    expect(readFileSync(hqPath, 'utf8')).toBe(broken)
  })
})

describe('session position', () => {
  it('accepts a trimmed position of 1 to 12 characters without brackets or line breaks', () => {
    expect(parsePosition(' FE ')).toBe('FE')
    expect(parsePosition('UI/UX')).toBe('UI/UX')
    expect(parsePosition('a'.repeat(12))).toBe('a'.repeat(12))
    for (const value of ['', ' ', 'a'.repeat(13), '[FE]', 'F]E', 'FE\nBE', 3, null]) {
      expect(parsePosition(value), JSON.stringify(value)).toBeNull()
    }
  })

  it('splits an old "[role] name" into the position and the name', () => {
    expect(splitPositionName('[FE] Jisoo')).toEqual({ position: 'FE', name: 'Jisoo' })
    expect(splitPositionName(' [ UI/UX ]  Junho 2 ')).toEqual({ position: 'UI/UX', name: 'Junho 2' })
    expect(splitPositionName('[QA]Emma')).toEqual({ position: 'QA', name: 'Emma' })
    expect(splitPositionName('[Lead]')).toEqual({ position: 'Lead', name: null })
    expect(splitPositionName('[Asst]   ')).toEqual({ position: 'Asst', name: null })
  })

  it('leaves a name alone when it does not start with a role in brackets', () => {
    for (const name of ['Jisoo', '웹 개발자', 'Jisoo [FE]', '[] Jisoo', '[  ] Jisoo', `[${'a'.repeat(13)}] Jisoo`, '[FE Jisoo']) {
      expect(splitPositionName(name), name).toBeNull()
    }
  })
})

describe('position name migration', () => {
  beforeEach(() => rmSync(hqDir, { recursive: true, force: true }))
  afterAll(() => rmSync(homedir(), { recursive: true, force: true }))

  const writeHqFile = (content: Record<string, unknown>) => {
    mkdirSync(hqDir, { recursive: true })
    writeFileSync(hqPath, JSON.stringify({ ...content, decor: { kept: true } }))
  }

  it('moves the role out of old names once and keeps the rest of the file', () => {
    writeHqFile({
      sessionNames: { a: '[FE] Jisoo', b: '[Lead] Minho', c: '[Dev]', d: '서버 개발자', e: '[] 괄호만', f: '[Asst] Kim' },
      genders: { a: 'female', b: 'male' },
    })
    expect(migratePositionNames()).toBe(4)
    expect(listSessionNames()).toEqual({ a: 'Jisoo', b: 'Minho', d: '서버 개발자', e: '[] 괄호만', f: 'Kim' })
    expect(listPositions()).toEqual({ a: 'FE', b: 'Lead', c: 'Dev', f: 'Asst' })
    expect(listGenders()).toEqual({ a: 'female', b: 'male' })
    expect(JSON.parse(readFileSync(hqPath, 'utf8')).decor).toEqual({ kept: true })
    const before = readFileSync(hqPath, 'utf8')
    expect(migratePositionNames()).toBe(0)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('keeps a position that is already there and only cleans the name', () => {
    writeHqFile({ sessionNames: { a: '[FE] Jisoo' }, positions: { a: 'BE' } })
    expect(migratePositionNames()).toBe(1)
    expect(listSessionNames()).toEqual({ a: 'Jisoo' })
    expect(listPositions()).toEqual({ a: 'BE' })
  })

  it('writes nothing when there is no file or nothing to move', () => {
    expect(migratePositionNames()).toBe(0)
    expect(existsSync(hqPath)).toBe(false)
    writeHqFile({ sessionNames: { a: 'Jisoo' } })
    const before = readFileSync(hqPath, 'utf8')
    expect(migratePositionNames()).toBe(0)
    expect(readFileSync(hqPath, 'utf8')).toBe(before)
  })

  it('refuses a broken file and leaves it as is', () => {
    mkdirSync(hqDir, { recursive: true })
    const broken = '{"sessionNames": {"a": "[FE] Jisoo"'
    writeFileSync(hqPath, broken)
    expect(() => migratePositionNames()).toThrow(/읽을 수 없어/)
    expect(readFileSync(hqPath, 'utf8')).toBe(broken)
  })
})
