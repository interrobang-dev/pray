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

/** 그룹 = 그래픽 공간. 좌표·크기는 타일 단위 */
export interface Group {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  waitingNote?: string
}

export interface Office {
  groups: Group[]
  teams: Team[]
}

interface HqFile extends Office {
  webSessions: WebSessionRecord[]
  /** 사용자가 직접 붙인 세션 이름. 없으면 화면은 jsonl 의 ai-title 을 쓴다. 외부 세션에도 붙일 수 있어 webSessions 와 별도 */
  sessionNames: Record<string, string>
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
  const groups = (rest.groups?.length ? rest.groups : (legacyGroups ?? [])).filter(
    (g) => g.id !== 'lobby' || teams.some((t) => t.groupId === 'lobby'),
  )
  // 모르는 키도 보존한다. 호스트·서버가 같은 파일을 쓰므로 한쪽이 구버전이어도 다른 쪽 데이터를 지우지 않게
  return { ...rest, groups, webSessions: rest.webSessions ?? [], teams, sessionNames: rest.sessionNames ?? {} }
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

export function removeWebSession(sessionId: string): void {
  const hq = readHq()
  hq.webSessions = hq.webSessions.filter((s) => s.sessionId !== sessionId)
  writeHq(hq)
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

/** 기존 그룹들의 오른쪽 끝 옆에 새 그룹을 둔다 */
export function addGroup(name: string): Group {
  const hq = readHq()
  const rightEdge = hq.groups.length ? Math.max(...hq.groups.map((r) => r.x + r.w)) + 1 : 0
  const group: Group = { id: randomUUID().slice(0, 8), name, x: rightEdge, y: 0, w: 10, h: 8 }
  hq.groups.push(group)
  writeHq(hq)
  return group
}

export const MIN_GROUP_SIZE = 4

function isTile(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

/** 이름·메모·위치·크기 변경. 위치는 0 이상, 크기는 MIN_GROUP_SIZE 이상 타일 정수만 받는다 */
export function updateGroup(id: string, patch: Partial<Omit<Group, 'id'>>): Group | null {
  const hq = readHq()
  const group = hq.groups.find((r) => r.id === id)
  if (!group) return null
  if (patch.name !== undefined) group.name = patch.name
  if (patch.waitingNote !== undefined) group.waitingNote = patch.waitingNote || undefined
  if (isTile(patch.x)) group.x = patch.x
  if (isTile(patch.y)) group.y = patch.y
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

export function addTeam(input: { name: string; cwd: string; groupId: string }): Team {
  const hq = readHq()
  if (hq.teams.some((t) => normalizeCwd(t.cwd) === normalizeCwd(input.cwd))) throw new TeamConflictError(input.cwd)
  const group = hq.groups.find((r) => r.id === input.groupId)
  if (!group) throw new GroupNotFoundError()
  const siblings = hq.teams.filter((t) => t.groupId === group.id)
  // 섬 테두리(앵커 -1타일)가 그룹 벽과 겹치지 않게 +2. 같은 그룹의 팀들 아래에 둔다. 겹치면 사용자가 끌어 옮긴다
  const y = siblings.length ? Math.max(...siblings.map((t) => t.y)) + 5 : group.y + 2
  const team: Team = {
    id: randomUUID().slice(0, 8),
    name: input.name,
    cwd: input.cwd,
    groupId: group.id,
    x: group.x + 2,
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
