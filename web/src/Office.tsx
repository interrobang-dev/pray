import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import { attendanceOf, type Office as OfficeData, type Group, type Part, type Session, type Team } from './types'
import { avatarOf, type Avatar } from './avatar'

/**
 * 도트 사무실. 모든 좌표는 "아트 픽셀" 단위이고 world 컨테이너를 2배로 키워 도트가 선명하게 보이게 한다.
 * 타일 하나 = 16 아트 px = 화면 32px.
 */
const SCALE = 2
const TILE = 16
const WALL_H = 40
/** 그룹·책상 원점. 바닥 격자가 x=0, y=WALL_H 부터 TILE 간격이라 둘 다 TILE 배수여야 격자선과 맞는다 */
const PAD_X = TILE
const PAD_Y = WALL_H + TILE
const SEAT_STEP = 3
/** 책상 footprint (타일). 책상 그림 32x48px 가 이 칸에 꼭 맞는다 */
const DESK_TILES_W = 2
const DESK_TILES_H = 3
const MIN_GROUP_SIZE = 4

const COLOR = {
  floor: 0xdcdde6,
  floorLine: 0xd2d3dd,
  wall: 0xf1f1f4,
  wallShadow: 0xdedfe6,
  sky: [0xcfe6f5, 0xdff0f9, 0xeef7fb],
  city: 0xb7c3d1,
  cityWindow: 0xd8e2ec,
  frame: 0xffffff,
  partition: 0xffffff,
  partitionShadow: 0xc9cbd6,
  green: 0x6fae5e,
  greenDark: 0x4f9a4a,
  greenLight: 0x8fd080,
  desk: 0xffffff,
  deskFront: 0xf1f1f4,
  deskLeg: 0xb9bbc6,
  chair: 0xffffff,
  chairLine: 0xcfd1db,
  bezel: 0x9a9ca8,
  screenOff: 0x3a3e4a,
  screenOn: 0x4aa3e8,
  text: 0x2b2f3a,
  pot: 0xe8e8ea,
  potLine: 0xc6c7d0,
  postit: 0xfde77a,
  bubble: 0xffffff,
  bubbleLine: 0xb5b8c5,
  alert: 0xffd3d3,
  alertLine: 0xe05a5a,
  select: 0x3f9c4b,
  gold: 0xd9a63a,
  silver: 0xa9b0bd,
  partLine: 0xc3c7d2,
}

interface Props {
  office: OfficeData
  sessions: Session[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
  /** 팀 책상을 끌어 놓음. 앵커 기준 오프셋 */
  onMoveDesk: (teamId: string, sessionId: string, desk: { dx: number; dy: number }) => void
  /** 팀 섬을 끌어 놓음 */
  onMoveTeam: (teamId: string, anchor: { groupId: string; x: number; y: number }) => void
  onEditTeam: (team: Team) => void
  onEditGroup: (group: Group) => void
  onUpdateGroupBounds: (groupId: string, bounds: Pick<Group, 'x' | 'y' | 'w' | 'h'>) => void
}

function label(text: string, size: number, color = COLOR.text, wrapWidth?: number): Text {
  return new Text({
    text,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: size,
      fill: color,
      wordWrap: wrapWidth !== undefined,
      wordWrapWidth: wrapWidth,
    },
    resolution: SCALE * 2,
  })
}

function groupAt(groups: Group[], tileX: number, tileY: number): Group | null {
  return groups.find((r) => tileX >= r.x && tileX < r.x + r.w && tileY >= r.y && tileY < r.y + r.h) ?? null
}

/** 책상 위치 (타일, 절대 좌표) */
interface Placement {
  x: number
  y: number
}

/** 섬 안의 파트 구역: 그 파트 책상들의 경계 (타일, 절대 좌표). 이름표는 바로 위 1타일에 그린다 */
interface PartZone {
  part: Part
  x: number
  y: number
  w: number
  h: number
}

/** 팀 섬 경계 (타일) */
interface Island {
  team: Team
  x: number
  y: number
  w: number
  h: number
  zones: PartZone[]
}

/** 로비: 팀 없는 세션(웹·외부)이 모이는 고정 구역. 그룹이 아니라 지울 수 없고, 그룹들의 오른쪽 끝에 붙는다 */
const ZONE_COLUMNS = 2
const ZONE_W = 1 + ZONE_COLUMNS * SEAT_STEP + 1

function lobbyZone(office: OfficeData, count: number): Group {
  const x = office.groups.length ? Math.max(...office.groups.map((r) => r.x + r.w)) + 1 : 0
  const tallest = office.groups.length ? Math.max(...office.groups.map((r) => r.y + r.h)) : 0
  const rows = Math.max(1, Math.ceil(count / ZONE_COLUMNS))
  return { id: 'lobby', name: '로비', x, y: 0, w: ZONE_W, h: Math.max(tallest, rows * SEAT_STEP + 2) }
}

/**
 * 팀 세션: 앵커 + 저장된 오프셋, 없으면 섬 안 2열 자동 정렬 (팀 직속 → 파트 순으로 아래로 쌓고, 파트 앞에는 이름표 자리 1타일).
 * 팀 없는 세션: 로비 구역에 순서대로.
 */
