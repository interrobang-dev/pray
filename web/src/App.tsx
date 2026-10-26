import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Terminal } from './Terminal'
import { Chat, type Jump, type JumpTarget } from './Chat'
import { Office, type OfficeFocus } from './Office'
import { layoutOffice, spotForNewGroup, spotForNewTeam } from './officeLayout'
import { UsagePanel } from './UsagePanel'
import { ShellsStatus, shellLines, type ShellRequest } from './Shells'
import { FlowPanel } from './FlowPanel'
import { GroupTodosModal } from './GroupTodosModal'
import { remainingCount, todosOf } from './groupTodos'
import { Modal, Segmented } from './Modal'
import { ModelSettingModal, useRestartingSessions } from './ModelSettingModal'
import { nextLabel } from './modelSetting'
import { sessionMenuEntries } from './sessionMenu'
import { LEAD_POSITION, MEMBER_POSITION, editableNameOf, modalName, modalPosition, nameOf, positionOf, renamePatch } from './sessionPosition'
import { PositionChip } from './PositionChip'
import { CharacterPicker, type CharacterChoice } from './CharacterPicker'
import { headImageUrl, loadCharacterSheet, loadRecolorArt, type CharacterSheet, type RecolorArt } from './characterArt'
import { dotLookOf } from './dotCharacter'
import {
  attendanceOf,
  formatDateTime,
  offDutyLabel,
  statusLabel,
  type FlowStatus,
  type Office as OfficeData,
  type Group,
  type GroupTodo,
  type OffDutyLabel,
  type Part,
  type Session,
  type Shell,
  type Team,
} from './types'
import { setThemeChoice, themeChoice, type ThemeChoice } from './theme'

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
}

const EMPTY_OFFICE: OfficeData = { groups: [], teams: [] }

/** 이 폭 이하는 폰 화면: 한 열(목록 ↔ 패널)이고 사무실을 마운트하지 않는다. style.css 의 @media 와 같은 값 */
const NARROW_QUERY = '(max-width: 768px)'

/** 마우스가 없는 기기. style.css 의 `@media (hover: none)` 과 같은 값 */
const TOUCH_QUERY = '(hover: none)'

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

/** 헤더 테마 버튼: 누를 때마다 라이트 → 다크 → 시스템 */
const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' }
const THEME_LABELS: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' }

/** 세션 API 가 그 폴더를 ~/.claude.json 에 신뢰로 기록하지 못했을 때 (isTrustFailed) */
const SESSION_TRUST_FAILED_MESSAGE =
  `Couldn't mark the folder as trusted. If this is the first session in this folder, allow trust yourself in the Terminal tab (leaving the default "No, exit" ends the session).`

