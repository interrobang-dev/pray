import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Terminal } from './Terminal'
import { Chat, type Jump, type JumpTarget } from './Chat'
import { Office, type OfficeFocus, type OfficeStyle } from './Office'
import { layoutOffice, spotForNewGroup, spotForNewTeam } from './officeLayout'
import { UsagePanel } from './UsagePanel'
import { ShellsStatus, shellLines, type ShellRequest } from './Shells'
import { FlowPanel } from './FlowPanel'
import { Modal, Segmented } from './Modal'
import {
  attendanceOf,
  statusLabel,
  type FlowStatus,
  type Office as OfficeData,
  type Group,
  type OffDuty,
  type Part,
  type Session,
  type SessionStatus,
  type Shell,
  type Team,
} from './types'
import { avatarOf, cssColor } from './avatar'
import { setThemeChoice, themeChoice, type ThemeChoice } from './theme'

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
}

const EMPTY_OFFICE: OfficeData = { groups: [], teams: [] }

/** 이 폭 이하는 폰 화면: 한 열(목록 ↔ 패널)이고 사무실을 마운트하지 않는다. style.css 의 @media 와 같은 값 */
const NARROW_QUERY = '(max-width: 768px)'

/** 사무실 숨기기 여부를 남기는 localStorage 키 (이 브라우저만) */
const OFFICE_HIDDEN_KEY = 'jk-corp.isOfficeHidden'

