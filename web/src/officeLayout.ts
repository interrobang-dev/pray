import { attendanceOf, type Group, type Office, type Part, type Session, type Team } from './types'

/**
 * 사무실 배치 (순수 함수, 모든 값은 타일). 그리기(Office.tsx)와 새 그룹·팀 자리 찾기(App.tsx)가 같이 쓴다.
 * 섬·그룹 크기는 여기서만 정해지므로 빈 자리도 여기서 찾는다 (서버는 화면이 준 좌표를 저장만 한다)
 */

/**
 * 칸막이 블록 줄 하나 = 4타일 (윗자리 몫 1 + 블록 모듈 2 + 아랫자리 몫 1, office-v5-props 메타 block.h 192 도트 px).
 * 짝 = 마주 보는 두 자리(윗자리는 아래를, 아랫자리는 위를 본다)가 한 모듈, 폭 2타일
 */
const BLOCK_ROW_H = 4
/** 짝 없이 지휘자만 있는 블록 줄 높이: 지휘자 책상 아래 끝(블록 줄 위에서 144 도트 px)까지라 아랫자리 몫이 없다 */
const LEAD_ONLY_ROW_H = 3
const PAIR_W = 2
/** 칸막이 블록 한 줄에 놓는 짝 수의 최대. 넘치면 줄을 더 쌓고 줄마다 짝 수를 고르게 나눈다 */
const MAX_PAIRS_PER_ROW = 4
/** 블록 줄 사이 통로 (위 줄 아랫자리 의자·아래 줄 윗사람 머리가 조금씩 나온다) */
const BLOCK_ROW_GAP = 1
/** 지휘자 자리 열 (블록 왼쪽) */
const LEAD_W = 2
/** 블록 오른쪽 끝 화분 열 (오른쪽 끝 칸막이 6 도트 px 포함) */
const PLANT_W = 1
/**
 * 자리 사각형 (블록 줄 원점 기준 타일. 클릭·선택 테두리·포커스·승인 화살표·자리 카드가 쓴다): 그 자리 사람·의자를 덮고 서로 겹치지 않는다.
 * 윗자리 = 머리부터 윗책상까지, 아랫자리 = 가운데 칸막이부터 의자까지(블록 줄 아래 통로 1타일 포함), 지휘자 = 블록 왼쪽 열 가운데
 */
const TOP_SEAT = { dy: 0, h: 2 }
const BOTTOM_SEAT = { dy: 2, h: 3 }
const LEAD_SEAT = { dy: 1, h: 2 }
/** 파트 단위 앞 여백: 파트 이름표 줄 + 위 단위 아랫자리 의자·이 단위 윗사람 머리가 나오는 몫 */
const PART_GAP = 2
/** 섬 테두리: 단위들 둘레 1타일 (팀 이름표 자리). 그래서 앵커 = 섬 왼쪽 위 + 1 */
const ISLAND_PADDING = 1
/** 그룹 벽과 섬 사이 (그룹 이름표·화분 자리) */
export const GROUP_MARGIN = 1
/** 섬끼리, 그룹끼리 띄우는 간격 */
const GAP = 1
/** 새 팀 자리로 잡는 크기: 지휘자 + 짝 하나 섬. 빈 섬(빈 짝 하나)만큼만 잡으면 지휘자가 생기거나 팀원이 늘면 옆 섬과 겹친다 */
const NEW_ISLAND = { w: LEAD_W + PAIR_W + PLANT_W + 2 * ISLAND_PADDING, h: BLOCK_ROW_H + 2 * ISLAND_PADDING }
/** 팀 없는 그룹 크기 = 새 팀 하나가 들어갈 크기 */
const MIN_GROUP = { w: NEW_ISLAND.w + 2 * GROUP_MARGIN, h: NEW_ISLAND.h + 2 * GROUP_MARGIN }
const LOBBY_COLUMNS = 2
/** Focus Zone 부스 간격. 부스 그림이 자리 폭보다 넓고 의자가 자리 아래로 나와 3×4 */
const BOOTH_STEP_X = 3
const BOOTH_STEP_Y = 4
/** 부스 자리 사각형 */
const BOOTH_SEAT = { w: 2, h: 3 }
const LOBBY_W = 1 + LOBBY_COLUMNS * BOOTH_STEP_X + 1
/** Focus Zone 위쪽 이름표 전용 줄. 자리는 그 아래 + 테두리 1타일부터 */
const LOBBY_SIGN_H = 1

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  w: number
  h: number
}

