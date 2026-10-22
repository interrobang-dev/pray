import { attendanceOf, type Group, type Office, type Part, type Session, type Team } from './types'

/**
 * 사무실 배치 (순수 함수, 모든 값은 타일). 그리기(Office.tsx)와 새 그룹·팀 자리 찾기(App.tsx)가 같이 쓴다.
 * 섬·그룹 크기는 여기서만 정해지므로 빈 자리도 여기서 찾는다 (서버는 화면이 준 좌표를 저장만 한다)
 */

/** 책상 간격. 책상 footprint 2×3 타일에 옆 간격 1 */
export const SEAT_STEP = 3
export const DESK_TILES_W = 2
export const DESK_TILES_H = 3
/** 섬 테두리: 책상들 둘레 1타일. 그래서 앵커(첫 책상) = 섬 왼쪽 위 + 1 */
const ISLAND_PADDING = 1
/** 그룹 벽과 섬 사이 (그룹 이름표·화분 자리) */
export const GROUP_MARGIN = 1
/** 섬끼리, 그룹끼리 띄우는 간격 */
const GAP = 1
/** 새 팀 자리로 잡는 크기: 2열 1줄 섬. 빈 섬(책상 하나 폭)만큼만 잡으면 팀원이 둘만 돼도 옆 섬과 겹친다 */
const NEW_ISLAND = { w: SEAT_STEP + DESK_TILES_W + 2 * ISLAND_PADDING, h: DESK_TILES_H + 2 * ISLAND_PADDING }
/** 팀 없는 그룹 크기 = 새 팀 하나가 들어갈 크기 */
const MIN_GROUP = { w: NEW_ISLAND.w + 2 * GROUP_MARGIN, h: NEW_ISLAND.h + 2 * GROUP_MARGIN }
const LOBBY_COLUMNS = 2
const LOBBY_W = 1 + LOBBY_COLUMNS * SEAT_STEP + 1

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  w: number
  h: number
}

/** 섬 안의 파트 구역: 그 파트 책상들의 경계 (절대 좌표). 이름표는 바로 위 1타일에 그린다 */
export interface PartZone extends Rect {
  part: Part
}

/** 팀 섬 경계 */
export interface Island extends Rect {
  team: Team
  zones: PartZone[]
}

/** 그려지는 그룹 영역: 저장된 위치의 최소 크기 + 안의 섬들 */
export interface GroupArea extends Rect {
  group: Group
}

export interface OfficeLayout {
  /** 자리가 있는 세션: 근무·휴식 (퇴근은 그리지 않는다). office.teams 에 없는 팀을 가리키는 세션(office 를 받기 전·팀을 막 지운 뒤)도 자리가 없어 뺀다 */
  seated: Session[]
  /** 책상 왼쪽 위 (절대 좌표) */
  seats: Map<string, Point>
  islands: Island[]
  /** office.groups 순서 */
  groupAreas: GroupArea[]
  /** 로비: 팀 없는 세션(웹·외부)이 모이는 고정 구역. 그룹들의 오른쪽 끝에 붙는다 */
  lobby: Rect
  /** 내용 전체의 오른쪽·아래 끝 */
  right: number
  bottom: number
}

/** 지휘 단위(팀 직속·파트) 인원 → 책상 열 수 */
export function deskColumns(count: number): number {
  return count <= 6 ? 2 : count <= 12 ? 3 : 4
}

function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by }
}

