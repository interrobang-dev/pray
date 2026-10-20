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

/** 팀 = 같은 폴더의 세션 묶음. 방 안의 책상 섬. 소속은 서버가 cwd 로 판정해 Session.teamId 로 준다 */
export interface Team {
  id: string
  name: string
  cwd: string
  roomId: string
  /** 섬 앵커 (타일) */
  x: number
  y: number
  leadSessionId?: string
  /** 앵커 기준 책상 오프셋. 끌어 놓았을 때만 저장 */
  desks: Record<string, { dx: number; dy: number }>
  createdAt: string
}

export interface Office {
  rooms: Room[]
  teams: Team[]
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