/** 앉은 사람이 보는 쪽. 지휘자 right, 블록 윗자리 down(얼굴), 아랫자리·Focus Zone 부스 up(뒷모습) */
export type SeatDirection = 'down' | 'up' | 'right'

/** 자리 사각형 (절대 타일). 그림은 블록 줄 단위로 그리고 이 사각형은 클릭·선택·포커스·승인 화살표·자리 카드가 쓴다 */
export interface Seat extends Rect {
  dir: SeatDirection
  /** Focus Zone 1인 부스 */
  isBooth: boolean
}

/** 블록 줄의 짝 하나: 윗자리·아랫자리 세션 ID (사람 없는 자리는 null — 빈 의자만) */
export interface BlockPair {
  top: string | null
  bottom: string | null
}

/**
 * 칸막이 블록 줄 하나. x·y = 첫 짝 왼쪽 위(블록 메타의 원점), w = 짝 수 × 2, h = 4. leadId = 그 줄 왼쪽 지휘자 자리의 세션
 * (지휘 단위 첫 줄만). leadId 가 null 이면 왼쪽 끝 마감 판을 세운다
 */
export interface BlockRow extends Rect {
  pairs: BlockPair[]
  leadId: string | null
}

/** 섬 안의 파트 구역: 그 파트 단위(지휘자 자리·블록·화분 열)의 경계 (절대 좌표). 이름표는 바로 위 여백(PART_GAP)에 그린다 */
export interface PartZone extends Rect {
  part: Part
}

/** 팀 섬 경계 (그려지는 자리. 밀렸으면 저장된 앵커보다 오른쪽) */
export interface Island extends Rect {
  team: Team
  zones: PartZone[]
  /** 그려지는 섬 왼쪽 위 + 1 = 밀린 만큼 옮긴 앵커 (밀리지 않았으면 team.x,y) */
  anchor: Point
  /** 칸막이 블록 줄들 (위에서 아래 순서) */
  rows: BlockRow[]
  /** 화분 열 칸: 블록 줄마다 하나 */
  plants: Rect[]
}

/** 그려지는 그룹 영역: 그려지는 위치의 최소 크기 + 안의 섬들 */
export interface GroupArea extends Rect {
  group: Group
  /** 그려지는 그룹 위치 = 밀린 만큼 옮긴 group.x,y */
  origin: Point
}

