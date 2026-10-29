export type SessionStatus = 'working' | 'waiting' | 'my-turn' | 'done' | 'needs-approval' | 'idle' | 'ended' | 'unknown'

/** 근무 = 살아 있는 세션. 휴식 = 호스트·트레이 재시작 중이라 잠깐 꺼진 웹 세션(호스트가 다시 띄운다). 퇴근 = 끝난 웹 세션(다시 출근할 수 있다) */
export type Attendance = 'present' | 'break' | 'off'

export interface OffDuty {
  endedAt: string
  /** exit = 스스로 퇴근, dismissed = 정리됨(종료 버튼), released = 팀장이 정리, error = 오류로 퇴근 */
  reason: 'exit' | 'dismissed' | 'error' | 'released'
  exitCode: number | null
}

export interface Session {
  id: string
  cwd: string
  /** 사용자가 붙인 이름. 화면은 name ?? title ?? id 순 */
  name: string | null
  /** 역할 (`FE`·`Lead` 등). name 에는 역할이 없다. 없으면 칩 없이. 옛 서버 응답에는 빠져 있고 이름 앞 "[역할]" 이 있을 수 있다 — positionOf 로 읽는다 */
  position?: string | null
  title: string | null
  status: SessionStatus
  kind: 'web' | 'external'
  /** attendance === 'present' 와 같다 */
  isAlive: boolean
  /** 휴식·퇴근 세션의 kind 는 web. 옛 서버 응답에는 빠져 있다 — attendanceOf 로 읽는다 */
  attendance?: Attendance
  /** 퇴근 세션만 값이 있다. 옛 서버 응답에는 빠져 있다 */
  offDuty?: OffDuty | null
  /** 세션 생성 시각. 서버가 이것의 오름차순으로 목록을 준다. 모르면 null, 옛 서버 응답에는 빠져 있다 */
  createdAt?: string | null
  lastAt: string | null
  /** 마지막 대화 줄(사람 쪽 user·claude 응답) 시각. 대화가 없으면 null, 옛 서버 응답에는 빠져 있다 (모르는 것으로 본다) */
  turnEndedAt?: string | null
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
  /** 웹 세션이 다음에 뜰 때 쓰는 모델·effort 설정. 칸이 null 이면 설정 없음, 외부 세션은 null. 옛 서버 응답에는 빠져 있다 (현재 모델 기준으로 본다) */
  modelSetting?: { model: string | null; effort: string | null } | null
  /** 다음 차례에 다시 읽을 문맥 크기 (토큰). 모르면 null, 옛 서버 응답에는 빠져 있다 */
  contextTokens?: number | null
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
}