function placeAll(office: OfficeData, sessions: Session[], zone: Group): { seats: Map<string, Placement>; islands: Island[] } {
  const seats = new Map<string, Placement>()
  const taken = new Set<string>()
  const occupy = (p: Placement) => taken.add(`${p.x},${p.y}`)
  const islands: Island[] = []

  for (const team of office.teams) {
    const members = sessions.filter((s) => s.teamId === team.id)
    const partIds = new Set(team.parts.map((p) => p.id))
    // 목록 갱신 사이에 파트를 못 찾으면 팀 직속으로 둔다
    const unitOf = (session: Session) => (session.partId && partIds.has(session.partId) ? session.partId : null)
    const placedByUnit = new Map<string | null, Placement[]>()
    const place = (session: Session, p: Placement) => {
      seats.set(session.id, p)
      occupy(p)
      const unit = unitOf(session)
      placedByUnit.set(unit, [...(placedByUnit.get(unit) ?? []), p])
    }
    for (const session of members) {
      const desk = team.desks[session.id]
      if (desk) place(session, { x: team.x + desk.dx, y: team.y + desk.dy })
    }
    const zones: PartZone[] = []
    let top = team.y
    for (const part of [null, ...team.parts]) {
      const unitMembers = members.filter((s) => unitOf(s) === (part?.id ?? null))
      if (part && unitMembers.length === 0) continue
      if (part) top += 1
      let slot = 0
      let bottom = top
      for (const session of unitMembers) {
        if (seats.has(session.id)) continue
        let p: Placement
        do {
          p = { x: team.x + (slot % 2) * SEAT_STEP, y: top + Math.floor(slot / 2) * SEAT_STEP }
          slot += 1
        } while (taken.has(`${p.x},${p.y}`))
        place(session, p)
        bottom = Math.max(bottom, p.y + DESK_TILES_H)
      }
      top = bottom
      if (!part) continue
      const placed = placedByUnit.get(part.id) ?? []
      const minX = Math.min(...placed.map((p) => p.x))
      const minY = Math.min(...placed.map((p) => p.y))
      zones.push({
        part,
        x: minX,
        y: minY,
        w: Math.max(...placed.map((p) => p.x)) + DESK_TILES_W - minX,
        h: Math.max(...placed.map((p) => p.y)) + DESK_TILES_H - minY,
      })
    }
    const placed = [...placedByUnit.values()].flat()
    if (placed.length === 0) placed.push({ x: team.x, y: team.y })
    const minX = Math.min(...placed.map((p) => p.x))
    // 파트 이름표 자리(구역 위 1타일)도 섬 안에 넣는다
    const minY = Math.min(...placed.map((p) => p.y), ...zones.map((z) => z.y - 1))
    const maxX = Math.max(...placed.map((p) => p.x)) + DESK_TILES_W
    const maxY = Math.max(...placed.map((p) => p.y)) + DESK_TILES_H
    islands.push({ team, x: minX - 1, y: minY - 1, w: maxX - minX + 2, h: maxY - minY + 2, zones })
  }

  let index = 0
  for (const session of sessions) {
    if (seats.has(session.id) || session.teamId) continue
    seats.set(session.id, {
      x: zone.x + 1 + (index % ZONE_COLUMNS) * SEAT_STEP,
      y: zone.y + 1 + Math.floor(index / ZONE_COLUMNS) * SEAT_STEP,
    })
    index += 1
  }
  return { seats, islands }
}

// ---------- 배경 ----------

function drawBackground(widthPx: number, heightPx: number): Container {
  const container = new Container()
  const g = new Graphics()
  g.rect(0, 0, widthPx, heightPx).fill(COLOR.floor)
  for (let x = 0; x < widthPx; x += TILE) g.rect(x, WALL_H, 1, heightPx - WALL_H).fill(COLOR.floorLine)
  for (let y = WALL_H; y < heightPx; y += TILE) g.rect(0, y, widthPx, 1).fill(COLOR.floorLine)

  // 벽과 통유리창
  g.rect(0, 0, widthPx, WALL_H).fill(COLOR.wall)
  g.rect(0, WALL_H - 3, widthPx, 3).fill(COLOR.wallShadow)
  const winTop = 4
  const winH = 26
  g.rect(0, winTop, widthPx, 9).fill(COLOR.sky[0])
  g.rect(0, winTop + 9, widthPx, 9).fill(COLOR.sky[1])
  g.rect(0, winTop + 18, widthPx, winH - 18).fill(COLOR.sky[2])
  // 도시 실루엣 (결정적 난수)
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let x = 2; x < widthPx; ) {
    const w = 3 + Math.floor(rand() * 4)
    const h = 3 + Math.floor(rand() * 8)
    g.rect(x, winTop + winH - h, w, h).fill(COLOR.city)
    for (let wy = winTop + winH - h + 1; wy < winTop + winH - 1; wy += 2) {
      if (rand() > 0.5) g.rect(x + 1, wy, 1, 1).fill(COLOR.cityWindow)
    }
    x += w + 1 + Math.floor(rand() * 4)
  }
  g.rect(0, winTop + winH - 2, widthPx, 2).fill(COLOR.wallShadow)
  // 창틀
  g.rect(0, winTop - 1, widthPx, 1).fill(COLOR.frame)
  g.rect(0, winTop + winH, widthPx, 2).fill(COLOR.frame)
  for (let x = 0; x < widthPx; x += 48) g.rect(x, winTop - 1, 2, winH + 2).fill(COLOR.frame)
  container.addChild(g)
  return container
}

