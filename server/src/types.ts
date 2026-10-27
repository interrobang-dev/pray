import type { SessionCharacter, SessionGender } from '@jk-corp/host/hq'
import type { ModelSetting } from './memberModel.js'

/**
 * 훅 이벤트로 정하는 상태 (hookState.ts). 서버의 다른 판정(대기 취소·중지·모델 변경 409 등)은 이것을 본다.
 * working = 차례 진행 중(UserPromptSubmit·PostToolUse), needs-approval = 승인·질문 대기(PermissionRequest), my-turn = 차례가 끝남(Stop·웹 중지),
 * idle = 세션 시작(SessionStart)·근무 중인데 ended 이고 끝나기 직전이 my-turn 이 아님, ended = 세션 끝(SessionEnd), unknown = 훅을 못 받음
 */
export type HookStatus =
  | 'working'
  | 'my-turn'
  | 'needs-approval'
  | 'idle'
  | 'ended'
  | 'unknown'

/**
 * 세션 목록이 내보내는 표시 상태 (Session.status). 근무 중 세션의 차례가 끝난 상태(훅 my-turn)만 셋으로 가른다 (turnEnd.ts):
 * waiting = 백그라운드 작업(shell·MCP 호출·에이전트)이 끝나기를 기다림, my-turn = 사람의 답이 필요함(물음으로 끝남·중지됨·마지막 말 없음),
 * done = 할 일을 마침 (팀원이 받은 지시를 끝냄 포함). 휴식·퇴근 세션은 훅 상태 그대로다
 */
export type SessionStatus = HookStatus | 'waiting' | 'done'

export interface Session {
  id: string
  cwd: string
  /** 사용자가 붙인 이름 (역할은 넣지 않는다). 화면은 name ?? title ?? id 순 */
  name: string | null
  /** 세션 역할 (FE·BE·Lead 등, hq.json positions). 없으면 null. 지휘 구분 role 과 다른 것. 바꾸기는 PATCH /api/sessions/:id */
  position: string | null
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
  /** 퇴근일 때만. released = 팀장이 정리(jk_dismiss), dismissed = 그 밖의 kill 요청(종료 버튼), exit = 종료 코드 0, error = 그 밖 */
  offDuty: { endedAt: string; reason: 'exit' | 'dismissed' | 'error' | 'released'; exitCode: number | null } | null
  /** 세션 생성 시각 (목록 정렬 기준: 오래된 것 먼저). 웹 세션은 hq 기록의 createdAt, 없으면 jsonl 첫 시각, 둘 다 없으면 null */
  createdAt: string | null
  lastAt: string | null
  /** 마지막 대화 줄(사람 쪽 user·claude 응답) 시각 (jsonl). 대화가 없으면 null. 화면이 차례가 끝나고 오래된 세션을 졸게 그린다 */
  turnEndedAt: string | null
  lastAssistantText: string | null
  /** 마지막 claude 응답(jsonl)의 모델 ID. 응답이 아직 없으면 null */
  model: string | null
  /** 같은 응답의 effort (perTurnEffort → effort 순). 없으면 null */
  effort: string | null
  /**
   * 웹 세션(근무·휴식·퇴근)의 hq 기록 extraArgs 에 든 `--model`·`--effort` 값 = 다음 resume 때 claude 에 넘어가는 것 (없는 칸은 null:
   * 모델은 마지막 응답의 모델, effort 는 사용자 전역 설정). 외부 세션은 null. 바꾸기는 PUT /api/sessions/:id/model
   */
  modelSetting: ModelSetting | null
  /** 다음 차례에 다시 읽을 문맥 크기 (jsonl 마지막 claude 응답 usage. 압축 뒤 다음 응답까지·응답이 없으면 null). 모델을 바꾸면 다음 차례에 이만큼 캐시를 다시 쓴다 */
  contextTokens: number | null
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
  /** 서버가 이름을 지을 때 정한 성별 (hq.json genders). 직접 지은 이름이면 null — 도트 인물을 성별 없이 고른다 */
  gender: SessionGender | null
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
