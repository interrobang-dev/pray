import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { normalizeCwd, type Part, type Team } from './team.js'

export type { Part, Team } from './team.js'

export interface WebSessionRecord {
  sessionId: string
  cwd: string
  createdAt: string
  /** spawn 때 claude 에 넘긴 추가 인자. resume 때 다시 넘긴다 (--name, --permission-mode, --append-system-prompt 등) */
  extraArgs?: string[]
}

/** released = 팀장이 정리한 팀원(jk_dismiss), dismissed = 그 밖의 kill 요청(화면 종료 버튼), exit = 종료 코드 0, error = 그 밖의 종료 코드 */
export type OffDutyReason = 'exit' | 'dismissed' | 'error' | 'released'

/** 끝난 웹 세션 (퇴근). 다시 출근(resume)하면 webSessions 로 되돌아간다. 호스트만 쓴다 */
export interface OffDutyRecord extends WebSessionRecord {
  endedAt: string
  reason: OffDutyReason
  /** kill 할 프로세스가 없었으면 null */
  exitCode: number | null
}

/** 퇴근 기록 보관 기간. 지나면 기록과 세션 이름을 지운다. 팀장이 정리한 팀원(released)은 많이 쌓여서 짧다 */
export const OFF_DUTY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const RELEASED_RETENTION_MS = 6 * 60 * 60 * 1000

/** 모르는 이유(다른 판의 기록)는 기본 기간 */
export function retentionOf(reason: OffDutyReason): number {
  return reason === 'released' ? RELEASED_RETENTION_MS : OFF_DUTY_RETENTION_MS
}

/** 그룹 할 일 한 줄. 시각은 ISO */
export interface GroupTodo {
  id: string
  text: string
  isDone: boolean
  createdAt: string
  /** 완료한 시각. 할 일이면 null */
  doneAt: string | null
}

/** 그룹 = 그래픽 공간. 좌표·크기는 타일 단위. 화면은 w·h 를 쓰지 않는다 (그룹 크기는 안의 팀 섬으로 정한다) */
export interface Group {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  /** 배열 순서 = 표시 순서. 늘 [할 일(사용자가 정한 순서)…, 완료(완료한 순서, 오래된 것 먼저)…] 로 나뉘어 있다 */
  todos: GroupTodo[]
}

export interface Office {
  groups: Group[]
  teams: Team[]
}

/** 사용자가 고른 도트 사무실 인물 (프리셋 id). 머리·윗옷 색은 '#rrggbb', null 이면 그 인물 기본색 */
export interface SessionCharacter {
  id: string
  hair: string | null
  top: string | null
}

/** 서버가 지은 이름 "[역할] 이름" 의 성별. 도트 사무실이 그 성별 인물을 고른다 */
export type SessionGender = 'male' | 'female'

interface HqFile extends Office {
  webSessions: WebSessionRecord[]
  offDuty: OffDutyRecord[]
  /** 사용자가 직접 붙인 세션 이름. 없으면 화면은 jsonl 의 ai-title 을 쓴다. 외부 세션에도 붙일 수 있어 webSessions 와 별도 */
  sessionNames: Record<string, string>
  /** 사용자가 고른 도트 인물. 없으면 화면이 세션 ID 해시로 고른다. 이름과 같이 지운다 */
  characters: Record<string, SessionCharacter>
  /** 서버가 이름을 지은 세션의 성별. 사용자가 직접 지은 이름이면 없다. 이름과 같이 지운다 */
  genders: Record<string, SessionGender>
}

const hqDir = join(homedir(), '.claude', 'jk-corp')
const hqPath = join(hqDir, 'hq.json')