// ---------- 소품 ----------

function drawPlant(x: number, y: number, isLarge: boolean): Graphics {
  const g = new Graphics()
  const potW = isLarge ? 8 : 5
  const potH = isLarge ? 6 : 4
  g.rect(x, y, potW, potH).fill(COLOR.pot).rect(x, y + potH - 1, potW, 1).fill(COLOR.potLine)
  const cx = x + Math.floor(potW / 2)
  const leaves: [number, number, number][] = isLarge
    ? [
        [-4, -3, COLOR.greenDark],
        [1, -3, COLOR.greenDark],
        [-2, -6, COLOR.green],
        [2, -5, COLOR.green],
        [-1, -9, COLOR.greenLight],
        [-5, -7, COLOR.green],
        [3, -8, COLOR.greenLight],
      ]
    : [
        [-2, -2, COLOR.greenDark],
        [0, -3, COLOR.green],
        [1, -1, COLOR.greenLight],
      ]
  for (const [dx, dy, color] of leaves) g.rect(cx + dx, y + dy, 3, 3).fill(color)
  return g
}

// ---------- 그룹 ----------

interface GroupParts {
  container: Container
  /** 끌면 그룹 이동 */
  sign: Graphics
  /** 끌면 크기 조절 */
  handle: Graphics
}

function drawGroup(group: Group, onEdit: () => void): GroupParts {
  const container = new Container()
  container.position.set(PAD_X + group.x * TILE, PAD_Y + group.y * TILE)
  const w = group.w * TILE
  const h = group.h * TILE
  const g = new Graphics()
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.25 })
  g.rect(0, 0, w, 3).fill(COLOR.partition).rect(0, 3, w, 1).fill(COLOR.partitionShadow)
  g.rect(0, 0, 3, h).fill(COLOR.partition).rect(3, 0, 1, h).fill(COLOR.partitionShadow)
  g.rect(w - 3, 0, 3, h).fill(COLOR.partition).rect(w - 4, 0, 1, h).fill(COLOR.partitionShadow)
  g.rect(0, h - 4, w, 2).fill(COLOR.partition).rect(0, h - 2, w, 2).fill(COLOR.green)
  container.addChild(g)

  const name = label(group.name, 7)
  const sign = new Graphics().rect(0, 0, name.width + 8, 11).fill(COLOR.partition).rect(0, 10, name.width + 8, 1).fill(COLOR.green)
  sign.position.set(6, 5)
  name.position.set(10, 6)
  container.addChild(sign, name)

  sign.eventMode = 'static'
  sign.cursor = 'move'

  container.addChild(drawPlant(w - 14, 8, true))
  container.addChild(drawPlant(6, h - 14, false))

  // 오른쪽 아래 모서리 크기 조절 핸들
  const handle = new Graphics().rect(0, 0, 7, 7).fill(COLOR.partition).rect(2, 2, 3, 3).fill(COLOR.green)
  handle.position.set(w - 10, h - 11)
  handle.eventMode = 'static'
  handle.cursor = 'nwse-resize'
  container.addChild(handle)

  if (group.waitingNote) {
    const text = label(group.waitingNote, 6, COLOR.text, 70)
    const note = new Graphics().rect(0, 0, text.width + 6, text.height + 5).fill(COLOR.postit)
    note.rect(0, 0, text.width + 6, 1).fill(0xe8cf4e)
    const x = w - 24 - text.width - 6
    note.position.set(x, 6)
    text.position.set(x + 3, 8)
    container.addChild(note, text)
  }

  container.eventMode = 'static'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return { container, sign, handle }
}

function drawZone(zone: Group): Container {
  const container = new Container()
  container.position.set(PAD_X + zone.x * TILE, PAD_Y + zone.y * TILE)
  const w = zone.w * TILE
  const h = zone.h * TILE
  const g = new Graphics()
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.12 })
  // 점선 파티션
  for (let x = 0; x < w; x += 4) {
    g.rect(x, 0, 2, 2).fill(COLOR.partitionShadow).rect(x, h - 2, 2, 2).fill(COLOR.partitionShadow)
  }
  for (let y = 0; y < h; y += 4) {
    g.rect(0, y, 2, 2).fill(COLOR.partitionShadow).rect(w - 2, y, 2, 2).fill(COLOR.partitionShadow)
  }
  container.addChild(g)
  const name = label(zone.name, 7, 0x7a7f8e)
  const sign = new Graphics().rect(0, 0, name.width + 8, 11).fill(0xf4f4f7).rect(0, 10, name.width + 8, 1).fill(COLOR.partitionShadow)
  sign.position.set(6, 5)
  name.position.set(10, 6)
  container.addChild(sign, name)
  return container
}

