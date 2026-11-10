import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dataDir } from './dataDir.js'
import { normalizeCwd, TODO_PRIORITIES, type Part, type Team, type Todo, type TodoPriority } from './team.js'

export type { Part, Team, Todo, TodoPriority } from './team.js'
export { TODO_PRIORITIES } from './team.js'

export interface WebSessionRecord {
  sessionId: string
  cwd: string
  createdAt: string
  /** spawn 때 claude 에 넘긴 추가 인자. resume 때 다시 넘긴다 (--name, --permission-mode, --append-system-prompt 등) */
  extraArgs?: string[]
}

/** released = 팀장이 정리한 팀원(team_dismiss), dismissed = 그 밖의 kill 요청(화면 종료 버튼), exit = 종료 코드 0, error = 그 밖의 종료 코드 */
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

/** 그룹 = 그래픽 공간. 좌표·크기는 타일 단위. 화면은 w·h 를 쓰지 않는다 (그룹 크기는 안의 팀 섬으로 정한다) */
export interface Group {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
}

/** 예전 기록의 그룹. 할 일은 팀으로 옮겨졌다 (migrateGroupTodosToTeams). 팀이 없는 그룹의 것만 남을 수 있다 */
type LegacyGroup = Group & { todos?: Todo[]; waitingNote?: unknown }

export interface Office {
  groups: Group[]
  teams: Team[]
  /** 팀과 무관한 내 할 일 (화면 "My desk"). 팀 할 일과 같은 꼴·순서 규칙. 서버만 쓴다 */
  todos: Todo[]
}

/**
 * 도트 사무실 인물 (프리셋 id). 머리·윗옷 색은 '#rrggbb', null 이면 그 인물 기본색.
 * isAuto = 서버가 새 세션에 배정한 것 (없으면 사용자가 고른 것). 옛 코드는 이 칸을 모르고 인물·색만 쓴다
 */
export interface SessionCharacter {
  id: string
  hair: string | null
  top: string | null
  isAuto?: boolean
}

/** 서버가 지은 이름의 성별. 도트 사무실이 그 성별 인물을 고른다 */
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
  /** 세션 역할 (FE·BE·Lead 등, parsePosition 꼴). 이름(sessionNames)에는 넣지 않는다 — 화면이 따로 붙인다. 이름과 같이 지운다 */
  positions: Record<string, string>
}

/** 설정 폴더는 처음 읽고 쓸 때 정한다 (dataDir) */
function hqPath(): string {
  return join(dataDir(), 'hq.json')
}

function readHq(): HqFile {
  let parsed: Partial<HqFile> = {}
  try {
    parsed = JSON.parse(readFileSync(hqPath(), 'utf8'))
  } catch (error) {
    // 파일 없음 → 기본값. 있는데 못 읽거나 깨졌으면 던져서 저장을 막는다. 기본값으로 넘어가면 다음 쓰기가 기록을 통째로 지운다
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unreadable(error)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw unreadable('최상위가 객체가 아님')
  // 구 파일 이전: "방(rooms)" 이 "그룹(groups)" 으로 바뀌었고 seats 는 없어졌다. 읽을 때 옮기고 다음 쓰기 때 새 키로만 저장한다
  const { rooms: legacyGroups, seats: _legacySeats, ...rest } = parsed as Partial<HqFile> & { rooms?: Group[]; seats?: unknown }
  const teams = (rest.teams ?? []).map(withDefaults)
  // 예전 기본 그룹 "로비"(id lobby) 는 없어졌다. 로비 = 팀 없는 세션이 모이는 고정 구역. 팀이 안 들어 있으면 읽을 때 지운다
  // 그룹의 옛 todos·waitingNote 는 읽을 때 바꾸지 않고 그대로 둔다 (migrateWaitingNotes·migrateGroupTodosToTeams 가 한 번 옮긴다)
  const groups = (rest.groups?.length ? rest.groups : (legacyGroups ?? [])).filter(
    (g) => g.id !== 'lobby' || teams.some((t) => t.groupId === 'lobby'),
  )
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
    positions: rest.positions ?? {},
    todos: rest.todos ?? [],
  }
}

