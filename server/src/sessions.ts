import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Session } from './types.js'
import type { HookState } from './hookState.js'
import { summarizeTranscript } from './transcript.js'
import { readLiveSessions } from './liveSessions.js'

const claudeDir = join(homedir(), '.claude')
const projectsDir = join(claudeDir, 'projects')
const sessionsDir = join(claudeDir, 'sessions')

async function findTranscript(sessionId: string): Promise<string | null> {
  let projectNames: string[]
  try {
    projectNames = await readdir(projectsDir)
  } catch {
    return null
  }
  for (const projectName of projectNames) {
    const candidate = join(projectsDir, projectName, `${sessionId}.jsonl`)
    try {
      return await readFile(candidate, 'utf8')
    } catch {
      continue
    }
  }
  return null
}

export async function listSessions(hookStates: Map<string, HookState>): Promise<Session[]> {
  const live = await readLiveSessions(sessionsDir)
  const ids = new Set<string>([...live.map((s) => s.sessionId), ...hookStates.keys()])

  const sessions = await Promise.all(
    [...ids].map(async (id): Promise<Session> => {
      const liveEntry = live.find((s) => s.sessionId === id)
      const hook = hookStates.get(id)
      const jsonl = await findTranscript(id)
      const transcript = jsonl ? summarizeTranscript(jsonl) : null
      return {
        id,
        cwd: liveEntry?.cwd ?? hook?.cwd ?? '',
        title: transcript?.title ?? null,
        status: hook?.status ?? 'unknown',
        kind: 'external',
        isAlive: liveEntry !== undefined,
        lastAt: transcript?.lastAt ?? hook?.updatedAt ?? null,
        lastAssistantText: hook?.lastAssistantText ?? transcript?.lastAssistantText ?? null,
        pendingTool: hook?.pendingTool ?? null,
      }
    }),
  )
  return sessions.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}