interface IslandParts {
  container: Container
  /** 끌면 섬(팀) 이동 */
  sign: Graphics
}

/** 팀 섬: 연한 바닥 + 점선 테두리 + 팀 이름표 + 파트 구역(옅은 실선 테두리 + 파트 이름표). 파트 구역은 섬 컨테이너에 있어 섬을 끌면 같이 움직인다 */
function drawIsland(island: Island, onEdit: () => void): IslandParts {
  const container = new Container()
  container.position.set(PAD_X + island.x * TILE, PAD_Y + island.y * TILE)
  const w = island.w * TILE
  const h = island.h * TILE
  const g = new Graphics()
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.4 })
  for (let x = 0; x < w; x += 4) g.rect(x, 0, 2, 1).fill(COLOR.greenDark).rect(x, h - 1, 2, 1).fill(COLOR.greenDark)
  for (let y = 0; y < h; y += 4) g.rect(0, y, 1, 2).fill(COLOR.greenDark).rect(w - 1, y, 1, 2).fill(COLOR.greenDark)
  container.addChild(g)
  for (const zone of island.zones) {
    // 책상 경계에서 좌우 4px, 위로 이름표 자리 12px, 아래 1px
    const zx = (zone.x - island.x) * TILE - 4
    const zy = (zone.y - island.y) * TILE - 12
    const zoneGraphics = new Graphics()
      .rect(zx, zy, zone.w * TILE + 8, zone.h * TILE + 13)
      .fill({ color: 0xffffff, alpha: 0.35 })
      .stroke({ width: 1, color: COLOR.partLine })
    const partName = label(zone.part.name, 6, 0x5d6675)
    const partSign = new Graphics()
      .rect(0, 0, partName.width + 6, 9)
      .fill(0xffffff)
      .rect(0, 8, partName.width + 6, 1)
      .fill(COLOR.silver)
    partSign.position.set(zx + 2, zy + 1)
    partName.position.set(zx + 5, zy + 2)
    container.addChild(zoneGraphics, partSign, partName)
  }
  const name = label(island.team.name, 6, COLOR.text)
  const sign = new Graphics().rect(0, 0, name.width + 6, 9).fill(0xffffff).rect(0, 8, name.width + 6, 1).fill(COLOR.greenDark)
  sign.position.set(3, 3)
  name.position.set(6, 4)
  sign.eventMode = 'static'
  sign.cursor = 'move'
  container.addChild(sign, name)
  container.eventMode = 'static'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return { container, sign }
}

// ---------- 캐릭터 ----------

interface Figure {
  container: Container
  handLeft: Graphics
  handRight: Graphics
  raisedHand: Graphics | null
}

function drawFigure(avatar: Avatar, status: Session['status']): Figure {
  const container = new Container()
  const isIdle = status === 'idle' || status === 'unknown' || status === 'ended'
  const hasRaisedHand = status === 'my-turn' || status === 'needs-approval'

  // 몸통 (셔츠) 10x8, 어깨 둥글게
  const body = new Graphics()
  body.rect(3, 12, 10, 9).fill(avatar.shirt)
  body.rect(2, 13, 1, 7).fill(avatar.shirt).rect(13, 13, 1, 7).fill(avatar.shirt)
  body.rect(7, 12, 2, 2).fill(COLOR.text)
  container.addChild(body)

  // 머리 12x10 (피부)
  const head = new Graphics().rect(2, 2, 12, 10).fill(avatar.skin)
  head.rect(1, 4, 1, 6).fill(avatar.skin).rect(14, 4, 1, 6).fill(avatar.skin)
  container.addChild(head)

  // 머리카락: 스타일별
  const hair = new Graphics()
  hair.rect(2, 1, 12, 3).fill(avatar.hair).rect(3, 0, 10, 1).fill(avatar.hair)
  switch (avatar.hairStyle) {
    case 0: // 짧은 머리
      hair.rect(1, 2, 1, 4).fill(avatar.hair).rect(14, 2, 1, 4).fill(avatar.hair)
      break
    case 1: // 단발
      hair.rect(1, 2, 2, 9).fill(avatar.hair).rect(13, 2, 2, 9).fill(avatar.hair)
      break
    case 2: // 앞머리
      hair.rect(2, 4, 4, 1).fill(avatar.hair).rect(8, 4, 6, 1).fill(avatar.hair)
      hair.rect(1, 2, 1, 5).fill(avatar.hair).rect(14, 2, 1, 5).fill(avatar.hair)
      break
    case 3: // 올백 + 가르마
      hair.rect(7, 0, 1, 4).fill(avatar.skin)
      hair.rect(1, 2, 1, 3).fill(avatar.hair).rect(14, 2, 1, 3).fill(avatar.hair)
      break
    case 4: // 포니테일
      hair.rect(1, 2, 1, 4).fill(avatar.hair).rect(14, 2, 1, 4).fill(avatar.hair)
      hair.rect(14, 4, 3, 8).fill(avatar.hair).rect(15, 12, 2, 2).fill(avatar.hair)
      break
    default: // 긴 머리
      hair.rect(1, 2, 2, 14).fill(avatar.hair).rect(13, 2, 2, 14).fill(avatar.hair)
      break
  }
  container.addChild(hair)

  // 눈·입
  const face = new Graphics()
  if (isIdle) {
    face.rect(4, 8, 3, 1).fill(COLOR.text).rect(9, 8, 3, 1).fill(COLOR.text)
  } else {
    face.rect(4, 7, 3, 2).fill(COLOR.text).rect(9, 7, 3, 2).fill(COLOR.text)
    face.rect(4, 7, 1, 1).fill(0x6fb3ff).rect(9, 7, 1, 1).fill(0x6fb3ff)
  }
  face.rect(7, 10, 2, 1).fill(0xc97b7b)
  if (status === 'needs-approval') face.rect(3, 9, 2, 1).fill(0xf3b0b0).rect(11, 9, 2, 1).fill(0xf3b0b0)
  container.addChild(face)

  // 손
  const handLeft = new Graphics().rect(1, 19, 3, 2).fill(avatar.skin)
  const handRight = new Graphics().rect(12, 19, 3, 2).fill(avatar.skin)
  container.addChild(handLeft, handRight)

  let raisedHand: Graphics | null = null
  if (hasRaisedHand) {
    handRight.visible = false
    raisedHand = new Graphics().rect(14, 10, 2, 7).fill(avatar.shirt).rect(14, 7, 3, 4).fill(avatar.skin)
    container.addChild(raisedHand)
  }
  return { container, handLeft, handRight, raisedHand }
}

