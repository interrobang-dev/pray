import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Terminal } from './Terminal'
import { FilesTab } from './FilesTab'
import { Chat, type Jump, type JumpTarget } from './Chat'
import { addToComposerDraft } from './composerDraft'
import { hasUnsavedEdit, confirmDiscardUnsaved, whenLeavingAllowed } from './unsavedEdits'
import { sessionIdFromHash } from './sessionLink'
import { parseCollapsedGroupIds, statusSummary, summaryLabel, toggleCollapsedGroup, type StatusCount } from './listCollapse'
import { isBtwShortcut } from './composerText'
import { Office, type OfficeFocus } from './Office'
import { layoutOffice, spotForNewGroup, spotForNewTeam } from './officeLayout'
import { UsagePanel } from './UsagePanel'
import { memoryLabel, memoryLevel, memoryPercent, parseSystemMemory } from './systemMemory'
import { ShellsStatus, shellLines, type ShellRequest } from './Shells'
import { KEY_STEP, clampPanelWidth, parsePanelWidth } from './panelWidth'
import { NewTeamModal } from './NewTeamModal'
import { TeamTodosModal } from './TeamTodosModal'
import { TeamTasksModal } from './TeamTasksModal'
import { remainingCount, todosOf } from './teamTodos'
import { Modal, Segmented } from './Modal'
import { alertDialog, confirmDialog, promptDialog } from './Dialog'
import { copyText } from './copyText'
import { ModelSettingModal, useRestartingSessions } from './ModelSettingModal'
import { nextLabel } from './modelSetting'
import { sessionMenuEntries } from './sessionMenu'
import { LEAD_POSITION, MEMBER_POSITION, editableNameOf, modalName, modalPosition, nameOf, positionOf, renamePatch } from './sessionPosition'
import { PositionChip } from './PositionChip'
import { CharacterPicker, type CharacterChoice } from './CharacterPicker'
import { seatPlaceOf } from './dotState'
import { headImageUrl, loadCharacterSheet, loadRecolorArt, type CharacterSheet, type RecolorArt } from './characterArt'
import { assignCharacter, charactersInUse, dotLookOf, type DotCharacter, type DotLook } from '@pray/host/dotCharacter'
import {
  attendanceOf,
  formatDateTime,
  offDutyLabel,
  statusLabel,
  vcsLabel,
  type Office as OfficeData,
  type Group,
  type TeamTodo,
  type OffDutyLabel,
  type Part,
  type Session,
  type Shell,
  type SystemMemory,
  type Team,
} from './types'
import { AppearanceModal } from './AppearanceModal'
import { contextSizeOf, turnCacheOf } from './contextSize'
import { handOverUnit } from './handOver'
import { HomePanel } from './HomePanel'
import { NeedsYouButton } from './NeedsYouButton'
import { AllTodosButton } from './AllTodosButton'
import { bannerOf, nextOutage, presentWebIds, type Outage, type RestartTarget } from './reconnect'

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
const OFFICE_HIDDEN_KEY = 'pray.isOfficeHidden'

