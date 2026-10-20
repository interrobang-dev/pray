import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface WebSessionRecord {
  sessionId: string
  cwd: string
  createdAt: string
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

interface HqFile extends Office {
  webSessions: WebSessionRecord[]
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
  return { rooms, seats: parsed.seats ?? {}, webSessions: parsed.webSessions ?? [] }
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

export function updateRoom(id: string, patch: Partial<Pick<Room, 'name' | 'waitingNote'>>): Room | null {
  const hq = readHq()
  const room = hq.rooms.find((r) => r.id === id)
  if (!room) return null
  if (patch.name !== undefined) room.name = patch.name
  if (patch.waitingNote !== undefined) room.waitingNote = patch.waitingNote || undefined
  writeHq(hq)
  return room
}

export function setSeat(sessionId: string, seat: Seat): void {
  const hq = readHq()
  hq.seats[sessionId] = seat
  writeHq(hq)
}