// ---------- 책상 단위 ----------

interface DeskParts {
  container: Container
  /** 휴식 세션은 null (빈 의자) */
  figure: Figure | null
}

const DESK_W = DESK_TILES_W * TILE
const DESK_H = DESK_TILES_H * TILE

/** 휴식 세션(호스트 재시작 중)은 책상을 그대로 두고 캐릭터 없이 빈 의자 + 흐린 이름표. 훅 상태가 남아 있어도 모니터·말풍선은 끈다 */
function drawDesk(session: Session, seat: Placement, isSelected: boolean): DeskParts {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  const avatar = avatarOf(session.id)
  const isOnBreak = attendanceOf(session) === 'break'
  const isWorking = session.status === 'working' && !isOnBreak
  const isExternal = session.kind === 'external'

  // 의자 등받이
  const chair = new Graphics().rect(5, 4, 14, 14).fill(COLOR.chair).rect(5, 4, 14, 1).fill(COLOR.chairLine)
  chair.rect(4, 6, 1, 10).fill(COLOR.chairLine).rect(19, 6, 1, 10).fill(COLOR.chairLine)
  container.addChild(chair)

  const figure = isOnBreak ? null : drawFigure(avatar, session.status)
  if (figure) {
    figure.container.position.set(4, 2)
    container.addChild(figure.container)
  }

  // 책상
  const desk = new Graphics()
  desk.rect(0, 20, DESK_W, 9).fill(COLOR.desk)
  desk.rect(0, 29, DESK_W, 6).fill(COLOR.deskFront)
  desk.rect(0, 20, 3, 15).fill(isExternal ? COLOR.deskLeg : COLOR.green)
  desk.rect(0, 35, DESK_W, 1).fill(COLOR.deskLeg)
  desk.rect(2, 36, 2, 3).fill(COLOR.deskLeg).rect(DESK_W - 4, 36, 2, 3).fill(COLOR.deskLeg)
  container.addChild(desk)

  // 모니터 (책상 오른쪽)
  const monitor = new Graphics()
  monitor.rect(22, 10, 10, 9).fill(COLOR.bezel)
  monitor.rect(23, 11, 8, 7).fill(isWorking ? COLOR.screenOn : COLOR.screenOff)
  if (isWorking) monitor.rect(24, 12, 3, 3).fill(0xdff0ff).rect(28, 13, 2, 2).fill(0xdff0ff)
  monitor.rect(26, 19, 2, 2).fill(COLOR.bezel).rect(24, 21, 6, 1).fill(COLOR.bezel)
  container.addChild(monitor)

  // 소품: 연필꽂이 또는 작은 화분
  if (avatar.hairStyle % 2 === 0) {
    container.addChild(new Graphics().rect(5, 24, 3, 4).fill(COLOR.greenDark).rect(6, 22, 1, 2).fill(0xe8c76a))
  } else {
    container.addChild(drawPlant(5, 24, false))
  }

  if (isSelected) {
    container.addChild(new Graphics().rect(-2, 1, DESK_W + 4, DESK_H - 6).stroke({ width: 1, color: COLOR.select }))
  }

  // 이름표
  const isLead = session.role === 'lead'
  const isPartLead = isLead && session.partId !== null
  const name = label(session.name ?? session.title ?? session.id.slice(0, 8), 6, isExternal ? 0x7a7f8e : COLOR.text)
  // 자리 간격(3타일)보다 조금 좁게. 책상보다 넓어도 옆 책상과 안 겹친다
  const tagW = Math.min(name.width + 4, SEAT_STEP * TILE - 4)
  // 이름표 밑줄: 외부 회색, 팀장 금색, 파트장 은색, 그 외 초록
  const underline = isExternal ? COLOR.chairLine : isPartLead ? COLOR.silver : isLead ? COLOR.gold : COLOR.green
  const tag = new Graphics().rect(0, 0, tagW, 9).fill(0xffffff).rect(0, 8, tagW, 1).fill(underline)
  tag.position.set(Math.floor((DESK_W - tagW) / 2), 39)
  name.position.set(tag.x + 2, 40)
  // 팀장·파트장: 책상 앞판 위에 금색 명패 (둘은 이름표 밑줄로 구분)
  if (isLead) container.addChild(new Graphics().rect(10, 30, 12, 3).fill(COLOR.gold).rect(11, 31, 10, 1).fill(0xf4d77a))
  const mask = new Graphics().rect(tag.x, 39, tagW, 9).fill(0xffffff)
  name.mask = mask
  if (isOnBreak) {
    tag.alpha = 0.5
    name.alpha = 0.5
  }
  container.addChild(tag, mask, name)

  // 말풍선
  const bubbleText = isOnBreak
    ? null
    : session.status === 'needs-approval'
      ? `승인 필요: ${session.pendingTool ?? '?'}`
      : session.status === 'my-turn'
        ? (session.lastAssistantText?.split('\n')[0] ?? '끝났어요').slice(0, 50)
        : null
  if (bubbleText) {
    const isAlert = session.status === 'needs-approval'
    const text = label(bubbleText, 6, COLOR.text, 80)
    const bw = text.width + 6
    const bh = text.height + 4
    const bubble = new Graphics()
    bubble.rect(0, 0, bw, bh).fill(isAlert ? COLOR.alert : COLOR.bubble)
    bubble.rect(0, 0, bw, bh).stroke({ width: 1, color: isAlert ? COLOR.alertLine : COLOR.bubbleLine })
    bubble.rect(6, bh, 2, 2).fill(isAlert ? COLOR.alertLine : COLOR.bubbleLine).rect(6, bh, 1, 1).fill(isAlert ? COLOR.alert : COLOR.bubble)
    bubble.position.set(2, -bh - 3)
    text.position.set(5, -bh - 1)
    container.addChild(bubble, text)
  }

  container.eventMode = 'static'
  container.cursor = 'pointer'
  return { container, figure }
}

