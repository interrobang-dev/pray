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
  /** 사용자가 붙인 이름. 화면은 name ?? title ?? id 순 */
  name: string | null
  title: string | null
  status: SessionStatus
  kind: 'web' | 'external'
  isAlive: boolean
  lastAt: string | null
  lastAssistantText: string | null
  pendingTool: string | null
  /** 이번 차례를 시작한 시각 (훅 상태). 모르면 null */
  workingSince: string | null
  /** 팀에 속하면 자기 지휘 단위의 지시자(팀장·파트장)/팀원. 아니면 null */
  role: 'lead' | 'member' | null
  teamId: string | null
  /** 팀 안의 파트. null 이면 팀 직속 */
  partId: string | null
  /** 서버가 이 세션의 AskUserQuestion 을 붙잡고 있을 때만 있다 (웹 세션만). 답하기는 POST /api/sessions/:id/answer */
  question: { questions: AskQuestion[] } | null
}

/** AskUserQuestion 의 질문 하나 (tool_input.questions[]) */
export interface AskQuestion {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}
