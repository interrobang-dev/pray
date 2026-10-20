import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface LiveSession {
  sessionId: string
  cwd: string
  pid: number
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function readLiveSessions(sessionsDir: string): Promise<LiveSession[]> {
  let names: string[]
  try {
    names = await readdir(sessionsDir)
  } catch {
    return []
  }
  const result: LiveSession[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const record = JSON.parse(await readFile(join(sessionsDir, name), 'utf8'))
      if (typeof record.sessionId !== 'string' || typeof record.pid !== 'number') continue
      if (!isProcessAlive(record.pid)) continue
      result.push({ sessionId: record.sessionId, cwd: record.cwd ?? '', pid: record.pid })
    } catch {
      continue
    }
  }
  return result
}