/** 구버전 기록(desks·parts·partOf·todos 없음, roomId 등)을 읽어도 터지지 않게 */
function withDefaults(team: Partial<Team> & Pick<Team, 'id' | 'name' | 'cwd'> & { roomId?: string }): Team {
  const { roomId, ...rest } = team
  return { groupId: roomId ?? 'lobby', x: 1, y: 1, desks: {}, parts: [], partOf: {}, todos: [], createdAt: '', ...rest }
}

function unreadable(cause: unknown): Error {
  return new Error(`hq.json 을 읽을 수 없어 읽기·저장을 막음 (${hqPath()}): ${cause}`, { cause })
}

/** Windows 는 대상 파일을 다른 프로세스(백신·인덱서 등)가 잡고 있으면 rename 이 실패한다. 잠깐 기다렸다 다시 한다 */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

/** 같은 폴더의 임시 파일에 다 쓴 뒤 바꿔 끼운다. 바로 덮어쓰면 쓰는 도중 강제 종료되거나 다른 프로세스가 그 사이에 읽을 때 빈 파일이 된다 */
function writeHq(hq: HqFile): void {
  mkdirSync(dataDir(), { recursive: true })
  const path = hqPath()
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(hq, null, 2) + '\n')
    renameWithRetry(tempPath, path)
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