/** 팀 TODO 한 줄. 시각은 ISO */
export interface TeamTodo {
  id: string
  text: string
  isDone: boolean
  createdAt: string
  doneAt: string | null
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
  /** 팀 폴더의 형상관리 (서버가 판정해 주는 파생값. 옛 서버 응답에는 없다) */
  vcs?: { kind: 'git' | 'svn'; root: string } | null
  /** 팀 TODO. 서버 순서 = [할 일(사용자가 정한 순서)…, 완료(완료한 순서, 오래된 것 먼저)…]. 옛 서버 응답은 없다 (teamTodos.ts todosOf) */
  todos?: TeamTodo[]
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

/** 곁가지 질문(btw) 문답 하나 (`GET /api/sessions/:id/btw` 의 items, 오래된 것 먼저). 대화 기록에는 없다 */
export interface BtwItem {
  id: string
  question: string
  status: 'pending' | 'answered' | 'failed'
  /** answered 일 때만 */
  answer: string | null
  /** failed 일 때만 (서버가 만든 영어 문구) */
  error: string | null
  askedAt: string
  answeredAt: string | null
}

export interface ScratchpadListing {
  files: ScratchpadFile[]
  /** 서버 상한(1000개)에서 잘렸는지. 얕은 폴더부터 모은다 */
  isTruncated: boolean
}

/** 세션 작업 폴더(cwd) 한 단계 목록 `GET /api/sessions/:id/tree` (server workspaceFiles.ts 와 손으로 맞춘다) */
export interface WorkspaceEntry {
  name: string
  kind: 'dir' | 'file'
  size: number
  mtime: string
}

export interface WorkspaceFolder {
  /** 폴더 먼저·이름순 */
  entries: WorkspaceEntry[]
  /** 숨긴 폴더(.git·node_modules 등)와 밖을 가리키는 링크 수 */
  hiddenCount: number
  /** 서버 상한(2000개)에서 잘렸는지 */
  isTruncated: boolean
}

/** `GET /api/sessions/:id/file`. euc-kr·utf-8-bom 은 4단계(편집)에서 저장 방식이 달라진다 */
export type WorkspaceFile =
  | {
      kind: 'text'
      text: string
      size: number
      mtime: string
      hash: string
      language: string | null
      encoding: 'utf-8' | 'utf-8-bom' | 'euc-kr'
      /** 이 접속에서 편집할 수 없는 이유 (다른 PC·.git 안·EUC-KR). 되면 null, 옛 서버 응답은 없다 */
      editBlockReason?: string | null
    }
  | { kind: 'binary'; isBinary: true; size: number; mtime: string }
  | { kind: 'too-large'; isTooLarge: true; size: number; mtime: string }

/** `GET /api/sessions/:id/find?q=` */
export interface WorkspaceFindResult {
  paths: string[]
  total: number
  /** 파일 수·시간 상한에 걸려 폴더를 다 훑지 못했다 */
  isIndexPartial: boolean
  fileCount: number
  elapsedMs: number
}

/** 내용 찾기 결과 한 줄. text 는 원래 줄의 column 번째 글자부터(긴 줄은 맞은 곳 근처 300자), ranges 는 text 안 [시작, 끝) */
export interface WorkspaceSearchLine {
  line: number
  column: number
  text: string
  ranges: [number, number][]
  /** 줄이 text 뒤로 더 있다 */
  hasMoreAfter: boolean
}

export interface WorkspaceSearchFile {
  path: string
  matchCount: number
  matches: WorkspaceSearchLine[]
}

/** `GET /api/sessions/:id/search?q=&case=&word=&regex=` (server workspaceSearch.ts 와 손으로 맞춘다) */
export interface WorkspaceSearchResult {
  /** 경로순 */
  files: WorkspaceSearchFile[]
  matchCount: number
  /** 맞은 곳이 있는 파일 수 */
  fileCount: number
  /** 실제로 찾아 본 파일 수 (1MB 넘는 것·바이너리 제외) */
  searchedFileCount: number
  /** 맞은 곳 2,000개·5초 상한에서 멈췄다 */
  isTruncated: boolean
  /** 파일 목록이 5만 개·3초 상한에서 멈췄다 (빠른 찾기와 같은 목록) */
  isIndexPartial: boolean
  elapsedMs: number
}

/** 변경 파일 상태 (HEAD·BASE 대비 작업 트리). missing = SVN 에서 svn delete 없이 지운 파일 */
export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'missing'

export interface ChangedFile {
  /** 세션 cwd 상대 (구분자 `/`) */
  path: string
  status: ChangeStatus
  /** 이름 바뀜의 옛 경로 (cwd 밖이면 `../` 로 시작) */
  oldPath: string | null
}

/** `GET /api/sessions/:id/changes` */
export type WorkspaceChanges =
  | { kind: 'none' }
  | { kind: 'git' | 'svn'; branch: string | null; files: ChangedFile[]; isTruncated: boolean; hiddenCount: number; error: string | null }

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
  oldLine: number | null
  newLine: number | null
  hasNoNewline?: boolean
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** `GET /api/sessions/:id/changes/diff?path=` */
export interface WorkspaceDiff {
  kind: 'diff' | 'binary' | 'too-large' | 'empty'
  path: string
  status: ChangeStatus
  oldPath: string | null
  hunks: DiffHunk[]
  encoding: 'utf-8' | 'euc-kr' | null
  hasPropertyChanges: boolean
}

/** 출근 상태. attendance 가 없는 옛 서버 응답은 isAlive 로 본다 (끝난 세션은 퇴근. 다시 출근·기록 지우기는 못 한다) */
export function attendanceOf(session: Session): Attendance {
  return session.attendance ?? (session.isAlive ? 'present' : 'off')
}

export const statusLabel: Record<SessionStatus, string> = {
  working: 'Working',
  waiting: 'Waiting',
  'my-turn': 'Your turn',
  done: 'Done',
  'needs-approval': 'Needs approval',
  idle: 'Idle',
  ended: 'Ended',
  unknown: 'Unknown',
}

/** 그 시각(퇴근·마지막 대화)부터 지금까지를 "just now"·"5m ago"·"3h ago"·"2d ago" 로 */
export function formatAgo(iso: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

/** 툴팁의 날짜·시각 "Oct 23, 2026, 21:00:05" (이 PC 시각) */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

export interface OffDutyLabel {
  text: string
  /** 오류로 퇴근. 빨강 */
  isError: boolean
  /** 툴팁: 퇴근 시각 */
  title: string
}

/** 퇴근 이유 · 시각 "Left · just now"·"Ended · 3h ago"·"Released by lead · 10m ago"·"Exited with error (code 1) · 2d ago" (목록 Off Duty 줄·퇴근 막대·사무실 퇴근 거리 카드) */
export function offDutyLabel(offDuty: OffDuty, now: number): OffDutyLabel {
  const isError = offDuty.reason === 'error'
  const reason = isError
    ? offDuty.exitCode === null
      ? 'Exited with error'
      : `Exited with error (code ${offDuty.exitCode})`
    : offDuty.reason === 'dismissed'
      ? 'Ended'
      : offDuty.reason === 'released'
        ? 'Released by lead'
        : 'Left'
  return { text: `${reason} · ${formatAgo(offDuty.endedAt, now)}`, isError, title: formatDateTime(offDuty.endedAt) }
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

/** 이 PC 에 저장된 Claude 계정 하나 (`GET /api/accounts`). 토큰은 오지 않는다. 서버와 손으로 맞춘다 */
export interface Account {
  id: string
  email: string | null
  displayName: string | null
  organizationName: string | null
  /** 사용량 응답의 plan 과 같은 꼴 (예 `max 5x`) */
  plan: string | null
  /** 지금 이 PC 의 claude 가 쓰는 계정 */
  isActive: boolean
  /** 이 시각이 지나면 다시 로그인해야 한다. 모르면 null */
  refreshExpiresAt: string | null
  savedAt: string
}

export interface AccountsResponse {
  accounts: Account[]
  activeId: string | null
}

/** 계정을 바꾸면 영향을 받는 세션 하나 (`GET /api/accounts/switch-impact`). 서버 switchImpact.ts 와 손으로 맞춘다 */
export interface ImpactSession {
  id: string
  name: string
  kind: 'web' | 'external'
  status: SessionStatus
  /** 차례가 끝난 뒤 지난 분. 모르면 null */
  minutesSinceTurn: number | null
  /** 다음 차례에 다시 읽을 문맥 크기. 모르면 null */
  contextTokens: number | null
}

export interface SwitchImpact {
  /** 최근 1시간 안에 대화했거나 지금 작업 중인 근무 세션. contextTokens 큰 순 */
  recentSessions: ImpactSession[]
  totalContextTokens: number
  /** 지금 작업 중·승인 대기인 근무 세션 (웹·외부) */
  busySessions: ImpactSession[]
}

/** `POST /api/accounts/:id/switch`. hasBusyWebSessions = 전환을 마친 뒤 서버가 다시 센, 작업 중·승인 대기인 웹 세션이 있는지 (옛 서버는 없음) */
export interface SwitchResponse {
  account: Account
  hasBusyWebSessions?: boolean
}

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

/** 팀 머리줄 형상관리 칩의 툴팁·aria-label: "Git · <루트 경로>"·"SVN · <루트 경로>" */
export function vcsLabel(vcs: { kind: 'git' | 'svn'; root: string }): string {
  return `${vcs.kind === 'git' ? 'Git' : 'SVN'} · ${vcs.root}`
}
