import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Session } from './types.js'
import type { HookState } from './hookState.js'
import { summarizeTranscript } from './transcript.js'
import { readLiveSessions } from './liveSessions.js'
import type { Team } from '@jk-corp/host/hq'

const claudeDir = join(homedir(), '.claude')
export const projectsDir = join(claudeDir, 'projects')
const sessionsDir = join(claudeDir, 'sessions')

export async function findTranscript(sessionId: string): Promise<string | null> {
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

function roleOf(sessionId: string, teams: Team[]): Pick<Session, 'role' | 'teamId'> {
  for (const team of teams) {
    if (team.leadSessionId === sessionId) return { role: 'lead', teamId: team.id }
    if (team.members.some((m) => m.sessionId === sessionId)) return { role: 'member', teamId: team.id }
  }
  return { role: null, teamId: null }
}

export async function listSessions(
  hookStates: Map<string, HookState>,
  webSessions: Map<string, string>,
  teams: Team[] = [],
): Promise<Session[]> {
  const live = await readLiveSessions(sessionsDir)
  const ids = new Set<string>([...live.map((s) => s.sessionId), ...hookStates.keys(), ...webSessions.keys()])

  const sessions = await Promise.all(
    [...ids].map(async (id): Promise<Session> => {
      const liveEntry = live.find((s) => s.sessionId === id)
      const hook = hookStates.get(id)
      const jsonl = await findTranscript(id)
      const transcript = jsonl ? summarizeTranscript(jsonl) : null
      return {
        id,
        cwd: liveEntry?.cwd ?? hook?.cwd ?? webSessions.get(id) ?? '',
        title: transcript?.title ?? null,
        status: hook?.status ?? 'unknown',
        kind: webSessions.has(id) ? 'web' : 'external',
        isAlive: liveEntry !== undefined || webSessions.has(id),
        lastAt: transcript?.lastAt ?? hook?.updatedAt ?? null,
        lastAssistantText: hook?.lastAssistantText ?? transcript?.lastAssistantText ?? null,
        pendingTool: hook?.pendingTool ?? null,
        ...roleOf(id, teams),
      }
    }),
  )
  return sessions.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}
