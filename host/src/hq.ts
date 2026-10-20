import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { normalizeCwd, type Team } from './team.js'

export type { Team } from './team.js'

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
  } catch {
    // 파일 없음 → 기본값
  }
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

/** 구버전 기록(desks 없음, roomId 등)을 읽어도 터지지 않게 */
function withDefaults(team: Partial<Team> & Pick<Team, 'id' | 'name' | 'cwd'> & { roomId?: string }): Team {
  const { roomId, ...rest } = team
  return { groupId: roomId ?? 'lobby', x: 1, y: 1, desks: {}, createdAt: '', ...rest }
}

function writeHq(hq: HqFile): void {
  mkdirSync(hqDir, { recursive: true })
  writeFileSync(hqPath, JSON.stringify(hq, null, 2) + '\n')
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

export function setDesk(teamId: string, sessionId: string, desk: { dx: number; dy: number }): Team | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team) return null
  team.desks[sessionId] = { dx: Math.round(desk.dx), dy: Math.round(desk.dy) }
  writeHq(hq)
  return team
}
