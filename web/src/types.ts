export type SessionStatus = 'working' | 'my-turn' | 'needs-approval' | 'idle' | 'ended' | 'unknown'

export interface Session {
  id: string
  cwd: string
  /** 사용자가 붙인 이름. 화면은 name ?? title ?? id 순 */
  name: string | null
  title: string | null
  status: SessionStatus
  kind: 'web' | 'external'
  isAlive: boolean
  lastAt: string | null
  lastAssistantText: string | null
  /** 마지막 claude 응답의 모델 ID·effort. 응답이 아직 없으면 null. 옛 서버 응답에는 빠져 있다 */
  model?: string | null
  effort?: string | null
  pendingTool: string | null
  /** 이번 차례를 시작한 시각 (훅 상태). 모르면 null. workingSince 가 없는 옛 서버 응답에는 빠져 있다 */
  workingSince: string | null
  /** 팀에 속하면 자기 지휘 단위의 지시자(팀장·파트장)/팀원. 아니면 null */
  role: 'lead' | 'member' | null
  teamId: string | null
  /** 팀 안의 파트. null 이면 팀 직속 */
  partId: string | null
  /** 서버가 이 웹 세션의 AskUserQuestion 훅을 붙잡고 있을 때만 값이 있다. 옛 서버 응답에는 빠져 있다 */
  question?: { questions: AskQuestion[] } | null
}

/** claude 가 AskUserQuestion 으로 묻는 질문 하나. 질문은 1~4개, 선택지는 2~4개 */
export interface AskQuestion {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}

export interface Group {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  waitingNote?: string
}

/** 파트 = 팀 안의 선택적 지휘 단위 (파트장 + 파트 팀원). worktree 가 있으면 그 폴더에서 일한다 */
export interface Part {
  id: string
  name: string
  leadSessionId?: string
  worktree?: { cwd: string; branch: string }
  createdAt: string
}

/** 팀 = 같은 폴더의 세션 묶음. 그룹 안의 책상 섬. 소속은 서버가 cwd 로 판정해 Session.teamId 로 준다 */
export interface Team {
  id: string
  name: string
  cwd: string
  groupId: string
  /** 섬 앵커 (타일) */
  x: number
  y: number
  leadSessionId?: string
  /** 앵커 기준 책상 오프셋. 끌어 놓았을 때만 저장 */
  desks: Record<string, { dx: number; dy: number }>
  /** 없으면 빈 배열. 소속은 서버가 판정해 Session.partId 로 준다 */
  parts: Part[]
  partOf: Record<string, string>
  createdAt: string
}

export interface Office {
  groups: Group[]
  teams: Team[]
}

export interface ToolUse {
  id: string
  name: string
  input: unknown
  result: string | null
  /** 답한 AskUserQuestion 에만 있다: 질문문 → 답 (여러 개 고르기는 ", " 로 이음). 옛 서버 응답·취소에는 없다 */
  answers?: Record<string, string>
}

/** 대화 탭 메시지 (`GET /api/sessions/:id/messages`) */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  timestamp: string
  text: string
  toolUses: ToolUse[]
  /** 서버가 보낸 팀장·파트장 지시인 user 메시지에만 있다. 옛 서버 응답에는 없다 */
  from?: { sessionId: string | null; name: string }
  /** claude 가 작업 중일 때 보내 아직 받아들여지지 않은 user 메시지 (대화 맨 끝). 옛 서버 응답에는 없다 */
  isQueued?: boolean
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