// ---------- 컴포넌트 ----------

export function Office(props: Props) {
  const { office, sessions, selectedId } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const latest = useRef(props)
  latest.current = props
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let isDisposed = false
    const app = new Application()
    const desks = new Map<string, DeskParts>()
    const working = new Set<string>()
    let frame = 0
    let removeWheel = () => {}
    let disconnectResize = () => {}

    void app
      .init({ resizeTo: host, background: COLOR.floor, antialias: false, roundPixels: true, resolution: 1 })
      .then(() => {
        if (isDisposed) {
          app.destroy(true)
          return
        }
        host.appendChild(app.canvas)
        appRef.current = app
        app.stage.eventMode = 'static'
        app.stage.hitArea = app.screen
        const world = new Container()
        world.scale.set(SCALE)
        app.stage.addChild(world)

        let drag: {
          sessionId: string
          teamId: string
          start: { x: number; y: number }
          offset: { x: number; y: number }
          isMoved: boolean
        } | null = null
        // 팀 섬 이동: 섬과 소속 책상을 같이 옮긴다
        let teamDrag: {
          team: Team
          start: { x: number; y: number }
          delta: { dx: number; dy: number }
          isMoved: boolean
          island: Container
          islandBase: { x: number; y: number }
          deskBases: { container: Container; x: number; y: number }[]
        } | null = null
        // 그룹 이동(이름표)·크기 조절(모서리 핸들). 끄는 동안 타일 단위로 그룹을 다시 그린다
        let groupDrag: {
          group: Group
          mode: 'move' | 'resize'
          start: { x: number; y: number }
          current: Pick<Group, 'x' | 'y' | 'w' | 'h'>
          isMoved: boolean
        } | null = null
        const groupViews = new Map<string, GroupParts>()

        /** 화면 좌표 → world 아트 픽셀 */
        const toWorld = (event: FederatedPointerEvent) => ({
          x: (event.global.x - world.x) / SCALE,
          y: (event.global.y - world.y) / SCALE,
        })

        // 휠로 사무실 패닝. 내용이 화면보다 클 때만 움직인다
        const content = { w: 0, h: 0 }
        const clampPan = () => {
          const minX = Math.min(0, app.screen.width - content.w * SCALE)
          const minY = Math.min(0, app.screen.height - content.h * SCALE)
          world.x = Math.round(Math.max(minX, Math.min(0, world.x)))
          world.y = Math.round(Math.max(minY, Math.min(0, world.y)))
        }
        const onWheel = (event: WheelEvent) => {
          event.preventDefault()
          const isHorizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
          if (isHorizontal) world.x -= event.deltaX || event.deltaY
          else world.y -= event.deltaY
          clampPan()
        }
        host.addEventListener('wheel', onWheel, { passive: false })
        removeWheel = () => host.removeEventListener('wheel', onWheel)

        // resizeTo 는 창 크기가 바뀔 때만 다시 잰다. 패널을 여닫을 때처럼 사무실 칸만 바뀌어도 캔버스가 따라가게
        // (안 하면 패널이 열린 채 다시 보인 사무실이 580px 캔버스로 남아, 패널을 닫으면 오른쪽이 빈다)
        const resizeObserver = new ResizeObserver(() => app.resize())
        resizeObserver.observe(host)
        disconnectResize = () => resizeObserver.disconnect()

        const redraw = () => {
          const { office, sessions, selectedId, onSelect, onEditGroup } = latest.current
          world.removeChildren()
          desks.clear()
          groupViews.clear()
          working.clear()
          // 근무·휴식 세션만 자리가 있다 (퇴근은 그리지 않는다). office.teams 에 없는 팀을 가리키는 세션(office 를 받기 전·팀을 막 지운 뒤)도
          // 자리가 없어 뺀다 — 왼쪽 목록도 팀 카드는 office.teams 기준, 로비는 팀 없는 세션만이라 같은 세션이 안 보인다
          const teamIds = new Set(office.teams.map((t) => t.id))
          const seated = sessions.filter((s) => attendanceOf(s) !== 'off' && (!s.teamId || teamIds.has(s.teamId)))
          const zone = lobbyZone(office, seated.filter((s) => !s.teamId).length)
          content.w = PAD_X * 2 + (zone.x + zone.w) * TILE
          content.h = PAD_Y + 16 + Math.max(zone.y + zone.h, ...office.groups.map((r) => r.y + r.h)) * TILE
          const bgW = Math.max(content.w, Math.ceil(app.screen.width / SCALE))
          const bgH = Math.max(content.h, Math.ceil(app.screen.height / SCALE))
          world.addChild(drawBackground(bgW, bgH))
          for (const group of office.groups) {
            const parts = drawGroup(group, () => {
              if (!groupDrag?.isMoved) onEditGroup(group)
            })
            const beginGroupDrag = (mode: 'move' | 'resize') => (event: FederatedPointerEvent) => {
              event.stopPropagation()
              groupDrag = {
                group,
                mode,
                start: toWorld(event),
                current: { x: group.x, y: group.y, w: group.w, h: group.h },
                isMoved: false,
              }
            }
            parts.sign.on('pointerdown', beginGroupDrag('move'))
            parts.handle.on('pointerdown', beginGroupDrag('resize'))
            world.addChild(parts.container)
            groupViews.set(group.id, parts)
          }
          world.addChild(drawZone(zone))
          clampPan()
          const { seats, islands } = placeAll(office, seated, zone)
          for (const island of islands) {
            const parts = drawIsland(island, () => {
              if (!teamDrag?.isMoved) latest.current.onEditTeam(island.team)
            })
            parts.sign.on('pointerdown', (event: FederatedPointerEvent) => {
              event.stopPropagation()
              const memberIds = seated.filter((s) => s.teamId === island.team.id).map((s) => s.id)
              teamDrag = {
                team: island.team,
                start: toWorld(event),
                delta: { dx: 0, dy: 0 },
                isMoved: false,
                island: parts.container,
                islandBase: { x: parts.container.x, y: parts.container.y },
                deskBases: memberIds
                  .map((id) => desks.get(id)?.container)
                  .filter((c): c is Container => Boolean(c))
                  .map((container) => ({ container, x: container.x, y: container.y })),
              }
            })
            world.addChild(parts.container)
          }
          // 아래쪽 책상이 위쪽을 가리도록 y 순 정렬
          const ordered = [...seated].sort((a, b) => seats.get(a.id)!.y - seats.get(b.id)!.y)
          for (const session of ordered) {
            const seat = seats.get(session.id)!
            const parts = drawDesk(session, seat, session.id === selectedId)
            // 팀에 속한 웹 세션만 끌 수 있다 (오프셋을 저장할 곳이 팀이라서)
            if (session.kind === 'web' && session.teamId) {
              const teamId = session.teamId
              parts.container.on('pointerdown', (event: FederatedPointerEvent) => {
                drag = {
                  sessionId: session.id,
                  teamId,
                  start: { x: event.global.x, y: event.global.y },
                  offset: {
                    x: (event.global.x - world.x) / SCALE - parts.container.x,
                    y: (event.global.y - world.y) / SCALE - parts.container.y,
                  },
                  isMoved: false,
                }
                world.setChildIndex(parts.container, world.children.length - 1)
              })
            }
            parts.container.on('pointertap', () => {
              if (!drag?.isMoved) onSelect(session.id)
            })
            world.addChild(parts.container)
            desks.set(session.id, parts)
            if (parts.figure && session.status === 'working') working.add(session.id)
          }
        }
        redrawRef.current = redraw
        app.renderer.on('resize', redraw)

        /** 끄는 동안 그룹을 임시 크기·위치로 다시 그린다 (저장 전 미리보기) */
        const previewGroup = () => {
          if (!groupDrag) return
          const view = groupViews.get(groupDrag.group.id)
          if (!view) return
          const parts = drawGroup({ ...groupDrag.group, ...groupDrag.current }, () => {})
          const index = world.getChildIndex(view.container)
          world.removeChildAt(index)
          world.addChildAt(parts.container, index)
          groupViews.set(groupDrag.group.id, parts)
        }

        app.stage.on('pointermove', (event: FederatedPointerEvent) => {
          if (groupDrag) {
            const point = toWorld(event)
            const dx = Math.round((point.x - groupDrag.start.x) / TILE)
            const dy = Math.round((point.y - groupDrag.start.y) / TILE)
            const { group, current } = groupDrag
            const next =
              groupDrag.mode === 'move'
                ? { x: Math.max(0, group.x + dx), y: Math.max(0, group.y + dy), w: group.w, h: group.h }
                : { x: group.x, y: group.y, w: Math.max(MIN_GROUP_SIZE, group.w + dx), h: Math.max(MIN_GROUP_SIZE, group.h + dy) }
            if (next.x === current.x && next.y === current.y && next.w === current.w && next.h === current.h) return
            groupDrag.current = next
            groupDrag.isMoved = true
            previewGroup()
            return
          }
          if (teamDrag) {
            const point = toWorld(event)
            const dx = Math.round((point.x - teamDrag.start.x) / TILE)
            const dy = Math.round((point.y - teamDrag.start.y) / TILE)
            const next = { dx: Math.max(-teamDrag.team.x, dx), dy: Math.max(-teamDrag.team.y, dy) }
            if (next.dx === teamDrag.delta.dx && next.dy === teamDrag.delta.dy) return
            teamDrag.delta = next
            teamDrag.isMoved = true
            teamDrag.island.position.set(teamDrag.islandBase.x + next.dx * TILE, teamDrag.islandBase.y + next.dy * TILE)
            for (const desk of teamDrag.deskBases) desk.container.position.set(desk.x + next.dx * TILE, desk.y + next.dy * TILE)
            return
          }
          if (!drag) return
          const parts = desks.get(drag.sessionId)
          if (!parts) return
          if (Math.hypot(event.global.x - drag.start.x, event.global.y - drag.start.y) > 4) drag.isMoved = true
          if (drag.isMoved) {
            // 끄는 동안에도 타일에 스냅해서 놓일 자리가 미리 보이게
            const point = toWorld(event)
            const tileX = Math.round((point.x - drag.offset.x - PAD_X) / TILE)
            const tileY = Math.round((point.y - drag.offset.y - PAD_Y) / TILE)
            parts.container.position.set(PAD_X + tileX * TILE, PAD_Y + tileY * TILE)
          }
        })
        const endDrag = () => {
          if (groupDrag) {
            const finished = groupDrag
            groupDrag = null
            if (finished.isMoved) latest.current.onUpdateGroupBounds(finished.group.id, finished.current)
            return
          }
          if (teamDrag) {
            const finished = teamDrag
            teamDrag = null
            if (!finished.isMoved) return
            const { office, onMoveTeam } = latest.current
            const x = finished.team.x + finished.delta.dx
            const y = finished.team.y + finished.delta.dy
            const group = groupAt(office.groups, x, y)
            onMoveTeam(finished.team.id, { groupId: group?.id ?? finished.team.groupId, x, y })
            return
          }
          if (!drag) return
          const current = drag
          drag = null
          if (!current.isMoved) return
          const parts = desks.get(current.sessionId)
          if (!parts) return
          const tileX = Math.max(0, Math.round((parts.container.x - PAD_X) / TILE))
          const tileY = Math.max(0, Math.round((parts.container.y - PAD_Y) / TILE))
          const { office, onMoveDesk } = latest.current
          const team = office.teams.find((t) => t.id === current.teamId)
          if (!team) return
          onMoveDesk(team.id, current.sessionId, { dx: tileX - team.x, dy: tileY - team.y })
        }
        app.stage.on('pointerup', endDrag)
        app.stage.on('pointerupoutside', endDrag)

        let elapsed = 0
        app.ticker.add((ticker) => {
          elapsed += ticker.deltaMS
          if (elapsed < 350) return
          elapsed = 0
          frame = (frame + 1) % 2
          for (const [id, parts] of desks) {
            const { figure } = parts
            if (!figure) continue
            if (working.has(id)) {
              figure.handLeft.y = frame ? -1 : 0
              figure.handRight.y = frame ? 0 : -1
            }
            if (figure.raisedHand) figure.raisedHand.y = frame ? -1 : 0
          }
        })

        redraw()
      })

    return () => {
      isDisposed = true
      removeWheel()
      disconnectResize()
      host.replaceChildren()
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    redrawRef.current()
  }, [office, sessions, selectedId])

  return <div ref={hostRef} className="office" />
}