function readHq(): HqFile {
  let parsed: Partial<HqFile> = {}
  try {
    parsed = JSON.parse(readFileSync(hqPath, 'utf8'))
  } catch (error) {
    // 파일 없음 → 기본값. 있는데 못 읽거나 깨졌으면 던져서 저장을 막는다. 기본값으로 넘어가면 다음 쓰기가 기록을 통째로 지운다
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unreadable(error)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw unreadable('최상위가 객체가 아님')
  // 구 파일 이전: "방(rooms)" 이 "그룹(groups)" 으로 바뀌었고 seats 는 없어졌다. 읽을 때 옮기고 다음 쓰기 때 새 키로만 저장한다
  const { rooms: legacyGroups, seats: _legacySeats, ...rest } = parsed as Partial<HqFile> & { rooms?: Group[]; seats?: unknown }
  const teams = (rest.teams ?? []).map(withDefaults)
  // 예전 기본 그룹 "로비"(id lobby) 는 없어졌다. 로비 = 팀 없는 세션이 모이는 고정 구역. 팀이 안 들어 있으면 읽을 때 지운다
  // 할 일이 생기기 전 기록은 todos 가 없다. 예전 대기 메모(waitingNote)는 여기서 바꾸지 않는다 (migrateWaitingNotes 가 한 번 옮긴다)
  const groups = (rest.groups?.length ? rest.groups : (legacyGroups ?? []))
    .filter((g) => g.id !== 'lobby' || teams.some((t) => t.groupId === 'lobby'))
    .map((g) => ({ ...g, todos: g.todos ?? [] }))
  // 모르는 키도 보존한다. 호스트·서버가 같은 파일을 쓰므로 한쪽이 구버전이어도 다른 쪽 데이터를 지우지 않게
  return {
    ...rest,
    groups,
    webSessions: rest.webSessions ?? [],
    offDuty: rest.offDuty ?? [],
    teams,
    sessionNames: rest.sessionNames ?? {},
    characters: rest.characters ?? {},
    genders: rest.genders ?? {},
  }
}

/** 구버전 기록(desks·parts·partOf 없음, roomId 등)을 읽어도 터지지 않게 */
function withDefaults(team: Partial<Team> & Pick<Team, 'id' | 'name' | 'cwd'> & { roomId?: string }): Team {
  const { roomId, ...rest } = team
  return { groupId: roomId ?? 'lobby', x: 1, y: 1, desks: {}, parts: [], partOf: {}, createdAt: '', ...rest }
}

function unreadable(cause: unknown): Error {
  return new Error(`hq.json 을 읽을 수 없어 읽기·저장을 막음 (${hqPath}): ${cause}`, { cause })
}

/** Windows 는 대상 파일을 다른 프로세스(백신·인덱서 등)가 잡고 있으면 rename 이 실패한다. 잠깐 기다렸다 다시 한다 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

/** 같은 폴더의 임시 파일에 다 쓴 뒤 바꿔 끼운다. 바로 덮어쓰면 쓰는 도중 강제 종료되거나 다른 프로세스가 그 사이에 읽을 때 빈 파일이 된다 */
function writeHq(hq: HqFile): void {
  mkdirSync(hqDir, { recursive: true })
  const tempPath = `${hqPath}.${process.pid}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(hq, null, 2) + '\n')
    renameWithRetry(tempPath, hqPath)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error
      // 호출부가 전부 동기라 동기로 기다린다
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS)
    }
  }
}

export function listWebSessions(): WebSessionRecord[] {
  return readHq().webSessions
}

export function addWebSession(record: WebSessionRecord): void {
  const hq = readHq()
  hq.webSessions = [...hq.webSessions.filter((s) => s.sessionId !== record.sessionId), record]
  writeHq(hq)
}

/** webSessions 기록의 extraArgs 를 바꾼다 (모델·effort 바꾸기). 기록이 없으면 아무것도 쓰지 않고 false */
export function setWebSessionArgs(sessionId: string, extraArgs: string[]): boolean {
  const hq = readHq()
  const record = hq.webSessions.find((s) => s.sessionId === sessionId)
  if (!record) return false
  record.extraArgs = extraArgs
  writeHq(hq)
  return true
}

export function removeWebSession(sessionId: string): void {
  const hq = readHq()
  hq.webSessions = hq.webSessions.filter((s) => s.sessionId !== sessionId)
  writeHq(hq)
}

/** 다시 출근할 수 없는 웹 세션(대화가 없음)의 기록과 이름·고른 인물·성별을 지운다. webSessions 에 없으면 아무것도 쓰지 않고 false */
export function discardWebSession(sessionId: string): boolean {
  const hq = readHq()
  if (!hq.webSessions.some((s) => s.sessionId === sessionId)) return false
  hq.webSessions = hq.webSessions.filter((s) => s.sessionId !== sessionId)
  delete hq.sessionNames[sessionId]
  delete hq.characters[sessionId]
  delete hq.genders[sessionId]
  writeHq(hq)
  return true
}

// ---------- 퇴근 기록 ----------

export function listOffDuty(): OffDutyRecord[] {
  return readHq().offDuty
}

/** webSessions 기록을 퇴근 기록으로 옮긴다. webSessions 에 없으면 아무것도 쓰지 않고 false */
export function moveToOffDuty(sessionId: string, end: Pick<OffDutyRecord, 'endedAt' | 'reason' | 'exitCode'>): boolean {
  const hq = readHq()
  const record = hq.webSessions.find((s) => s.sessionId === sessionId)
  if (!record) return false
  hq.webSessions = hq.webSessions.filter((s) => s.sessionId !== sessionId)
  hq.offDuty = [...hq.offDuty.filter((s) => s.sessionId !== sessionId), { ...record, ...end }]
  writeHq(hq)
  return true
}

/** 퇴근 기록을 webSessions 로 되돌린다 (다시 출근). 없으면 null */
export function returnFromOffDuty(sessionId: string): WebSessionRecord | null {
  const hq = readHq()
  const record = hq.offDuty.find((s) => s.sessionId === sessionId)
  if (!record) return null
  const { endedAt: _endedAt, reason: _reason, exitCode: _exitCode, ...webSession } = record
  hq.offDuty = hq.offDuty.filter((s) => s.sessionId !== sessionId)
  hq.webSessions = [...hq.webSessions.filter((s) => s.sessionId !== sessionId), webSession]
  writeHq(hq)
  return webSession
}

/** 퇴근 기록과 그 세션 이름·고른 인물·성별을 지운다. 없으면 false */
export function removeOffDuty(sessionId: string): boolean {
  const hq = readHq()
  if (!hq.offDuty.some((s) => s.sessionId === sessionId)) return false
  hq.offDuty = hq.offDuty.filter((s) => s.sessionId !== sessionId)
  delete hq.sessionNames[sessionId]
  delete hq.characters[sessionId]
  delete hq.genders[sessionId]
  writeHq(hq)
  return true
}

/** 이유별 보관 기간이 지난 퇴근 기록과 그 이름·고른 인물·성별을 지운다. 지운 세션 ID 들 (없으면 쓰지 않는다) */
export function pruneOffDuty(now = Date.now()): string[] {
  const hq = readHq()
  const expired = hq.offDuty.filter((s) => now - Date.parse(s.endedAt) > retentionOf(s.reason)).map((s) => s.sessionId)
  if (expired.length === 0) return []
  hq.offDuty = hq.offDuty.filter((s) => !expired.includes(s.sessionId))
  for (const sessionId of expired) {
    delete hq.sessionNames[sessionId]
    delete hq.characters[sessionId]
    delete hq.genders[sessionId]
  }
  writeHq(hq)
  return expired
}

export function listSessionNames(): Record<string, string> {
  return readHq().sessionNames
}

/** 빈 이름이나 null 이면 지운다 (자동 제목으로 복귀) */
export function setSessionName(sessionId: string, name: string | null): void {
  const hq = readHq()
  const trimmed = name?.trim()
  if (trimmed) hq.sessionNames[sessionId] = trimmed
  else delete hq.sessionNames[sessionId]
  writeHq(hq)
}

export function listCharacters(): Record<string, SessionCharacter> {
  return readHq().characters
}

/** null 이면 지운다 (세션 ID 해시로 고르는 자동으로 복귀) */
export function setCharacter(sessionId: string, character: SessionCharacter | null): void {
  const hq = readHq()
  if (character) hq.characters[sessionId] = character
  else delete hq.characters[sessionId]
  writeHq(hq)
}

export function listGenders(): Record<string, SessionGender> {
  return readHq().genders
}

/** null 이면 지운다 (도트 인물을 성별 없이 고른다) */
export function setGender(sessionId: string, gender: SessionGender | null): void {
  const hq = readHq()
  if (gender) hq.genders[sessionId] = gender
  else delete hq.genders[sessionId]
  writeHq(hq)
}

export function readOffice(): Office {
  const { groups, teams } = readHq()
  return { groups, teams }
}

export class OrderMismatchError extends Error {
  constructor() {
    super('순서 목록이 지금 있는 것과 다름 (빠졌거나 모르는 ID·중복). 목록을 다시 받아 시도해라')
  }
}

/** items 중 isTarget 인 것들이 차지한 자리에 ids 순서대로 다시 넣는다. 나머지는 자리 그대로. ids 가 대상과 정확히 같은 집합이 아니면 던진다 */
function reorderSlots<T extends { id: string }>(items: T[], ids: string[], isTarget: (item: T) => boolean): T[] {
  const byId = new Map(items.filter(isTarget).map((item) => [item.id, item]))
  if (ids.length !== byId.size || new Set(ids).size !== ids.length) throw new OrderMismatchError()
  const ordered = ids.map((id) => {
    const item = byId.get(id)
    if (!item) throw new OrderMismatchError()
    return item
  })
  let next = 0
  return items.map((item) => (isTarget(item) ? ordered[next++] : item))
}

// ---------- 그룹 ----------

/**
 * 화면이 빈 자리를 찾아 position 을 준다 (그룹·섬 크기는 화면 배치에서 정해져서). 없거나 타일 좌표가 아니면 기존 그룹들의 오른쪽 끝 옆에 둔다
 */
export function addGroup(name: string, position: { x?: unknown; y?: unknown } = {}): Group {
  const hq = readHq()
  const rightEdge = hq.groups.length ? Math.max(...hq.groups.map((r) => r.x + r.w)) + 1 : 0
  const { x, y } = isTile(position.x) && isTile(position.y) ? { x: position.x, y: position.y } : { x: rightEdge, y: 0 }
  const group: Group = { id: randomUUID().slice(0, 8), name, x, y, w: 10, h: 8, todos: [] }
  hq.groups.push(group)
  writeHq(hq)
  return group
}

export const MIN_GROUP_SIZE = 4

function isTile(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

/** 왼쪽·위로 옮길 때 앵커가 0 밑으로 가는 팀이 있으면 그만큼 덜 옮긴다 (팀들 사이 배치는 그대로) */
function limitShift(delta: number, anchors: number[]): number {
  return anchors.length ? Math.max(delta, -Math.min(...anchors)) : delta
}

/**
 * 이름·위치·크기 변경. 위치는 0 이상, 크기는 MIN_GROUP_SIZE 이상 타일 정수만 받는다. 할 일은 아래 할 일 함수로만 바꾼다.
 * 위치가 바뀌면 그 그룹 팀들의 앵커도 같은 만큼 옮긴다 (그룹을 끌면 안의 섬이 같이 움직인다)
 */
export function updateGroup(id: string, patch: Partial<Omit<Group, 'id' | 'todos'>>): Group | null {
  const hq = readHq()
  const group = hq.groups.find((r) => r.id === id)
  if (!group) return null
  if (patch.name !== undefined) group.name = patch.name
  const teams = hq.teams.filter((t) => t.groupId === id)
  const dx = limitShift(isTile(patch.x) ? patch.x - group.x : 0, teams.map((t) => t.x))
  const dy = limitShift(isTile(patch.y) ? patch.y - group.y : 0, teams.map((t) => t.y))
  group.x += dx
  group.y += dy
  for (const team of teams) {
    team.x += dx
    team.y += dy
  }
  if (isTile(patch.w) && patch.w >= MIN_GROUP_SIZE) group.w = patch.w
  if (isTile(patch.h) && patch.h >= MIN_GROUP_SIZE) group.h = patch.h
  writeHq(hq)
  return group
}

export class GroupNotEmptyError extends Error {
  constructor(name: string) {
    super(`"${name}" 그룹에 팀이 있어 지울 수 없음. 팀을 먼저 옮기거나 지워라`)
  }
}

/** 팀이 없는 그룹만 지운다 */
export function removeGroup(id: string): boolean {
  const hq = readHq()
  const group = hq.groups.find((g) => g.id === id)
  if (!group) return false
  if (hq.teams.some((t) => t.groupId === id)) throw new GroupNotEmptyError(group.name)
  hq.groups = hq.groups.filter((g) => g.id !== id)
  writeHq(hq)
  return true
}

/** 그룹 순서(= 목록 순서)를 통째로 바꾼다. ids 는 지금 있는 그룹 전부여야 한다 */
export function reorderGroups(ids: string[]): Group[] {
  const hq = readHq()
  hq.groups = reorderSlots(hq.groups, ids, () => true)
  writeHq(hq)
  return hq.groups
}

// ---------- 그룹 할 일 ----------

export const MAX_TODO_LENGTH = 500

/** 줄바꿈(\r\n·\n·\r)은 하나마다 공백 하나로 바꾸고 앞뒤 공백을 뺀다 */
function normalizeTodoText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ').trim()
}

/** API 로 받은 할 일 글. 문자열이고 정리한 뒤 1~500자면 정리한 글, 아니면 null */
export function parseTodoText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = normalizeTodoText(value)
  return text.length >= 1 && text.length <= MAX_TODO_LENGTH ? text : null
}

/**
 * 예전 그룹 대기 메모를 할 일 글들로 나눈다. "- " 로 시작하면 맨 앞·줄바꿈 뒤·쉼표 뒤의 "- " 마다 한 항목이고
 * 항목 끝 쉼표·공백은 뺀다 (실제 메모가 "- 가, - 나" 꼴. 항목 안의 " - " 는 나누지 않는다). 아니면 글 전체가 한 항목, 빈 메모는 []
 */
export function splitWaitingNote(note: string): string[] {
  const trimmed = note.trim()
  if (!trimmed.startsWith('- ')) return trimmed ? [normalizeTodoText(trimmed)] : []
  return trimmed
    .split(/(?:^|[\r\n,])\s*-(?:\s+|$)/)
    .map((item) => normalizeTodoText(item).replace(/[,\s]+$/, ''))
    .filter((item) => item)
}

export class TodoNotFoundError extends Error {
  constructor() {
    super('할 일을 찾을 수 없음')
  }
}

function newTodo(text: string, now: Date): GroupTodo {
  return { id: randomUUID().slice(0, 8), text, isDone: false, createdAt: now.toISOString(), doneAt: null }
}

/** 할 일 구역과 완료 구역 (각 구역 안 순서 그대로) */
function splitTodos(todos: GroupTodo[]): { open: GroupTodo[]; done: GroupTodo[] } {
  return { open: todos.filter((t) => !t.isDone), done: todos.filter((t) => t.isDone) }
}

/** 할 일 구역 맨 끝(첫 완료 앞)에 넣는다. 글은 부른 쪽이 parseTodoText 로 거른다. 그룹이 없으면 null */
export function addTodo(groupId: string, text: string, now = new Date()): GroupTodo | null {
  const hq = readHq()
  const group = hq.groups.find((g) => g.id === groupId)
  if (!group) return null
  const todo = newTodo(text, now)
  const { open, done } = splitTodos(group.todos)
  group.todos = [...open, todo, ...done]
  writeHq(hq)
  return todo
}

export type TodoPatch = { text?: string; isDone?: boolean }

/**
 * 글·완료 변경. 완료가 되면 doneAt = now 이고 맨 끝(완료한 순서)으로, 할 일로 되돌리면 doneAt null 이고 할 일 구역 맨 끝으로.
 * 완료 값이 그대로면 자리를 안 바꾼다. 그룹이 없으면 null, 할 일이 없으면 TodoNotFoundError
 */
export function updateTodo(groupId: string, todoId: string, patch: TodoPatch, now = new Date()): GroupTodo | null {
  const hq = readHq()
  const group = hq.groups.find((g) => g.id === groupId)
  if (!group) return null
  const todo = group.todos.find((t) => t.id === todoId)
  if (!todo) throw new TodoNotFoundError()
  if (patch.text !== undefined) todo.text = patch.text
  if (patch.isDone !== undefined && patch.isDone !== todo.isDone) {
    todo.isDone = patch.isDone
    todo.doneAt = patch.isDone ? now.toISOString() : null
    const { open, done } = splitTodos(group.todos.filter((t) => t.id !== todoId))
    group.todos = patch.isDone ? [...open, ...done, todo] : [...open, todo, ...done]
  }
  writeHq(hq)
  return todo
}

/** 남은 할 일 목록. 그룹이 없으면 null, 할 일이 없으면 TodoNotFoundError */
export function removeTodo(groupId: string, todoId: string): GroupTodo[] | null {
  const hq = readHq()
  const group = hq.groups.find((g) => g.id === groupId)
  if (!group) return null
  if (!group.todos.some((t) => t.id === todoId)) throw new TodoNotFoundError()
  group.todos = group.todos.filter((t) => t.id !== todoId)
  writeHq(hq)
  return group.todos
}

/** 할 일(미완료) 구역 순서를 통째로 바꾼다. ids 는 그 구역 전부여야 한다. 완료 구역은 그대로. 그룹이 없으면 null */
export function reorderTodos(groupId: string, ids: string[]): GroupTodo[] | null {
  const hq = readHq()
  const group = hq.groups.find((g) => g.id === groupId)
  if (!group) return null
  group.todos = reorderSlots(group.todos, ids, (t) => !t.isDone)
  writeHq(hq)
  return group.todos
}

/**
 * 예전 그룹 대기 메모(waitingNote)를 할 일로 옮기고 그 키를 지운다 (서버가 시작할 때 부른다).
 * 읽을 때 바꾸지 않는 것은 할 일 ID 가 읽을 때마다 바뀌지 않게다 — 한 번 써서 남긴다. 옮긴 항목은 할 일 구역 끝에 미완료로 붙인다.
 * 옮긴 그룹 수 (없으면 쓰지 않는다)
 */
export function migrateWaitingNotes(now = new Date()): number {
  const hq = readHq()
  let migratedCount = 0
  for (const group of hq.groups as (Group & { waitingNote?: unknown })[]) {
    if (typeof group.waitingNote !== 'string') continue
    const { open, done } = splitTodos(group.todos)
    group.todos = [...open, ...splitWaitingNote(group.waitingNote).map((text) => newTodo(text, now)), ...done]
    delete group.waitingNote
    migratedCount++
  }
  if (migratedCount > 0) writeHq(hq)
  return migratedCount
}

// ---------- 팀 ----------

export function listTeams(): Team[] {
  return readHq().teams
}

export class TeamConflictError extends Error {
  constructor(cwd: string) {
    super(`같은 폴더의 팀이 이미 있음: ${cwd}`)
  }
}

/** 그룹 안의 빈 자리에 앵커를 둔다. 같은 폴더의 팀이 있으면 거부 */
export class GroupNotFoundError extends Error {
  constructor() {
    super('그룹을 골라야 함')
  }
}

/** 앵커(x·y)는 화면이 빈 자리를 찾아 준다. 없거나 타일 좌표가 아니면 같은 그룹 팀들 아래에 둔다 */
export function addTeam(input: { name: string; cwd: string; groupId: string; x?: unknown; y?: unknown }): Team {
  const hq = readHq()
  if (hq.teams.some((t) => normalizeCwd(t.cwd) === normalizeCwd(input.cwd))) throw new TeamConflictError(input.cwd)
  const group = hq.groups.find((r) => r.id === input.groupId)
  if (!group) throw new GroupNotFoundError()
  const siblings = hq.teams.filter((t) => t.groupId === group.id)
  // 섬 테두리(앵커 -1타일)가 그룹 벽과 겹치지 않게 +2. 같은 그룹의 팀들 아래에 둔다. 겹치면 사용자가 끌어 옮긴다
  const fallback = { x: group.x + 2, y: siblings.length ? Math.max(...siblings.map((t) => t.y)) + 5 : group.y + 2 }
  const { x, y } = isTile(input.x) && isTile(input.y) ? { x: input.x, y: input.y } : fallback
  const team: Team = {
    id: randomUUID().slice(0, 8),
    name: input.name,
    cwd: input.cwd,
    groupId: group.id,
    x,
    y,
    desks: {},
    parts: [],
    partOf: {},
    createdAt: new Date().toISOString(),
  }
  hq.teams.push(team)
  writeHq(hq)
  return team
}

export type TeamPatch = Partial<Pick<Team, 'name' | 'groupId' | 'x' | 'y'>> & { leadSessionId?: string | null }

export function updateTeam(id: string, patch: TeamPatch): Team | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === id)
  if (!team) return null
  if (patch.name !== undefined && patch.name.trim()) team.name = patch.name.trim()
  if (patch.groupId !== undefined && hq.groups.some((r) => r.id === patch.groupId)) team.groupId = patch.groupId
  if (isTile(patch.x)) team.x = patch.x
  if (isTile(patch.y)) team.y = patch.y
  if (patch.leadSessionId === null) delete team.leadSessionId
  else if (typeof patch.leadSessionId === 'string') team.leadSessionId = patch.leadSessionId
  writeHq(hq)
  return team
}

export function removeTeam(teamId: string): boolean {
  const hq = readHq()
  const before = hq.teams.length
  hq.teams = hq.teams.filter((t) => t.id !== teamId)
  if (hq.teams.length === before) return false
  writeHq(hq)
  return true
}

/** 한 그룹 안 팀 순서(= 목록 순서)를 통째로 바꾼다. ids 는 그 그룹 팀 전부여야 한다. 다른 그룹 팀들은 배열 안 자리 그대로. 그룹이 없으면 null */
export function reorderTeams(groupId: string, ids: string[]): Team[] | null {
  const hq = readHq()
  if (!hq.groups.some((g) => g.id === groupId)) return null
  hq.teams = reorderSlots(hq.teams, ids, (t) => t.groupId === groupId)
  writeHq(hq)
  return hq.teams.filter((t) => t.groupId === groupId)
}

export function setDesk(teamId: string, sessionId: string, desk: { dx: number; dy: number }): Team | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team) return null
  team.desks[sessionId] = { dx: Math.round(desk.dx), dy: Math.round(desk.dy) }
  writeHq(hq)
  return team
}

// ---------- 파트 ----------

export class PartNotFoundError extends Error {
  constructor() {
    super('파트를 찾을 수 없음')
  }
}

export class WorktreePartError extends Error {
  constructor() {
    super('worktree 파트의 소속은 폴더로 정해져 바꿀 수 없음')
  }
}

/** 팀이 없으면 null. worktree 는 호출한 쪽이 git 으로 만든 뒤 넘긴다 */
export function addPart(teamId: string, input: { name: string; worktree?: Part['worktree'] }): Part | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team) return null
  const part: Part = { id: randomUUID().slice(0, 8), name: input.name.trim(), createdAt: new Date().toISOString() }
  if (input.worktree) part.worktree = input.worktree
  team.parts.push(part)
  writeHq(hq)
  return part
}

export type PartPatch = { name?: string; leadSessionId?: string | null }

export function updatePart(teamId: string, partId: string, patch: PartPatch): Part | null {
  const hq = readHq()
  const part = hq.teams.find((t) => t.id === teamId)?.parts.find((p) => p.id === partId)
  if (!part) return null
  if (patch.name !== undefined && patch.name.trim()) part.name = patch.name.trim()
  if (patch.leadSessionId === null) delete part.leadSessionId
  else if (typeof patch.leadSessionId === 'string') part.leadSessionId = patch.leadSessionId
  writeHq(hq)
  return part
}

/** 파트 기록과 그 파트를 가리키는 partOf 만 지운다. worktree 폴더·브랜치는 남긴다. 소속 세션은 팀 직속이 된다 */
export function removePart(teamId: string, partId: string): boolean {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team || !team.parts.some((p) => p.id === partId)) return false
  team.parts = team.parts.filter((p) => p.id !== partId)
  for (const [sessionId, value] of Object.entries(team.partOf)) if (value === partId) delete team.partOf[sessionId]
  writeHq(hq)
  return true
}

/** 팀 폴더 세션의 파트 소속. null 이면 팀 직속. worktree 파트로는 옮길 수 없다 (폴더로 정해짐) */
export function setPartOf(teamId: string, sessionId: string, partId: string | null): Team | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team) return null
  if (partId === null) delete team.partOf[sessionId]
  else {
    const part = team.parts.find((p) => p.id === partId)
    if (!part) throw new PartNotFoundError()
    if (part.worktree) throw new WorktreePartError()
    team.partOf[sessionId] = partId
  }
  writeHq(hq)
  return team
}
