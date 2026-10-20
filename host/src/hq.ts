import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface WebSessionRecord {
  sessionId: string
  cwd: string
  createdAt: string
  /** spawn 때 claude 에 넘긴 추가 인자. resume 때 다시 넘긴다 (--name, --permission-mode, --append-system-prompt 등) */
  extraArgs?: string[]
}

/** 방 = 업무. 좌표·크기는 타일 단위 */
export interface Room {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  waitingNote?: string
}

/** 책상 위치. 타일 단위 절대 좌표 */
export interface Seat {
  roomId: string
  x: number
  y: number
  label?: string
}

export interface Office {
  rooms: Room[]
  seats: Record<string, Seat>
}

export interface TeamMember {
  sessionId: string
  name: string
  cwd: string
  createdAt: string
}

/** 팀 = 팀장 세션 하나 + 팀원 세션들. 팀장이 MCP 도구로 팀원을 다룬다 */
export interface Team {
  id: string
  name: string
  cwd: string
  leadSessionId: string
  createdAt: string
  members: TeamMember[]
}

interface HqFile extends Office {
  webSessions: WebSessionRecord[]
  teams: Team[]
}

const LOBBY: Room = { id: 'lobby', name: '로비', x: 0, y: 0, w: 16, h: 10 }

const hqDir = join(homedir(), '.claude', 'jk-corp')
const hqPath = join(hqDir, 'hq.json')

function readHq(): HqFile {
  let parsed: Partial<HqFile> = {}
  try {
    parsed = JSON.parse(readFileSync(hqPath, 'utf8'))
  } catch {
    // 파일 없음 → 기본값
  }
  const rooms = parsed.rooms?.length ? parsed.rooms : [LOBBY]
  // 모르는 키도 보존한다. 호스트·서버가 같은 파일을 쓰므로 한쪽이 구버전이어도 다른 쪽 데이터를 지우지 않게
  return { ...parsed, rooms, seats: parsed.seats ?? {}, webSessions: parsed.webSessions ?? [], teams: parsed.teams ?? [] }
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

export function readOffice(): Office {
  const { rooms, seats } = readHq()
  return { rooms, seats }
}

/** 기존 방들의 오른쪽 끝 옆에 새 방을 둔다 */
export function addRoom(name: string): Room {
  const hq = readHq()
  const rightEdge = Math.max(...hq.rooms.map((r) => r.x + r.w))
  const room: Room = { id: randomUUID().slice(0, 8), name, x: rightEdge + 1, y: 0, w: 10, h: 8 }
  hq.rooms.push(room)
  writeHq(hq)
  return room
}

export const MIN_ROOM_SIZE = 4

function isTile(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

/** 이름·메모·위치·크기 변경. 위치는 0 이상, 크기는 MIN_ROOM_SIZE 이상 타일 정수만 받는다 */
export function updateRoom(id: string, patch: Partial<Omit<Room, 'id'>>): Room | null {
  const hq = readHq()
  const room = hq.rooms.find((r) => r.id === id)
  if (!room) return null
  if (patch.name !== undefined) room.name = patch.name
  if (patch.waitingNote !== undefined) room.waitingNote = patch.waitingNote || undefined
  if (isTile(patch.x)) room.x = patch.x
  if (isTile(patch.y)) room.y = patch.y
  if (isTile(patch.w) && patch.w >= MIN_ROOM_SIZE) room.w = patch.w
  if (isTile(patch.h) && patch.h >= MIN_ROOM_SIZE) room.h = patch.h
  writeHq(hq)
  return room
}

export function setSeat(sessionId: string, seat: Seat): void {
  const hq = readHq()
  hq.seats[sessionId] = seat
  writeHq(hq)
}

export function listTeams(): Team[] {
  return readHq().teams
}

export function addTeam(team: Team): void {
  const hq = readHq()
  hq.teams = [...hq.teams.filter((t) => t.id !== team.id), team]
  writeHq(hq)
}

export function removeTeam(teamId: string): void {
  const hq = readHq()
  hq.teams = hq.teams.filter((t) => t.id !== teamId)
  writeHq(hq)
}

export function addTeamMember(teamId: string, member: TeamMember): Team | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team) return null
  team.members = [...team.members.filter((m) => m.sessionId !== member.sessionId), member]
  writeHq(hq)
  return team
}

export function removeTeamMember(teamId: string, sessionId: string): Team | null {
  const hq = readHq()
  const team = hq.teams.find((t) => t.id === teamId)
  if (!team) return null
  team.members = team.members.filter((m) => m.sessionId !== sessionId)
  writeHq(hq)
  return team
}
