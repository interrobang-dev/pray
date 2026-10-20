export type SessionStatus =
  | 'working'
  | 'my-turn'
  | 'needs-approval'
  | 'idle'
  | 'ended'
  | 'unknown'

export interface Session {
  id: string
  cwd: string
  title: string | null
  status: SessionStatus
  kind: 'web' | 'external'
  isAlive: boolean
  lastAt: string | null
  lastAssistantText: string | null
  pendingTool: string | null
}