export interface OfficeLayout {
  /** 자리가 있는 세션: 근무·휴식 (퇴근은 책상 없이 건물 밖 띠에 그린다). office.teams 에 없는 팀을 가리키는 세션(office 를 받기 전·팀을 막 지운 뒤)도 자리가 없어 뺀다 */
  seated: Session[]
  seats: Map<string, Seat>
  islands: Island[]
  /** office.groups 순서 */
  groupAreas: GroupArea[]
  /** 로비(Focus Zone): 팀 없는 세션(웹·외부)이 모이는 고정 구역. 그룹들의 오른쪽 끝에 붙는다 */
  lobby: Rect
  /** 로비 안 부스 자리 전부 (앉은 자리 포함, 구역 높이만큼) */
  booths: Seat[]
  /** 내용 전체의 오른쪽·아래 끝 */
  right: number
  bottom: number
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

interface IslandParts {
  rows: BlockRow[]
  plants: Rect[]
}

/**
 * 지휘 단위 하나 (왼쪽 위 x,y): 지휘자는 첫 블록 줄 왼쪽 자리(right), 팀원은 짝 단위로 윗자리(down) → 아랫자리(up) → 다음 짝 … 받은 순서대로.
 * 짝 수 p, 줄 수 ⌈p/4⌉, 줄마다 ⌈p/줄 수⌉ 짝(지휘자만 있으면 짝 없는 줄 하나). 블록 오른쪽 끝에 화분 열. 지휘자가 없으면 지휘자 열이 없다. 단위 경계를 돌려준다
 */
function placeUnit(
  origin: Point,
  lead: Session | undefined,
  members: Session[],
  minPairs: number,
  seats: Map<string, Seat>,
  parts: IslandParts,
): Rect {
  const pairCount = Math.max(minPairs, Math.ceil(members.length / 2))
  const blockX = origin.x + (lead ? LEAD_W : 0)
  const rows = Math.max(1, Math.ceil(pairCount / MAX_PAIRS_PER_ROW))
  const perRow = Math.ceil(pairCount / rows)
  const rowH = pairCount ? BLOCK_ROW_H : LEAD_ONLY_ROW_H
  const rowY = (row: number) => origin.y + row * (rowH + BLOCK_ROW_GAP)
  for (let row = 0; row < rows; row++) {
    const y = rowY(row)
    const pairs: BlockPair[] = []
    for (let column = 0; column < Math.min(perRow, pairCount - row * perRow); column++) {
      const index = (row * perRow + column) * 2
      const x = blockX + column * PAIR_W
      const [top, bottom] = [members[index], members[index + 1]]
      if (top) seats.set(top.id, { x, y: y + TOP_SEAT.dy, w: PAIR_W, h: TOP_SEAT.h, dir: 'down', isBooth: false })
      if (bottom) seats.set(bottom.id, { x, y: y + BOTTOM_SEAT.dy, w: PAIR_W, h: BOTTOM_SEAT.h, dir: 'up', isBooth: false })
      pairs.push({ top: top?.id ?? null, bottom: bottom?.id ?? null })
    }
    const leadId = row === 0 && lead ? lead.id : null
    if (leadId) seats.set(leadId, { x: blockX - LEAD_W, y: y + LEAD_SEAT.dy, w: LEAD_W, h: LEAD_SEAT.h, dir: 'right', isBooth: false })
    parts.rows.push({ x: blockX, y, w: pairs.length * PAIR_W, h: rowH, pairs, leadId })
    parts.plants.push({ x: blockX + perRow * PAIR_W, y, w: PLANT_W, h: rowH })
  }
  return { ...origin, w: blockX - origin.x + perRow * PAIR_W + PLANT_W, h: rows * rowH + (rows - 1) * BLOCK_ROW_GAP }
}

/**
 * 섬 하나: 팀 직속 → 파트 순으로 아래로 쌓는다 (파트 앞에는 이름표 여백 PART_GAP, 세션 없는 파트는 건너뛴다).
 * 단위마다 placeUnit 규칙을 따로 적용하고, 그 단위의 팀장·파트장이 지휘자 자리에 앉는다. 세션 없는 팀은 빈 짝 하나
 */
function placeTeam(team: Team, members: Session[], seats: Map<string, Seat>): Island {
  const partIds = new Set(team.parts.map((p) => p.id))
  // 목록 갱신 사이에 파트를 못 찾으면 팀 직속으로 둔다
  const unitOf = (session: Session) => (session.partId && partIds.has(session.partId) ? session.partId : null)
  const parts: IslandParts = { rows: [], plants: [] }
  const zones: PartZone[] = []
  const occupied: Rect[] = []
  let top = team.y
  for (const part of [null, ...team.parts]) {
    const unitMembers = members.filter((s) => unitOf(s) === (part?.id ?? null))
    if (unitMembers.length === 0) continue
    const leadSessionId = part ? part.leadSessionId : team.leadSessionId
    const lead = unitMembers.find((s) => s.id === leadSessionId)
    if (part) top += PART_GAP
    const unit = placeUnit(
      { x: team.x, y: top },
      lead,
      unitMembers.filter((s) => s !== lead),
      0,
      seats,
      parts,
    )
    // 파트 이름표 여백(구역 위)도 섬 안에 넣는다
    if (part) {
      zones.push({ part, ...unit })
      occupied.push({ ...unit, y: unit.y - PART_GAP, h: unit.h + PART_GAP })
    } else occupied.push(unit)
    top += unit.h
  }
  if (occupied.length === 0) occupied.push(placeUnit({ x: team.x, y: team.y }, undefined, [], 1, seats, parts))
  return { team, zones, anchor: { x: team.x, y: team.y }, ...parts, ...inflate(boundingBox(occupied), ISLAND_PADDING) }
}

/** origin 위치의 최소 크기 영역에 그 그룹 섬들(+ 벽 여백)을 더한 경계 */
function groupAreaOf(group: Group, origin: Point, islands: Island[]): GroupArea {
  const own = islands.filter((i) => i.team.groupId === group.id).map((i) => inflate(i, GROUP_MARGIN))
  return { group, origin, ...boundingBox([{ ...origin, ...MIN_GROUP }, ...own]) }
}

function shiftIsland(island: Island, dx: number): Island {
  const shift = <T extends Point>(point: T): T => ({ ...point, x: point.x + dx })
  return {
    ...island,
    x: island.x + dx,
    anchor: shift(island.anchor),
    zones: island.zones.map(shift),
    rows: island.rows.map(shift),
    plants: island.plants.map(shift),
  }
}

/**
 * 그릴 때만 미는 규칙 (저장된 좌표는 그대로). 왼쪽(x 작은 것)부터, 같으면 위(y 작은 것)부터, 그것도 같으면 받은 순서로 자리를 정하고,
 * 이미 자리를 정한 것과 겹치거나 gap 보다 가까우면 그것의 오른쪽 끝 + gap 으로 옮겨 다시 본다 (연쇄). 오른쪽으로만 민다.
 * 반환은 받은 순서 그대로이고 각각 오른쪽으로 민 칸 수
 */
export function pushRight(rects: Rect[], gap: number): number[] {
  const order = rects.map((_, index) => index).sort((a, b) => rects[a].x - rects[b].x || rects[a].y - rects[b].y || a - b)
  const settled: Rect[] = []
  const shifts = rects.map(() => 0)
  for (const index of order) {
    const rect = { ...rects[index] }
    for (;;) {
      const blocker = settled.find((s) => overlaps(inflate(s, gap), rect))
      if (!blocker) break
      rect.x = blocker.x + blocker.w + gap
    }
    shifts[index] = rect.x - rects[index].x
    settled.push(rect)
  }
  return shifts
}

export function layoutOffice(office: Office, sessions: Session[]): OfficeLayout {
  const teamIds = new Set(office.teams.map((t) => t.id))
  const seated = sessions.filter((s) => attendanceOf(s) !== 'off' && (!s.teamId || teamIds.has(s.teamId)))
  const seats = new Map<string, Seat>()
  const islands = office.teams.map((team) =>
    placeTeam(
      team,
      seated.filter((s) => s.teamId === team.id),
      seats,
    ),
  )
  // 인원이 늘어 커진 섬이 이웃과 겹치면 그릴 때만 오른쪽으로 민다: 같은 그룹 섬끼리(그룹이 지워진 팀끼리도) → 그 결과 넓어진 그룹끼리
  const groupIds = new Set(office.groups.map((g) => g.id))
  for (const groupId of [...groupIds, null]) {
    const members = islands.flatMap((island, index) =>
      (groupId === null ? !groupIds.has(island.team.groupId) : island.team.groupId === groupId) ? [index] : [],
    )
    const shifts = pushRight(
      members.map((index) => islands[index]),
      GAP,
    )
    members.forEach((index, i) => {
      islands[index] = shiftIsland(islands[index], shifts[i])
    })
  }
  const unpushedAreas = office.groups.map((group) => groupAreaOf(group, { x: group.x, y: group.y }, islands))
  const groupShifts = pushRight(unpushedAreas, GAP)
  const groupAreas = office.groups.map((group, index) => {
    const dx = groupShifts[index]
    if (dx) {
      islands.forEach((island, i) => {
        if (island.team.groupId === group.id) islands[i] = shiftIsland(island, dx)
      })
    }
    return { ...unpushedAreas[index], x: unpushedAreas[index].x + dx, origin: { x: group.x + dx, y: group.y } }
  })
  for (const island of islands) {
    const dx = island.anchor.x - island.team.x
    if (!dx) continue
    for (const session of seated) {
      const seat = session.teamId === island.team.id ? seats.get(session.id) : undefined
      if (seat) seats.set(session.id, { ...seat, x: seat.x + dx })
    }
  }
  // 그룹이 지워진 팀의 섬도 로비가 가리지 않게 같이 본다
  const placed: Rect[] = [...groupAreas, ...islands]
  const lobbySessions = seated.filter((s) => !s.teamId)
  const rows = Math.max(1, Math.ceil(lobbySessions.length / LOBBY_COLUMNS))
  const lobby = {
    x: placed.length ? Math.max(...placed.map((r) => r.x + r.w)) + GAP : 0,
    y: 0,
    w: LOBBY_W,
    h: Math.max(LOBBY_SIGN_H + rows * BOOTH_STEP_Y + 2, ...placed.map((r) => r.y + r.h)),
  }
  const boothAt = (index: number): Seat => ({
    x: lobby.x + 1 + (index % LOBBY_COLUMNS) * BOOTH_STEP_X,
    y: lobby.y + LOBBY_SIGN_H + 1 + Math.floor(index / LOBBY_COLUMNS) * BOOTH_STEP_Y,
    ...BOOTH_SEAT,
    dir: 'up',
    isBooth: true,
  })
  lobbySessions.forEach((session, index) => seats.set(session.id, boothAt(index)))
  // 그룹이 더 높아 구역이 길면 그 높이만큼 빈 부스를 더 둔다
  const boothRows = Math.max(rows, Math.floor((lobby.h - LOBBY_SIGN_H - 2) / BOOTH_STEP_Y))
  const booths = Array.from({ length: boothRows * LOBBY_COLUMNS }, (_, index) => boothAt(index))
  return { seated, seats, islands, groupAreas, lobby, booths, right: lobby.x + lobby.w, bottom: lobby.y + lobby.h }
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
  // 저장하는 앵커는 그룹이 밀리기 전 좌표 (그릴 때 그룹과 같이 다시 밀린다)
  return { x: spot.x + ISLAND_PADDING - (area.origin.x - area.group.x), y: spot.y + ISLAND_PADDING }
}

/**
 * 끌어 놓은 섬의 새 자리. anchor 는 화면에 그려진(밀린) 좌표다. 그룹은 놓은 앵커가 든 그룹(그 섬을 뺀 그룹 영역 기준, 없으면 원래 그룹)이고,
 * 다른 섬(그려진 자리)과 겹치거나 GAP 보다 가까우면 놓은 자리에서 가장 가까운 빈 자리로 붙인다
 */
export function dropIsland(layout: OfficeLayout, team: Team, anchor: Point): { groupId: string; x: number; y: number } {
  const island = layout.islands.find((i) => i.team.id === team.id)
  const others = layout.islands.filter((i) => i.team.id !== team.id)
  const target = layout.groupAreas
    .map((a) => groupAreaOf(a.group, a.origin, others))
    .find((a) => anchor.x >= a.x && anchor.x < a.x + a.w && anchor.y >= a.y && anchor.y < a.y + a.h)
  const groupId = target?.group.id ?? team.groupId
  // 저장하는 앵커는 그 그룹이 밀리기 전 좌표 (그릴 때 그룹과 같이 다시 밀린다). 서버는 음수를 받지 않는다
  const groupArea = layout.groupAreas.find((a) => a.group.id === groupId)
  const groupShift = groupArea ? groupArea.origin.x - groupArea.group.x : 0
  if (!island) return { groupId, x: Math.max(0, anchor.x - groupShift), y: anchor.y }
  const offset = { x: island.x - island.anchor.x, y: island.y - island.anchor.y }
  const spot = findFreeSpot(
    island,
    { x: anchor.x + offset.x, y: anchor.y + offset.y },
    others.map((i) => inflate(i, GAP)),
    { x: GROUP_MARGIN, y: GROUP_MARGIN },
  )
  return { groupId, x: Math.max(0, spot.x - offset.x - groupShift), y: spot.y - offset.y }
}