/** 이름 추천 API 응답. name 은 이름만 (역할은 따로). 성별은 서버가 그 이름에 맞춰 정한다 (옛 서버 응답에는 없다) */
interface MemberNameSuggestion {
  name: string
  gender?: 'male' | 'female'
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
  return nameOf(session)
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
  return { text, className, title: formatDateTime(iso) }
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
  /**
   * 팀·파트 세션 추가 모달에 미리 채울 이름(이름만)과 그 성별. 성별은 이 이름을 그대로 쓸 때만 세션 생성에 넘긴다.
   * Role 칸은 세그먼트(Member/Lead)에 따라 Dev/Lead 로 채운다
   */
  const [suggestedSessionName, setSuggestedSessionName] = useState<MemberNameSuggestion | null>(null)
  /** 사용자가 Name 칸에 직접 쓴 값. null 이면 아직 안 고쳤다 — 고친 뒤로는 추천 이름으로 바꾸지 않는다 */
  const [typedSessionName, setTypedSessionName] = useState<string | null>(null)
  /** 사용자가 Role 칸에 직접 쓴 값. null 이면 아직 안 고쳤다 — 고친 뒤로는 세그먼트로 Dev↔Lead 를 바꾸지 않는다 */
  const [typedSessionPosition, setTypedSessionPosition] = useState<string | null>(null)
  /** 파트 추가 모달. 팀 "⋯" 의 "파트 추가" 로 열린다 */
  const [partForm, setPartForm] = useState<{ teamId: string } | null>(null)
  const [partLocation, setPartLocation] = useState<'folder' | 'worktree'>('folder')
  const [isPartLeadSpawned, setIsPartLeadSpawned] = useState(true)
  /** 이름 변경 모달의 대상 세션 */
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  /** 이름 모달에서 고른 도트 인물 (null = 자동). 지시자일 때만 모달에 보인다 */
  const [renameCharacter, setRenameCharacter] = useState<CharacterChoice>({ id: null, hair: null, top: null })
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  /** 모델·effort 변경 창을 연 세션 ID. 패널 모델 칩과 목록 ⋯ 메뉴가 같이 연다 (패널이 안 열린 세션도 된다) */
  const [modelModalSessionId, setModelModalSessionId] = useState<string | null>(null)
  /** Chat 이 알려 준 "대화 맨 끝에 대기 메시지가 있는" 세션 ID (없으면 null) */
  const [queuedSessionId, setQueuedSessionId] = useState<string | null>(null)
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
  /** 사무실 퇴근 거리의 "+N" 을 누른 횟수. 바뀌면 펼친 Off Duty 구역으로 목록을 스크롤한다 (펼친 뒤 그려진 다음에) */
  const [offDutyScrollRequest, setOffDutyScrollRequest] = useState(0)
  const offDutyRef = useRef<HTMLLIElement>(null)
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
  /** 마우스가 없는 기기. 세션 줄 ⋯ 는 hover 로 나타나서 두지 않는다 */
  const isTouch = useMediaQuery(TOUCH_QUERY)
  /** 헤더 버튼으로 사무실을 숨겼는지 (localStorage). 폰 폭은 원래 사무실이 없어 이 값과 무관하다 */
  const [isOfficeHidden, setIsOfficeHidden] = useState(readIsOfficeHidden)
  /** 목록 아바타를 도트 인물 머리로 그릴 아틀라스. 읽기 전·못 읽으면 빈 칩 */
  const [dotHeadArt, setDotHeadArt] = useState<{ sheet: CharacterSheet; art: RecolorArt } | null>(null)
  /** 데스크톱에서 사무실을 숨긴 화면: 패널이 목록 오른쪽 폭을 다 쓰고, 세션을 안 골랐으면 그 자리에 안내 */
  const isOfficeHiddenLayout = !isNarrow && isOfficeHidden
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice)
  /** TODO 모달을 연 그룹. 목록 그룹 라벨의 버튼과 사무실 그룹 이름표 옆 버튼이 같은 모달을 연다 */
  const [todoGroupId, setTodoGroupId] = useState<string | null>(null)
  const todoGroup = todoGroupId ? office.groups.find((g) => g.id === todoGroupId) : undefined

  useEffect(() => {
    let isCurrent = true
    Promise.all([loadCharacterSheet(), loadRecolorArt()]).then(
      ([sheet, art]) => isCurrent && setDotHeadArt({ sheet, art }),
      (error: unknown) => console.error('목록 아바타용 도트 인물을 읽지 못해 빈 칩으로 둔다', error),
    )
    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // 목록만 스크롤한다 (scrollIntoView 는 overflow hidden 인 조상까지 움직인다)
  useEffect(() => {
    const list = listRef.current
    const section = offDutyRef.current
    if (!offDutyScrollRequest || !list || !section) return
    const top = list.scrollTop + section.getBoundingClientRect().top - list.getBoundingClientRect().top
    list.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [offDutyScrollRequest])

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
    const query = new URLSearchParams({ role: MEMBER_POSITION })
    if (sessionForm.partId) query.set('partId', sessionForm.partId)
    fetch(`/api/team/${sessionForm.teamId}/member-name?${query}`)
      .then((r) => (r.ok ? (r.json() as Promise<MemberNameSuggestion>) : null))
      .then((data) => {
        if (!isCancelled && data) setSuggestedSessionName(data)
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

  const handleQueuedChange = useCallback(
    (sessionId: string, hasQueuedMessage: boolean) => setQueuedSessionId((previous) => (hasQueuedMessage ? sessionId : previous === sessionId ? null : previous)),
    [],
  )
  const { restartingIds, beginRestart } = useRestartingSessions()
  const selected = snapshot.sessions.find((s) => s.id === selectedId) ?? null
  const modelModalSession = snapshot.sessions.find((s) => s.id === modelModalSessionId) ?? null
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
    // 추천 이름을 그대로 쓸 때만 그 성별을 넘긴다 (직접 고친 이름은 성별 없음)
    const isSuggestedName = Boolean(sessionForm.teamId) && typedSessionName === null && suggestedSessionName !== null
    const response = await postJson('/api/sessions', 'POST', {
      cwd: sessionForm.teamId ? undefined : form.get('cwd'),
      teamId: sessionForm.teamId ?? undefined,
      partId: sessionForm.partId ?? undefined,
      name: form.get('name'),
      position: String(form.get('position') ?? '').trim() || undefined,
      gender: isSuggestedName ? suggestedSessionName?.gender : undefined,
      isLead: Boolean(sessionForm.teamId) && sessionRole === 'lead',
    })
    if (!response.ok) {
      alert((await response.json()).message ?? "Couldn't create session")
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
      alert((await response.json()).message ?? "Couldn't create team")
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
      alert((await response.json()).message ?? "Couldn't create part")
      return
    }
    const { part, isTrusted, isLinked } = (await response.json()) as { part: Part; isTrusted: boolean; isLinked?: boolean }
    if (isWorktree && !isTrusted) alert(`Couldn't mark the folder as trusted. The first session in this folder needs trust allowed in the Terminal tab.\n${part.worktree?.cwd}`)
    if (isLinked) alert(`Linked to the existing worktree and branch ${part.worktree?.branch} (not created fresh from the current HEAD).\n${part.worktree?.cwd}`)
    setPartForm(null)
    if (!isPartLeadSpawned) return
    // 세션 추가 모달의 파트장과 같은 역할 Lead + 추천 이름과 그 성별. 추천을 못 받으면 이름 없이 (자동 제목)
    const leadQuery = new URLSearchParams({ role: LEAD_POSITION, partId: part.id })
    const leadName = await fetch(`/api/team/${partForm.teamId}/member-name?${leadQuery}`)
      .then((r) => (r.ok ? (r.json() as Promise<MemberNameSuggestion>) : null))
      .catch(() => null)
    const leadResponse = await postJson('/api/sessions', 'POST', {
      teamId: partForm.teamId,
      partId: part.id,
      isLead: true,
      name: leadName?.name,
      position: LEAD_POSITION,
      gender: leadName?.gender,
    })
    if (!leadResponse.ok) {
      alert((await leadResponse.json()).message ?? "Couldn't start part lead")
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
      alert((await response.json()).message ?? "Couldn't create group")
      return
    }
    setIsGroupForm(false)
  }

  async function restartHost() {
    if (!confirm('Restarting the host disconnects all web sessions. They come back with --resume when it starts again. Restart?')) return
    const response = await postJson('/api/host/restart', 'POST', {})
    if (!response.ok) alert((await response.json()).message ?? "Couldn't restart host")
  }

  async function restartServer() {
    if (
      !confirm(
        'Restarting the server disconnects this screen for a few seconds. Sessions keep running, status comes back with the next hook, and questions held here must be answered in the Terminal tab. Restart?',
      )
    )
      return
    try {
      const response = await postJson('/api/server/restart', 'POST', {})
      if (response.ok) return
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      alert(`Couldn't restart server: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      alert("Couldn't restart server: Network error")
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

  function cycleTheme() {
    const next = NEXT_THEME[theme]
    setThemeChoice(next)
    setTheme(next)
  }

  async function renameSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameTarget) return
    const form = new FormData(event.currentTarget)
    // 바뀐 이름·역할만 보낸다 (이름만 고쳤는데 역할이 지워지지 않게)
    const patch = renamePatch(renameTarget, String(form.get('name') ?? ''), String(form.get('position') ?? ''))
    if (Object.keys(patch).length > 0) {
      const response = await postJson(`/api/sessions/${renameTarget.id}`, 'PATCH', patch)
      if (!response.ok) {
        alert((await response.json()).message ?? "Couldn't rename session")
        return
      }
    }
    const current = renameTarget.character ?? null
    const isCharacterChanged =
      renameCharacter.id !== (current?.id ?? null) || renameCharacter.hair !== (current?.hair ?? null) || renameCharacter.top !== (current?.top ?? null)
    if (renameTarget.role === 'lead' && isCharacterChanged) {
      const body = renameCharacter.id ? renameCharacter : { id: null }
      const characterResponse = await postJson(`/api/sessions/${renameTarget.id}/character`, 'PUT', body)
      if (!characterResponse.ok) {
        alert((await characterResponse.json().catch(() => ({}))).message ?? "Couldn't change character")
        return
      }
    }
    setRenameTarget(null)
  }

  function openRename(session: Session) {
    setRenameCharacter(session.character ? { ...session.character } : { id: null, hair: null, top: null })
    setRenameTarget(session)
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
    setTypedSessionPosition(null)
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
    const name = prompt('Part name (the worktree folder and branch keep their names)', part.name)
    if (name?.trim()) void postJson(`/api/team/${team.id}/parts/${part.id}`, 'PATCH', { name: name.trim() })
  }

  function releasePartLead(team: Team, part: Part) {
    if (confirm(`Remove the part lead of "${part.name}"? (The session stays and becomes a part member.)`)) {
      void postJson(`/api/team/${team.id}/parts/${part.id}`, 'PATCH', { leadSessionId: null })
    }
  }

  /** worktree 파트는 서버가 폴더·브랜치도 지운다. 브랜치가 병합되지 않았으면 지울지 물어 ?branch= 로 다시 보낸다 */
  async function removePart(team: Team, part: Part) {
    const effect = part.worktree
      ? `The worktree folder ${part.worktree.cwd} is deleted too (not if a session is working there or there are uncommitted changes). Branch ${part.worktree.branch} is deleted if merged; otherwise you'll be asked.`
      : 'Its sessions keep running and move directly under the team.'
    if (!confirm(`Delete part "${part.name}"? ${effect}`)) return
    const url = `/api/team/${team.id}/parts/${part.id}`
    let response = await fetch(url, { method: 'DELETE' })
    let body = (await response.json().catch(() => ({}))) as { code?: string; branch?: string; message?: string }
    if (response.status === 409 && body.code === 'branch-unmerged') {
      const isBranchDeleted = confirm(`Branch ${body.branch} isn't merged. Delete the branch too? (OK = delete, Cancel = keep)`)
      response = await fetch(`${url}?branch=${isBranchDeleted ? 'delete' : 'keep'}`, { method: 'DELETE' })
      body = await response.json().catch(() => ({}))
    }
    if (!response.ok) alert(body.message ?? "Couldn't delete part")
  }

  function releaseLead(team: Team) {
    if (confirm(`Remove the lead of "${team.name}"? (The session stays and becomes a member.)`)) {
      void postJson(`/api/team/${team.id}`, 'PATCH', { leadSessionId: null })
    }
  }

  function removeTeam(team: Team) {
    if (confirm(`Delete team "${team.name}"? Its sessions keep running without a team.`)) {
      void fetch(`/api/team/${team.id}`, { method: 'DELETE' })
    }
  }

  async function removeGroup(group: Group) {
    if (!confirm(`Delete group "${group.name}"?`)) return
    const response = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' })
    if (!response.ok) alert((await response.json()).message ?? "Couldn't delete group")
  }

  async function renameGroup(group: Group) {
    const name = prompt('Group name', group.name)?.trim()
    if (!name || name === group.name) return
    const response = await postJson(`/api/groups/${group.id}`, 'PATCH', { name })
    if (!response.ok) alert(((await response.json().catch(() => ({}))) as { message?: string }).message ?? "Couldn't rename group")
  }

  function endSession(sessionId: string) {
    if (confirm('End this session?')) void fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
  }

  /** 목록 ⋯ 메뉴의 Clock in. 받아들여지면 패널 퇴근 막대와 같이 근무로 바뀔 때까지 "Clocking in…" 으로 막는다 */
  async function clockIn(session: Session) {
    try {
      const response = await postJson(`/api/sessions/${session.id}/resume`, 'POST', {})
      if (response.ok) {
        setReturningSessions((prev) => ({ ...prev, [session.id]: session.offDuty?.endedAt ?? '' }))
        return
      }
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      alert(`Couldn't clock in: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      alert("Couldn't clock in: Network error")
    }
  }

  /** 목록 ⋯ 메뉴의 Delete record. 확인 문구는 패널 퇴근 막대와 같다 */
  async function deleteRecord(sessionId: string) {
    if (!confirm("Delete the off duty record? The session leaves the list and can't clock in again.")) return
    try {
      const response = await fetch(`/api/sessions/${sessionId}/off-duty`, { method: 'DELETE' })
      if (response.ok) return
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      alert(`Couldn't delete record: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      alert("Couldn't delete record: Network error")
    }
  }

  /** TODO 모달이 서버 응답으로 화면 목록을 먼저 바꾼다. 사무실 SSE 가 오면 서버 것으로 바뀐다 */
  function changeTodos(groupId: string, update: (todos: GroupTodo[]) => GroupTodo[]) {
    setOffice((prev) => ({ ...prev, groups: prev.groups.map((g) => (g.id === groupId ? { ...g, todos: update(todosOf(g)) } : g)) }))
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
    const name = prompt(`Team name (folder: ${team.cwd})`, team.name)
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
    alert(`Couldn't change the order: ${failure}`)
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
      <button className="drag-handle" onPointerDown={(event) => startReorder(event, scope, id)} title="Drag to reorder">
        ⠿
      </button>
    )
  }

  /** 끌 수 없는 팀(그룹이 지워진 팀)의 빈 ⠿ 칸. 손잡이와 같은 폭이라 버튼 열이 그룹·팀 줄과 세로로 맞는다 */
  function renderDragSpacer() {
    return (
      <button className="drag-handle drag-spacer" tabIndex={-1} aria-hidden="true" disabled>
        ⠿
      </button>
    )
  }

  /** 그룹 라벨의 TODO 버튼: 체크리스트 아이콘 + 남은 개수. 남은 것이 있으면 늘 보이고 0 이면 "+"·"⋯" 처럼 마우스를 올렸을 때만 (터치 기기는 늘) */
  function renderTodoButton(group: Group) {
    const remaining = remainingCount(group)
    return (
      <button
        className={remaining > 0 ? 'todo-button has-todos' : 'todo-button'}
        onClick={() => setTodoGroupId(group.id)}
        title="TODO"
        aria-label={remaining > 0 ? `TODO · ${remaining} left` : 'TODO'}
      >
        <TodoIcon />
        {remaining > 0 && <span>{remaining}</span>}
      </button>
    )
  }

  function renderSessionModal(teamId: string | null, partId: string | null) {
    const team = teamId ? office.teams.find((t) => t.id === teamId) : undefined
    const part = team?.parts.find((p) => p.id === partId)
    const leadSessionId = part ? part.leadSessionId : team?.leadSessionId
    const hasLiveLead = Boolean(leadSessionId && snapshot.sessions.some((s) => s.id === leadSessionId && s.isAlive))
    const leadLabel = part ? 'Part lead' : 'Lead'
    const sessionPosition = modalPosition(typedSessionPosition, sessionRole, Boolean(team))
    const sessionName = modalName(typedSessionName, suggestedSessionName?.name ?? null, Boolean(team))
    return (
      <Modal
        title={
          part ? `New session — Team "${team?.name}" · Part "${part.name}"` : team ? `New session — Team "${team.name}"` : 'New session — Focus Zone (no team)'
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
                { value: 'member', label: 'Member', hint: `Works on tasks from the ${leadLabel.toLowerCase()}` },
                {
                  value: 'lead',
                  label: leadLabel,
                  isDisabled: hasLiveLead,
                  hint: hasLiveLead
                    ? `This ${part ? 'part' : 'team'} already has a ${leadLabel.toLowerCase()}`
                    : `Spawns ${part ? 'part' : 'team'} members and hands out work (with MCP tools)`,
                },
              ]}
            />
          )}
          {!team && <input name="cwd" placeholder="Folder path (e.g. D:\workspace\foo)" required autoFocus />}
          <div className="field-row">
            <label className="field role">
              <span>Role</span>
              <input
                name="position"
                placeholder="e.g. FE"
                value={sessionPosition}
                onChange={(event) => setTypedSessionPosition(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Name</span>
              <input
                name="name"
                placeholder="Optional; empty = auto title"
                value={sessionName}
                onChange={(event) => setTypedSessionName(event.target.value)}
                autoFocus={Boolean(team)}
              />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="primary">
              Start
            </button>
            <button type="button" onClick={() => setSessionForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  /** 팀 카드: 헤더(이름·세션 수·hover 버튼) + 팀 직속 세션 + 파트별(소제목 + 세션). 폴더는 툴팁. position 은 그룹 안 순번 (그룹이 없는 팀은 없어 끌기 손잡이도 없다) */
  function renderTeam(team: Team, position?: { index: number; count: number }) {
    const scope: ReorderScope = { kind: 'team', groupId: team.groupId }
    // 근무·휴식 세션. 순서는 서버가 준 그대로 (생성순)
    const members = snapshot.sessions.filter((s) => s.teamId === team.id && attendanceOf(s) !== 'off')
    const menuItems: MenuItem[] = [
      { label: 'Rename', onClick: () => editTeam(team) },
      { label: 'Add part', onClick: () => openPartForm(team.id) },
      ...(team.leadSessionId ? [{ label: 'Remove lead', onClick: () => releaseLead(team) }] : []),
      'separator',
      { label: 'Delete team', onClick: () => removeTeam(team) },
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
            <button onClick={() => openSessionForm(team.id)} disabled={!snapshot.isHostReachable} title="Add session to team">
              +
            </button>
            <MoreMenu items={menuItems} />
            {position ? renderDragHandle(scope, team.id) : renderDragSpacer()}
          </span>
        </div>
        {members.filter((s) => !s.partId).map((session) => renderSession(session, false))}
        {team.parts.map((part) => renderPart(team, part, members.filter((s) => s.partId === part.id)))}
      </div>
    )
  }

  /** 파트 소제목(worktree 아이콘·이름·세션 수·hover 버튼) + 파트 세션. 브랜치 이름은 아이콘 툴팁 */
  function renderPart(team: Team, part: Part, members: Session[]) {
    const menuItems: MenuItem[] = [
      { label: 'Rename', onClick: () => editPart(team, part) },
      ...(part.leadSessionId ? [{ label: 'Remove part lead', onClick: () => releasePartLead(team, part) }] : []),
      'separator',
      { label: 'Delete part', onClick: () => void removePart(team, part) },
    ]
    const worktreeLabel = part.worktree ? `worktree · ${part.worktree.branch}` : null
    return (
      <div key={part.id} className="part" title={part.worktree?.cwd ?? team.cwd}>
        <div className="part-head">
          {worktreeLabel && (
            <span className="worktree-icon" role="img" title={worktreeLabel} aria-label={worktreeLabel}>
              <WorktreeIcon />
            </span>
          )}
          <span className="name">{part.name}</span>
          {members.length > 0 && <span className="count">{members.length}</span>}
          <span className="head-actions">
            <button onClick={() => openSessionForm(team.id, part.id)} disabled={!snapshot.isHostReachable} title="Add session to part">
              +
            </button>
            <MoreMenu items={menuItems} />
          </span>
        </div>
        {members.map((session) => renderSession(session, false))}
      </div>
    )
  }

  /** 세션 줄 ⋯ 메뉴: 그 세션에서 되는 것만, 패널의 ✎·모델 칩·전원 아이콘·퇴근 막대와 같은 동작을 부른다 */
  function sessionMenuItems(session: Session): MenuItem[] {
    return sessionMenuEntries(session).map((entry): MenuItem => {
      switch (entry) {
        case 'separator':
          return 'separator'
        case 'rename':
          return { label: 'Rename…', onClick: () => openRename(session) }
        case 'model':
          return restartingIds.has(session.id)
            ? { label: 'Model & effort…', onClick: () => undefined, isDisabled: true, title: 'Restarting…' }
            : { label: 'Model & effort…', onClick: () => setModelModalSessionId(session.id) }
        case 'end':
          return { label: 'End session', onClick: () => endSession(session.id) }
        case 'clock-in': {
          const isReturning = session.id in returningSessions
          return {
            label: 'Clock in',
            onClick: () => void clockIn(session),
            isDisabled: isReturning,
            title: isReturning ? 'Clocking in…' : undefined,
          }
        }
        case 'delete-record':
          return { label: 'Delete record', onClick: () => void deleteRecord(session.id) }
      }
    })
  }

  /**
   * 세션 한 줄: 상태 점 · 아바타 · 제목 · (승인 대기·휴식 배지 · 시각). 팀장은 아바타 금색, 파트장은 은색 테두리. 팀 안에서는 폴더를 숨긴다 (팀 = 폴더). teamName 이 있으면 제목 앞에 붙인다 (퇴근).
   * 휴식은 회색 점 + "휴식", 퇴근은 시각 대신 퇴근 이유 · 시각 (옛 서버 응답이라 이유가 없으면 시각)
   */
  function renderSession(session: Session, hasCwd: boolean, teamName?: string) {
    const look = dotHeadArt ? dotLookOf(session, dotHeadArt.sheet.characters) : null
    const headUrl = look && dotHeadArt ? headImageUrl(dotHeadArt.sheet, dotHeadArt.art, look) : null
    const elapsed = formatElapsed(session.lastAt, now)
    const model = modelLabel(session)
    const attendance = attendanceOf(session)
    const isPresent = attendance === 'present'
    const offDuty = attendance === 'off' && session.offDuty ? offDutyLabel(session.offDuty, now) : null
    const roleLabel = session.role === 'lead' ? (session.partId ? 'Part lead' : 'Lead') : null
    return (
      <div
        key={session.id}
        className={['session', session.id === selectedId ? 'selected' : '', attendance === 'off' ? 'dead' : ''].join(' ')}
        onClick={() => selectSession(session.id)}
      >
        <span
          className={`status-dot ${isPresent ? session.status : attendance}`}
          title={isPresent ? statusLabel[session.status] : attendance === 'break' ? 'Break' : 'Off duty'}
        />
        <span
          className={['avatar', roleLabel === 'Lead' ? 'lead' : roleLabel === 'Part lead' ? 'part-lead' : '', headUrl ? 'head' : ''].join(' ')}
          style={headUrl ? { backgroundImage: `url(${headUrl})` } : undefined}
          role={roleLabel ? 'img' : undefined}
          title={roleLabel ?? undefined}
          aria-label={roleLabel ?? undefined}
        />
        <div className="title">
          {teamName ? `${teamName} · ` : ''}
          <PositionChip position={positionOf(session)} />
          {displayName(session)}
        </div>
        {model && (
          <span className="model" title={session.model ?? undefined}>
            {model}
          </span>
        )}
        <div className="meta">
          {isPresent && session.status === 'needs-approval' && <span className="badge needs-approval">{statusLabel[session.status]}</span>}
          {attendance === 'break' && <span className="badge">Break</span>}
          {/* 시각(퇴근은 이유 · 시각)과 ⋯ 는 한 칸에 겹쳐 있어 줄 폭이 안 바뀐다. 마우스를 올리면 시각이 숨고 ⋯ 가 보인다 */}
          <span className="session-tail">
            {offDuty ? (
              <span className={offDuty.isError ? 'off-duty-reason error' : 'off-duty-reason'} title={offDuty.title}>
                {offDuty.text}
              </span>
            ) : (
              <span className={`time ${elapsed.className}`} title={elapsed.title}>
                {elapsed.text}
              </span>
            )}
            {!isNarrow && !isTouch && (
              <span className="session-more" onClick={(event) => event.stopPropagation()}>
                <MoreMenu items={sessionMenuItems(session)} />
              </span>
            )}
          </span>
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
    if (attendance === 'break') return <p className="hint">On break · Resumes when the host starts it again</p>
    // attendance 가 없는 옛 서버 응답의 끝난 웹 세션: 다시 출근·기록 지우기를 못 한다
    if (attendance === 'off' && session.kind === 'web') return <p className="hint">Off duty · Record is view only</p>
    return undefined
  }

  /** 점프로 연 세션 패널의 헤더 아래 "← <팀장 이름> 대화로". 팀장 세션이 목록에서 빠졌으면 누를 수 없다 */
  function renderJumpBack(back: JumpBack) {
    const from = snapshot.sessions.find((s) => s.id === back.fromSessionId)
    return (
      <div className="jump-back">
        <button onClick={returnFromJump} disabled={!from} title={from ? 'Back to the line you clicked' : "Can't open: no session record"}>
          ← Back to {from ? displayName(from) : back.fromName}
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
            <h1>
              <img className="logo" src="/favicon.svg" width={16} height={16} alt="" />
              jk-corp
            </h1>
            <button className="icon" onClick={cycleTheme} title={`Theme: ${THEME_LABELS[theme]}`} aria-label={`Theme: ${THEME_LABELS[theme]}`}>
              <ThemeIcon choice={theme} />
            </button>
            {/* 폰 폭에는 원래 사무실이 없다 */}
            {!isNarrow && (
              <button
                className="icon"
                onClick={toggleOffice}
                title={isOfficeHidden ? 'Show office' : 'Hide office'}
                aria-label={isOfficeHidden ? 'Show office' : 'Hide office'}
              >
                <OfficeToggleIcon isShown={!isOfficeHidden} />
              </button>
            )}
          </header>
          <div className="toolbar">
            <button onClick={() => setIsGroupForm(true)} title="Create a group">
              <NewGroupIcon />
              New Group
            </button>
            <button onClick={() => openSessionForm(null)} disabled={!snapshot.isHostReachable} title="New session in Focus Zone">
              <NewSessionIcon />
              New Session
            </button>
            <FlowRow status={flowStatus} isSelected={isFlowOpen} onOpen={openFlow} />
          </div>
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
                    {renderTodoButton(group)}
                    <span className="head-actions">
                      <button onClick={() => openTeamForm(group.id)} title="Add team to group">
                        +
                      </button>
                      <MoreMenu
                        items={[
                          { label: 'Rename', onClick: () => void renameGroup(group) },
                          'separator',
                          {
                            label: 'Delete group',
                            onClick: () => void removeGroup(group),
                            isDisabled: teams.length > 0,
                            title: teams.length > 0 ? 'Move or delete its teams first' : undefined,
                          },
                        ]}
                      />
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
              <li ref={offDutyRef} className="group">
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
          <Modal title="New group" onClose={() => setIsGroupForm(false)}>
            <form className="create" onSubmit={createGroup}>
              <input name="name" placeholder="Group name" required autoFocus />
              <div className="actions">
                <button type="submit" className="primary">
                  Create
                </button>
                <button type="button" onClick={() => setIsGroupForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        )}
        {teamForm && (
          <Modal
            title={`New team — Group "${office.groups.find((g) => g.id === teamForm.groupId)?.name ?? ''}"`}
            onClose={() => setTeamForm(null)}
          >
            <form className="create" onSubmit={createTeam}>
              <input name="name" placeholder="Team name" required autoFocus />
              <input name="cwd" placeholder="Work folder (e.g. D:\workspace\foo). Sessions in this folder join the team" required />
              <div className="actions">
                <button type="submit" className="primary">
                  Create
                </button>
                <button type="button" onClick={() => setTeamForm(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        )}
        {sessionForm && renderSessionModal(sessionForm.teamId, sessionForm.partId)}
        {todoGroup && <GroupTodosModal key={todoGroup.id} group={todoGroup} onClose={() => setTodoGroupId(null)} onChangeTodos={changeTodos} />}
        {partForm && (
          <Modal
            title={`New part — Team "${office.teams.find((t) => t.id === partForm.teamId)?.name ?? ''}"`}
            subtitle={office.teams.find((t) => t.id === partForm.teamId)?.cwd}
            onClose={() => setPartForm(null)}
          >
            <form className="create" onSubmit={createPart}>
              <input name="name" placeholder="Part name (e.g. api)" required autoFocus />
              <Segmented
                value={partLocation}
                onChange={setPartLocation}
                options={[
                  { value: 'folder', label: 'Team folder', hint: 'Shares the team folder. For work on separate files' },
                  { value: 'worktree', label: 'New worktree', hint: 'For editing the same files at once. Works in its own folder next to the repo' },
                ]}
              />
              <div className="form-hint">
                {partLocation === 'worktree'
                  ? 'Folder <repo>.worktrees/<name> next to the repo, branch part/<name> (from the current HEAD; only the letters and digits of the name are used; links to an existing worktree or branch). You merge it yourself'
                  : "Uses the team folder as is. Split the work so it doesn't edit the same files as other parts or the team"}
              </div>
              <label className="check">
                <input type="checkbox" checked={isPartLeadSpawned} onChange={(e) => setIsPartLeadSpawned(e.target.checked)} />
                Start a part lead now
              </label>
              <div className="actions">
                <button type="submit" className="primary" disabled={!snapshot.isHostReachable && isPartLeadSpawned}>
                  Create
                </button>
                <button type="button" onClick={() => setPartForm(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        )}
        {renameTarget && (
          <Modal title="Rename session" subtitle={renameTarget.title ?? renameTarget.id} onClose={() => setRenameTarget(null)}>
            <form className="create" onSubmit={renameSession}>
              <div className="field-row">
                <label className="field role">
                  <span>Role</span>
                  <input name="position" defaultValue={positionOf(renameTarget) ?? ''} placeholder="e.g. FE" />
                </label>
                <label className="field">
                  <span>Name</span>
                  <input name="name" defaultValue={editableNameOf(renameTarget)} placeholder="Empty = back to the auto title" autoFocus />
                </label>
              </div>
              {renameTarget.role === 'lead' && (
                <>
                  <span className="form-hint">Office character (shown at the desk, as the list avatar and on the Off Duty street)</span>
                  <CharacterPicker
                    sessionId={renameTarget.id}
                    gender={renameTarget.gender ?? null}
                    value={renameCharacter}
                    onChange={setRenameCharacter}
                  />
                </>
              )}
              <div className="actions">
                <button type="submit" className="primary">
                  Save
                </button>
                <button type="button" onClick={() => setRenameTarget(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        )}
        {/* 폰 폭과 사무실을 숨겼을 때는 PixiJS 를 돌리지 않도록 마운트하지 않는다 (CSS 로 숨기기만 하면 캔버스가 계속 돈다) */}
        {isOfficeHiddenLayout && !hasPanel && <div className="office-empty">Pick a session on the left to open its chat</div>}
        {!isNarrow && !isOfficeHidden && (
          <Office
            office={office}
            sessions={snapshot.sessions}
            selectedId={selectedId}
            focus={officeFocus}
            hasQuestionCard={Boolean(isSelectedLiveWeb && selected.question?.questions.length)}
            onSelect={(sessionId) => selectSession(sessionId, false)}
            onShowOffDutyList={() => {
              setIsOffDutyOpen(true)
              setOffDutyScrollRequest((count) => count + 1)
            }}
            onMoveGroup={moveGroup}
            onMoveTeam={moveTeam}
            onEditTeam={editTeam}
            onOpenGroupTodos={setTodoGroupId}
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
              <b>
                <PositionChip position={positionOf(selected)} />
                {displayName(selected)}
              </b>
              <button className="rename" title="Rename" onClick={() => openRename(selected)}>
                ✎
              </button>
              {restartingIds.has(selected.id) ? (
                <span className="model-chip" title="Restarting with the new model / effort">
                  Restarting…
                </span>
              ) : isSelectedLiveWeb ? (
                <button
                  type="button"
                  className="model-chip is-button"
                  title={[selected.model, nextLabel(selected) && `Next: ${nextLabel(selected)}`, 'Change model & effort'].filter(Boolean).join('\n')}
                  onClick={() => setModelModalSessionId(selected.id)}
                >
                  {modelLabel(selected) ?? 'Model'}
                  {nextLabel(selected) && <span className="model-next"> → {nextLabel(selected)}</span>}
                </button>
              ) : (
                modelLabel(selected) && (
                  <span className="model-chip" title={selected.model ?? undefined}>
                    {modelLabel(selected)}
                  </span>
                )
              )}
              <span className="cwd">{selected.cwd}</span>
              <nav className="tabs">
                <button className={shownTab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')} title="Chat" aria-label="Chat">
                  <ChatTabIcon />
                </button>
                {isSelectedLiveWeb && (
                  <button
                    className={shownTab === 'terminal' ? 'on' : ''}
                    onClick={() => setTab('terminal')}
                    title="Terminal"
                    aria-label="Terminal"
                  >
                    <TerminalTabIcon />
                  </button>
                )}
              </nav>
              {isSelectedLiveWeb && (
                <button
                  className="end-session"
                  title="End session"
                  aria-label="End session"
                  onClick={() => endSession(selected.id)}
                >
                  <EndSessionIcon />
                </button>
              )}
              {/* 폰에서는 패널이 화면 전체라 "뒤로" 가 목록으로 돌아가는 버튼이다 */}
              <button className="close" onClick={() => setSelectedId(null)} title={isNarrow ? 'Back to list' : 'Close'}>
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
                sessionPositions={Object.fromEntries(snapshot.sessions.map((s) => [s.id, positionOf(s)]))}
                jump={jump?.sessionId === selected.id ? jump : null}
                onJumpHandled={() => setJump(null)}
                onOpenRelay={openRelay}
                // 서버는 근무 중이 아닌 세션에 [] 를 준다. 옛 서버 응답은 필드가 없다
                shells={selected.shells ?? []}
                shellRequest={shellRequest?.sessionId === selected.id ? shellRequest : null}
                onShellRequestHandled={() => setShellRequest(null)}
                onQueuedChange={handleQueuedChange}
              />
            )}
          </section>
        )}
        {modelModalSession && attendanceOf(modelModalSession) === 'present' && modelModalSession.kind === 'web' && (
          <ModelSettingModal
            session={modelModalSession}
            hasQueuedMessage={queuedSessionId === modelModalSession.id}
            onClose={() => setModelModalSessionId(null)}
            onApplied={(isRestarted) => {
              if (isRestarted) beginRestart(modelModalSession.id)
              setModelModalSessionId(null)
            }}
          />
        )}
      </main>
      {/* 화면 아래 상태 표시줄: 왼쪽 사용량, 오른쪽 세션 집계·연결 상태와 재시작 ↻ (폰은 목록 화면에서만. style.css) */}
      <footer className="status-bar">
        <UsagePanel />
        <span className="status-right">
          {approvalSessions.length > 0 && (
            <button className="status-approval" onClick={() => selectSession(approvalSessions[0].id)} title="Open a session that needs approval">
              Needs approval {approvalSessions.length}
            </button>
          )}
          <ShellsStatus lines={shellLines(office, snapshot.sessions)} onOpen={openShell} />
          <span className="status-counts">
            Working {workingCount} · On duty {presentSessions.length}
          </span>
          {/* 폰(390px)에서는 위 글자 대신 이 짧은 꼴 "3/9". 데스크톱 CSS 를 건드리지 않으려고 hidden 으로 숨겨 두고 style.css 폰 블록에서만 보인다 */}
          <span className="status-counts-short" hidden title={`Working ${workingCount} · On duty ${presentSessions.length}`}>
            {workingCount}/{presentSessions.length}
          </span>
          <span className="status-link" title={isConnected ? 'Server connected' : 'Server disconnected'}>
            <span className="status-link-label">Server</span>
            <span className={isConnected ? 'dot on' : 'dot'} />
            <button onClick={restartServer} disabled={!isConnected} title="Restart server (offline for a few seconds)">
              ↻
            </button>
          </span>
          <span className="status-link" title={snapshot.isHostReachable ? 'Session host connected' : 'Session host disconnected'}>
            <span className="status-link-label">Host</span>
            <span className={snapshot.isHostReachable ? 'dot on' : 'dot'} />
            <button onClick={restartHost} disabled={!snapshot.isHostReachable} title="Restart host (web sessions disconnect)">
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
    const actionLabel = action === 'return' ? 'clock in' : 'delete record'
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
      setErrorMessage(`Couldn't ${actionLabel}: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      setErrorMessage(`Couldn't ${actionLabel}: Network error`)
    }
    setBusy(null)
  }

  function clearRecord() {
    if (confirm("Delete the off duty record? The session leaves the list and can't clock in again.")) void request('clear')
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
          {isReturning || busy === 'return' ? 'Clocking in…' : 'Clock in'}
        </button>
        <button disabled={isLocked} onClick={clearRecord}>
          {busy === 'clear' || busy === 'cleared' ? 'Deleting…' : 'Delete record'}
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
 * 툴바 세 번째(New Session 아래) Flow 버튼: 플로우 로고 · "Flow" · [종] N · [말풍선] N (안 읽은 알림·채팅). 누르면 오른쪽 패널이 플로우 알림이 된다.
 * 둘 다 0 이면 회색, 하나라도 있으면 강조. 아직 못 셌으면 "…", 키 없음이면 "No key", 확인 실패면 짧게 (전문은 title. 앞 수가 있으면 수 + ⚠)
 */
function FlowRow({ status, isSelected, onOpen }: { status: FlowStatus | null; isSelected: boolean; onOpen: () => void }) {
  const hasCounts = status !== null && status.unreadAlarmCount !== null && status.unreadChatCount !== null
  const hasUnread = hasCounts && (status.unreadAlarmCount! > 0 || status.unreadChatCount! > 0)
  let summary: ReactNode
  let title = 'Show Flow alerts'
  if (status === null) summary = '…'
  else if (!status.isConfigured) {
    summary = 'No key'
    title = 'No FLOW_API_KEY in ~/.claude/flow-key.env'
  } else if (hasCounts) {
    summary = (
      <>
        <span className="flow-row-count">
          <AlertsIcon />
          {status.unreadAlarmCount}
        </span>
        ·
        <span className="flow-row-count">
          <ChatsIcon />
          {status.unreadChatCount}
        </span>
      </>
    )
    title = `Show Flow alerts · Alerts ${status.unreadAlarmCount} · Chats ${status.unreadChatCount}`
  } else summary = status.error ? 'Check failed' : '…'
  if (status?.isConfigured && status.error) title = `Flow check failed: ${status.error}`
  return (
    <button
      className={['flow-row', isSelected ? 'selected' : '', hasUnread ? 'unread' : ''].join(' ')}
      onClick={onOpen}
      title={title}
    >
      <img className="flow-logo" src="/flow-logo.png" alt="" width={16} height={16} />
      <span>Flow</span>
      <span className={status?.isConfigured && status.error && !hasCounts ? 'flow-row-summary error' : 'flow-row-summary'}>{summary}</span>
      {status?.isConfigured && status.error && hasCounts && <span className="flow-row-warning">⚠</span>}
    </button>
  )
}

/** Flow 버튼 요약의 안 읽은 알림 아이콘: 종 */
function AlertsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="Alerts">
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

/** Flow 버튼 요약의 안 읽은 채팅 아이콘: 말풍선 (ChatTabIcon 과 같은 그림) */
function ChatsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" role="img" aria-label="Chats">
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

/** 드롭다운 항목. 'separator' 는 구분선, isDisabled 는 흐리게 두고 누를 수 없다 (이유는 title) */
type MenuItem = { label: string; onClick: () => void; isDisabled?: boolean; title?: string } | 'separator'

/** "⋯" 버튼 + 작은 드롭다운. 바깥 클릭·Esc 로 닫힌다 */
function MoreMenu({ items }: { items: MenuItem[] }) {
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
      <button onClick={() => setIsOpen((prev) => !prev)} title="More">
        ⋯
      </button>
      {isOpen && (
        <div className="menu-list">
          {items.map((item, index) =>
            item === 'separator' ? (
              <hr key={`separator-${index}`} className="menu-separator" />
            ) : (
              <button
                key={item.label}
                disabled={item.isDisabled}
                title={item.title}
                onClick={() => {
                  setIsOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            ),
          )}
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

/** 패널 헤더 종료 버튼 아이콘: 전원 ⏻ */
function EndSessionIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 2v5.5M4.9 4.3a5 5 0 1 0 6.2 0"
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

/** 그룹 라벨의 TODO 아이콘: 체크리스트 (체크한 줄 둘 + 빈 상자 줄 하나). 사무실 그룹 이름표 옆 도트 아이콘(Office.tsx TODO_ICON)과 같은 모양 */
function TodoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.75 3.25l1.25 1.25 2.25-2.5M1.75 8.25l1.25 1.25 2.25-2.5M7.5 3.5h7M7.5 8.5h7M7.5 13.5h7" />
      <rect x="1.75" y="11.75" width="3.5" height="3.5" rx="0.5" />
    </svg>
  )
}

/** 파트 소제목의 worktree 아이콘: 줄기에서 갈라지는 git 브랜치 (원 셋 = 커밋) */
function WorktreeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="4.5" cy="12.5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="11.5" cy="5" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M4.5 5.25v5.5M11.5 6.75c0 2.75-7 1.25-7 4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}