/** 다시 출근할 수 없는 웹 세션(대화가 없음)의 기록과 이름·고른 인물·성별·역할을 지운다. webSessions 에 없으면 아무것도 쓰지 않고 false */
export function discardWebSession(sessionId: string): boolean {
  const hq = readHq()
  if (!hq.webSessions.some((s) => s.sessionId === sessionId)) return false
  hq.webSessions = hq.webSessions.filter((s) => s.sessionId !== sessionId)
  delete hq.sessionNames[sessionId]
  delete hq.characters[sessionId]
  delete hq.genders[sessionId]
  delete hq.positions[sessionId]
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

/** 퇴근 기록과 그 세션 이름·고른 인물·성별·역할을 지운다. 없으면 false */
export function removeOffDuty(sessionId: string): boolean {
  const hq = readHq()
  if (!hq.offDuty.some((s) => s.sessionId === sessionId)) return false
  hq.offDuty = hq.offDuty.filter((s) => s.sessionId !== sessionId)
  delete hq.sessionNames[sessionId]
  delete hq.characters[sessionId]
  delete hq.genders[sessionId]
  delete hq.positions[sessionId]
  writeHq(hq)
  return true
}

/** 이유별 보관 기간이 지난 퇴근 기록과 그 이름·고른 인물·성별·역할을 지운다. 지운 세션 ID 들 (없으면 쓰지 않는다) */
export function pruneOffDuty(now = Date.now()): string[] {
  const hq = readHq()
  const expired = hq.offDuty.filter((s) => now - Date.parse(s.endedAt) > retentionOf(s.reason)).map((s) => s.sessionId)
  if (expired.length === 0) return []
  hq.offDuty = hq.offDuty.filter((s) => !expired.includes(s.sessionId))
  for (const sessionId of expired) {
    delete hq.sessionNames[sessionId]
    delete hq.characters[sessionId]
    delete hq.genders[sessionId]
    delete hq.positions[sessionId]
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

// ---------- 세션 역할 ----------

const MAX_POSITION_LENGTH = 12

/** trim 한 역할. 1~12자이고 `[`·`]`·줄바꿈이 없어야 한다. 아니면 null (화면이 "[역할]" 로 붙이므로 괄호를 막는다) */
export function parsePosition(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > MAX_POSITION_LENGTH || /[[\]\r\n]/.test(trimmed)) return null
  return trimmed
}

/**
 * 역할을 이름에 붙이던 옛 꼴 "[역할] 이름" 을 나눈다. 이름 부분이 비면 name 은 null (자동 제목).
 * 그 꼴이 아니거나 괄호 안이 역할 꼴(parsePosition)이 아니면 null — 이름 그대로 둔다
 */
export function splitPositionName(name: string): { position: string; name: string | null } | null {
  const match = /^\[([^\]]*)\]\s*(.*)$/s.exec(name.trim())
  const position = match ? parsePosition(match[1]) : null
  if (!match || !position) return null
  return { position, name: match[2].trim() || null }
}

export function listPositions(): Record<string, string> {
  return readHq().positions
}

/** null 이면 지운다. 꼴은 부른 쪽이 parsePosition 으로 거른다 */
export function setPosition(sessionId: string, position: string | null): void {
  const hq = readHq()
  if (position) hq.positions[sessionId] = position
  else delete hq.positions[sessionId]
  writeHq(hq)
}

/**
 * 옛 이름 "[역할] 이름" 을 역할(positions)과 이름으로 나눈다 (서버가 시작할 때 부른다). 이름 부분이 비면 이름은 지운다.
 * 이미 역할이 있으면 그 역할을 두고 이름에서만 뗀다 — 따로 정한 역할이 더 새것이고, 이름에 남기면 화면에 역할이 두 번 보인다.
 * 성별은 이름 부분이 그대로라 남긴다. 나눈 이름 수 (없으면 쓰지 않는다)
 */
export function migratePositionNames(): number {
  const hq = readHq()
  let migratedCount = 0
  for (const [sessionId, name] of Object.entries(hq.sessionNames)) {
    const split = splitPositionName(name)
    if (!split) continue
    if (split.name) hq.sessionNames[sessionId] = split.name
    else delete hq.sessionNames[sessionId]
    hq.positions[sessionId] ??= split.position
    migratedCount++
  }
  if (migratedCount > 0) writeHq(hq)
  return migratedCount
}

/** 화면용. 팀이 없어 못 옮긴 그룹의 옛 todos 는 싣지 않는다 */
export function readOffice(): Office {
  const { groups, teams, todos } = readHq()
  return { groups: groups.map(({ todos: _legacyTodos, ...group }: LegacyGroup) => group), teams, todos }
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
  const group: Group = { id: randomUUID().slice(0, 8), name, x, y, w: 10, h: 8 }
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
 * 이름·위치·크기 변경. 위치는 0 이상, 크기는 MIN_GROUP_SIZE 이상 타일 정수만 받는다.
 * 위치가 바뀌면 그 그룹 팀들의 앵커도 같은 만큼 옮긴다 (그룹을 끌면 안의 섬이 같이 움직인다)
 */
export function updateGroup(id: string, patch: Partial<Omit<Group, 'id'>>): Group | null {
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

// ---------- 할 일 (팀 할 일·내 책상) ----------

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

/** API 로 받은 우선순위가 4값(critical·high·medium·low) 중 하나인지. 없음(null)은 따로 본다 — 부른 쪽이 틀린 값을 400 으로 바꾼다 */
export function isTodoPriority(value: unknown): value is TodoPriority {
  return typeof value === 'string' && (TODO_PRIORITIES as readonly string[]).includes(value)
}

export class TodoNotFoundError extends Error {
  constructor() {
    super('할 일을 찾을 수 없음')
  }
}

function newTodo(text: string, now: Date): Todo {
  return { id: randomUUID().slice(0, 8), text, isDone: false, createdAt: now.toISOString(), doneAt: null }
}

/** 할 일 구역과 완료 구역 (각 구역 안 순서 그대로) */
function splitTodos(todos: Todo[]): { open: Todo[]; done: Todo[] } {
  return { open: todos.filter((t) => !t.isDone), done: todos.filter((t) => t.isDone) }
}

/** 할 일이 사는 곳: 팀 할 일(`teams[].todos`) 또는 팀과 무관한 내 책상(최상위 `todos`). 규칙(구역·글·ID)은 둘이 같다 */
export type TodoScope = { kind: 'team'; teamId: string } | { kind: 'desk' }

export const DESK_SCOPE: TodoScope = { kind: 'desk' }

export function teamScope(teamId: string): TodoScope {
  return { kind: 'team', teamId }
}

/** 그 범위의 todos 를 가진 객체 (팀 또는 hq 자체). 팀이 없으면 null. 내 책상은 늘 있다 */
function todoHolder(hq: HqFile, scope: TodoScope): { todos: Todo[] } | null {
  return scope.kind === 'desk' ? hq : (hq.teams.find((t) => t.id === scope.teamId) ?? null)
}

/** 할 일 구역 맨 끝(첫 완료 앞)에 넣는다. 글은 부른 쪽이 parseTodoText 로 거른다. 팀이 없으면 null */
export function addTodo(scope: TodoScope, text: string, now = new Date()): Todo | null {
  const hq = readHq()
  const holder = todoHolder(hq, scope)
  if (!holder) return null
  const todo = newTodo(text, now)
  const { open, done } = splitTodos(holder.todos)
  holder.todos = [...open, todo, ...done]
  writeHq(hq)
  return todo
}

/** priority: 4값이면 그 값으로, null 이면 없음(키를 지운다), 빼면 그대로. 값은 부른 쪽이 isTodoPriority 로 거른다 */
export type TodoPatch = { text?: string; isDone?: boolean; priority?: TodoPriority | null }

/**
 * 글·완료·우선순위 변경. 우선순위는 자리를 바꾸지 않는다 (자동 정렬 없음). 완료가 되면 doneAt = now 이고 맨 끝(완료한 순서)으로, 할 일로 되돌리면 doneAt null 이고 할 일 구역 맨 끝으로.
 * 완료 값이 그대로면 자리를 안 바꾼다. 팀이 없으면 null, 할 일이 없으면 TodoNotFoundError
 */
export function updateTodo(scope: TodoScope, todoId: string, patch: TodoPatch, now = new Date()): Todo | null {
  const hq = readHq()
  const holder = todoHolder(hq, scope)
  if (!holder) return null
  const todo = holder.todos.find((t) => t.id === todoId)
  if (!todo) throw new TodoNotFoundError()
  if (patch.text !== undefined) todo.text = patch.text
  if (patch.priority === null) delete todo.priority
  else if (patch.priority !== undefined) todo.priority = patch.priority
  if (patch.isDone !== undefined && patch.isDone !== todo.isDone) {
    todo.isDone = patch.isDone
    todo.doneAt = patch.isDone ? now.toISOString() : null
    const { open, done } = splitTodos(holder.todos.filter((t) => t.id !== todoId))
    holder.todos = patch.isDone ? [...open, ...done, todo] : [...open, todo, ...done]
  }
  writeHq(hq)
  return todo
}

/** 남은 할 일 목록. 팀이 없으면 null, 할 일이 없으면 TodoNotFoundError */
export function removeTodo(scope: TodoScope, todoId: string): Todo[] | null {
  const hq = readHq()
  const holder = todoHolder(hq, scope)
  if (!holder) return null
  if (!holder.todos.some((t) => t.id === todoId)) throw new TodoNotFoundError()
  holder.todos = holder.todos.filter((t) => t.id !== todoId)
  writeHq(hq)
  return holder.todos
}

/** 완료한 할 일을 모두 지우고 지운 개수를 돌려준다. 지울 것이 없으면 쓰지 않는다. 팀이 없으면 null */
export function clearDoneTodos(scope: TodoScope): number | null {
  const hq = readHq()
  const holder = todoHolder(hq, scope)
  if (!holder) return null
  const remaining = holder.todos.filter((t) => !t.isDone)
  const removedCount = holder.todos.length - remaining.length
  if (removedCount === 0) return 0
  holder.todos = remaining
  writeHq(hq)
  return removedCount
}

/** 할 일(미완료) 구역 순서를 통째로 바꾼다. ids 는 그 구역 전부여야 한다. 완료 구역은 그대로. 팀이 없으면 null */
export function reorderTodos(scope: TodoScope, ids: string[]): Todo[] | null {
  const hq = readHq()
  const holder = todoHolder(hq, scope)
  if (!holder) return null
  holder.todos = reorderSlots(holder.todos, ids, (t) => !t.isDone)
  writeHq(hq)
  return holder.todos
}

/**
 * 예전 그룹 대기 메모(waitingNote)를 할 일로 옮기고 그 키를 지운다 (서버가 시작할 때 부른다).
 * 읽을 때 바꾸지 않는 것은 할 일 ID 가 읽을 때마다 바뀌지 않게다 — 한 번 써서 남긴다. 옮긴 항목은 할 일 구역 끝에 미완료로 붙인다.
 * 옮긴 그룹 수 (없으면 쓰지 않는다)
 */
export function migrateWaitingNotes(now = new Date()): number {
  const hq = readHq()
  let migratedCount = 0
  for (const group of hq.groups as LegacyGroup[]) {
    if (typeof group.waitingNote !== 'string') continue
    const { open, done } = splitTodos(group.todos ?? [])
    group.todos = [...open, ...splitWaitingNote(group.waitingNote).map((text) => newTodo(text, now)), ...done]
    delete group.waitingNote
    migratedCount++
  }
  if (migratedCount > 0) writeHq(hq)
  return migratedCount
}

/** 항목 글이 "<이름> - <글>" 꼴이고 그 이름이 팀 이름에 (대소문자 무시) 포함되면 그 팀과 접두어를 뗀 글. 여러 팀이면 이름이 가장 비슷한(가장 짧은) 팀, 같으면 앞선 팀 */
function teamByTodoPrefix(text: string, teams: Team[]): { team: Team; text: string } | null {
  const separatorIndex = text.indexOf(' - ')
  if (separatorIndex < 0) return null
  const prefix = text.slice(0, separatorIndex).trim().toLowerCase()
  const rest = text.slice(separatorIndex + 3).trim()
  if (!prefix || !rest) return null
  let best: Team | null = null
  for (const team of teams) {
    if (!team.name.toLowerCase().includes(prefix)) continue
    if (!best || team.name.length < best.name.length) best = team
  }
  return best ? { team: best, text: rest } : null
}

export interface GroupTodoMigration {
  /** 할 일을 받은 팀과 받은 개수 (옮긴 그룹의 팀 순서) */
  moves: { groupId: string; teamId: string; count: number }[]
  /** 팀이 없어 옮기지 못하고 그룹 기록에 둔 그룹과 그 개수 */
  leftBehind: { groupId: string; count: number }[]
}

/**
 * 그룹 할 일(`groups[].todos`, 예전 기록)을 팀 할 일로 한 번 옮기고 그 키를 지운다 (서버가 시작할 때 부른다).
 * 그 그룹(groupId)의 팀이 하나면 전부 그 팀으로(순서·id·시각 그대로). 여럿이면 글이 "<이름> - " 로 시작하고 그 이름이 팀 이름에 들어 있는 항목은
 * 그 팀으로 옮기며 접두어를 떼고, 나머지는 그 그룹의 첫 팀(teams 배열 순서)으로. 팀이 없는 그룹은 옮기지 않고 그대로 둔다.
 * 옮긴 항목은 받는 팀의 구역 규칙대로 붙는다 (할 일은 할 일 구역 끝, 완료는 완료 구역 끝). 옮길 것이 없으면 쓰지 않는다
 */
export function migrateGroupTodosToTeams(): GroupTodoMigration {
  const hq = readHq()
  const result: GroupTodoMigration = { moves: [], leftBehind: [] }
  let isChanged = false
  for (const group of hq.groups as LegacyGroup[]) {
    const todos = group.todos ?? []
    if (todos.length === 0) continue
    const teams = hq.teams.filter((t) => t.groupId === group.id)
    if (teams.length === 0) {
      result.leftBehind.push({ groupId: group.id, count: todos.length })
      continue
    }
    const received = new Map<Team, Todo[]>()
    for (const todo of todos) {
      const byPrefix = teams.length > 1 ? teamByTodoPrefix(todo.text, teams) : null
      const target = byPrefix?.team ?? teams[0]
      received.set(target, [...(received.get(target) ?? []), byPrefix ? { ...todo, text: byPrefix.text } : todo])
    }
    for (const [team, moved] of received) {
      const current = splitTodos(team.todos)
      const incoming = splitTodos(moved)
      team.todos = [...current.open, ...incoming.open, ...current.done, ...incoming.done]
      result.moves.push({ groupId: group.id, teamId: team.id, count: moved.length })
    }
    delete group.todos
    isChanged = true
  }
  if (isChanged) writeHq(hq)
  return result
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
    todos: [],
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
