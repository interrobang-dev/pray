import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Session } from './types.js'
import type { HookState } from './hookState.js'
import { summarizeTranscript } from './transcript.js'
import { readLiveSessions } from './liveSessions.js'
import { partOfSession, roleOf, teamOf, type Team } from '@jk-corp/host/team'

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

export async function listSessions(
  hookStates: Map<string, HookState>,
  webSessions: Map<string, string>,
  teams: Team[] = [],
  names: Record<string, string> = {},
): Promise<Session[]> {
  const live = await readLiveSessions(sessionsDir)
  const ids = new Set<string>([...live.map((s) => s.sessionId), ...hookStates.keys(), ...webSessions.keys()])

  const sessions = await Promise.all(
    [...ids].map(async (id): Promise<Session> => {
      const liveEntry = live.find((s) => s.sessionId === id)
      const hook = hookStates.get(id)
      const jsonl = await findTranscript(id)
      const transcript = jsonl ? summarizeTranscript(jsonl) : null
      const cwd = liveEntry?.cwd ?? hook?.cwd ?? webSessions.get(id) ?? ''
      const isWeb = webSessions.has(id)
      const team = teamOf(cwd, teams)
      const part = partOfSession(id, cwd, team)
      return {
        id,
        cwd,
        name: names[id] ?? null,
        title: transcript?.title ?? null,
        status: hook?.status ?? 'unknown',
        kind: isWeb ? 'web' : 'external',
        isAlive: liveEntry !== undefined || webSessions.has(id),
        lastAt: transcript?.lastAt ?? hook?.updatedAt ?? null,
        lastAssistantText: hook?.lastAssistantText ?? transcript?.lastAssistantText ?? null,
        pendingTool: hook?.pendingTool ?? null,
        workingSince: hook?.workingSince ?? null,
        teamId: team?.id ?? null,
        partId: part?.id ?? null,
        role: roleOf(id, isWeb, team, part),
      }
    }),
  )
  return sessions.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}