function boundingBox(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 섬 하나: 팀 직속 → 파트 순으로 아래로 쌓는다 (파트 앞에는 이름표 자리 1타일, 세션 없는 파트는 건너뛴다).
 * 단위마다 인원으로 열 수를 정하고, 그 단위의 팀장·파트장이 맨 앞 자리, 나머지는 받은 순서 그대로
 */
function placeTeam(team: Team, members: Session[], seats: Map<string, Point>): Island {
  const partIds = new Set(team.parts.map((p) => p.id))
  // 목록 갱신 사이에 파트를 못 찾으면 팀 직속으로 둔다
  const unitOf = (session: Session) => (session.partId && partIds.has(session.partId) ? session.partId : null)
  const desks: Point[] = []
  const zones: PartZone[] = []
  let top = team.y
  for (const part of [null, ...team.parts]) {
    const unitMembers = members.filter((s) => unitOf(s) === (part?.id ?? null))
    if (unitMembers.length === 0) continue
    const leadSessionId = part ? part.leadSessionId : team.leadSessionId
    const ordered = [...unitMembers.filter((s) => s.id === leadSessionId), ...unitMembers.filter((s) => s.id !== leadSessionId)]
    if (part) top += 1
    const columns = deskColumns(ordered.length)
    ordered.forEach((session, index) => {
      const seat = { x: team.x + (index % columns) * SEAT_STEP, y: top + Math.floor(index / columns) * SEAT_STEP }
      seats.set(session.id, seat)
      desks.push(seat)
    })
    const unit = {
      x: team.x,
      y: top,
      w: (Math.min(columns, ordered.length) - 1) * SEAT_STEP + DESK_TILES_W,
      h: (Math.ceil(ordered.length / columns) - 1) * SEAT_STEP + DESK_TILES_H,
    }
    if (part) zones.push({ part, ...unit })
    top += unit.h
  }
  // 세션 없는 팀은 책상 하나 자리. 파트 이름표 자리(구역 위 1타일)도 섬 안에 넣는다
  const occupied = [
    ...(desks.length ? desks : [{ x: team.x, y: team.y }]).map((p) => ({ ...p, w: DESK_TILES_W, h: DESK_TILES_H })),
    ...zones.map((z) => ({ ...z, y: z.y - 1, h: z.h + 1 })),
  ]
  return { team, zones, ...inflate(boundingBox(occupied), ISLAND_PADDING) }
}

/** 저장된 위치의 최소 크기 영역에 그 그룹 섬들(+ 벽 여백)을 더한 경계 */
function groupAreaOf(group: Group, islands: Island[]): GroupArea {
  const own = islands.filter((i) => i.team.groupId === group.id).map((i) => inflate(i, GROUP_MARGIN))
  return { group, ...boundingBox([{ x: group.x, y: group.y, ...MIN_GROUP }, ...own]) }
}

export function layoutOffice(office: Office, sessions: Session[]): OfficeLayout {
  const teamIds = new Set(office.teams.map((t) => t.id))
  const seated = sessions.filter((s) => attendanceOf(s) !== 'off' && (!s.teamId || teamIds.has(s.teamId)))
  const seats = new Map<string, Point>()
  const islands = office.teams.map((team) =>
    placeTeam(
      team,
      seated.filter((s) => s.teamId === team.id),
      seats,
    ),
  )
  const groupAreas = office.groups.map((group) => groupAreaOf(group, islands))
  // 그룹이 지워진 팀의 섬도 로비가 가리지 않게 같이 본다
  const placed: Rect[] = [...groupAreas, ...islands]
  const lobbySessions = seated.filter((s) => !s.teamId)
  const rows = Math.max(1, Math.ceil(lobbySessions.length / LOBBY_COLUMNS))
  const lobby = {
    x: placed.length ? Math.max(...placed.map((r) => r.x + r.w)) + GAP : 0,
    y: 0,
    w: LOBBY_W,
    h: Math.max(rows * SEAT_STEP + 2, ...placed.map((r) => r.y + r.h)),
  }
  lobbySessions.forEach((session, index) => {
    seats.set(session.id, {
      x: lobby.x + 1 + (index % LOBBY_COLUMNS) * SEAT_STEP,
      y: lobby.y + 1 + Math.floor(index / LOBBY_COLUMNS) * SEAT_STEP,
    })
  })
  return { seated, seats, islands, groupAreas, lobby, right: lobby.x + lobby.w, bottom: lobby.y + lobby.h }
}

/**
 * preferred 에서 가장 가까운(맨해튼 거리, 같으면 위, 그다음 왼쪽) 자리 중 size 사각형이 obstacles 와 겹치지 않는 곳. x·y 는 min 이상.
 * 모든 장애물의 오른쪽 끝 너머는 늘 비어 있어 거기까지만 본다
 */
export function findFreeSpot(size: { w: number; h: number }, preferred: Point, obstacles: Rect[], min: Point): Point {
  const maxX = Math.max(min.x, preferred.x, ...obstacles.map((o) => o.x + o.w))
  const maxY = Math.max(min.y, preferred.y, ...obstacles.map((o) => o.y + o.h))
  let best: Point = { x: maxX, y: Math.max(min.y, preferred.y) }
  let bestDistance = Infinity
  for (let y = min.y; y <= maxY; y++) {
    for (let x = min.x; x <= maxX; x++) {
      const distance = Math.abs(x - preferred.x) + Math.abs(y - preferred.y)
      if (distance >= bestDistance) continue
      const rect = { x, y, w: size.w, h: size.h }
      if (obstacles.some((o) => overlaps(rect, o))) continue
      best = { x, y }
      bestDistance = distance
    }
  }
  return best
}

/** 새 그룹 자리 (최소 크기). 그려진 그룹·섬과 GAP 만큼 띄운다. 로비는 늘 그룹들 오른쪽 끝으로 따라가므로 피하지 않는다 */
export function spotForNewGroup(layout: OfficeLayout): Point {
  const obstacles = [...layout.groupAreas, ...layout.islands].map((r) => inflate(r, GAP))
  return findFreeSpot(MIN_GROUP, { x: 0, y: 0 }, obstacles, { x: 0, y: 0 })
}

/**
 * 새 팀의 앵커. 그룹 안 왼쪽 위에서 가장 가까운 빈 자리이고, 그룹을 왼쪽·위로 늘리지 않는다.
 * 그룹이 그 섬만큼 늘어나도 다른 그룹과 겹치지 않게 다른 그룹은 벽 여백만큼 더 띄운다. 그룹이 없으면 null
 */
export function spotForNewTeam(layout: OfficeLayout, groupId: string): Point | null {
  const area = layout.groupAreas.find((a) => a.group.id === groupId)
  if (!area) return null
  const origin = { x: area.x + GROUP_MARGIN, y: area.y + GROUP_MARGIN }
  const obstacles = [
    ...layout.islands.map((i) => inflate(i, GAP)),
    ...layout.groupAreas.filter((a) => a !== area).map((a) => inflate(a, GROUP_MARGIN + GAP)),
  ]
  const spot = findFreeSpot(NEW_ISLAND, origin, obstacles, origin)
  return { x: spot.x + ISLAND_PADDING, y: spot.y + ISLAND_PADDING }
}

/**
 * 끌어 놓은 섬의 새 자리. 그룹은 놓은 앵커가 든 그룹(그 섬을 뺀 그룹 영역 기준, 없으면 원래 그룹)이고,
 * 다른 섬과 겹치거나 GAP 보다 가까우면 놓은 자리에서 가장 가까운 빈 자리로 붙인다
 */
export function dropIsland(layout: OfficeLayout, team: Team, anchor: Point): { groupId: string; x: number; y: number } {
  const island = layout.islands.find((i) => i.team.id === team.id)
  const others = layout.islands.filter((i) => i.team.id !== team.id)
  const target = layout.groupAreas
    .map((a) => groupAreaOf(a.group, others))
    .find((a) => anchor.x >= a.x && anchor.x < a.x + a.w && anchor.y >= a.y && anchor.y < a.y + a.h)
  const groupId = target?.group.id ?? team.groupId
  if (!island) return { groupId, ...anchor }
  const offset = { x: island.x - team.x, y: island.y - team.y }
  const spot = findFreeSpot(
    island,
    { x: anchor.x + offset.x, y: anchor.y + offset.y },
    others.map((i) => inflate(i, GAP)),
    { x: GROUP_MARGIN, y: GROUP_MARGIN },
  )
  return { groupId, x: spot.x - offset.x, y: spot.y - offset.y }
}