/** 저장된 사무실 숨기기 여부. 읽지 못하면(저장소가 막힌 브라우저 등) 보이기 */
function readIsOfficeHidden(): boolean {
  try {
    return localStorage.getItem(OFFICE_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

/** 사무실 그림 방식(클래식·도트)을 남기는 localStorage 키 (이 브라우저만) */
const OFFICE_STYLE_KEY = 'jk-corp.officeStyle'
const OFFICE_STYLE_LABELS: Record<OfficeStyle, string> = { classic: '클래식', dot: '도트' }

/** 저장된 사무실 그림 방식. 읽지 못하거나 모르는 값이면 클래식 */
function readOfficeStyle(): OfficeStyle {
  try {
    return localStorage.getItem(OFFICE_STYLE_KEY) === 'dot' ? 'dot' : 'classic'
  } catch {
    return 'classic'
  }
}

/** 헤더 테마 버튼: 누를 때마다 라이트 → 다크 → 시스템 */
const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' }
const THEME_LABELS: Record<ThemeChoice, string> = { light: '라이트', dark: '다크', system: '시스템' }

/** 세션 API 가 그 폴더를 ~/.claude.json 에 신뢰로 기록하지 못했을 때 (isTrustFailed) */
const SESSION_TRUST_FAILED_MESSAGE =
  '신뢰 표시를 남기지 못했습니다. 이 폴더에서 처음 뜨는 세션이면 터미널 탭에서 신뢰를 직접 허용해야 합니다 (기본 선택 "No, exit" 를 그대로 두면 세션이 꺼집니다).'

/** 세션 추가 모달이 미리 채우는 이름 "[역할] 성" 의 역할 (사용자 확정). 팀장·파트장 모두 Lead */
const MEMBER_ROLE_TAG = 'Dev'
const LEAD_ROLE_TAG = 'Lead'

/** "[역할] 성" 의 역할 부분만 바꾼다 (성은 그대로) */
function withRoleTag(name: string, roleTag: string): string {
  return name.replace(/^\[[^\]]*\]/, `[${roleTag}]`)
}

/** 미디어 쿼리 일치 여부. 창 폭이 바뀌면 따라간다 */
function useMediaQuery(query: string): boolean {
  const [isMatched, setIsMatched] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setIsMatched(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return isMatched
}

/** 화면에 쓰는 세션 이름: 사용자 지정 → 자동 제목 → ID 앞 8자리 */
function displayName(session: Session): string {
  return session.name ?? session.title ?? session.id.slice(0, 8)
}

/** 모델 ID → 짧은 이름. claude-<이름>-<주>-<부> 는 "Opus 5.5" 꼴로, 모르는 꼴은 ID 그대로 (날짜가 붙은 옛 ID 가 "Opus 4.20250514" 가 되지 않게 버전은 두 자리까지) */
function modelName(model: string): string {
  const match = model.match(/^claude-([a-z]+)-(\d{1,2})-(\d{1,2})$/)
  if (!match) return model
  const [, name, major, minor] = match
  return `${name[0].toUpperCase()}${name.slice(1)} ${major}.${minor}`
}

/** 목록·패널의 "Opus 5.5 · xhigh". 모델을 모르면 null, effort 가 없으면 모델만 */
function modelLabel(session: Session): string | null {
  if (!session.model) return null
  return session.effort ? `${modelName(session.model)} · ${session.effort}` : modelName(session.model)
}

/** 마지막 활동부터 지금까지를 "now"·"3m"·"2h"·"1d" 처럼 단위 하나로. 15분 미만은 recent, 2시간 초과는 stale */
function formatElapsed(iso: string | null, now: number): { text: string; className: string; title: string } {
  if (!iso) return { text: '-', className: '', title: '' }
  const date = new Date(iso)
  const minutes = Math.floor(Math.max(0, now - date.getTime()) / 60_000)
  const text =
    minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
  const className = minutes < 15 ? 'recent' : minutes > 120 ? 'stale' : ''
  return { text, className, title: date.toLocaleString('ko-KR') }
}

/** 퇴근 시각부터 지금까지를 "방금"·"5분 전"·"3시간 전"·"2일 전" 으로 */
function formatAgo(iso: string, now: number): string {
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`
  return `${Math.floor(minutes / 1440)}일 전`
}

interface OffDutyLabel {
  text: string
  /** 오류로 퇴근. 빨강 */
  isError: boolean
  /** 툴팁: 퇴근 시각 */
  title: string
}

/** 퇴근 이유 · 시각 "퇴근 · 방금"·"정리됨 · 3시간 전"·"오류로 퇴근 (코드 1) · 2일 전" */
function offDutyLabel(offDuty: OffDuty, now: number): OffDutyLabel {
  const isError = offDuty.reason === 'error'
  const reason = isError
    ? offDuty.exitCode === null
      ? '오류로 퇴근'
      : `오류로 퇴근 (코드 ${offDuty.exitCode})`
    : offDuty.reason === 'dismissed'
      ? '정리됨'
      : '퇴근'
  return { text: `${reason} · ${formatAgo(offDuty.endedAt, now)}`, isError, title: new Date(offDuty.endedAt).toLocaleString('ko-KR') }
}

/** 팀 카드 안 세션 줄의 정렬 순위. 작을수록 위. 승인 대기 → 내 차례 → 작업 중 → 나머지 (팀장도 상태로만 정렬) */
const statusOrder: Record<SessionStatus, number> = {
  'needs-approval': 0,
  'my-turn': 1,
  working: 2,
  idle: 3,
  unknown: 3,
  ended: 3,
}

async function postJson(url: string, method: string, body: unknown): Promise<Response> {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

/** 점프(팀장 대화의 지시·보고 한 줄)로 연 세션에서 돌아갈 곳: 팀장 대화와 그때 누른 한 줄 */
interface JumpBack {
  /** 점프로 연 세션. 이 세션 패널에만 돌아가기 버튼이 보인다 */
  toSessionId: string
  fromSessionId: string
  /** 점프할 때의 팀장 이름. 팀장이 아직 목록에 있으면 지금 이름을 쓴다 */
  fromName: string
  rowKey: string
}

/** 목록 끌어 놓기의 범위: 그룹끼리, 또는 한 그룹 안의 팀끼리 (다른 그룹으로 옮기기는 사무실에서 섬을 끌어서) */
type ReorderScope = { kind: 'group' } | { kind: 'team'; groupId: string }

/** 끌기로 보는 최소 이동 (px). 이보다 덜 움직이고 놓으면 그냥 클릭이다 */
const DRAG_THRESHOLD_PX = 5
/** 끄는 동안 목록 위·아래 끝에서 이 거리 안이면 목록을 스크롤한다 */
const AUTO_SCROLL_EDGE_PX = 40
/** 끝에 바짝 붙었을 때 한 프레임에 스크롤하는 양 (px) */
const AUTO_SCROLL_MAX_PX = 14

function isSameScope(a: ReorderScope, b: ReorderScope): boolean {
  return a.kind === 'group' ? b.kind === 'group' : b.kind === 'team' && a.groupId === b.groupId
}

/** items 중 isTarget 인 것들이 차지한 자리에 ids 순서대로 다시 넣는다 (서버 hq.ts reorderSlots 와 같은 규칙). 집합이 다르면 그대로 둔다 */
function reorderSlots<T extends { id: string }>(items: T[], ids: string[], isTarget: (item: T) => boolean): T[] {
  const byId = new Map(items.filter(isTarget).map((item) => [item.id, item]))
  if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return items
  let next = 0
  return items.map((item) => (isTarget(item) ? byId.get(ids[next++])! : item))
}

function applyOrder(office: OfficeData, scope: ReorderScope, ids: string[]): OfficeData {
  return scope.kind === 'group'
    ? { ...office, groups: reorderSlots(office.groups, ids, () => true) }
    : { ...office, teams: reorderSlots(office.teams, ids, (t) => t.groupId === scope.groupId) }
}

/** ids 에서 id 를 빼 dropIndex(원래 목록에서 이 순번 앞) 자리에 넣은 새 순서 */
function moveTo(ids: string[], id: string, dropIndex: number): string[] {
  const rest = ids.filter((other) => other !== id)
  rest.splice(dropIndex > ids.indexOf(id) ? dropIndex - 1 : dropIndex, 0, id)
  return rest
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ isHostReachable: false, sessions: [] })
  const [office, setOffice] = useState<OfficeData>(EMPTY_OFFICE)
  const [isConnected, setIsConnected] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 오른쪽 패널 자리에 플로우 알림 패널을 열었는지. 세션 패널과 같은 자리라 세션을 고르면 닫힌다 */
  const [isFlowOpen, setIsFlowOpen] = useState(false)
  /** 플로우 안 읽은 수 (전역 SSE flow). 아직 못 받았으면(flow 를 모르는 옛 서버 포함) null */
  const [flowStatus, setFlowStatus] = useState<FlowStatus | null>(null)
  const [isGroupForm, setIsGroupForm] = useState(false)
  /** 팀 추가 모달. 그룹 헤더의 "+ 팀" 으로 열리며 그 그룹에 고정 */
  const [teamForm, setTeamForm] = useState<{ groupId: string } | null>(null)
  /** 세션 추가 모달. 팀 헤더의 "+" 면 그 팀 직속, 파트 소제목의 "+" 면 그 파트, 툴바의 "New Session" 이면 로비(폴더 직접 입력) */
  const [sessionForm, setSessionForm] = useState<{ teamId: string | null; partId: string | null } | null>(null)
  const [sessionRole, setSessionRole] = useState<'member' | 'lead'>('member')
  /** 팀·파트 세션 추가 모달에 미리 채울 이름. 서버가 성을 고른 "[Dev] 성" 이고, 보일 때는 세그먼트에 맞춰 역할만 바꾼다 */
  const [suggestedSessionName, setSuggestedSessionName] = useState<string | null>(null)
  /** 사용자가 이름 칸에 직접 쓴 값. null 이면 아직 안 고쳤다 — 고친 뒤로는 미리 채운 이름·세그먼트로 바꾸지 않는다 */
  const [typedSessionName, setTypedSessionName] = useState<string | null>(null)
  /** 파트 추가 모달. 팀 "⋯" 의 "파트 추가" 로 열린다 */
  const [partForm, setPartForm] = useState<{ teamId: string } | null>(null)
  const [partLocation, setPartLocation] = useState<'folder' | 'worktree'>('folder')
  const [isPartLeadSpawned, setIsPartLeadSpawned] = useState(true)
  /** 이름 변경 모달의 대상 세션 */
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  /** 고른 세션의 대화에서 찾아 갈 곳. Chat 이 그 세션 대화를 불러온 뒤 처리하고 비운다 */
  const [jump, setJump] = useState<(Jump & { sessionId: string }) | null>(null)
  /** 점프로 연 세션의 "← 팀장 대화로". 다른 세션을 직접 고르면 사라진다 */
  const [jumpBack, setJumpBack] = useState<JumpBack | null>(null)
  const nextJumpIdRef = useRef(1)
  /** 상태 표시줄 Shells 창에서 고른 shell. 그 세션 대화의 ShellsButton 이 그 shell 을 고른 채 모달을 연 뒤 비운다 */
  const [shellRequest, setShellRequest] = useState<(ShellRequest & { sessionId: string }) | null>(null)
  const nextShellRequestIdRef = useRef(1)
  /** 사무실 화면이 이동해 보여 줄 팀·세션. 목록 팀 이름 클릭·세션 선택(사무실 책상 클릭 제외) 때마다 새 id 로 넘긴다 */
  const [officeFocus, setOfficeFocus] = useState<OfficeFocus | null>(null)
  const nextFocusIdRef = useRef(1)
  const [transcriptVersions, setTranscriptVersions] = useState<Record<string, number>>({})
  /** 목록 맨 아래 "Off Duty" 구역을 펼쳤는지. 기본 접힘 */
  const [isOffDutyOpen, setIsOffDutyOpen] = useState(false)
  /** [다시 출근] 이 받아들여져 근무로 바뀌기를 기다리는 세션 ID → 그때의 퇴근 시각 (다시 퇴근하면 시각이 바뀐다). 기다리는 동안 패널이 "출근 중…" */
  const [returningSessions, setReturningSessions] = useState<Record<string, string>>({})
  /** 목록의 경과 시간을 1분마다 다시 계산하기 위한 현재 시각 */
  const [now, setNow] = useState(() => Date.now())
  /**
   * 목록에서 끌고 있는 그룹·팀과 놓일 자리 (끌기로 판정된 뒤에만).
   * dropIndex 는 형제 목록에서 이 순번 앞(길이면 맨 끝)이고, 놓아도 순서가 그대로인 자리면 null (선을 안 그린다)
   */
  const [reorderDrag, setReorderDrag] = useState<{ scope: ReorderScope; id: string; dropIndex: number | null } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const isNarrow = useMediaQuery(NARROW_QUERY)
  /** 헤더 버튼으로 사무실을 숨겼는지 (localStorage). 폰 폭은 원래 사무실이 없어 이 값과 무관하다 */
  const [isOfficeHidden, setIsOfficeHidden] = useState(readIsOfficeHidden)
  /** 사무실 그림 방식 (localStorage). 헤더 버튼으로 바꾼다 */
  const [officeStyle, setOfficeStyle] = useState<OfficeStyle>(readOfficeStyle)
  /** 데스크톱에서 사무실을 숨긴 화면: 패널이 목록 오른쪽 폭을 다 쓰고, 세션을 안 골랐으면 그 자리에 안내 */
  const isOfficeHiddenLayout = !isNarrow && isOfficeHidden
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    fetch('/api/office')
      .then((r) => r.json())
      .then(setOffice)
    const source = new EventSource('/api/events')
    source.addEventListener('sessions', (event) => {
      setSnapshot(JSON.parse((event as MessageEvent).data))
      setIsConnected(true)
    })
    source.addEventListener('office', (event) => setOffice(JSON.parse((event as MessageEvent).data)))
    source.addEventListener('flow', (event) => setFlowStatus(JSON.parse((event as MessageEvent).data)))
    source.addEventListener('transcript', (event) => {
      const { sessionId } = JSON.parse((event as MessageEvent).data) as { sessionId: string }
      setTranscriptVersions((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }))
    })
    source.onerror = () => setIsConnected(false)
    return () => source.close()
  }, [])

  // 팀·파트 세션 추가 모달이 열리면 서버에 이름을 추천받는다. 실패하면 빈 칸 그대로
  useEffect(() => {
    if (!sessionForm?.teamId) return
    let isCancelled = false
    const query = new URLSearchParams({ role: MEMBER_ROLE_TAG })
    if (sessionForm.partId) query.set('partId', sessionForm.partId)
    fetch(`/api/team/${sessionForm.teamId}/member-name?${query}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ name: string }>) : null))
      .then((data) => {
        if (!isCancelled && data) setSuggestedSessionName(data.name)
      })
      .catch(() => {})
    return () => {
      isCancelled = true
    }
  }, [sessionForm])

  // 다시 출근을 기다리던 세션이 근무로 바뀌었거나, 다시 퇴근했거나(퇴근 시각이 바뀜), 목록에서 빠지면 기다림을 끝낸다
  useEffect(() => {
    setReturningSessions((prev) => {
      const ids = Object.keys(prev).filter((id) => {
        const session = snapshot.sessions.find((s) => s.id === id)
        return session && attendanceOf(session) !== 'present' && (session.offDuty?.endedAt ?? prev[id]) === prev[id]
      })
      return ids.length === Object.keys(prev).length ? prev : Object.fromEntries(ids.map((id) => [id, prev[id]]))
    })
  }, [snapshot])

  const selected = snapshot.sessions.find((s) => s.id === selectedId) ?? null
  const isSelectedPresent = selected !== null && attendanceOf(selected) === 'present'
  /** 근무 중인 웹 세션. 터미널·입력·승인·종료는 이때만 (휴식·퇴근 세션 pty 에 키·resize 를 보내지 않게) */
  const isSelectedLiveWeb = isSelectedPresent && selected.kind === 'web'
  /** 터미널을 못 여는 세션이면 보던 탭이 터미널이어도 대화 */
  const shownTab = isSelectedLiveWeb ? tab : 'chat'

  /**
   * 세션을 고른다. 다른 세션이면 대화 탭으로 연다 (같은 세션을 다시 누르면 보던 탭 그대로).
   * 탭과 선택을 한 번에 바꾼다 — 따로 바꾸면 새 세션의 터미널이 잠깐 붙어 그 pty 크기를 바꾼다.
   * 다른 세션을 직접 고르면 점프·돌아가기는 끝난다. 목록·상태 표시줄에서 고르면 사무실 화면도 그 책상으로 옮긴다
   */
  function selectSession(sessionId: string, isOfficeFocused = true) {
    if (sessionId !== selectedId) {
      setTab('chat')
      setJump(null)
      setJumpBack(null)
    }
    setIsFlowOpen(false)
    setSelectedId(sessionId)
    if (isOfficeFocused && !isNarrow && !isOfficeHidden) {
      setOfficeFocus({ id: nextFocusIdRef.current++, kind: 'session', sessionId })
    }
  }

  function focusTeam(teamId: string) {
    if (isNarrow || isOfficeHidden) return
    setOfficeFocus({ id: nextFocusIdRef.current++, kind: 'team', teamId })
  }

  /** 오른쪽 패널을 플로우 알림으로 바꾼다. 세션 선택은 닫힌다 (다시 고르면 대화 탭부터, 점프·돌아가기도 끝) */
  function openFlow() {
    setSelectedId(null)
    setIsFlowOpen(true)
  }

  /** 세션의 대화 탭을 열고 target 으로 간다 (점프·돌아가기) */
  function openJump(sessionId: string, target: JumpTarget) {
    setTab('chat')
    setIsFlowOpen(false)
    setSelectedId(sessionId)
    setJump({ id: nextJumpIdRef.current++, sessionId, target })
  }

  /** 팀장 대화의 지시·보고 한 줄을 눌렀다: 그 팀원 대화의 그 메시지로 가고, 돌아올 곳으로 지금 세션과 그 줄을 둔다 */
  function openRelay(memberSessionId: string, target: JumpTarget, rowKey: string) {
    if (!selected) return
    openJump(memberSessionId, target)
    setJumpBack({ toSessionId: memberSessionId, fromSessionId: selected.id, fromName: displayName(selected), rowKey })
  }

  /** 상태 표시줄 Shells 창의 줄을 눌렀다: 그 세션을 대화 탭으로 열고(shell 버튼은 대화 탭에만 있다) shell 모달을 그 shell 을 고른 채 연다 */
  function openShell(sessionId: string, shell: Shell) {
    selectSession(sessionId)
    setTab('chat')
    setShellRequest({ id: nextShellRequestIdRef.current++, sessionId, shell })
  }

  /** 돌아가기: 팀장 대화를 다시 열고 점프할 때 누른 그 한 줄로 간다 */
  function returnFromJump() {
    if (!jumpBack) return
    openJump(jumpBack.fromSessionId, { kind: 'row', rowKey: jumpBack.rowKey })
    setJumpBack(null)
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionForm) return
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/sessions', 'POST', {
      cwd: sessionForm.teamId ? undefined : form.get('cwd'),
      teamId: sessionForm.teamId ?? undefined,
      partId: sessionForm.partId ?? undefined,
      name: form.get('name'),
      isLead: Boolean(sessionForm.teamId) && sessionRole === 'lead',
    })
    if (!response.ok) {
      alert((await response.json()).message ?? '생성 실패')
      return
    }
    const { sessionId, isTrustFailed } = (await response.json()) as { sessionId: string; isTrustFailed?: boolean }
    selectSession(sessionId, false)
    setSessionForm(null)
    if (isTrustFailed) alert(SESSION_TRUST_FAILED_MESSAGE)
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!teamForm) return
    const form = new FormData(event.currentTarget)
    // 섬 크기는 화면 배치에서 정해져서 빈 자리도 화면이 찾아 넘긴다 (사무실을 안 띄운 폰에서도 같은 배치로)
    const anchor = spotForNewTeam(layoutOffice(office, snapshot.sessions), teamForm.groupId)
    const response = await postJson('/api/team', 'POST', { name: form.get('name'), cwd: form.get('cwd'), groupId: teamForm.groupId, ...anchor })
    if (!response.ok) {
      alert((await response.json()).message ?? '팀 생성 실패')
      return
    }
    setTeamForm(null)
  }

  /** 파트를 만들고, 고르면 그 파트의 파트장을 바로 띄운다 (파트 API 와 세션 API 두 번 호출) */
  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!partForm) return
    const form = new FormData(event.currentTarget)
    const isWorktree = partLocation === 'worktree'
    const response = await postJson(`/api/team/${partForm.teamId}/parts`, 'POST', { name: form.get('name'), isWorktree })
    if (!response.ok) {
      alert((await response.json()).message ?? '파트 생성 실패')
      return
    }
    const { part, isTrusted, isLinked } = (await response.json()) as { part: Part; isTrusted: boolean; isLinked?: boolean }
    if (isWorktree && !isTrusted) alert(`신뢰 표시를 남기지 못했습니다. 이 폴더에서 처음 뜨는 세션은 터미널에서 신뢰를 직접 허용해야 합니다.\n${part.worktree?.cwd}`)
    if (isLinked) alert(`이미 있던 worktree·브랜치 ${part.worktree?.branch} 로 연결했습니다 (현재 HEAD 에서 새로 만들지 않음).\n${part.worktree?.cwd}`)
    setPartForm(null)
    if (!isPartLeadSpawned) return
    // 세션 추가 모달의 파트장과 같은 "[Lead] 성". 추천을 못 받으면 이름 없이 (자동 제목)
    const leadQuery = new URLSearchParams({ role: LEAD_ROLE_TAG, partId: part.id })
    const leadName = await fetch(`/api/team/${partForm.teamId}/member-name?${leadQuery}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ name: string }>) : null))
      .then((data) => data?.name)
      .catch(() => undefined)
    const leadResponse = await postJson('/api/sessions', 'POST', {
      teamId: partForm.teamId,
      partId: part.id,
      isLead: true,
      name: leadName,
    })
    if (!leadResponse.ok) {
      alert((await leadResponse.json()).message ?? '파트장 생성 실패')
      return
    }
    const { sessionId, isTrustFailed } = (await leadResponse.json()) as { sessionId: string; isTrustFailed?: boolean }
    selectSession(sessionId, false)
    // worktree 신뢰 실패는 위에서 이미 알렸다 (같은 폴더라 같은 이유)
    if (isTrustFailed && !(isWorktree && !isTrusted)) alert(SESSION_TRUST_FAILED_MESSAGE)
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const spot = spotForNewGroup(layoutOffice(office, snapshot.sessions))
    const response = await postJson('/api/groups', 'POST', { name: form.get('name'), ...spot })
    if (!response.ok) {
      alert((await response.json()).message ?? '그룹 생성 실패')
      return
    }
    setIsGroupForm(false)
  }

  async function restartHost() {
    if (!confirm('호스트를 재시작하면 웹 세션이 모두 끊깁니다. 다시 뜰 때 --resume 으로 복구됩니다. 재시작할까요?')) return
    const response = await postJson('/api/host/restart', 'POST', {})
    if (!response.ok) alert((await response.json()).message ?? '호스트 재시작 실패')
  }

  async function restartServer() {
    if (
      !confirm(
        '서버를 재시작하면 몇 초 동안 화면이 끊깁니다. 세션은 그대로이고, 상태 표시는 다음 훅부터, 웹에서 받던 질문은 터미널 탭에서 답합니다. 재시작할까요?',
      )
    )
      return
    try {
      const response = await postJson('/api/server/restart', 'POST', {})
      if (response.ok) return
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      alert(`서버 재시작 실패: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      alert('서버 재시작 실패: 네트워크 오류')
    }
  }

  function toggleOffice() {
    const isHidden = !isOfficeHidden
    setIsOfficeHidden(isHidden)
    try {
      localStorage.setItem(OFFICE_HIDDEN_KEY, String(isHidden))
    } catch {
      // 저장하지 못하면 이 화면에서만 바뀐다
    }
  }

  function toggleOfficeStyle() {
    const next: OfficeStyle = officeStyle === 'classic' ? 'dot' : 'classic'
    setOfficeStyle(next)
    try {
      localStorage.setItem(OFFICE_STYLE_KEY, next)
    } catch {
      // 저장하지 못하면 이 화면에서만 바뀐다
    }
  }

  function cycleTheme() {
    const next = NEXT_THEME[theme]
    setThemeChoice(next)
    setTheme(next)
  }

  async function renameSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameTarget) return
    const form = new FormData(event.currentTarget)
    const response = await postJson(`/api/sessions/${renameTarget.id}`, 'PATCH', { name: form.get('name') })
    if (!response.ok) {
      alert((await response.json()).message ?? '이름 변경 실패')
      return
    }
    setRenameTarget(null)
  }

  function openTeamForm(groupId: string) {
    setSessionForm(null)
    setPartForm(null)
    setTeamForm({ groupId })
  }

  function openSessionForm(teamId: string | null, partId: string | null = null) {
    setTeamForm(null)
    setPartForm(null)
    setSessionRole('member')
    setSuggestedSessionName(null)
    setTypedSessionName(null)
    setSessionForm({ teamId, partId })
  }

  function openPartForm(teamId: string) {
    setTeamForm(null)
    setSessionForm(null)
    setPartLocation('folder')
    setIsPartLeadSpawned(true)
    setPartForm({ teamId })
  }

  function editPart(team: Team, part: Part) {
    const name = prompt('파트 이름 (worktree 폴더·브랜치 이름은 그대로)', part.name)
    if (name?.trim()) void postJson(`/api/team/${team.id}/parts/${part.id}`, 'PATCH', { name: name.trim() })
  }

  function releasePartLead(team: Team, part: Part) {
    if (confirm(`"${part.name}" 파트장 지정을 해제할까요? (세션은 그대로 남고 파트 팀원이 됩니다)`)) {
      void postJson(`/api/team/${team.id}/parts/${part.id}`, 'PATCH', { leadSessionId: null })
    }
  }

  /** worktree 파트는 서버가 폴더·브랜치도 지운다. 브랜치가 병합되지 않았으면 지울지 물어 ?branch= 로 다시 보낸다 */
  async function removePart(team: Team, part: Part) {
    const effect = part.worktree
      ? `worktree 폴더 ${part.worktree.cwd} 도 지워집니다 (그 폴더에 근무 중인 세션이나 커밋하지 않은 변경이 있으면 지우지 않습니다). 브랜치 ${part.worktree.branch} 는 병합됐으면 지우고, 아니면 다시 묻습니다.`
      : '소속 세션은 종료되지 않고 팀 직속이 됩니다.'
    if (!confirm(`"${part.name}" 파트를 지울까요? ${effect}`)) return
    const url = `/api/team/${team.id}/parts/${part.id}`
    let response = await fetch(url, { method: 'DELETE' })
    let body = (await response.json().catch(() => ({}))) as { code?: string; branch?: string; message?: string }
    if (response.status === 409 && body.code === 'branch-unmerged') {
      const isBranchDeleted = confirm(`브랜치 ${body.branch} 가 병합되지 않았습니다. 브랜치도 지울까요? (확인 = 지움, 취소 = 남김)`)
      response = await fetch(`${url}?branch=${isBranchDeleted ? 'delete' : 'keep'}`, { method: 'DELETE' })
      body = await response.json().catch(() => ({}))
    }
    if (!response.ok) alert(body.message ?? '파트 삭제 실패')
  }

  function releaseLead(team: Team) {
    if (confirm(`"${team.name}" 팀장 지정을 해제할까요? (세션은 그대로 남고 팀원이 됩니다)`)) {
      void postJson(`/api/team/${team.id}`, 'PATCH', { leadSessionId: null })
    }
  }

  function removeTeam(team: Team) {
    if (confirm(`"${team.name}" 팀을 지울까요? 세션은 종료되지 않고 무소속이 됩니다.`)) {
      void fetch(`/api/team/${team.id}`, { method: 'DELETE' })
    }
  }

  async function removeGroup(group: Group) {
    if (!confirm(`"${group.name}" 그룹을 지울까요?`)) return
    const response = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' })
    if (!response.ok) alert((await response.json()).message ?? '삭제 실패')
  }

  function editGroup(group: Group) {
    const waitingNote = prompt(`"${group.name}" 대기 메모 (비우면 삭제)`, group.waitingNote ?? '')
    if (waitingNote === null) return
    void postJson(`/api/groups/${group.id}`, 'PATCH', { waitingNote })
  }

  /** 그룹 안의 팀들도 같은 만큼 옮긴다 (서버도 PATCH 한 번에 같이 옮긴다) */
  function moveGroup(groupId: string, position: { x: number; y: number }) {
    setOffice((prev) => {
      const group = prev.groups.find((r) => r.id === groupId)
      if (!group) return prev
      const dx = position.x - group.x
      const dy = position.y - group.y
      return {
        ...prev,
        groups: prev.groups.map((r) => (r.id === groupId ? { ...r, ...position } : r)),
        teams: prev.teams.map((t) => (t.groupId === groupId ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
      }
    })
    void postJson(`/api/groups/${groupId}`, 'PATCH', position)
  }

  function patchTeam(teamId: string, patch: Partial<Team>) {
    setOffice((prev) => ({ ...prev, teams: prev.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)) }))
  }

  function moveTeam(teamId: string, anchor: { groupId: string; x: number; y: number }) {
    patchTeam(teamId, anchor)
    void postJson(`/api/team/${teamId}`, 'PATCH', anchor)
  }

  function editTeam(team: Team) {
    const name = prompt(`팀 이름 (폴더: ${team.cwd})`, team.name)
    if (name?.trim()) void postJson(`/api/team/${team.id}`, 'PATCH', { name: name.trim() })
  }

  /**
   * 목록 손잡이(⠿)를 누르면 시작한다. pointer 이벤트라 마우스·터치가 같고, 손잡이가 pointer 를 잡아(setPointerCapture) 밖으로 나가도 이벤트가 온다.
   * DRAG_THRESHOLD_PX 를 넘게 움직여야 끌기다. 놓일 자리는 형제 요소들의 세로 가운데와 비교해 정하고(DOM 순서 = 화면 순서), 목록 위·아래 끝 근처에서는 목록을 스크롤한다
   */
  function startReorder(event: ReactPointerEvent<HTMLElement>, scope: ReorderScope, id: string) {
    const list = listRef.current
    if (!list || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const pointerId = event.pointerId
    event.currentTarget.setPointerCapture(pointerId)
    const start = { x: event.clientX, y: event.clientY }
    const selector =
      scope.kind === 'group' ? ':scope > li[data-group-id]' : `:scope > li[data-group-id="${CSS.escape(scope.groupId)}"] > [data-team-id]`
    let pointerY = start.y
    let isDragging = false
    let ids: string[] = []
    let dropIndex: number | null = null
    let frame = 0

    function updateDrop() {
      const elements = [...list!.querySelectorAll<HTMLElement>(selector)]
      ids = elements.map((element) => (scope.kind === 'group' ? element.dataset.groupId : element.dataset.teamId) ?? '')
      const from = ids.indexOf(id)
      const before = elements.findIndex((element) => {
        const rect = element.getBoundingClientRect()
        return pointerY < rect.top + rect.height / 2
      })
      const index = before === -1 ? elements.length : before
      const next = from === -1 || index === from || index === from + 1 ? null : index
      dropIndex = next
      setReorderDrag((prev) => (prev && prev.id === id && prev.dropIndex === next ? prev : { scope, id, dropIndex: next }))
    }

    /** 누른 자리에서 그 끝 쪽으로 움직였을 때만 스크롤한다 — 끝 근처 항목을 반대쪽으로 끌 때 목록이 거꾸로 밀리지 않게 */
    function autoScroll() {
      const rect = list!.getBoundingClientRect()
      const topDepth = pointerY < start.y ? rect.top + AUTO_SCROLL_EDGE_PX - pointerY : 0
      const bottomDepth = pointerY > start.y ? pointerY - (rect.bottom - AUTO_SCROLL_EDGE_PX) : 0
      const depth = topDepth > 0 ? -topDepth : bottomDepth > 0 ? bottomDepth : 0
      if (depth !== 0) {
        const scrollTop = list!.scrollTop
        list!.scrollTop += Math.sign(depth) * Math.ceil((Math.min(Math.abs(depth), AUTO_SCROLL_EDGE_PX) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX)
        if (list!.scrollTop !== scrollTop) updateDrop()
      }
      frame = requestAnimationFrame(autoScroll)
    }

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return
      pointerY = moveEvent.clientY
      if (!isDragging) {
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD_PX) return
        isDragging = true
        frame = requestAnimationFrame(autoScroll)
      }
      updateDrop()
    }

    function onEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      cancelAnimationFrame(frame)
      setReorderDrag(null)
      if (endEvent.type === 'pointerup' && isDragging && dropIndex !== null) void saveOrder(scope, ids, moveTo(ids, id, dropIndex))
    }

    // 손잡이가 pointer 를 잡고 있어 이벤트가 손잡이에서 window 로 올라온다. 끄는 사이 손잡이가 다시 그려져도 놓치지 않게 window 에서 받는다
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  /** 화면 순서를 먼저 바꾸고 저장한다. 실패하면 원래 순서로 되돌리고 알린다 (성공하면 서버가 office 이벤트로 같은 순서를 다시 보낸다) */
  async function saveOrder(scope: ReorderScope, previousIds: string[], ids: string[]) {
    setOffice((prev) => applyOrder(prev, scope, ids))
    const url = scope.kind === 'group' ? '/api/groups/order' : `/api/groups/${scope.groupId}/teams/order`
    let failure: string | null = null
    try {
      const response = await postJson(url, 'PUT', { ids })
      if (!response.ok) failure = ((await response.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${response.status}`
    } catch (error) {
      failure = String(error)
    }
    if (failure === null) return
    setOffice((prev) => applyOrder(prev, scope, previousIds))
    alert(`순서를 바꾸지 못했습니다: ${failure}`)
  }

  /** 끌어 놓기 중 목록 항목에 붙일 클래스: 끄는 중(흐리게)·놓일 자리 선(앞 또는 맨 끝 뒤) */
  function reorderClass(scope: ReorderScope, id: string, index: number, count: number): string {
    if (!reorderDrag || !isSameScope(reorderDrag.scope, scope)) return ''
    if (reorderDrag.id === id) return 'dragging'
    if (reorderDrag.dropIndex === index) return 'drop-before'
    return reorderDrag.dropIndex === count && index === count - 1 ? 'drop-after' : ''
  }

  /** 끌기 손잡이. "+"·"⋯" 와 같은 head-actions 안에 두어 보이는 규칙(hover·터치 기기)이 같다 */
  function renderDragHandle(scope: ReorderScope, id: string) {
    return (
      <button className="drag-handle" onPointerDown={(event) => startReorder(event, scope, id)} title="끌어서 순서 바꾸기">
        ⠿
      </button>
    )
  }

  function renderSessionModal(teamId: string | null, partId: string | null) {
    const team = teamId ? office.teams.find((t) => t.id === teamId) : undefined
    const part = team?.parts.find((p) => p.id === partId)
    const leadSessionId = part ? part.leadSessionId : team?.leadSessionId
    const hasLiveLead = Boolean(leadSessionId && snapshot.sessions.some((s) => s.id === leadSessionId && s.isAlive))
    const leadLabel = part ? '파트장' : '팀장'
    const roleTag = sessionRole === 'lead' ? LEAD_ROLE_TAG : MEMBER_ROLE_TAG
    const sessionName = typedSessionName ?? (team && suggestedSessionName ? withRoleTag(suggestedSessionName, roleTag) : '')
    return (
      <Modal
        title={
          part ? `세션 추가 — 「${team?.name}」 · 파트 「${part.name}」` : team ? `세션 추가 — 팀 「${team.name}」` : '세션 추가 — 로비 (팀 없음)'
        }
        subtitle={part?.worktree?.cwd ?? team?.cwd}
        onClose={() => setSessionForm(null)}
      >
        <form className="create" onSubmit={createSession}>
          {team && (
            <Segmented
              value={sessionRole}
              onChange={setSessionRole}
              options={[
                { value: 'member', label: '팀원', hint: `${leadLabel}의 지시를 받아 일한다` },
                {
                  value: 'lead',
                  label: leadLabel,
                  isDisabled: hasLiveLead,
                  hint: hasLiveLead
                    ? `이 ${part ? '파트' : '팀'}에는 이미 ${leadLabel}이 있음`
                    : `${part ? '파트' : '팀 직속'} 팀원을 만들어 일을 나눠 준다 (MCP 도구 장착)`,
                },
              ]}
            />
          )}
          {!team && <input name="cwd" placeholder="폴더 경로 (예: D:\workspace\foo)" required autoFocus />}
          <input
            name="name"
            placeholder="세션 이름 (선택. 비우면 대화 내용으로 자동 제목)"
            value={sessionName}
            onChange={(event) => setTypedSessionName(event.target.value)}
            autoFocus={Boolean(team)}
          />
          <div className="actions">
            <button type="submit" className="primary">
              시작
            </button>
            <button type="button" onClick={() => setSessionForm(null)}>
              취소
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  /** 팀 카드: 헤더(이름·세션 수·hover 버튼) + 팀 직속 세션 + 파트별(소제목 + 세션). 폴더는 툴팁. position 은 그룹 안 순번 (그룹이 없는 팀은 없어 끌기 손잡이도 없다) */
  function renderTeam(team: Team, position?: { index: number; count: number }) {
    const scope: ReorderScope = { kind: 'team', groupId: team.groupId }
    // 근무·휴식 세션. 휴식은 훅 상태가 남아 있어도 "나머지" 순위
    const rankOf = (session: Session) => (attendanceOf(session) === 'break' ? statusOrder.idle : statusOrder[session.status])
    const members = snapshot.sessions
      .filter((s) => s.teamId === team.id && attendanceOf(s) !== 'off')
      .sort((a, b) => rankOf(a) - rankOf(b))
    const menuItems = [
      { label: '파트 추가', onClick: () => openPartForm(team.id) },
      ...(team.leadSessionId ? [{ label: '팀장 해제', onClick: () => releaseLead(team) }] : []),
      { label: '팀 삭제', onClick: () => removeTeam(team) },
    ]
    return (
      <div
        key={team.id}
        className={['team', position ? reorderClass(scope, team.id, position.index, position.count) : ''].join(' ')}
        title={team.cwd}
        data-team-id={position ? team.id : undefined}
      >
        <div className="team-head">
          <span className="name" onClick={() => focusTeam(team.id)}>
            {team.name}
          </span>
          {members.length > 0 && <span className="count">{members.length}</span>}
          <span className="head-actions">
            <button onClick={() => openSessionForm(team.id)} disabled={!snapshot.isHostReachable} title="팀 직속 세션 추가">
              +
            </button>
            <MoreMenu items={menuItems} />
            {position && renderDragHandle(scope, team.id)}
          </span>
        </div>
        {members.filter((s) => !s.partId).map((session) => renderSession(session, false))}
        {team.parts.map((part) => renderPart(team, part, members.filter((s) => s.partId === part.id)))}
      </div>
    )
  }

  /** 파트 소제목(이름·worktree 브랜치·세션 수·hover 버튼) + 파트 세션 */
  function renderPart(team: Team, part: Part, members: Session[]) {
    const menuItems = [
      { label: '이름 변경', onClick: () => editPart(team, part) },
      ...(part.leadSessionId ? [{ label: '파트장 해제', onClick: () => releasePartLead(team, part) }] : []),
      { label: '파트 삭제', onClick: () => void removePart(team, part) },
    ]
    return (
      <div key={part.id} className="part" title={part.worktree?.cwd ?? team.cwd}>
        <div className="part-head">
          <span className="name">{part.name}</span>
          {part.worktree && <span className="branch">⎇ {part.worktree.branch}</span>}
          {members.length > 0 && <span className="count">{members.length}</span>}
          <span className="head-actions">
            <button onClick={() => openSessionForm(team.id, part.id)} disabled={!snapshot.isHostReachable} title="이 파트에 세션 추가">
              +
            </button>
            <MoreMenu items={menuItems} />
          </span>
        </div>
        {members.map((session) => renderSession(session, false))}
      </div>
    )
  }

  /**
   * 세션 한 줄: 상태 점 · 아바타 · 제목 · (승인 대기·휴식 배지 · 시각). 팀장은 아바타 금색, 파트장은 은색 테두리. 팀 안에서는 폴더를 숨긴다 (팀 = 폴더). teamName 이 있으면 제목 앞에 붙인다 (퇴근).
   * 휴식은 회색 점 + "휴식", 퇴근은 시각 대신 퇴근 이유 · 시각 (옛 서버 응답이라 이유가 없으면 시각)
   */
  function renderSession(session: Session, hasCwd: boolean, teamName?: string) {
    const avatar = avatarOf(session.id)
    const elapsed = formatElapsed(session.lastAt, now)
    const model = modelLabel(session)
    const attendance = attendanceOf(session)
    const isPresent = attendance === 'present'
    const offDuty = attendance === 'off' && session.offDuty ? offDutyLabel(session.offDuty, now) : null
    const roleLabel = session.role === 'lead' ? (session.partId ? '파트장' : '팀장') : null
    return (
      <div
        key={session.id}
        className={['session', session.id === selectedId ? 'selected' : '', attendance === 'off' ? 'dead' : ''].join(' ')}
        onClick={() => selectSession(session.id)}
      >
        <span
          className={`status-dot ${isPresent ? session.status : attendance}`}
          title={isPresent ? statusLabel[session.status] : attendance === 'break' ? '휴식' : '퇴근'}
        />
        <span
          className={['avatar', roleLabel === '팀장' ? 'lead' : roleLabel === '파트장' ? 'part-lead' : ''].join(' ')}
          style={{ '--hair': cssColor(avatar.hair), '--skin': cssColor(avatar.skin) } as CSSProperties}
          role={roleLabel ? 'img' : undefined}
          title={roleLabel ?? undefined}
          aria-label={roleLabel ?? undefined}
        />
        <div className="title">{teamName ? `${teamName} · ${displayName(session)}` : displayName(session)}</div>
        {model && (
          <span className="model" title={session.model ?? undefined}>
            {model}
          </span>
        )}
        <div className="meta">
          {isPresent && session.status === 'needs-approval' && <span className="badge needs-approval">{statusLabel[session.status]}</span>}
          {attendance === 'break' && <span className="badge">휴식</span>}
          {offDuty ? (
            <span className={offDuty.isError ? 'off-duty-reason error' : 'off-duty-reason'} title={offDuty.title}>
              {offDuty.text}
            </span>
          ) : (
            <span className={`time ${elapsed.className}`} title={elapsed.title}>
              {elapsed.text}
            </span>
          )}
        </div>
        {hasCwd && <div className="cwd">{session.cwd}</div>}
      </div>
    )
  }

  /** 입력할 수 없는 세션의 입력칸 자리: 퇴근 버튼(출근 중 포함)·휴식 안내. undefined 면 Chat 의 외부 세션 안내 */
  function renderPanelFooter(session: Session): ReactNode {
    const attendance = attendanceOf(session)
    const isReturning = session.id in returningSessions
    if (isReturning || session.attendance === 'off') {
      return (
        <OffDutyBar
          key={session.id}
          sessionId={session.id}
          label={attendance === 'off' && session.offDuty ? offDutyLabel(session.offDuty, now) : null}
          isReturning={isReturning}
          onReturnAccepted={() => setReturningSessions((prev) => ({ ...prev, [session.id]: session.offDuty?.endedAt ?? '' }))}
        />
      )
    }
    if (attendance === 'break') return <p className="hint">휴식 중 · 호스트가 다시 띄우면 이어집니다</p>
    // attendance 가 없는 옛 서버 응답의 끝난 웹 세션: 다시 출근·기록 지우기를 못 한다
    if (attendance === 'off' && session.kind === 'web') return <p className="hint">퇴근한 세션이라 기록만 볼 수 있습니다</p>
    return undefined
  }

  /** 점프로 연 세션 패널의 헤더 아래 "← <팀장 이름> 대화로". 팀장 세션이 목록에서 빠졌으면 누를 수 없다 */
  function renderJumpBack(back: JumpBack) {
    const from = snapshot.sessions.find((s) => s.id === back.fromSessionId)
    return (
      <div className="jump-back">
        <button onClick={returnFromJump} disabled={!from} title={from ? '점프할 때 누른 줄로 돌아간다' : '세션 기록이 없어 열 수 없음'}>
          ← {from ? displayName(from) : back.fromName} 대화로
        </button>
      </div>
    )
  }

  /** 그룹이 지워져 소속 그룹이 없는 팀. 라벨 없이 그대로 보여 준다 */
  const orphanTeams = office.teams.filter((t) => !office.groups.some((g) => g.id === t.groupId))
  /** 팀·로비에는 근무·휴식 세션. 휴식은 호스트가 다시 띄우면 저절로 돌아오므로 자리를 지킨다 */
  const lobbySessions = snapshot.sessions.filter((s) => !s.teamId && attendanceOf(s) !== 'off')
  /** 퇴근 세션은 맨 아래 "Off Duty" 에 모은다. 서버가 준 순서 그대로 */
  const offDutySessions = snapshot.sessions.filter((s) => attendanceOf(s) === 'off')
  /** footer 집계는 근무 세션만. 휴식·퇴근 세션은 훅 상태가 남아 있어도 세지 않는다 */
  const presentSessions = snapshot.sessions.filter((s) => attendanceOf(s) === 'present')
  const workingCount = presentSessions.filter((s) => s.status === 'working').length
  const approvalSessions = presentSessions.filter((s) => s.status === 'needs-approval')
  /** 오른쪽 패널 자리에 무엇이든 열려 있는지 (세션 또는 플로우) */
  const hasPanel = selected !== null || isFlowOpen

  return (
    <div className="app">
      <main className={`layout${hasPanel ? ' with-panel' : ''}${isOfficeHiddenLayout ? ' office-hidden' : ''}`}>
        <aside>
          <header>
            <h1>jk-corp</h1>
            <button className="icon" onClick={cycleTheme} title={`테마: ${THEME_LABELS[theme]}`} aria-label={`테마: ${THEME_LABELS[theme]}`}>
              <ThemeIcon choice={theme} />
            </button>
            {/* 폰 폭에는 원래 사무실이 없다 */}
            {!isNarrow && (
              <button
                className="icon"
                onClick={toggleOffice}
                title={isOfficeHidden ? '사무실 보이기' : '사무실 숨기기'}
                aria-label={isOfficeHidden ? '사무실 보이기' : '사무실 숨기기'}
              >
                <OfficeToggleIcon isShown={!isOfficeHidden} />
              </button>
            )}
            {/* 사무실이 보일 때만 (숨겼거나 폰 폭이면 바꿀 그림이 없다) */}
            {!isNarrow && !isOfficeHidden && (
              <button
                className="icon"
                onClick={toggleOfficeStyle}
                title={`사무실 그림: ${OFFICE_STYLE_LABELS[officeStyle]}`}
                aria-label={`사무실 그림: ${OFFICE_STYLE_LABELS[officeStyle]}`}
              >
                <OfficeStyleIcon style={officeStyle} />
              </button>
            )}
          </header>
          <div className="toolbar">
            <button onClick={() => setIsGroupForm(true)} title="새 그룹">
              <NewGroupIcon />
              New Group
            </button>
            <button onClick={() => openSessionForm(null)} disabled={!snapshot.isHostReachable} title="Focus Zone 에 새 세션">
              <NewSessionIcon />
              New Session
            </button>
          </div>
          <FlowRow status={flowStatus} isSelected={isFlowOpen} onOpen={openFlow} />
          <ul ref={listRef} className={reorderDrag ? 'sessions reordering' : 'sessions'}>
            {office.groups.map((group, groupIndex) => {
              const teams = office.teams.filter((t) => t.groupId === group.id)
              return (
                <li
                  key={group.id}
                  className={['group', reorderClass({ kind: 'group' }, group.id, groupIndex, office.groups.length)].join(' ')}
                  data-group-id={group.id}
                >
                  <div className="group-label">
                    <span className="name">{group.name}</span>
                    <span className="head-actions">
                      <button onClick={() => openTeamForm(group.id)} title="이 그룹에 팀 추가">
                        +
                      </button>
                      {teams.length === 0 && <MoreMenu items={[{ label: '그룹 삭제', onClick: () => removeGroup(group) }]} />}
                      {renderDragHandle({ kind: 'group' }, group.id)}
                    </span>
                  </div>
                  {teams.map((team, teamIndex) => renderTeam(team, { index: teamIndex, count: teams.length }))}
                </li>
              )
            })}
            {orphanTeams.length > 0 && <li className="group">{orphanTeams.map((team) => renderTeam(team))}</li>}
            <li className="group">
              <div className="group-label">
                <span className="name">Focus Zone</span>
                {lobbySessions.length > 0 && <span className="count">{lobbySessions.length}</span>}
              </div>
              {lobbySessions.map((session) => renderSession(session, true))}
            </li>
            {offDutySessions.length > 0 && (
              <li className="group">
                <div className="group-label toggle" onClick={() => setIsOffDutyOpen(!isOffDutyOpen)}>
                  <span className="name">
                    {isOffDutyOpen ? '▾' : '▸'} Off Duty
                  </span>
                  <span className="count">{offDutySessions.length}</span>
                </div>
                {isOffDutyOpen &&
                  offDutySessions.map((session) => {
                    const team = office.teams.find((t) => t.id === session.teamId)
                    return renderSession(session, !team, team?.name)
                  })}
              </li>
            )}
          </ul>
        </aside>
        {isGroupForm && (
          <Modal title="그룹 추가" onClose={() => setIsGroupForm(false)}>
            <form className="create" onSubmit={createGroup}>
              <input name="name" placeholder="그룹 이름" required autoFocus />
              <div className="actions">
                <button type="submit" className="primary">
                  만들기
                </button>
                <button type="button" onClick={() => setIsGroupForm(false)}>
                  취소
                </button>
              </div>
            </form>
          </Modal>
        )}
        {teamForm && (
          <Modal
            title={`팀 추가 — 그룹 「${office.groups.find((g) => g.id === teamForm.groupId)?.name ?? ''}」`}
            onClose={() => setTeamForm(null)}
          >
            <form className="create" onSubmit={createTeam}>
              <input name="name" placeholder="팀 이름" required autoFocus />
              <input name="cwd" placeholder="작업 폴더 (예: D:\workspace\foo). 이 폴더의 세션이 팀이 됨" required />
              <div className="actions">
                <button type="submit" className="primary">
                  만들기
                </button>
                <button type="button" onClick={() => setTeamForm(null)}>
                  취소
                </button>
              </div>
            </form>
          </Modal>
        )}
        {sessionForm && renderSessionModal(sessionForm.teamId, sessionForm.partId)}
        {partForm && (
          <Modal
            title={`파트 추가 — 팀 「${office.teams.find((t) => t.id === partForm.teamId)?.name ?? ''}」`}
            subtitle={office.teams.find((t) => t.id === partForm.teamId)?.cwd}
            onClose={() => setPartForm(null)}
          >
            <form className="create" onSubmit={createPart}>
              <input name="name" placeholder="파트 이름 (예: api)" required autoFocus />
              <Segmented
                value={partLocation}
                onChange={setPartLocation}
                options={[
                  { value: 'folder', label: '팀 폴더', hint: '팀 폴더를 같이 쓴다. 파일이 겹치지 않는 일에' },
                  { value: 'worktree', label: '새 worktree', hint: '같은 파일을 동시에 고칠 때. 저장소 옆 폴더에서 따로 일한다' },
                ]}
              />
              <div className="form-hint">
                {partLocation === 'worktree'
                  ? '저장소 옆 <저장소>.worktrees/<이름> 폴더, 브랜치 part/<이름> (현재 HEAD 기준. 이름의 영문·숫자만 씀. 이미 있으면 그 worktree·브랜치에 연결). 병합은 직접'
                  : '팀 폴더 그대로. 다른 파트·팀 직속과 같은 파일을 고치지 않게 나눈다'}
              </div>
              <label className="check">
                <input type="checkbox" checked={isPartLeadSpawned} onChange={(e) => setIsPartLeadSpawned(e.target.checked)} />
                파트장 바로 띄우기
              </label>
              <div className="actions">
                <button type="submit" className="primary" disabled={!snapshot.isHostReachable && isPartLeadSpawned}>
                  만들기
                </button>
                <button type="button" onClick={() => setPartForm(null)}>
                  취소
                </button>
              </div>
            </form>
          </Modal>
        )}
        {renameTarget && (
          <Modal title="세션 이름 변경" subtitle={renameTarget.title ?? renameTarget.id} onClose={() => setRenameTarget(null)}>
            <form className="create" onSubmit={renameSession}>
              <input
                name="name"
                defaultValue={renameTarget.name ?? ''}
                placeholder="비우면 자동 제목으로 돌아감"
                autoFocus
              />
              <div className="actions">
                <button type="submit" className="primary">
                  저장
                </button>
                <button type="button" onClick={() => setRenameTarget(null)}>
                  취소
                </button>
              </div>
            </form>
          </Modal>
        )}
        {/* 폰 폭과 사무실을 숨겼을 때는 PixiJS 를 돌리지 않도록 마운트하지 않는다 (CSS 로 숨기기만 하면 캔버스가 계속 돈다) */}
        {isOfficeHiddenLayout && !hasPanel && <div className="office-empty">왼쪽에서 세션을 고르면 대화가 열립니다</div>}
        {!isNarrow && !isOfficeHidden && (
          <Office
            style={officeStyle}
            office={office}
            sessions={snapshot.sessions}
            selectedId={selectedId}
            focus={officeFocus}
            hasQuestionCard={Boolean(isSelectedLiveWeb && selected.question?.questions.length)}
            onSelect={(sessionId) => selectSession(sessionId, false)}
            onMoveGroup={moveGroup}
            onMoveTeam={moveTeam}
            onEditTeam={editTeam}
            onEditGroup={editGroup}
          />
        )}
        {isFlowOpen && !selected && (
          <FlowPanel
            unreadAlarmCount={flowStatus?.unreadAlarmCount ?? null}
            unreadChatCount={flowStatus?.unreadChatCount ?? null}
            isNarrow={isNarrow}
            onStatus={setFlowStatus}
            onClose={() => setIsFlowOpen(false)}
          />
        )}
        {selected && (
          <section className="panel">
            <div className="panel-header">
              <b>{displayName(selected)}</b>
              <button className="rename" title="이름 변경" onClick={() => setRenameTarget(selected)}>
                ✎
              </button>
              {modelLabel(selected) && (
                <span className="model-chip" title={selected.model ?? undefined}>
                  {modelLabel(selected)}
                </span>
              )}
              <span className="cwd">{selected.cwd}</span>
              <nav className="tabs">
                <button className={shownTab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')} title="대화" aria-label="대화">
                  <ChatTabIcon />
                </button>
                {isSelectedLiveWeb && (
                  <button
                    className={shownTab === 'terminal' ? 'on' : ''}
                    onClick={() => setTab('terminal')}
                    title="터미널"
                    aria-label="터미널"
                  >
                    <TerminalTabIcon />
                  </button>
                )}
              </nav>
              {isSelectedLiveWeb && (
                <button
                  onClick={() => {
                    if (confirm('세션을 종료할까요?')) void fetch(`/api/sessions/${selected.id}`, { method: 'DELETE' })
                  }}
                >
                  종료
                </button>
              )}
              {/* 폰에서는 패널이 화면 전체라 "뒤로" 가 목록으로 돌아가는 버튼이다 */}
              <button className="close" onClick={() => setSelectedId(null)} title={isNarrow ? '목록으로' : '닫기'}>
                {isNarrow ? '←' : '×'}
              </button>
            </div>
            {jumpBack?.toSessionId === selected.id && renderJumpBack(jumpBack)}
            {shownTab === 'terminal' ? (
              <Terminal sessionId={selected.id} />
            ) : (
              <Chat
                sessionId={selected.id}
                isWritable={isSelectedLiveWeb}
                footer={renderPanelFooter(selected)}
                // 휴식·퇴근 세션은 훅 상태가 남아 있어도 작업 중·승인 대기로 보지 않는다
                isApprovalNeeded={isSelectedPresent && selected.status === 'needs-approval'}
                isWorking={isSelectedPresent && selected.status === 'working'}
                workingSince={selected.workingSince ?? null}
                pendingTool={selected.pendingTool}
                question={selected.question ?? null}
                suggestion={selected.suggestion ?? null}
                version={transcriptVersions[selected.id] ?? 0}
                sessionNames={Object.fromEntries(snapshot.sessions.map((s) => [s.id, displayName(s)]))}
                jump={jump?.sessionId === selected.id ? jump : null}
                onJumpHandled={() => setJump(null)}
                onOpenRelay={openRelay}
                // 서버는 근무 중이 아닌 세션에 [] 를 준다. 옛 서버 응답은 필드가 없다
                shells={selected.shells ?? []}
                shellRequest={shellRequest?.sessionId === selected.id ? shellRequest : null}
                onShellRequestHandled={() => setShellRequest(null)}
              />
            )}
          </section>
        )}
      </main>
      {/* 화면 아래 상태 표시줄: 왼쪽 사용량, 오른쪽 세션 집계·연결 상태와 재시작 ↻ (폰은 목록 화면에서만. style.css) */}
      <footer className="status-bar">
        <UsagePanel />
        <span className="status-right">
          {approvalSessions.length > 0 && (
            <button className="status-approval" onClick={() => selectSession(approvalSessions[0].id)} title="승인 대기 세션 열기">
              승인 대기 {approvalSessions.length}
            </button>
          )}
          <ShellsStatus lines={shellLines(office, snapshot.sessions)} onOpen={openShell} />
          <span>
            작업 중 {workingCount} · 근무 {presentSessions.length}
          </span>
          <span className="status-link" title={isConnected ? '서버 연결됨' : '서버 끊김'}>
            <span className="status-link-label">서버</span>
            <span className={isConnected ? 'dot on' : 'dot'} />
            <button onClick={restartServer} disabled={!isConnected} title="서버 재시작 (몇 초 끊김)">
              ↻
            </button>
          </span>
          <span className="status-link" title={snapshot.isHostReachable ? '세션 호스트 연결됨' : '세션 호스트 끊김'}>
            <span className="status-link-label">호스트</span>
            <span className={snapshot.isHostReachable ? 'dot on' : 'dot'} />
            <button onClick={restartHost} disabled={!snapshot.isHostReachable} title="호스트 재시작 (웹 세션 끊김)">
              ↻
            </button>
          </span>
        </span>
      </footer>
    </div>
  )
}

/**
 * 퇴근 세션의 입력칸 자리: 퇴근 이유 · [다시 출근] · [기록 지우기]. 실패하면 서버 문구를 그 아래에 보인다.
 * 다시 출근이 받아들여지면 App 이 세션이 근무로 바뀔 때까지 isReturning 으로 막는다. 기록 지우기에 성공하면 세션이 목록에서 빠질 때까지 막아 둔다 (그러면 패널이 닫힌다)
 */
function OffDutyBar({
  sessionId,
  label,
  isReturning,
  onReturnAccepted,
}: {
  sessionId: string
  label: OffDutyLabel | null
  isReturning: boolean
  onReturnAccepted: () => void
}) {
  const [busy, setBusy] = useState<'return' | 'clear' | 'cleared' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isLocked = isReturning || busy !== null

  async function request(action: 'return' | 'clear') {
    const actionLabel = action === 'return' ? '다시 출근' : '기록 지우기'
    setBusy(action)
    setErrorMessage(null)
    try {
      const response =
        action === 'return'
          ? await postJson(`/api/sessions/${sessionId}/resume`, 'POST', {})
          : await fetch(`/api/sessions/${sessionId}/off-duty`, { method: 'DELETE' })
      if (response.ok) {
        if (action === 'return') onReturnAccepted()
        setBusy(action === 'clear' ? 'cleared' : null)
        return
      }
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      setErrorMessage(`${actionLabel} 실패: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      setErrorMessage(`${actionLabel} 실패: 네트워크 오류`)
    }
    setBusy(null)
  }

  function clearRecord() {
    if (confirm('퇴근 기록을 지울까요? 목록에서 빠지고 다시 출근할 수 없습니다.')) void request('clear')
  }

  return (
    <div className="off-duty">
      {label && (
        <span className={label.isError ? 'off-duty-reason error' : 'off-duty-reason'} title={label.title}>
          {label.text}
        </span>
      )}
      <div className="off-duty-actions">
        <button className="primary" disabled={isLocked} onClick={() => void request('return')}>
          {isReturning || busy === 'return' ? '출근 중…' : '다시 출근'}
        </button>
        <button disabled={isLocked} onClick={clearRecord}>
          {busy === 'clear' || busy === 'cleared' ? '지우는 중…' : '기록 지우기'}
        </button>
      </div>
      {errorMessage && (
        <div className="off-duty-error" role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  )
}

/**
 * 툴바 아래 플로우 한 줄: 아이콘 · "Flow" · "알림 N · 채팅 N". 누르면 오른쪽 패널이 플로우 알림이 된다.
 * 둘 다 0 이면 회색, 하나라도 있으면 강조. 아직 못 셌으면 "…", 키 없음이면 "키 없음", 확인 실패면 짧게 (전문은 title. 앞 수가 있으면 수 + ⚠)
 */
function FlowRow({ status, isSelected, onOpen }: { status: FlowStatus | null; isSelected: boolean; onOpen: () => void }) {
  const hasCounts = status !== null && status.unreadAlarmCount !== null && status.unreadChatCount !== null
  const hasUnread = hasCounts && (status.unreadAlarmCount! > 0 || status.unreadChatCount! > 0)
  let summary: string
  let title = '플로우 알림 보기'
  if (status === null) summary = '…'
  else if (!status.isConfigured) {
    summary = '키 없음'
    title = '~/.claude/flow-key.env 에 FLOW_API_KEY 가 없습니다'
  } else if (hasCounts) summary = `알림 ${status.unreadAlarmCount} · 채팅 ${status.unreadChatCount}`
  else summary = status.error ? '확인 실패' : '…'
  if (status?.isConfigured && status.error) title = `플로우 확인 실패: ${status.error}`
  return (
    <button
      className={['flow-row', isSelected ? 'selected' : '', hasUnread ? 'unread' : ''].join(' ')}
      onClick={onOpen}
      title={title}
    >
      <FlowIcon />
      <span className="flow-row-name">Flow</span>
      <span className={status?.isConfigured && status.error && !hasCounts ? 'flow-row-summary error' : 'flow-row-summary'}>{summary}</span>
      {status?.isConfigured && status.error && hasCounts && <span className="flow-row-warning">⚠</span>}
    </button>
  )
}

/** 플로우 줄 아이콘: 종 (알림) */
function FlowIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1.5H3l1-1.5zM6.5 13.5a1.5 1.5 0 0 0 3 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** "⋯" 버튼 + 작은 드롭다운. 바깥 클릭·Esc 로 닫힌다 */
function MoreMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  return (
    <span ref={rootRef} className={isOpen ? 'menu open' : 'menu'}>
      <button onClick={() => setIsOpen((prev) => !prev)} title="더보기">
        ⋯
      </button>
      {isOpen && (
        <div className="menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setIsOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/** 헤더의 사무실 보이기/숨기기 아이콘. 화면 3열 그림이고 가운데(사무실) 칸이 채워져 있으면 보이는 중, 비어 있으면 숨긴 중 (지금 상태를 보인다) */
function OfficeToggleIcon({ isShown }: { isShown: boolean }) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <rect x="0.5" y="1.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
      <path d="M4.5 1.5v11" stroke="currentColor" />
      {isShown && (
        <>
          <rect x="5" y="2" width="4" height="10" fill="currentColor" opacity="0.5" />
          <path d="M9.5 1.5v11" stroke="currentColor" />
        </>
      )}
    </svg>
  )
}

/** 헤더의 사무실 그림 아이콘. 지금 고른 것을 보인다: 클래식 = 테두리 상자 안 작은 사각형, 도트 = 2×2 칸을 엇갈려 채운 도트 */
function OfficeStyleIcon({ style }: { style: OfficeStyle }) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <rect x="0.5" y="0.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" />
      {style === 'classic' ? (
        <rect x="4.5" y="4.5" width="5" height="5" fill="currentColor" opacity="0.5" />
      ) : (
        <path d="M3 3h4v4H3zM7 7h4v4H7z" fill="currentColor" />
      )}
    </svg>
  )
}

/** 헤더의 테마 아이콘. 지금 고른 것을 보인다: 라이트 = 해, 다크 = 달, 시스템 = 모니터 */
function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {choice === 'light' && (
        <>
          <circle cx="8" cy="8" r="2.75" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
        </>
      )}
      {choice === 'dark' && <path d="M14 8.53A6 6 0 1 1 7.47 2a4.67 4.67 0 0 0 6.53 6.53z" />}
      {choice === 'system' && (
        <>
          <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.25" />
          <path d="M8 11v2.5M5.5 13.5h5" />
        </>
      )}
    </svg>
  )
}

/** 패널 헤더 대화 탭 아이콘: 말풍선 */
function ChatTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M4 2.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5v-2.5H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 2.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 패널 헤더 터미널 탭 아이콘: 창 안의 `>_` */
function TerminalTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M4.5 6l2 2-2 2M8 10.5h3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 툴바 New Group 아이콘: 겹친 상자 (뒤 상자는 앞 상자에 가리지 않은 부분만) */
function NewGroupIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2.5" y="5.5" width="9" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M5.5 5.5V4A1.5 1.5 0 0 1 7 2.5h5A1.5 1.5 0 0 1 13.5 4v5a1.5 1.5 0 0 1-1.5 1.5h-.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 툴바 New Session 아이콘: 사람 (세션 = 사무실 직원. 패널 탭의 말풍선·터미널과 겹치지 않게) */
function NewSessionIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3.5 13.5a4.5 4.5 0 0 1 9 0" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}
