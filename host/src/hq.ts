import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface WebSessionRecord {
  sessionId: string
  cwd: string
  createdAt: string
}

interface HqFile {
  rooms: unknown[]
  seats: Record<string, unknown>
  webSessions: WebSessionRecord[]
}

const hqDir = join(homedir(), '.claude', 'jk-corp')
const hqPath = join(hqDir, 'hq.json')

function readHq(): HqFile {
  try {
    const parsed = JSON.parse(readFileSync(hqPath, 'utf8'))
    return { rooms: parsed.rooms ?? [], seats: parsed.seats ?? {}, webSessions: parsed.webSessions ?? [] }
  } catch {
    return { rooms: [], seats: {}, webSessions: [] }
  }
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