/** 저장된 사무실 숨기기 여부. 읽지 못하면(저장소가 막힌 브라우저 등) 보이기 */
function readIsOfficeHidden(): boolean {
  try {
    return localStorage.getItem(OFFICE_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

/** 사무실이 보일 때 오른쪽 패널 폭(px)을 남기는 localStorage 키 (이 브라우저만) */
const PANEL_WIDTH_KEY = 'pray.panelWidth'

/** 목록 접기를 남기는 localStorage 키 (이 브라우저만): 접힌 그룹 ID 배열(JSON)·Focus Zone 접힘·Off Duty 펼침 */
const COLLAPSED_GROUPS_KEY = 'pray.collapsedGroups'
const FOCUS_ZONE_COLLAPSED_KEY = 'pray.isFocusZoneCollapsed'
const OFF_DUTY_OPEN_KEY = 'pray.isOffDutyOpen'

/** 저장된 값. 읽지 못하면(저장소가 막힌 브라우저 등) null — 기본값으로 본다 */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장하지 못하면 이 화면에서만 바뀐다
  }
}

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

/** isLocal = 이 PC 에서 연 화면(`/api/auth/me`). 팀 폴더는 이 PC 에서만 탐색기로 열고 다른 PC 는 경로 복사 */
export function App({ isLocal }: { isLocal: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ isHostReachable: false, sessions: [] })
  const [office, setOffice] = useState<OfficeData>(EMPTY_OFFICE)
  const [isConnected, setIsConnected] = useState(false)
  /** 서버·호스트가 끊겼다 다시 붙기까지 (위쪽 띠, reconnect.ts). 끊기지 않았으면 null */
  const [outage, setOutage] = useState<Outage | null>(null)
  /** 끊긴 동안 띠 단계를 다시 계산하는 시계 */
  const [outageTick, setOutageTick] = useState(0)
  /** 마지막으로 다 붙어 있을 때 근무 중이던 웹 세션 (호스트가 다시 붙은 뒤 돌아오기를 기다린다) */
  const healthyWebIdsRef = useRef<string[]>([])
  /** 화면 ↻ 로 시작한 재시작 (곧 끊기면 "Restarting …") */
  const restartRequestRef = useRef<{ target: RestartTarget; at: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isGroupForm, setIsGroupForm] = useState(false)
  /** 팀 추가 모달. 그룹 헤더의 "+ 팀" 으로 열리며 그 그룹에 고정 */
  const [teamForm, setTeamForm] = useState<{ groupId: string } | null>(null)
  /** 세션 추가 모달. 팀 헤더의 "+" 면 그 팀 직속, 파트 소제목의 "+" 면 그 파트, Focus Zone 라벨의 "+"·첫 화면 New session 이면 로비(폴더 직접 입력) */
  const [sessionForm, setSessionForm] = useState<{ teamId: string | null; partId: string | null } | null>(null)
  const [sessionRole, setSessionRole] = useState<'member' | 'lead'>('member')
  /** 세션 추가 모달의 "Carry over previous lead's history" 칸 (직전 지시자 기록이 있는 팀·파트에서 Lead 를 고를 때만 보인다) */
  const [isCarryOverChecked, setIsCarryOverChecked] = useState(true)
  /** 세션 추가 요청을 보내는 중 (Hand over 면 서버가 옛 지시자가 끝나기를 최대 10초 기다린다) */
  const [isSessionSubmitting, setIsSessionSubmitting] = useState(false)
  /**
   * 팀·파트 세션 추가 모달에 미리 채울 이름(이름만)과 그 성별. 성별은 이 이름을 그대로 쓸 때만 세션 생성에 넘긴다.
   * Role 칸은 세그먼트(Member/Lead)에 따라 Dev/Lead 로 채운다
   */
  const [suggestedSessionName, setSuggestedSessionName] = useState<MemberNameSuggestion | null>(null)
  /** 사용자가 Name 칸에 직접 쓴 값. null 이면 아직 안 고쳤다 — 고친 뒤로는 추천 이름으로 바꾸지 않는다 */
  const [typedSessionName, setTypedSessionName] = useState<string | null>(null)
  /** 사용자가 Role 칸에 직접 쓴 값. null 이면 아직 안 고쳤다 — 고친 뒤로는 세그먼트로 Dev↔Lead 를 바꾸지 않는다 */
  const [typedSessionPosition, setTypedSessionPosition] = useState<string | null>(null)
  /** 세션 추가 창의 인물 고르기 값과, 아직 ID 가 없는 새 세션의 자동 후보를 고를 때 해시에 쓸 임시 ID (창을 열 때마다 새로) */
  const [sessionCharacter, setSessionCharacter] = useState<CharacterChoice>({ id: null, hair: null, top: null })
  const [sessionCharacterSeed, setSessionCharacterSeed] = useState('')
  /** 이름 바꾸기 창 Name 칸 글 (이름 다시 뽑기가 바꾸므로 state) */
  const [renameName, setRenameName] = useState('')
  /** 이름 바꾸기 창에서 Auto 버튼이 준 이름·성별. Name 칸이 이 이름 그대로면 그 성별을 같이 저장한다 */
  const [autoName, setAutoName] = useState<MemberNameSuggestion | null>(null)
  /** Auto 버튼으로 그동안 보인 이름 (다시 내지 않게)·인물 (건너뛰게). 두 창 공용, 창을 열 때 비운다 */
  const [autoNames, setAutoNames] = useState<string[]>([])
  const [autoSkip, setAutoSkip] = useState<DotLook[]>([])
  /** Auto 가 이름을 받는 중 (버튼 잠금) · Auto 를 누른 횟수 (미리보기 반짝임) */
  const [isAutoBusy, setIsAutoBusy] = useState(false)
  const [autoPulse, setAutoPulse] = useState(0)
  /** 파트 추가 모달. 팀 "⋯" 의 "파트 추가" 로 열린다 */
  const [partForm, setPartForm] = useState<{ teamId: string } | null>(null)
  const [partLocation, setPartLocation] = useState<'folder' | 'worktree'>('folder')
  const [isPartLeadSpawned, setIsPartLeadSpawned] = useState(true)
  /** 이름 변경 모달의 대상 세션 */
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  /** 이름 모달에서 고른 도트 인물 (null = 자동). 지시자일 때만 모달에 보인다 */
  const [renameCharacter, setRenameCharacter] = useState<CharacterChoice>({ id: null, hair: null, top: null })
  const [tab, setTab] = useState<'chat' | 'terminal' | 'files'>('chat')
  /** 대화 탭 안 검색 막대를 열었는지. 세션을 바꾸거나 대화 탭을 떠나면 닫는다 */
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false)
  /** 바뀔 때마다 열려 있는 검색 막대의 입력칸에 포커스한다 (Ctrl+F 를 다시 누름) */
  const [chatSearchFocusId, setChatSearchFocusId] = useState(0)
  /** Ctrl+Shift+B 를 누른 횟수. 바뀔 때마다 대화 탭이 곁가지 질문 카드를 열고 카드 입력칸에 포커스한다 */
  const [btwOpenId, setBtwOpenId] = useState(0)
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
  /** 세션 ID → 곁가지 질문(btw) 문답이 바뀐 횟수 (전역 SSE btw 이벤트). 대화 탭의 카드가 바뀌면 다시 받는다 */
  const [btwVersions, setBtwVersions] = useState<Record<string, number>>({})
  /** 목록 맨 아래 "Off Duty" 구역을 펼쳤는지. 기본 접힘 (localStorage) */
  const [isOffDutyOpen, setIsOffDutyOpen] = useState(() => readStored(OFF_DUTY_OPEN_KEY) === 'true')
  /** 목록에서 접은 그룹 ID·Focus Zone 을 접었는지. 기본 펼침 (localStorage) */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState(() => parseCollapsedGroupIds(readStored(COLLAPSED_GROUPS_KEY)))
  const [isFocusZoneCollapsed, setIsFocusZoneCollapsed] = useState(() => readStored(FOCUS_ZONE_COLLAPSED_KEY) === 'true')
  /** 사무실 퇴근 거리의 "+N" 을 누른 횟수. 바뀌면 펼친 Off Duty 구역으로 목록을 스크롤한다 (펼친 뒤 그려진 다음에) */
  const [offDutyScrollRequest, setOffDutyScrollRequest] = useState(0)
  const offDutyRef = useRef<HTMLLIElement>(null)
  /** [다시 출근] 이 받아들여져 근무로 바뀌기를 기다리는 세션 ID → 그때의 퇴근 시각 (다시 퇴근하면 시각이 바뀐다). 기다리는 동안 패널이 "출근 중…" */
  const [returningSessions, setReturningSessions] = useState<Record<string, string>>({})
  /** 목록의 경과 시간을 1분마다 다시 계산하기 위한 현재 시각 */
  const [now, setNow] = useState(() => Date.now())
  /** 이 PC 메모리 (상태 표시줄 RAM). 5초마다 받고 실패하면 null 이라 칸을 숨긴다 */
  const [systemMemory, setSystemMemory] = useState<SystemMemory | null>(null)
  /** 상태 표시줄 RAM 사용률(%). 모르면 null 이라 칸을 숨긴다 */
  const memoryPercentShown = systemMemory ? memoryPercent(systemMemory) : null
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
  /** 사무실이 보일 때 오른쪽 패널 폭. 패널 왼쪽 가장자리를 끌어 바꾼다 (CSS 가 창 폭에 맞춰 다시 줄인다) */
  const [panelWidth, setPanelWidth] = useState(() => parsePanelWidth(readStored(PANEL_WIDTH_KEY)))
  const [isPanelResizing, setIsPanelResizing] = useState(false)
  const layoutRef = useRef<HTMLElement>(null)
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false)
  /** TODO 모달을 연 팀. 목록 팀 머리줄의 버튼과 사무실 팀 명판 옆 버튼이 같은 모달을 연다 */
  const [todoTeamId, setTodoTeamId] = useState<string | null>(null)
  const todoTeam = todoTeamId ? office.teams.find((t) => t.id === todoTeamId) : undefined
  /** Tasks 창을 연 팀 (팀 ⋯ 메뉴 Tasks). 팀이 사라지면 그리지 않아 닫힌다 */
  const [tasksTeamId, setTasksTeamId] = useState<string | null>(null)
  const tasksTeam = tasksTeamId ? office.teams.find((t) => t.id === tasksTeamId) : undefined

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

  useEffect(() => {
    let isStopped = false
    async function load() {
      try {
        const response = await fetch('/api/system/memory')
        const memory = response.ok ? parseSystemMemory(await response.json()) : null
        if (!isStopped) setSystemMemory(memory)
      } catch {
        if (!isStopped) setSystemMemory(null)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 5000)
    return () => {
      isStopped = true
      clearInterval(timer)
    }
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
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const current = new EventSource('/api/events')
      source = current
      current.addEventListener('sessions', (event) => {
        setSnapshot(JSON.parse((event as MessageEvent).data))
        setIsConnected(true)
      })
      current.addEventListener('office', (event) => setOffice(JSON.parse((event as MessageEvent).data)))
      current.addEventListener('transcript', (event) => {
        const { sessionId } = JSON.parse((event as MessageEvent).data) as { sessionId: string }
        setTranscriptVersions((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }))
      })
      current.addEventListener('btw', (event) => {
        const { sessionId } = JSON.parse((event as MessageEvent).data) as { sessionId: string }
        setBtwVersions((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }))
      })
      current.onerror = () => {
        setIsConnected(false)
        // 연결 거절은 브라우저가 알아서 다시 붙지만, 200 이 아닌 응답(재시작 중 프록시 502 등)을 받으면 CLOSED 로 끝나 다시 붙지 않는다
        if (current.readyState !== EventSource.CLOSED) return
        current.close()
        clearTimeout(retryTimer)
        retryTimer = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      clearTimeout(retryTimer)
      source?.close()
    }
  }, [])

  // 끊김 띠: 연결·세션 목록이 바뀔 때와 끊긴 동안 시계마다 단계를 다시 계산한다
  useEffect(() => {
    const input = { isConnected, isHostReachable: snapshot.isHostReachable, sessions: snapshot.sessions }
    if (!outage && isConnected && snapshot.isHostReachable) healthyWebIdsRef.current = presentWebIds(snapshot.sessions)
    const next = nextOutage(outage, input, Date.now(), healthyWebIdsRef.current, restartRequestRef.current)
    if (next === outage) return
    if (next && next.since !== outage?.since) restartRequestRef.current = null
    setOutage(next)
  }, [isConnected, snapshot, outage, outageTick])

  const connectionBanner = bannerOf(outage, { isConnected, isHostReachable: snapshot.isHostReachable, sessions: snapshot.sessions })
  const isServerWaiting = connectionBanner?.phase === 'server'
  const isHostWaiting = connectionBanner?.phase === 'host' || connectionBanner?.phase === 'resume'
  const hasOutage = outage !== null
  useEffect(() => {
    if (!hasOutage) return
    const timer = setInterval(() => setOutageTick((tick) => tick + 1), 250)
    return () => clearInterval(timer)
  }, [hasOutage])

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
  // 대화 탭에 넘기는 세션 이름·역할. 세션 목록 SSE 는 몇 초마다 새 배열을 주므로 글로 비교해 내용이 바뀔 때만 새 객체를 만든다
  // (새 객체면 대화 탭이 지시·보고 줄을 모두 다시 만든다)
  const sessionNamesJson = JSON.stringify(snapshot.sessions.map((s) => [s.id, displayName(s)]))
  const sessionPositionsJson = JSON.stringify(snapshot.sessions.map((s) => [s.id, positionOf(s)]))
  const sessionNames = useMemo<Record<string, string>>(() => Object.fromEntries(JSON.parse(sessionNamesJson)), [sessionNamesJson])
  const sessionPositions = useMemo<Record<string, string | null>>(() => Object.fromEntries(JSON.parse(sessionPositionsJson)), [sessionPositionsJson])
  const selected = snapshot.sessions.find((s) => s.id === selectedId) ?? null
  const modelModalSession = snapshot.sessions.find((s) => s.id === modelModalSessionId) ?? null
  const isSelectedPresent = selected !== null && attendanceOf(selected) === 'present'
  /** 근무 중인 웹 세션. 터미널·입력·승인·종료는 이때만 (휴식·퇴근 세션 pty 에 키·resize 를 보내지 않게) */
  const isSelectedLiveWeb = isSelectedPresent && selected.kind === 'web'
  const selectedContext = selected ? contextSizeOf(selected.contextTokens) : null
  /** 팀장 교대 지름길: 문맥이 경고 단계인 지금의 팀장·파트장이면 그 팀·파트 (패널 머리 Hand over) */
  const selectedHandOver = selected ? handOverUnit(selected, office.teams) : null
  /** 터미널을 못 여는 세션이면 보던 탭이 터미널이어도 대화. Files 는 읽기만 해서 모든 세션(휴식·퇴근·외부 포함)에 있다 */
  const shownTab = tab === 'terminal' && !isSelectedLiveWeb ? 'chat' : tab
  /** 대화 안 검색을 쓸 수 있는 때: 세션 패널의 대화 탭 (터미널 탭은 범위 밖) */
  const isChatSearchAvailable = selected !== null && shownTab === 'chat'

  useEffect(() => {
    setIsChatSearchOpen(false)
  }, [selectedId, shownTab])

  // Ctrl+F (맥 Meta+F): 대화 탭이 열려 있고 모달이 없을 때만 가로채 대화 검색을 연다. 그 밖에서는 브라우저 찾기 그대로
  useEffect(() => {
    if (!isChatSearchAvailable) return
    const onKeyDown = (event: KeyboardEvent) => {
      const isFindKey = event.code === 'KeyF' || event.key.toLowerCase() === 'f'
      if (!isFindKey || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || document.querySelector('.modal-overlay')) return
      event.preventDefault()
      setIsChatSearchOpen(true)
      setChatSearchFocusId((id) => id + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isChatSearchAvailable])

  // Ctrl+Shift+B (맥 Meta+Shift+B): 근무 중인 웹 세션의 대화 탭이 열려 있고 모달이 없을 때만 가로채 곁가지 질문 카드를 연다.
  // 브라우저의 북마크 막대 토글과 겹쳐서 preventDefault 로 막는다. 그 밖에서는 브라우저 기본 그대로
  useEffect(() => {
    if (!isSelectedLiveWeb || shownTab !== 'chat') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBtwShortcut(event) || document.querySelector('.modal-overlay')) return
      event.preventDefault()
      setBtwOpenId((id) => id + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSelectedLiveWeb, shownTab])

  /** Files 탭 Add to chat: 대화 입력칸(언마운트돼 있다)의 커서 자리에 넣고 대화 탭으로 간다. 입력칸이 그려질 때 포커스한다 */
  function addToChat(snippet: string) {
    whenLeavingAllowed(() => {
      addToComposerDraft(snippet)
      setTab('chat')
    })
  }

  function toggleChatSearch() {
    if (isChatSearchOpen) {
      setIsChatSearchOpen(false)
      return
    }
    setIsChatSearchOpen(true)
    setChatSearchFocusId((id) => id + 1)
  }

  /**
   * 세션을 고른다. 다른 세션이면 대화 탭으로 연다 (같은 세션을 다시 누르면 보던 탭 그대로).
   * 탭과 선택을 한 번에 바꾼다 — 따로 바꾸면 새 세션의 터미널이 잠깐 붙어 그 pty 크기를 바꾼다.
   * 다른 세션을 직접 고르면 점프·돌아가기는 끝난다. 목록·상태 표시줄에서 고르면 사무실 화면도 그 책상으로 옮긴다
   */
  function selectSession(sessionId: string, isOfficeFocused = true) {
    // Files 탭에 저장 안 한 편집이 있으면 버릴지 먼저 묻는다 (없으면 그대로 동기 — 탭과 선택을 한 번에 바꾼다)
    if (sessionId !== selectedId && hasUnsavedEdit()) {
      void confirmDiscardUnsaved().then((isAllowed) => isAllowed && selectSession(sessionId, isOfficeFocused))
      return
    }
    if (sessionId !== selectedId) {
      setTab('chat')
      setJump(null)
      setJumpBack(null)
    }
    setSelectedId(sessionId)
    if (isOfficeFocused && !isNarrow && !isOfficeHidden) {
      setOfficeFocus({ id: nextFocusIdRef.current++, kind: 'session', sessionId })
    }
  }

  function focusTeam(teamId: string) {
    if (isNarrow || isOfficeHidden) return
    setOfficeFocus({ id: nextFocusIdRef.current++, kind: 'team', teamId })
  }

  /** 세션의 대화 탭을 열고 target 으로 간다 (점프·돌아가기) */
  function openJump(sessionId: string, target: JumpTarget) {
    setTab('chat')
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
    if (hasUnsavedEdit()) {
      void confirmDiscardUnsaved().then((isAllowed) => isAllowed && openShell(sessionId, shell))
      return
    }
    selectSession(sessionId)
    setTab('chat')
    setShellRequest({ id: nextShellRequestIdRef.current++, sessionId, shell })
  }

  // 트레이 앱 알림을 누르면 `#session=<id>` 로 연다 (처음 열 때 주소에, 떠 있는 창은 hashchange). 읽으면 해시를 지워 같은 알림을 다시 눌러도 바뀌게 한다
  const selectSessionRef = useRef(selectSession)
  selectSessionRef.current = selectSession
  useEffect(() => {
    const onHash = () => {
      const sessionId = sessionIdFromHash(window.location.hash)
      if (!sessionId) return
      history.replaceState(null, '', window.location.pathname + window.location.search)
      selectSessionRef.current(sessionId)
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 트레이 앱이 "그 세션이 지금 열려 있으면 알리지 않기" 에 읽는다
  useEffect(() => {
    if (selectedId) document.documentElement.dataset.openSession = selectedId
    else delete document.documentElement.dataset.openSession
  }, [selectedId])

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
    const isCarryingOver = isCarryOverShown(sessionForm.teamId, sessionForm.partId) && isCarryOverChecked
    // 살아 있는 지시자가 있으면 그를 끝내고 띄운다 (서버가 끝나기를 기다린다). 확인 창을 취소하면 아무것도 안 한다
    const liveLead = liveLeadOf(sessionForm.teamId, sessionForm.partId)
    if (liveLead) {
      const isMidTurn = liveLead.status === 'working' || liveLead.status === 'waiting' || liveLead.status === 'needs-approval'
      const leadLabel = sessionForm.partId ? 'part lead' : 'lead'
      const message = `End ${displayName(liveLead)} and start a new ${leadLabel}?${isMidTurn ? ' Its current turn will stop.' : ''}`
      if (!(await confirmDialog(message, { confirmLabel: 'End & start', isDanger: true }))) return
    }
    // 인물: 직접 고른 것·뽑은 후보는 그대로, 그대로 Auto 면 창에 보이던 자동 인물을 자동 배정으로 (아틀라스를 못 읽었으면 빼서 서버가 배정)
    const characters = dotHeadArt?.sheet.characters
    const autoCharacter = sessionCharacter.id === null && characters ? newSessionAutoLook(sessionForm.teamId, characters) : null
    const character = sessionCharacter.id ? sessionCharacter : autoCharacter ? { ...autoCharacter, isAuto: true } : undefined
    setIsSessionSubmitting(true)
    let response: Response
    try {
      response = await postJson('/api/sessions', 'POST', {
        character,
        cwd: sessionForm.teamId ? undefined : form.get('cwd'),
        teamId: sessionForm.teamId ?? undefined,
        partId: sessionForm.partId ?? undefined,
        name: form.get('name'),
        position: String(form.get('position') ?? '').trim() || undefined,
        gender: isSuggestedName ? suggestedSessionName?.gender : undefined,
        isLead: Boolean(sessionForm.teamId) && sessionRole === 'lead',
        carryOverHistory: isCarryingOver || undefined,
        replacesLead: liveLead ? true : undefined,
      })
    } finally {
      setIsSessionSubmitting(false)
    }
    if (!response.ok) {
      void alertDialog((await response.json()).message ?? "Couldn't create session")
      return
    }
    const { sessionId, isTrustFailed } = (await response.json()) as { sessionId: string; isTrustFailed?: boolean }
    selectSession(sessionId, false)
    setSessionForm(null)
    if (isTrustFailed) void alertDialog(SESSION_TRUST_FAILED_MESSAGE)
  }

  /** 성공하면 true (창이 닫는다). gitInit 은 이 PC 화면에서만 실린다 */
  async function createTeam(team: { name: string; cwd: string; gitInit?: boolean }): Promise<boolean> {
    if (!teamForm) return false
    // 섬 크기는 화면 배치에서 정해져서 빈 자리도 화면이 찾아 넘긴다 (사무실을 안 띄운 폰에서도 같은 배치로)
    const anchor = spotForNewTeam(layoutOffice(office, snapshot.sessions), teamForm.groupId)
    const response = await postJson('/api/team', 'POST', { ...team, groupId: teamForm.groupId, ...anchor })
    if (!response.ok) {
      void alertDialog((await response.json()).message ?? "Couldn't create team")
      return false
    }
    return true
  }

  /** 파트를 만들고, 고르면 그 파트의 파트장을 바로 띄운다 (파트 API 와 세션 API 두 번 호출) */
  async function createPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!partForm) return
    const form = new FormData(event.currentTarget)
    const isWorktree = partLocation === 'worktree'
    const response = await postJson(`/api/team/${partForm.teamId}/parts`, 'POST', { name: form.get('name'), isWorktree })
    if (!response.ok) {
      void alertDialog((await response.json()).message ?? "Couldn't create part")
      return
    }
    const { part, isTrusted, isLinked } = (await response.json()) as { part: Part; isTrusted: boolean; isLinked?: boolean }
    if (isWorktree && !isTrusted) await alertDialog(`Couldn't mark the folder as trusted. The first session in this folder needs trust allowed in the Terminal tab.\n${part.worktree?.cwd}`)
    if (isLinked) await alertDialog(`Linked to the existing worktree and branch ${part.worktree?.branch} (not created fresh from the current HEAD).\n${part.worktree?.cwd}`)
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
      void alertDialog((await leadResponse.json()).message ?? "Couldn't start part lead")
      return
    }
    const { sessionId, isTrustFailed } = (await leadResponse.json()) as { sessionId: string; isTrustFailed?: boolean }
    selectSession(sessionId, false)
    // worktree 신뢰 실패는 위에서 이미 알렸다 (같은 폴더라 같은 이유)
    if (isTrustFailed && !(isWorktree && !isTrusted)) void alertDialog(SESSION_TRUST_FAILED_MESSAGE)
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const spot = spotForNewGroup(layoutOffice(office, snapshot.sessions))
    const response = await postJson('/api/groups', 'POST', { name: form.get('name'), ...spot })
    if (!response.ok) {
      void alertDialog((await response.json()).message ?? "Couldn't create group")
      return
    }
    setIsGroupForm(false)
  }

  async function restartHost() {
    const isConfirmed = await confirmDialog(
      'Restarting the host disconnects all web sessions. They come back with --resume when it starts again. Restart?',
      { confirmLabel: 'Restart', isDanger: true },
    )
    if (!isConfirmed) return
    restartRequestRef.current = { target: 'host', at: Date.now() }
    const response = await postJson('/api/host/restart', 'POST', {})
    if (response.ok) return
    restartRequestRef.current = null
    void alertDialog((await response.json()).message ?? "Couldn't restart host")
  }

  async function restartServer() {
    const isConfirmed = await confirmDialog(
      'Restarting the server disconnects this screen for a few seconds. Sessions keep running, status comes back with the next hook, and questions held here must be answered in the Terminal tab. Restart?',
      { confirmLabel: 'Restart' },
    )
    if (!isConfirmed) return
    restartRequestRef.current = { target: 'server', at: Date.now() }
    try {
      const response = await postJson('/api/server/restart', 'POST', {})
      if (response.ok) return
      restartRequestRef.current = null
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      void alertDialog(`Couldn't restart server: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      restartRequestRef.current = null
      void alertDialog("Couldn't restart server: Network error")
    }
  }

  /** 패널 폭을 바꾸고 남긴다. 목록·사무실 칸이 남도록 지금 화면 폭으로 줄인다 */
  function changePanelWidth(width: number, isSaved: boolean) {
    const layout = layoutRef.current
    const next = layout ? clampPanelWidth(width, layout.getBoundingClientRect().width) : width
    setPanelWidth(next)
    if (isSaved) writeStored(PANEL_WIDTH_KEY, String(next))
    return next
  }

  function startPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const layout = layoutRef.current
    if (!layout) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setIsPanelResizing(true)
    let last = panelWidth
    const widthAt = (clientX: number) => layout.getBoundingClientRect().right - clientX
    const onMove = (move: PointerEvent) => {
      last = changePanelWidth(widthAt(move.clientX), false)
    }
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      setIsPanelResizing(false)
      writeStored(PANEL_WIDTH_KEY, String(last))
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }

  function resizePanelByKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    // 화면에 보이는 폭(창이 좁아 CSS 가 줄인 폭일 수 있다)에서 시작한다
    const panel = event.currentTarget.nextElementSibling
    const current = panel instanceof HTMLElement ? panel.getBoundingClientRect().width : panelWidth
    changePanelWidth(current + (event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP), true)
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

  function changeOffDutyOpen(isOpen: boolean) {
    setIsOffDutyOpen(isOpen)
    writeStored(OFF_DUTY_OPEN_KEY, String(isOpen))
  }

  function toggleFocusZone() {
    const isCollapsed = !isFocusZoneCollapsed
    setIsFocusZoneCollapsed(isCollapsed)
    writeStored(FOCUS_ZONE_COLLAPSED_KEY, String(isCollapsed))
  }

  function toggleGroup(groupId: string) {
    const ids = toggleCollapsedGroup(
      collapsedGroupIds,
      groupId,
      office.groups.map((g) => g.id),
    )
    setCollapsedGroupIds(ids)
    writeStored(COLLAPSED_GROUPS_KEY, JSON.stringify(ids))
  }

  async function renameSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renameTarget) return
    const form = new FormData(event.currentTarget)
    // 바뀐 이름·역할만 보낸다 (이름만 고쳤는데 역할이 지워지지 않게). Auto 버튼이 준 이름 그대로면 그 성별도
    const namePatch = renamePatch(renameTarget, renameName, String(form.get('position') ?? ''))
    const patch = namePatch.name !== undefined && autoName?.gender && namePatch.name === autoName.name ? { ...namePatch, gender: autoName.gender } : namePatch
    if (Object.keys(patch).length > 0) {
      const response = await postJson(`/api/sessions/${renameTarget.id}`, 'PATCH', patch)
      if (!response.ok) {
        void alertDialog((await response.json()).message ?? "Couldn't rename session")
        return
      }
    }
    // 바뀐 것만 보낸다: id null(그대로 Auto) 은 지금이 직접 고른 인물일 때만 { id: null }(서버가 새로 배정), Auto 카드로 뽑은 후보는 isAuto 로
    const current = renameTarget.character ?? null
    const isSameLook = current !== null && renameCharacter.id === current.id && renameCharacter.hair === current.hair && renameCharacter.top === current.top
    const isCharacterChanged =
      renameCharacter.id === null
        ? current !== null && !current.isAuto
        : !isSameLook || Boolean(renameCharacter.isAuto) !== Boolean(current?.isAuto)
    if (isCharacterChanged) {
      const body = renameCharacter.id ? renameCharacter : { id: null }
      const characterResponse = await postJson(`/api/sessions/${renameTarget.id}/character`, 'PUT', body)
      if (!characterResponse.ok) {
        void alertDialog((await characterResponse.json().catch(() => ({}))).message ?? "Couldn't change character")
        return
      }
    }
    setRenameTarget(null)
  }

  /** 이름 바꾸기 창의 지금 이름 성별: Auto 가 준 이름 그대로면 그 성별, 원래 이름 그대로면 세션 성별, 직접 고쳤으면 없음 */
  function renameGenderOf(session: Session): 'male' | 'female' | null {
    if (autoName && renameName.trim() === autoName.name) return autoName.gender ?? null
    return renameName.trim() === editableNameOf(session) ? (session.gender ?? null) : null
  }

  /**
   * 세션 창(세션 추가·이름 바꾸기)의 Auto 버튼: 무엇을 골랐든·이름을 직접 썼든 이름과 인물을 같이 새로 정한다.
   * 이름은 팀 세션만(이름 추천 API 가 팀 단위) 성별 구분 없이 뽑고(그동안 보인 이름은 exclude), 인물은 그 이름 성별의 다음 자동 후보
   * (자동 배정 규칙, 그동안 보인 인물은 건너뛴다). 팀이 없거나 이름을 못 받으면 인물만 바꾸고 성별은 지금 이름 기준
   */
  async function pressAuto(kind: 'new' | 'rename') {
    const target = kind === 'new' ? sessionForm : renameTarget
    if (!target || isAutoBusy) return
    const teamId = target.teamId ?? null
    const characters = dotHeadArt?.sheet.characters ?? []
    const choice = kind === 'new' ? sessionCharacter : renameCharacter
    let gender = kind === 'new' ? newSessionGender(teamId) : renameTarget ? renameGenderOf(renameTarget) : null
    if (teamId) {
      const shownName = kind === 'new' ? modalName(typedSessionName, suggestedSessionName?.name ?? null, true) : renameName
      const query = new URLSearchParams({ role: MEMBER_POSITION })
      if (target.partId) query.set('partId', target.partId)
      for (const name of [...autoNames, shownName.trim()].filter(Boolean)) query.append('exclude', name)
      setIsAutoBusy(true)
      let data: MemberNameSuggestion | null = null
      try {
        const response = await fetch(`/api/team/${teamId}/member-name?${query}`)
        data = response.ok ? ((await response.json()) as MemberNameSuggestion) : null
      } catch {
        data = null
      } finally {
        setIsAutoBusy(false)
      }
      if (data) {
        const picked = data
        // 이번에 보이던 이름(처음 추천 이름 포함)과 새 이름 모두 다음에 다시 내지 않는다
        setAutoNames((names) => [...names, shownName.trim(), picked.name].filter(Boolean))
        if (kind === 'new') {
          setSuggestedSessionName(picked)
          setTypedSessionName(null)
        } else {
          setRenameName(picked.name)
          setAutoName(picked)
        }
        gender = picked.gender ?? null
      }
    }
    if (characters.length > 0) {
      // 건너뛸 인물: 그동안 보인 것 + 지금 보이는 것 + 처음 자동 인물 (직접 고른 뒤 처음 누를 때도 처음 인물이 다시 나오지 않게)
      const initialLook = kind === 'new' ? newSessionAutoLook(teamId, characters) : renameTarget ? dotLookOf(renameTarget, characters) : null
      const shownLook = choice.id ? { id: choice.id, hair: choice.hair, top: choice.top } : initialLook
      const skip = [...autoSkip, ...(autoSkip.length === 0 && initialLook && shownLook !== initialLook ? [initialLook] : []), ...(shownLook ? [shownLook] : [])]
      const next = nextAutoLook({ id: kind === 'new' || !renameTarget ? sessionCharacterSeed : renameTarget.id, gender, teamId }, characters, skip, Math.random)
      setAutoSkip(skip)
      if (next) (kind === 'new' ? setSessionCharacter : setRenameCharacter)({ ...next, isAuto: true })
    }
    setAutoPulse((count) => count + 1)
  }

  /**
   * 자동 배정 규칙(assignCharacter)으로 고른 인물: 근무·휴식 세션이 지금 보이는 인물 + skip 을 쓰는 중으로 친다.
   * random 을 주면(Auto 버튼) 동점 고르기·색이 누를 때마다 무작위, 안 주면 결정적 (창을 열 때의 처음 인물)
   */
  function nextAutoLook(
    target: { id: string; gender: 'male' | 'female' | null; teamId: string | null },
    characters: DotCharacter[],
    skip: DotLook[],
    random?: () => number,
  ): DotLook | null {
    const inUse = charactersInUse(snapshot.sessions.filter((other) => attendanceOf(other) !== 'off'), characters)
    const skipped = skip.map((look, index) => ({ sessionId: `skip-${index}`, teamId: target.teamId, look }))
    return assignCharacter(target, characters, [...inUse, ...skipped], random)
  }

  function openRename(session: Session) {
    const { character } = session
    setRenameCharacter(character && !character.isAuto ? { id: character.id, hair: character.hair, top: character.top } : { id: null, hair: null, top: null })
    setRenameName(editableNameOf(session))
    setAutoName(null)
    setAutoNames([])
    setAutoSkip([])
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
    setIsCarryOverChecked(true)
    setSuggestedSessionName(null)
    setTypedSessionName(null)
    setTypedSessionPosition(null)
    setSessionCharacter({ id: null, hair: null, top: null })
    setAutoNames([])
    setAutoSkip([])
    // 해시에만 쓰는 임시 ID. crypto.randomUUID 는 다른 PC 의 http 접속(보안 컨텍스트 아님)에 없다
    setSessionCharacterSeed(`new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
    setSessionForm({ teamId, partId })
  }

  /** Hand over: 그 팀·파트의 세션 추가 창을 Lead·인계 칸 켜짐으로 연다. 옛 지시자가 근무 중이면 Start 가 확인 창 뒤 그를 끝내고 새 지시자를 띄운다 */
  function openHandOver(teamId: string, partId: string | null) {
    openSessionForm(teamId, partId)
    setSessionRole('lead')
  }

  function openPartForm(teamId: string) {
    setTeamForm(null)
    setSessionForm(null)
    setPartLocation('folder')
    setIsPartLeadSpawned(true)
    setPartForm({ teamId })
  }

  async function editPart(team: Team, part: Part) {
    const name = await promptDialog('Part name (the worktree folder and branch keep their names)', { defaultValue: part.name, confirmLabel: 'Rename' })
    if (name?.trim()) void postJson(`/api/team/${team.id}/parts/${part.id}`, 'PATCH', { name: name.trim() })
  }

  async function releasePartLead(team: Team, part: Part) {
    const isConfirmed = await confirmDialog(`Remove the part lead of "${part.name}"? (The session stays and becomes a part member.)`, {
      confirmLabel: 'Remove',
    })
    if (isConfirmed) void postJson(`/api/team/${team.id}/parts/${part.id}`, 'PATCH', { leadSessionId: null })
  }

  /** worktree 파트는 서버가 폴더·브랜치도 지운다. 브랜치가 병합되지 않았으면 지울지 물어 ?branch= 로 다시 보낸다 */
  async function removePart(team: Team, part: Part) {
    const effect = part.worktree
      ? `The worktree folder ${part.worktree.cwd} is deleted too (not if a session is working there or there are uncommitted changes). Branch ${part.worktree.branch} is deleted if merged; otherwise you'll be asked.`
      : 'Its sessions keep running and move directly under the team.'
    if (!(await confirmDialog(`Delete part "${part.name}"? ${effect}`, { confirmLabel: 'Delete', isDanger: true }))) return
    const url = `/api/team/${team.id}/parts/${part.id}`
    let response = await fetch(url, { method: 'DELETE' })
    let body = (await response.json().catch(() => ({}))) as { code?: string; branch?: string; message?: string }
    if (response.status === 409 && body.code === 'branch-unmerged') {
      // 버튼 이름이 동작이라 예전 "(OK = delete, Cancel = keep)" 은 뺐다. 닫기(Esc·바깥 클릭)는 브라우저 confirm 처럼 Cancel = 남기기
      const isBranchDeleted = await confirmDialog(`Branch ${body.branch} isn't merged. Delete the branch too?`, {
        confirmLabel: 'Delete branch',
        cancelLabel: 'Keep branch',
        isDanger: true,
      })
      response = await fetch(`${url}?branch=${isBranchDeleted ? 'delete' : 'keep'}`, { method: 'DELETE' })
      body = await response.json().catch(() => ({}))
    }
    if (!response.ok) void alertDialog(body.message ?? "Couldn't delete part")
  }

  async function releaseLead(team: Team) {
    const isConfirmed = await confirmDialog(`Remove the lead of "${team.name}"? (The session stays and becomes a member.)`, { confirmLabel: 'Remove' })
    if (isConfirmed) void postJson(`/api/team/${team.id}`, 'PATCH', { leadSessionId: null })
  }

  async function removeTeam(team: Team) {
    const isConfirmed = await confirmDialog(`Delete team "${team.name}"? Its sessions keep running without a team.`, { confirmLabel: 'Delete', isDanger: true })
    if (isConfirmed) void fetch(`/api/team/${team.id}`, { method: 'DELETE' })
  }

  async function removeGroup(group: Group) {
    if (!(await confirmDialog(`Delete group "${group.name}"?`, { confirmLabel: 'Delete', isDanger: true }))) return
    const response = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' })
    if (!response.ok) void alertDialog((await response.json()).message ?? "Couldn't delete group")
  }

  async function renameGroup(group: Group) {
    const name = (await promptDialog('Group name', { defaultValue: group.name, confirmLabel: 'Rename' }))?.trim()
    if (!name || name === group.name) return
    const response = await postJson(`/api/groups/${group.id}`, 'PATCH', { name })
    if (!response.ok) void alertDialog(((await response.json().catch(() => ({}))) as { message?: string }).message ?? "Couldn't rename group")
  }

  async function endSession(sessionId: string) {
    if (await confirmDialog('End this session?', { confirmLabel: 'End', isDanger: true })) void fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
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
      void alertDialog(`Couldn't clock in: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      void alertDialog("Couldn't clock in: Network error")
    }
  }

  /** 팀 ⋯ 메뉴의 Open folder. 서버가 이 PC 의 탐색기로 연다 */
  async function openTeamFolder(team: Team) {
    try {
      const response = await fetch(`/api/team/${team.id}/open-folder`, { method: 'POST' })
      if (response.ok) return
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      void alertDialog(`Couldn't open folder: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      void alertDialog("Couldn't open folder: Network error")
    }
  }

  /** 다른 PC 에서 연 화면의 팀 ⋯ 메뉴 Copy folder path */
  async function copyTeamFolder(team: Team) {
    if (!(await copyText(team.cwd))) void alertDialog(`Couldn't copy the folder path:\n${team.cwd}`)
  }

  /** 목록 ⋯ 메뉴의 Delete record. 확인 문구는 패널 퇴근 막대와 같다 */
  async function deleteRecord(sessionId: string) {
    const isConfirmed = await confirmDialog("Delete the off duty record? The session leaves the list and can't clock in again.", {
      confirmLabel: 'Delete',
      isDanger: true,
    })
    if (!isConfirmed) return
    try {
      const response = await fetch(`/api/sessions/${sessionId}/off-duty`, { method: 'DELETE' })
      if (response.ok) return
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      void alertDialog(`Couldn't delete record: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      void alertDialog("Couldn't delete record: Network error")
    }
  }

  /** TODO 모달이 서버 응답으로 화면 목록을 먼저 바꾼다. 사무실 SSE 가 오면 서버 것으로 바뀐다 */
  function changeTodos(teamId: string, update: (todos: TeamTodo[]) => TeamTodo[]) {
    setOffice((prev) => ({ ...prev, teams: prev.teams.map((t) => (t.id === teamId ? { ...t, todos: update(todosOf(t)) } : t)) }))
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

  async function editTeam(team: Team) {
    const name = await promptDialog(`Team name (folder: ${team.cwd})`, { defaultValue: team.name, confirmLabel: 'Rename' })
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
    void alertDialog(`Couldn't change the order: ${failure}`)
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

  /** 팀 머리줄의 TODO 버튼: 체크리스트 아이콘 + 남은 개수. 남은 것이 있으면 늘 보이고 0 이면 "+"·"⋯" 처럼 마우스를 올렸을 때만 (터치 기기는 늘) */
  function renderTodoButton(team: Team) {
    const remaining = remainingCount(team)
    return (
      <button
        className={remaining > 0 ? 'todo-button has-todos' : 'todo-button'}
        onClick={() => setTodoTeamId(team.id)}
        title="TODO"
        aria-label={remaining > 0 ? `TODO · ${remaining} left` : 'TODO'}
      >
        <TodoIcon />
        {remaining > 0 && <span>{remaining}</span>}
      </button>
    )
  }

  /** 인계 칸을 보일지: Lead·Part lead 를 골랐고 그 팀·파트에 직전 지시자 기록이 있을 때 (서버 파생 필드 hasPreviousLead. 옛 서버 응답은 없다) */
  function isCarryOverShown(teamId: string | null, partId: string | null): boolean {
    const team = teamId ? office.teams.find((t) => t.id === teamId) : undefined
    const unit = partId ? team?.parts.find((p) => p.id === partId) : team
    return sessionRole === 'lead' && Boolean(unit?.hasPreviousLead)
  }

  /** 그 팀·파트의 근무 중인 지시자. 없으면 undefined */
  function liveLeadOf(teamId: string | null, partId: string | null): Session | undefined {
    const team = teamId ? office.teams.find((t) => t.id === teamId) : undefined
    const part = team?.parts.find((p) => p.id === partId)
    const leadSessionId = part ? part.leadSessionId : team?.leadSessionId
    return leadSessionId ? snapshot.sessions.find((s) => s.id === leadSessionId && s.isAlive) : undefined
  }

  /** 세션 추가 창의 지금 이름 성별: 추천·Auto 이름을 고치지 않았을 때만 */
  function newSessionGender(teamId: string | null): 'male' | 'female' | null {
    return teamId && typedSessionName === null ? (suggestedSessionName?.gender ?? null) : null
  }

  /** 세션 추가 창의 처음 자동 인물: 임시 ID 해시·지금 이름 성별·그 팀 기준 */
  function newSessionAutoLook(teamId: string | null, characters: DotCharacter[]): DotLook | null {
    return nextAutoLook({ id: sessionCharacterSeed, gender: newSessionGender(teamId), teamId }, characters, [])
  }

  function renderSessionModal(teamId: string | null, partId: string | null) {
    const team = teamId ? office.teams.find((t) => t.id === teamId) : undefined
    const part = team?.parts.find((p) => p.id === partId)
    const liveLead = liveLeadOf(teamId, partId)
    const leadLabel = part ? 'Part lead' : 'Lead'
    /** 살아 있는 지시자가 있는데 Lead 를 골랐으면 Start 가 그를 끝내고 새 지시자를 띄운다 (Hand over. 서버 replacesLead) */
    const liveLeadToEnd = team && sessionRole === 'lead' ? liveLead : undefined
    const sessionPosition = modalPosition(typedSessionPosition, sessionRole, Boolean(team))
    const sessionName = modalName(typedSessionName, suggestedSessionName?.name ?? null, Boolean(team))
    return (
      <Modal
        title={
          part ? `New session — Team "${team?.name}" · Part "${part.name}"` : team ? `New session — Team "${team.name}"` : 'New session — Focus Zone (no team)'
        }
        subtitle={part?.worktree?.cwd ?? team?.cwd}
        onClose={() => setSessionForm(null)}
        className="character-modal"
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
                  hint: liveLead
                    ? `Starting ends ${displayName(liveLead)} first`
                    : `Spawns ${part ? 'part' : 'team'} members and hands out work (with MCP tools)`,
                },
              ]}
            />
          )}
          {isCarryOverShown(teamId, partId) && (
            <label className="check" title={`Sends the previous ${leadLabel.toLowerCase()}'s last compact summary and recent requests and replies as the first message`}>
              <input type="checkbox" checked={isCarryOverChecked} onChange={(event) => setIsCarryOverChecked(event.target.checked)} />
              Carry over previous lead's history
            </label>
          )}
          {liveLeadToEnd && (
            <p className="hand-over-note">
              Starting ends {displayName(liveLeadToEnd)} first. A {part ? 'part' : 'team'} has one {leadLabel.toLowerCase()} at a time.
            </p>
          )}
          {!team && <input name="cwd" placeholder="Folder path (e.g. D:\workspace\foo)" required autoFocus />}
          {/* 프로필 카드: 미리보기 | Role·Name · Auto(이름·인물 같이) · 색, 그 아래 인물 격자 */}
          <CharacterPicker
            currentAutoLook={(characters) => newSessionAutoLook(teamId, characters)}
            value={sessionCharacter}
            onChange={setSessionCharacter}
            onAuto={() => void pressAuto('new')}
            isAutoBusy={isAutoBusy}
            autoHint={team ? 'Pick a name and a character for me' : 'Pick a character for me'}
            pulse={autoPulse}
            fields={
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
            }
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={isSessionSubmitting}>
              {isSessionSubmitting ? 'Starting…' : liveLeadToEnd ? `End ${displayName(liveLeadToEnd)} & start` : 'Start'}
            </button>
            <button type="button" onClick={() => setSessionForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  /** 팀 카드: 헤더(이름·SVN 칩·hover 버튼) + 팀 직속 세션 + 파트별(소제목 + 세션). 폴더·형상관리 종류는 툴팁. position 은 그룹 안 순번 (그룹이 없는 팀은 없어 끌기 손잡이도 없다) */
  function renderTeam(team: Team, position?: { index: number; count: number }) {
    const scope: ReorderScope = { kind: 'team', groupId: team.groupId }
    // 근무·휴식 세션. 순서는 서버가 준 그대로 (생성순)
    const members = snapshot.sessions.filter((s) => s.teamId === team.id && attendanceOf(s) !== 'off')
    const vcsName = team.vcs ? (team.vcs.kind === 'git' ? 'git' : 'SVN') : null
    const menuItems: MenuItem[] = [
      isLocal
        ? { label: 'Open folder', onClick: () => void openTeamFolder(team) }
        : { label: 'Copy folder path', onClick: () => void copyTeamFolder(team) },
      { label: 'Rename', onClick: () => void editTeam(team) },
      { label: 'Tasks', onClick: () => setTasksTeamId(team.id) },
      { label: 'Add part', onClick: () => openPartForm(team.id) },
      ...(team.leadSessionId ? [{ label: 'Remove lead', onClick: () => void releaseLead(team) }] : []),
      'separator',
      { label: 'Delete team', onClick: () => void removeTeam(team) },
    ]
    return (
      <div
        key={team.id}
        className={['team', position ? reorderClass(scope, team.id, position.index, position.count) : ''].join(' ')}
        title={vcsName ? `${team.cwd} · ${vcsName}` : team.cwd}
        data-team-id={position ? team.id : undefined}
      >
        <div className="team-head">
          <span className="name" onClick={() => focusTeam(team.id)}>
            {team.name}
          </span>
          {/* 칩은 SVN 만. 대부분 git 이라 git 칩은 정보가 없다 (git 은 카드 title 로만) */}
          {team.vcs?.kind === 'svn' && (
            <span className="vcs-chip" role="img" title={vcsLabel(team.vcs)} aria-label={vcsLabel(team.vcs)}>
              SVN
            </span>
          )}
          {renderTodoButton(team)}
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

  /** 파트 소제목(worktree 아이콘·이름·hover 버튼) + 파트 세션. 브랜치 이름은 아이콘 툴팁 */
  function renderPart(team: Team, part: Part, members: Session[]) {
    const menuItems: MenuItem[] = [
      { label: 'Rename', onClick: () => void editPart(team, part) },
      ...(part.leadSessionId ? [{ label: 'Remove part lead', onClick: () => void releasePartLead(team, part) }] : []),
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
          return { label: 'End session', onClick: () => void endSession(session.id) }
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
   * 세션 한 줄: 아바타 · 제목 · (승인 대기·휴식 배지 · 시각). 상태는 아바타 테두리가 나타낸다
   * (작업 중 파랑 숨쉬기·승인 대기 빨강·내 차례 초록·휴식 회색 점선·라운지(사무실과 같은 seatPlaceOf) 회색 실선, 그 밖은 없음). 아바타의 title·aria-label 이 상태 글자이고
   * 팀장·파트장이면 앞에 "Lead · "·"Part lead · " 이 붙는다. 팀 안에서는 폴더를 숨긴다 (팀 = 폴더). teamName 이 있으면 제목 앞에 붙인다 (퇴근).
   * 퇴근은 시각 대신 퇴근 이유 · 시각 (옛 서버 응답이라 이유가 없으면 시각)
   */
  /** 목록 아바타 툴팁의 상태 글자: 근무 중이면 상태(+ 라운지), 아니면 Break·Off duty */
  function sessionStateLabel(session: Session): string {
    const attendance = attendanceOf(session)
    if (attendance !== 'present') return attendance === 'break' ? 'Break' : 'Off duty'
    const place = seatPlaceOf(session, now)
    const loungeText = place === 'lounge-doze' ? ' · Dozing in lounge' : place === 'lounge' ? ' · Resting in lounge' : ''
    return statusLabel[session.status] + loungeText
  }

  /** 세션 아바타: 도트 인물 머리 그림 + 상태 테두리 클래스 (목록 세션 줄·첫 화면 최근 세션) */
  function renderAvatar(session: Session) {
    const look = dotHeadArt ? dotLookOf(session, dotHeadArt.sheet.characters) : null
    const headUrl = look && dotHeadArt ? headImageUrl(dotHeadArt.sheet, dotHeadArt.art, look) : null
    const attendance = attendanceOf(session)
    const ring = attendance === 'present' ? (seatPlaceOf(session, now) === 'desk' ? session.status : 'lounge') : attendance
    const roleLabel = session.role === 'lead' ? (session.partId ? 'Part lead' : 'Lead') : null
    const stateLabel = sessionStateLabel(session)
    const avatarLabel = roleLabel ? `${roleLabel} · ${stateLabel}` : stateLabel
    return (
      <span
        className={['avatar', ring, headUrl ? 'head' : ''].join(' ')}
        style={headUrl ? { backgroundImage: `url(${headUrl})` } : undefined}
        role="img"
        title={avatarLabel}
        aria-label={avatarLabel}
      />
    )
  }

  function renderSession(session: Session, hasCwd: boolean, teamName?: string) {
    const elapsed = formatElapsed(session.lastAt, now)
    const model = modelLabel(session)
    const attendance = attendanceOf(session)
    const isPresent = attendance === 'present'
    const offDuty = attendance === 'off' && session.offDuty ? offDutyLabel(session.offDuty, now) : null
    return (
      <div
        key={session.id}
        className={['session', session.id === selectedId ? 'selected' : '', attendance === 'off' ? 'dead' : ''].join(' ')}
        onClick={() => selectSession(session.id)}
      >
        {renderAvatar(session)}
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

  /**
   * 목록 라벨(그룹·Focus Zone·Off Duty)의 접기 단추: ▾/▸ · 이름 · 개수 · 접혔을 때만 상태 요약 점(승인 대기·내 차례·작업 중 수).
   * 오른쪽 "+"·"⋯"·⠿ 는 단추 밖(형제)이라 눌러도 접히지 않는다
   */
  function renderGroupToggle(name: string, isOpen: boolean, onToggle: () => void, count: number | null, summary: StatusCount[]) {
    const label = summaryLabel(summary)
    return (
      <button className="group-toggle" onClick={onToggle} aria-expanded={isOpen}>
        <span className="chevron" aria-hidden="true">
          {isOpen ? '▾' : '▸'}
        </span>
        <span className="name">{name}</span>
        {count !== null && <span className="count">{count}</span>}
        {summary.length > 0 && (
          <span className="status-summary" role="img" title={label} aria-label={label}>
            {summary.map((item) => (
              <span key={item.status} className={item.status}>
                {item.count}
              </span>
            ))}
          </span>
        )}
      </button>
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
  const workingCount = presentSessions.filter((s) => s.status === 'working' || s.status === 'waiting').length
  const approvalSessions = presentSessions.filter((s) => s.status === 'needs-approval')
  /** 오른쪽 패널(세션)이 열려 있는지 */
  const hasPanel = selected !== null

  return (
    <div className="app">
      {connectionBanner && (
        <div className={`reconnect-band ${connectionBanner.phase}`} role="status" aria-live="polite">
          {connectionBanner.phase === 'done' ? (
            <span className="reconnect-mark" aria-hidden="true">
              ✓
            </span>
          ) : connectionBanner.phase === 'partial' ? (
            <span className="reconnect-mark" aria-hidden="true">
              !
            </span>
          ) : (
            <span className="reconnect-spinner" aria-hidden="true" />
          )}
          <span className="reconnect-text">{connectionBanner.text}</span>
        </div>
      )}
      <main
        ref={layoutRef}
        className={`layout${hasPanel ? ' with-panel' : ''}${isOfficeHiddenLayout ? ' office-hidden' : ''}${isPanelResizing ? ' panel-resizing' : ''}`}
        style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}
      >
        <aside>
          <header>
            <h1>
              {/* 배율 100% 는 손으로 맞춘 16px 판, 그보다 큰 배율은 벡터판 (16px 판을 늘이면 도트가 고르지 않게 커진다) */}
              <img className="logo" src="/favicon.svg" srcSet="/favicon.svg 1x, /logo.svg 2x" width={16} height={16} alt="" />
              Pray
            </h1>
            <button className="icon" onClick={() => setIsAppearanceOpen(true)} title="Appearance" aria-label="Appearance">
              <AppearanceIcon />
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
          {/* 한 줄: New Group(남는 폭) · 아이콘 버튼들. 아이콘 버튼의 창은 툴바 바로 아래에 붙는다 (.toolbar 기준 absolute) */}
          <div className="toolbar">
            <button className="toolbar-new-group" onClick={() => setIsGroupForm(true)} title="Create a group">
              <NewGroupIcon />
              New Group
            </button>
            <NeedsYouButton sessions={snapshot.sessions} teams={office.teams} now={now} renderAvatar={renderAvatar} onSelect={selectSession} />
            <AllTodosButton office={office} icon={<TodoIcon />} onChangeTodos={changeTodos} onOpenTeam={setTodoTeamId} />
          </div>
          <ul ref={listRef} className={reorderDrag ? 'sessions reordering' : 'sessions'}>
            {office.groups.map((group, groupIndex) => {
              const teams = office.teams.filter((t) => t.groupId === group.id)
              const isOpen = !collapsedGroupIds.includes(group.id)
              const summary = isOpen ? [] : statusSummary(snapshot.sessions.filter((s) => teams.some((t) => t.id === s.teamId)))
              return (
                <li
                  key={group.id}
                  className={['group', reorderClass({ kind: 'group' }, group.id, groupIndex, office.groups.length)].join(' ')}
                  data-group-id={group.id}
                >
                  <div className="group-label">
                    {renderGroupToggle(group.name, isOpen, () => toggleGroup(group.id), null, summary)}
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
                  {isOpen && teams.map((team, teamIndex) => renderTeam(team, { index: teamIndex, count: teams.length }))}
                </li>
              )
            })}
            {orphanTeams.length > 0 && <li className="group">{orphanTeams.map((team) => renderTeam(team))}</li>}
            <li className="group">
              <div className="group-label">
                {renderGroupToggle(
                  'Focus Zone',
                  !isFocusZoneCollapsed,
                  toggleFocusZone,
                  lobbySessions.length > 0 ? lobbySessions.length : null,
                  isFocusZoneCollapsed ? statusSummary(lobbySessions) : [],
                )}
                {/* 팀 없이 세션 추가 (폴더 직접 입력). 라벨 오른쪽 끝 */}
                <span className="head-actions">
                  <button onClick={() => openSessionForm(null)} disabled={!snapshot.isHostReachable} title="New session in Focus Zone">
                    +
                  </button>
                </span>
              </div>
              {!isFocusZoneCollapsed && lobbySessions.map((session) => renderSession(session, true))}
            </li>
            {offDutySessions.length > 0 && (
              <li ref={offDutyRef} className="group">
                <div className="group-label">
                  {/* 근무가 아니라 상태 요약 없이 개수만 */}
                  {renderGroupToggle('Off Duty', isOffDutyOpen, () => changeOffDutyOpen(!isOffDutyOpen), offDutySessions.length, [])}
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
          <NewTeamModal
            groupName={office.groups.find((g) => g.id === teamForm.groupId)?.name ?? ''}
            isLocal={isLocal}
            onClose={() => setTeamForm(null)}
            onCreate={createTeam}
          />
        )}
        {sessionForm && renderSessionModal(sessionForm.teamId, sessionForm.partId)}
        {todoTeam && <TeamTodosModal key={todoTeam.id} team={todoTeam} onClose={() => setTodoTeamId(null)} onChangeTodos={changeTodos} />}
        {tasksTeam && <TeamTasksModal key={tasksTeam.id} team={tasksTeam} onClose={() => setTasksTeamId(null)} />}
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
          <Modal
            title="Rename session"
            subtitle={renameTarget.title ?? renameTarget.id}
            onClose={() => setRenameTarget(null)}
            className="character-modal"
          >
            <form className="create" onSubmit={renameSession}>
              {/* 프로필 카드는 역할과 상관없이 모든 세션 (팀장·파트장·팀원·외부). 이름은 팀 세션만 Auto 가 바꾼다 */}
              <CharacterPicker
                currentAutoLook={(characters) => dotLookOf(renameTarget, characters)}
                value={renameCharacter}
                onChange={setRenameCharacter}
                onAuto={() => void pressAuto('rename')}
                isAutoBusy={isAutoBusy}
                autoHint={renameTarget.teamId ? 'Pick a name and a character for me' : 'Pick a character for me'}
                pulse={autoPulse}
                fields={
                  <div className="field-row">
                    <label className="field role">
                      <span>Role</span>
                      <input name="position" defaultValue={positionOf(renameTarget) ?? ''} placeholder="e.g. FE" />
                    </label>
                    <label className="field">
                      <span>Name</span>
                      <input
                        name="name"
                        value={renameName}
                        onChange={(event) => setRenameName(event.target.value)}
                        placeholder="Empty = back to the auto title"
                        autoFocus
                      />
                    </label>
                  </div>
                }
              />
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
        {isOfficeHiddenLayout && !hasPanel && (
          <HomePanel
            sessions={snapshot.sessions}
            teams={office.teams}
            now={now}
            isHostReachable={snapshot.isHostReachable}
            renderAvatar={renderAvatar}
            stateLabelOf={sessionStateLabel}
            onSelect={selectSession}
            onNewSession={(teamId) => openSessionForm(teamId)}
          />
        )}
        {!isNarrow && !isOfficeHidden && (
          <Office
            office={office}
            sessions={snapshot.sessions}
            selectedId={selectedId}
            focus={officeFocus}
            hasQuestionCard={Boolean(isSelectedLiveWeb && selected.question?.questions.length)}
            onSelect={(sessionId) => selectSession(sessionId, false)}
            onShowOffDutyList={() => {
              changeOffDutyOpen(true)
              setOffDutyScrollRequest((count) => count + 1)
            }}
            onMoveGroup={moveGroup}
            onMoveTeam={moveTeam}
            onEditTeam={(team) => void editTeam(team)}
            onOpenTeamTodos={setTodoTeamId}
          />
        )}
        {/* 사무실이 보일 때만 패널 폭을 끈다 (숨기면 패널이 남는 폭을 다 쓰고, 폰은 한 열). 패널 바로 앞 형제라 키보드 폭 계산이 패널을 잰다 */}
        {hasPanel && !isNarrow && !isOfficeHidden && (
          <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            title="Drag to resize"
            tabIndex={0}
            onPointerDown={startPanelResize}
            onKeyDown={resizePanelByKey}
          />
        )}
        {selected && (
          <section className="panel">
            <div className="panel-header">
              <b>
                <PositionChip position={positionOf(selected)} />
                {displayName(selected)}
              </b>
              <span className="cwd">{selected.cwd}</span>
              <nav className="tabs">
                <button className={shownTab === 'chat' ? 'on' : ''} onClick={() => whenLeavingAllowed(() => setTab('chat'))} title="Chat" aria-label="Chat">
                  <ChatTabIcon />
                </button>
                {isSelectedLiveWeb && (
                  <button
                    className={shownTab === 'terminal' ? 'on' : ''}
                    onClick={() => whenLeavingAllowed(() => setTab('terminal'))}
                    title="Terminal"
                    aria-label="Terminal"
                  >
                    <TerminalTabIcon />
                  </button>
                )}
                <button className={shownTab === 'files' ? 'on' : ''} onClick={() => setTab('files')} title="Files" aria-label="Files">
                  <FilesTabIcon />
                </button>
              </nav>
              {/* 폰은 머리 한 줄에 이름이 보이게 검색·이름 바꾸기·종료를 ⋯ 메뉴 하나로 묶는다 */}
              {isNarrow && (
                <span className="panel-more">
                  <MoreMenu
                    items={[
                      ...(shownTab === 'chat' ? [{ label: isChatSearchOpen ? 'Close search' : 'Search conversation', onClick: toggleChatSearch }] : []),
                      { label: 'Rename…', onClick: () => openRename(selected) },
                      ...(isSelectedLiveWeb ? (['separator', { label: 'End session', onClick: () => void endSession(selected.id) }] as MenuItem[]) : []),
                    ]}
                  />
                </span>
              )}
              {!isNarrow && shownTab === 'chat' && (
                <button
                  type="button"
                  className={`search-toggle${isChatSearchOpen ? ' on' : ''}`}
                  title="Search conversation"
                  aria-label="Search conversation"
                  aria-pressed={isChatSearchOpen}
                  onClick={toggleChatSearch}
                >
                  <SearchTabIcon />
                </button>
              )}
              {!isNarrow && (
                <button className="rename" title="Rename" aria-label="Rename" onClick={() => openRename(selected)}>
                  <RenameIcon />
                </button>
              )}
              {!isNarrow && isSelectedLiveWeb && (
                <button
                  className="end-session"
                  title="End session"
                  aria-label="End session"
                  onClick={() => void endSession(selected.id)}
                >
                  <EndSessionIcon />
                </button>
              )}
              {/* 폰에서는 패널이 화면 전체라 "뒤로" 가 목록으로 돌아가는 버튼이다 */}
              <button className="close" onClick={() => whenLeavingAllowed(() => setSelectedId(null))} title={isNarrow ? 'Back to list' : 'Close'}>
                {isNarrow ? '←' : '×'}
              </button>
            </div>
            {jumpBack?.toSessionId === selected.id && renderJumpBack(jumpBack)}
            {shownTab === 'terminal' ? (
              <Terminal sessionId={selected.id} />
            ) : shownTab === 'files' ? (
              <FilesTab
                key={selected.id}
                sessionId={selected.id}
                cwd={selected.cwd}
                isLocal={isLocal}
                onAddToChat={addToChat}
                addToChatBlockReason={
                  isSelectedLiveWeb
                    ? null
                    : selected.kind !== 'web'
                      ? 'started from a terminal or IDE, so this session is view-only'
                      : attendanceOf(selected) === 'off'
                        ? 'this session is off duty'
                        : 'this session is on a break'
                }
              />
            ) : (
              <Chat
                sessionId={selected.id}
                isWritable={isSelectedLiveWeb}
                footer={renderPanelFooter(selected)}
                contextSize={selectedContext}
                handOverTitle={selectedHandOver && `Hand over: start a new ${selectedHandOver.partId ? 'part lead' : 'lead'} with this one's history`}
                onHandOver={selectedHandOver && (() => openHandOver(selectedHandOver.teamId, selectedHandOver.partId))}
                turnCache={selected ? turnCacheOf(selected.turnUsage) : null}
                modelText={modelLabel(selected)}
                modelFullName={selected.model ?? null}
                modelNextText={nextLabel(selected)}
                isModelRestarting={restartingIds.has(selected.id)}
                onChangeModel={() => setModelModalSessionId(selected.id)}
                // 휴식·퇴근 세션은 훅 상태가 남아 있어도 작업 중·승인 대기로 보지 않는다
                isApprovalNeeded={isSelectedPresent && selected.status === 'needs-approval'}
                isWorking={isSelectedPresent && selected.status === 'working'}
                workingSince={selected.workingSince ?? null}
                pendingTool={selected.pendingTool}
                question={selected.question ?? null}
                suggestion={selected.suggestion ?? null}
                handoverFrom={selected.handover?.fromName ?? null}
                version={transcriptVersions[selected.id] ?? 0}
                btwVersion={btwVersions[selected.id] ?? 0}
                sessionNames={sessionNames}
                sessionPositions={sessionPositions}
                jump={jump?.sessionId === selected.id ? jump : null}
                onJumpHandled={() => setJump(null)}
                onOpenRelay={openRelay}
                // 서버는 근무 중이 아닌 세션에 [] 를 준다. 옛 서버 응답은 필드가 없다
                shells={selected.shells ?? []}
                shellRequest={shellRequest?.sessionId === selected.id ? shellRequest : null}
                onShellRequestHandled={() => setShellRequest(null)}
                onQueuedChange={handleQueuedChange}
                isSearchOpen={isChatSearchOpen}
                searchFocusId={chatSearchFocusId}
                onSearchClose={() => setIsChatSearchOpen(false)}
                btwOpenId={btwOpenId}
              />
            )}
          </section>
        )}
        {isAppearanceOpen && <AppearanceModal onClose={() => setIsAppearanceOpen(false)} />}
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
          {memoryPercentShown !== null && systemMemory && (
            <span
              className={`status-memory ${memoryLevel(memoryPercentShown)}`}
              role="img"
              title={memoryLabel(systemMemory)}
              aria-label={memoryLabel(systemMemory)}
            >
              RAM {memoryPercentShown}%
            </span>
          )}
          <span className="status-counts">
            Working {workingCount} · On duty {presentSessions.length}
          </span>
          {/* 폰(390px)에서는 위 글자 대신 이 짧은 꼴 "3/9". 데스크톱 CSS 를 건드리지 않으려고 hidden 으로 숨겨 두고 style.css 폰 블록에서만 보인다 */}
          <span className="status-counts-short" hidden title={`Working ${workingCount} · On duty ${presentSessions.length}`}>
            {workingCount}/{presentSessions.length}
          </span>
          <span className="status-link" title={isConnected ? 'Server connected' : 'Server disconnected'}>
            <span className="status-link-label">Server</span>
            <span className={[isConnected ? 'dot on' : 'dot', isServerWaiting ? 'is-waiting' : ''].join(' ')} />
            <button
              className={isServerWaiting ? 'is-spinning' : undefined}
              onClick={() => void restartServer()}
              disabled={!isConnected}
              title="Restart server (offline for a few seconds)"
            >
              <span className="restart-glyph">↻</span>
            </button>
          </span>
          <span className="status-link" title={snapshot.isHostReachable ? 'Session host connected' : 'Session host disconnected'}>
            <span className="status-link-label">Host</span>
            <span className={[snapshot.isHostReachable ? 'dot on' : 'dot', isHostWaiting ? 'is-waiting' : ''].join(' ')} />
            <button
              className={isHostWaiting ? 'is-spinning' : undefined}
              onClick={() => void restartHost()}
              disabled={!snapshot.isHostReachable}
              title="Restart host (web sessions disconnect)"
            >
              <span className="restart-glyph">↻</span>
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

  async function clearRecord() {
    const isConfirmed = await confirmDialog("Delete the off duty record? The session leaves the list and can't clock in again.", {
      confirmLabel: 'Delete',
      isDanger: true,
    })
    if (isConfirmed) void request('clear')
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
        <button disabled={isLocked} onClick={() => void clearRecord()}>
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

/** 헤더의 Appearance 버튼 아이콘: 톱니 */
function AppearanceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
      <path d="M6.8 1.5h2.4l.35 1.75 1.2.7 1.7-.57 1.2 2.08-1.35 1.18v1.4l1.35 1.18-1.2 2.08-1.7-.57-1.2.7-.35 1.75H6.8l-.35-1.75-1.2-.7-1.7.57-1.2-2.08 1.35-1.18v-1.4L2.35 5.46l1.2-2.08 1.7.57 1.2-.7z" />
      <circle cx="8" cy="8" r="2" />
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

/** 패널 헤더 Files 탭 아이콘: 폴더 */
function FilesTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M2 4.25A1.25 1.25 0 0 1 3.25 3h3.1l1.4 1.5h5A1.25 1.25 0 0 1 14 5.75v6A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 패널 헤더 대화 검색 아이콘: 돋보기 */
function SearchTabIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="6.8" cy="6.8" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path d="M10 10l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
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

/** 패널 헤더 이름 바꾸기 버튼 아이콘: 연필 (Files 탭 편집 버튼 PencilIcon 과 같은 그림) */
function RenameIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

/** 팀 머리줄의 TODO 아이콘: 체크리스트 (체크한 줄 둘 + 빈 상자 줄 하나). 사무실 팀 명판 옆 도트 아이콘(Office.tsx TODO_ICON)과 같은 모양 */
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
