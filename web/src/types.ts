export type SessionStatus = 'working' | 'my-turn' | 'needs-approval' | 'idle' | 'ended' | 'unknown'

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
  /** 팀에 속하면 팀장/팀원. 아니면 null */
  role: 'lead' | 'member' | null
  teamId: string | null
}

export interface Room {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  waitingNote?: string
}

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

export const statusLabel: Record<SessionStatus, string> = {
  working: '작업중',
  'my-turn': '내 차례',
  'needs-approval': '승인 필요',
  idle: '대기',
  ended: '종료',
  unknown: '알 수 없음',
}

export interface UsageLimit {
  label: string
  percent: number
  resetsAt: string
  severity: string
}

export interface Usage {
  plan: string | null
  limits: UsageLimit[]
  fetchedAt: string
}

export type UsageResult = { ok: true; usage: Usage } | { ok: false; reason: string }
