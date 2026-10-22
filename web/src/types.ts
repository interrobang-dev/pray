export type SessionStatus = 'working' | 'my-turn' | 'needs-approval' | 'idle' | 'ended' | 'unknown'

/** 근무 = 살아 있는 세션. 휴식 = 호스트·트레이 재시작 중이라 잠깐 꺼진 웹 세션(호스트가 다시 띄운다). 퇴근 = 끝난 웹 세션(다시 출근할 수 있다) */
export type Attendance = 'present' | 'break' | 'off'

export interface OffDuty {
  endedAt: string
  /** exit = 스스로 퇴근, dismissed = 정리됨(종료 버튼·팀장 정리), error = 오류로 퇴근 */
  reason: 'exit' | 'dismissed' | 'error'
  exitCode: number | null
}

export interface Session {
  id: string
  cwd: string
  /** 사용자가 붙인 이름. 화면은 name ?? title ?? id 순 */
  name: string | null
  title: string | null
  status: SessionStatus
  kind: 'web' | 'external'
  /** attendance === 'present' 와 같다 */
  isAlive: boolean
  /** 휴식·퇴근 세션의 kind 는 web. 옛 서버 응답에는 빠져 있다 — attendanceOf 로 읽는다 */
  attendance?: Attendance
  /** 퇴근 세션만 값이 있다. 옛 서버 응답에는 빠져 있다 */
  offDuty?: OffDuty | null
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
  /** 입력칸에 놓인 Claude Code 다음 입력 제안 (웹 세션만, 세션의 mod 가 서버로 보낸다). 옛 서버 응답에는 빠져 있다 */
  suggestion?: string | null
  /** claude 가 백그라운드로 띄워 아직 실행 중인 Bash 명령. 근무 중이 아니면 [], 옛 서버 응답에는 빠져 있다 (없는 것으로 본다) */
  shells?: Shell[]
  /** 사용자가 고른 도트 사무실 인물. 없으면 null (세션 ID 해시로 고른다). 옛 서버 응답에는 빠져 있다 */
  character?: SessionCharacter | null
  /** 서버가 이름을 지을 때 정한 성별. 직접 지은 이름이면 null (성별 없이 인물을 고른다). 옛 서버 응답에는 빠져 있다 */
  gender?: 'male' | 'female' | null
}

/** 도트 인물 프리셋 id 와 머리·윗옷 색 ('#rrggbb', null = 그 인물 기본색) */
export interface SessionCharacter {
  id: string
  hair: string | null
  top: string | null
}

/** 백그라운드 shell 하나 (Session.shells) */
export interface Shell {
  id: string
  command: string
  description: string | null
  startedAt: string
}

/** shell 출력의 끝부분 (`GET /api/sessions/:id/shells/:shellId/output?lines=`) */
export interface ShellOutput {
  lines: string[]
  /** 출력이 요청한 줄 수보다 길어 마지막 줄들만 왔는지 */
  isTruncated: boolean
  /** 출력 전체 크기 (바이트) */
  size: number
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
  /** 화면은 쓰지 않는다 (그룹 크기는 안의 팀 섬으로 정한다) */
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
  /** 예전 책상 끌기의 기록 (앵커 기준 오프셋). 화면은 읽지 않는다 — 책상은 인원으로 자동 배치 */
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
  /** Claude Code 가 대화를 압축하며 남긴 요약 (role system, text 는 요약 원문). 옛 서버 응답에는 없다 */
  isCompactSummary?: true
  /** 작업을 중지(Esc)해 Claude Code 가 남긴 "[Request interrupted by user]" 줄 (role system, text 는 원문). 옛 서버 응답에는 없다 */
  isInterrupt?: true
}

/** 세션 작업 폴더(scratchpad)의 파일 하나 (`GET /api/sessions/:id/files`) */
export interface ScratchpadFile {
  /** scratchpad 기준 상대 경로. 구분자는 `/` */
  path: string
  size: number
  modifiedAt: string
}

export interface ScratchpadListing {
  files: ScratchpadFile[]
  /** 서버 상한(1000개)에서 잘렸는지. 얕은 폴더부터 모은다 */
  isTruncated: boolean
}

/** 출근 상태. attendance 가 없는 옛 서버 응답은 isAlive 로 본다 (끝난 세션은 퇴근. 다시 출근·기록 지우기는 못 한다) */
export function attendanceOf(session: Session): Attendance {
  return session.attendance ?? (session.isAlive ? 'present' : 'off')
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
  kind: string
  model: string | null
  percent: number
  resetsAt: string
  severity: string
}

export interface Usage {
  plan: string | null
  /** 로그인된 Claude 계정 이메일. 못 읽으면 null, 옛 서버 응답에는 빠져 있다 */
  email?: string | null
  limits: UsageLimit[]
  fetchedAt: string
}

export type UsageResult = { ok: true; usage: Usage } | { ok: false; reason: string }

/** 플로우(flow.team) 안 읽은 수 (`GET /api/flow`, 전역 SSE `flow`). 서버 flow.ts 와 손으로 맞춘다 */
export interface FlowStatus {
  /** 키 파일에 FLOW_API_KEY 가 있는지. 서버가 막 떠 아직 확인 전이면 true (수는 null 이라 "…") */
  isConfigured: boolean
  /** 안 읽은 알림 수. 한 번도 못 셌으면 null */
  unreadAlarmCount: number | null
  /** 채팅방 안 읽은 메시지 수 합계. 한 번도 못 셌으면 null */
  unreadChatCount: number | null
  checkedAt: string | null
  /** 마지막 확인이 실패했으면 그 이유 (수는 그 전 성공 값 그대로) */
  error: string | null
}

/** 플로우 알림 하나 (`GET /api/flow/alarms`) */
export interface FlowAlarm {
  alarmId: string
  projectId: string
  /** 참여 프로젝트 목록에 없으면 null */
  projectName: string | null
  postId: string
  /** 댓글 알림이 아니면 "-1" */
  remarkId: string
  /** 답글 알림이 아니면 "-1" */
  replyId: string
  registerId: string
  registerName: string
  /** 플로우 원본 YYYYMMDDHHmmss (한국 시각) */
  registeredDateTime: string
  /** 같은 시각의 ISO 8601 (`+09:00`). 꼴이 틀리면 null */
  registeredAt: string | null
  message: string | null
  content: string
  isRead: boolean
  isMention: boolean
  isWorker: boolean
  isRegistrant: boolean
}

export interface FlowAlarmPage {
  alarms: FlowAlarm[]
  hasNext: boolean
  /** 다음 쪽을 받을 cursor. 마지막 쪽이면 null */
  nextCursor: string | null
}
