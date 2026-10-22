import type { SessionCharacter } from '@jk-corp/host/hq'

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
  /**
   * 근무(present) = pid 기록 또는 호스트 목록에 있음. 휴식(break) = hq.json webSessions 에 있는데 프로세스 없음 (호스트가 다시 뜨면 저절로 돌아옴).
   * 퇴근(off) = 끝난 웹 세션 (hq.json offDuty). POST /api/sessions/:id/resume 로 다시 출근, DELETE /api/sessions/:id/off-duty 로 목록에서 지움
   */
  attendance: 'present' | 'break' | 'off'
  /** attendance === 'present' 와 같은 뜻 */
  isAlive: boolean
  /** 퇴근일 때만. dismissed = kill 요청(정리됨), exit = 종료 코드 0, error = 그 밖 */
  offDuty: { endedAt: string; reason: 'exit' | 'dismissed' | 'error'; exitCode: number | null } | null
  lastAt: string | null
  lastAssistantText: string | null
  /** 마지막 claude 응답(jsonl)의 모델 ID. 응답이 아직 없으면 null */
  model: string | null
  /** 같은 응답의 effort (perTurnEffort → effort 순). 없으면 null */
  effort: string | null
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
  /** 입력칸에 놓인 Claude Code 다음 입력 제안 (웹 세션의 mod 가 POST /api/hook/suggestion 으로 보낸다). 웹 세션이 아니거나 없으면 null */
  suggestion: string | null
  /** claude 가 백그라운드로 돌리고 있는 shell (시작 순). 근무 중이 아니면 []. 출력은 GET /api/sessions/:id/shells/:shellId/output */
  shells: Shell[]
  /** 사용자가 고른 도트 사무실 인물 (hq.json characters). 없으면 null — 화면이 세션 ID 해시로 고른다. 바꾸기는 PUT /api/sessions/:id/character */
  character: SessionCharacter | null
}

/** 백그라운드 shell (Bash·PowerShell 의 run_in_background, 시간 초과로 백그라운드로 넘어간 것 포함) */
export interface Shell {
  /** Claude Code 의 작업 ID (예: bx2ec6656) */
  id: string
  command: string
  /** 도구 입력의 description. 없으면 null */
  description: string | null
  /** 도구를 부른 시각 (ISO) */
  startedAt: string
}

/** AskUserQuestion 의 질문 하나 (tool_input.questions[]) */
export interface AskQuestion {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}
