import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from './Terminal'
import { Chat } from './Chat'
import { Office } from './Office'
import { UsagePanel } from './UsagePanel'
import { Modal, Segmented } from './Modal'
import { statusLabel, type Office as OfficeData, type Group, type Part, type Session, type SessionStatus, type Team } from './types'
import { avatarOf, cssColor } from './avatar'

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
}

const EMPTY_OFFICE: OfficeData = { groups: [], teams: [] }

/** 이 폭 이하는 폰 화면: 한 열(목록 ↔ 패널)이고 사무실을 마운트하지 않는다. style.css 의 @media 와 같은 값 */
const NARROW_QUERY = '(max-width: 768px)'

/** 세션 API 가 그 폴더를 ~/.claude.json 에 신뢰로 기록하지 못했을 때 (isTrustFailed) */
const SESSION_TRUST_FAILED_MESSAGE =
  '신뢰 표시를 남기지 못했습니다. 이 폴더에서 처음 뜨는 세션이면 터미널 탭에서 신뢰를 직접 허용해야 합니다 (기본 선택 "No, exit" 를 그대로 두면 세션이 꺼집니다).'

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
  const [isGroupForm, setIsGroupForm] = useState(false)
  /** 팀 추가 모달. 그룹 헤더의 "+ 팀" 으로 열리며 그 그룹에 고정 */
  const [teamForm, setTeamForm] = useState<{ groupId: string } | null>(null)
  /** 세션 추가 모달. 팀 헤더의 "+" 면 그 팀 직속, 파트 소제목의 "+" 면 그 파트, 툴바의 "+ 세션" 이면 로비(폴더 직접 입력) */
  const [sessionForm, setSessionForm] = useState<{ teamId: string | null; partId: string | null } | null>(null)
  const [sessionRole, setSessionRole] = useState<'member' | 'lead'>('member')
  /** 파트 추가 모달. 팀 "⋯" 의 "파트 추가" 로 열린다 */
  const [partForm, setPartForm] = useState<{ teamId: string } | null>(null)
  const [partLocation, setPartLocation] = useState<'folder' | 'worktree'>('folder')
  const [isPartLeadSpawned, setIsPartLeadSpawned] = useState(true)
  /** 이름 변경 모달의 대상 세션 */
  const [renameTarget, setRenameTarget] = useState<Session | null>(null)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  const [transcriptVersions, setTranscriptVersions] = useState<Record<string, number>>({})
  /** 목록 맨 아래 "휴무"(죽은 세션) 구역을 펼쳤는지. 기본 접힘 */
  const [isOffDutyOpen, setIsOffDutyOpen] = useState(false)
  /** 목록의 경과 시간을 1분마다 다시 계산하기 위한 현재 시각 */
  const [now, setNow] = useState(() => Date.now())
  /**
   * 목록에서 끌고 있는 그룹·팀과 놓일 자리 (끌기로 판정된 뒤에만).
   * dropIndex 는 형제 목록에서 이 순번 앞(길이면 맨 끝)이고, 놓아도 순서가 그대로인 자리면 null (선을 안 그린다)
   */
  const [reorderDrag, setReorderDrag] = useState<{ scope: ReorderScope; id: string; dropIndex: number | null } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const isNarrow = useMediaQuery(NARROW_QUERY)

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
    source.addEventListener('transcript', (event) => {
      const { sessionId } = JSON.parse((event as MessageEvent).data) as { sessionId: string }
      setTranscriptVersions((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }))
    })
    source.onerror = () => setIsConnected(false)
    return () => source.close()
  }, [])

  const selected = snapshot.sessions.find((s) => s.id === selectedId) ?? null

  /**
   * 세션을 고른다. 다른 세션이면 대화 탭으로 연다 (같은 세션을 다시 누르면 보던 탭 그대로).
   * 탭과 선택을 한 번에 바꾼다 — 따로 바꾸면 새 세션의 터미널이 잠깐 붙어 그 pty 크기를 바꾼다
   */
  function selectSession(sessionId: string) {
    if (sessionId !== selectedId) setTab('chat')
    setSelectedId(sessionId)
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
    selectSession(sessionId)
    setSessionForm(null)
    if (isTrustFailed) alert(SESSION_TRUST_FAILED_MESSAGE)
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!teamForm) return
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/team', 'POST', { name: form.get('name'), cwd: form.get('cwd'), groupId: teamForm.groupId })
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
    const { part, isTrusted } = (await response.json()) as { part: Part; isTrusted: boolean }
    if (isWorktree && !isTrusted) alert(`신뢰 표시를 남기지 못했습니다. 이 폴더에서 처음 뜨는 세션은 터미널에서 신뢰를 직접 허용해야 합니다.\n${part.worktree?.cwd}`)
    setPartForm(null)
    if (!isPartLeadSpawned) return
    const leadResponse = await postJson('/api/sessions', 'POST', {
      teamId: partForm.teamId,
      partId: part.id,
      isLead: true,
    })
    if (!leadResponse.ok) {
      alert((await leadResponse.json()).message ?? '파트장 생성 실패')
      return
    }
    const { sessionId, isTrustFailed } = (await leadResponse.json()) as { sessionId: string; isTrustFailed?: boolean }
    selectSession(sessionId)
    // worktree 신뢰 실패는 위에서 이미 알렸다 (같은 폴더라 같은 이유)
    if (isTrustFailed && !(isWorktree && !isTrusted)) alert(SESSION_TRUST_FAILED_MESSAGE)
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/groups', 'POST', { name: form.get('name') })
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

  function removePart(team: Team, part: Part) {
    const effect = part.worktree
      ? `worktree 폴더와 브랜치 ${part.worktree.branch} 는 남습니다. 그 폴더의 세션은 팀 폴더 밖이라 로비로 갑니다.`
      : '소속 세션은 종료되지 않고 팀 직속이 됩니다.'
    if (confirm(`"${part.name}" 파트를 지울까요? ${effect}`)) {
      void fetch(`/api/team/${team.id}/parts/${part.id}`, { method: 'DELETE' })
    }
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

  function updateGroupBounds(groupId: string, bounds: Pick<Group, 'x' | 'y' | 'w' | 'h'>) {
    setOffice((prev) => ({ ...prev, groups: prev.groups.map((r) => (r.id === groupId ? { ...r, ...bounds } : r)) }))
    void postJson(`/api/groups/${groupId}`, 'PATCH', bounds)
  }

  function patchTeam(teamId: string, patch: Partial<Team>) {
    setOffice((prev) => ({ ...prev, teams: prev.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)) }))
  }

  function moveDesk(teamId: string, sessionId: string, desk: { dx: number; dy: number }) {
    const team = office.teams.find((t) => t.id === teamId)
    if (team) patchTeam(teamId, { desks: { ...team.desks, [sessionId]: desk } })
    void postJson(`/api/team/${teamId}/desks/${sessionId}`, 'PUT', desk)
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
          <input name="name" placeholder="세션 이름 (선택. 비우면 대화 내용으로 자동 제목)" autoFocus={Boolean(team)} />
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
    const members = snapshot.sessions
      .filter((s) => s.teamId === team.id && s.isAlive)
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
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
          <span className="name">{team.name}</span>
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
      { label: '파트 삭제', onClick: () => removePart(team, part) },
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

  /** 세션 한 줄: 상태 점 · 아바타 · 제목 · (팀장 태그 · 승인 대기 배지 · 시각). 팀 안에서는 폴더를 숨긴다 (팀 = 폴더). teamName 이 있으면 제목 앞에 붙인다 (휴무) */
  function renderSession(session: Session, hasCwd: boolean, teamName?: string) {
    const avatar = avatarOf(session.id)
    const elapsed = formatElapsed(session.lastAt, now)
    const model = modelLabel(session)
    return (
      <div
        key={session.id}
        className={['session', session.id === selectedId ? 'selected' : '', session.isAlive ? '' : 'dead'].join(' ')}
        onClick={() => selectSession(session.id)}
      >
        <span className={`status-dot ${session.status}`} title={statusLabel[session.status]} />
        <span className="avatar" style={{ '--hair': cssColor(avatar.hair), '--skin': cssColor(avatar.skin) } as CSSProperties} />
        <div className="title">{teamName ? `${teamName} · ${displayName(session)}` : displayName(session)}</div>
        {model && (
          <span className="model" title={session.model ?? undefined}>
            {model}
          </span>
        )}
        <div className="meta">
          {session.role === 'lead' &&
            (session.partId ? <span className="badge role-part-lead">파트장</span> : <span className="badge role-lead">팀장</span>)}
          {session.status === 'needs-approval' && <span className="badge needs-approval">{statusLabel[session.status]}</span>}
          <span className={`time ${elapsed.className}`} title={elapsed.title}>
            {elapsed.text}
          </span>
        </div>
        {hasCwd && <div className="cwd">{session.cwd}</div>}
      </div>
    )
  }

  /** 그룹이 지워져 소속 그룹이 없는 팀. 라벨 없이 그대로 보여 준다 */
  const orphanTeams = office.teams.filter((t) => !office.groups.some((g) => g.id === t.groupId))
  const lobbySessions = snapshot.sessions.filter((s) => !s.teamId && s.isAlive)
  /** 죽은 세션은 팀·로비에서 빼고 맨 아래 "휴무" 에 모은다. 서버가 준 순서(최근 활동 순) 그대로 */
  const offDutySessions = snapshot.sessions.filter((s) => !s.isAlive)

  return (
    <main className={selected ? 'layout with-panel' : 'layout'}>
      <aside>
        <header>
          <h1>jk-corp</h1>
          <span className={isConnected ? 'dot on' : 'dot'} title={isConnected ? '서버 연결됨' : '서버 끊김'} />
          <span
            className={snapshot.isHostReachable ? 'dot on' : 'dot'}
            title={snapshot.isHostReachable ? '세션 호스트 연결됨' : '세션 호스트 끊김'}
          />
          <button className="icon" onClick={restartHost} disabled={!snapshot.isHostReachable} title="호스트 재시작 (웹 세션 끊김)">
            ↻
          </button>
        </header>
        <div className="toolbar">
          <button onClick={() => setIsGroupForm(true)}>+ 그룹</button>
          <button onClick={() => openSessionForm(null)} disabled={!snapshot.isHostReachable}>
            + 세션 (로비)
          </button>
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
              <span className="name">로비</span>
              {lobbySessions.length > 0 && <span className="count">{lobbySessions.length}</span>}
            </div>
            {lobbySessions.map((session) => renderSession(session, true))}
          </li>
          {offDutySessions.length > 0 && (
            <li className="group">
              <div className="group-label toggle" onClick={() => setIsOffDutyOpen(!isOffDutyOpen)}>
                <span className="name">
                  {isOffDutyOpen ? '▾' : '▸'} 휴무
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
        <UsagePanel />
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
                ? '저장소 옆 <저장소>.worktrees/<이름> 폴더, 브랜치 part/<이름> (현재 HEAD 기준. 이름의 영문·숫자만 씀). 병합은 직접'
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
      {/* 폰 폭에서는 PixiJS 를 돌리지 않도록 마운트하지 않는다 (CSS 로 숨기기만 하면 캔버스가 계속 돈다) */}
      {!isNarrow && (
        <Office
          office={office}
          sessions={snapshot.sessions}
          selectedId={selectedId}
          onSelect={selectSession}
          onMoveDesk={moveDesk}
          onMoveTeam={moveTeam}
          onEditTeam={editTeam}
          onEditGroup={editGroup}
          onUpdateGroupBounds={updateGroupBounds}
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
              <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
                대화
              </button>
              {selected.kind === 'web' && (
                <button className={tab === 'terminal' ? 'on' : ''} onClick={() => setTab('terminal')}>
                  터미널
                </button>
              )}
            </nav>
            {selected.kind === 'web' && (
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
          {tab === 'terminal' && selected.kind === 'web' ? (
            <Terminal sessionId={selected.id} />
          ) : (
            <Chat
              sessionId={selected.id}
              isWritable={selected.kind === 'web'}
              isApprovalNeeded={selected.status === 'needs-approval'}
              isWorking={selected.status === 'working'}
              workingSince={selected.workingSince ?? null}
              pendingTool={selected.pendingTool}
              question={selected.question ?? null}
              suggestion={selected.suggestion ?? null}
              version={transcriptVersions[selected.id] ?? 0}
              sessionNames={Object.fromEntries(snapshot.sessions.map((s) => [s.id, displayName(s)]))}
            />
          )}
        </section>
      )}
    </main>
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
