import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import { attendanceOf, type Office as OfficeData, type Group, type Session, type Team } from './types'
import { avatarOf, type Avatar } from './avatar'
import {
  DESK_TILES_H,
  DESK_TILES_W,
  GROUP_MARGIN,
  SEAT_STEP,
  dropIsland,
  layoutOffice,
  type GroupArea,
  type Island,
  type Point,
  type Rect,
} from './officeLayout'

/**
 * 도트 사무실. 모든 좌표는 "아트 픽셀" 단위이고 world 컨테이너를 정수 배율(1~4배, 기본 2배)로 키워 도트가 선명하게 보이게 한다.
 * 타일 하나 = 16 아트 px (2배면 화면 32px). 책상·섬·그룹 크기는 officeLayout.ts 가 타일 단위로 정한다
 */
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const DEFAULT_ZOOM = 2
/** 휠 delta 를 이만큼 모으면 한 단계 (마우스 휠 한 칸 ≈ 100. 트랙패드의 잔 delta 는 모아서) */
const WHEEL_STEP = 50
/** 누른 뒤 이만큼(화면 px) 움직이기 전에는 클릭 */
const DRAG_THRESHOLD_PX = 5
const TILE = 16
const WALL_H = 40
/** 그룹·책상 원점. 바닥 격자가 x=0, y=WALL_H 부터 TILE 간격이라 둘 다 TILE 배수여야 격자선과 맞는다 */
const PAD_X = TILE
const PAD_Y = WALL_H + TILE

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
  /** 그룹 이름표를 끌어 놓음. 안의 팀들도 같은 만큼 옮긴다 */
  onMoveGroup: (groupId: string, position: { x: number; y: number }) => void
  /** 팀 섬을 끌어 놓음 */
  onMoveTeam: (teamId: string, anchor: { groupId: string; x: number; y: number }) => void
  onEditTeam: (team: Team) => void
  onEditGroup: (group: Group) => void
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
    // 가장 크게 키운 배율에서도 글자가 흐리지 않게
    resolution: MAX_ZOOM,
  })
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
  /** 끌면 그룹 이동 (안의 섬과 같이) */
  sign: Graphics
}

/** 크기는 저장된 w·h 가 아니라 그려지는 영역(안의 섬들을 다 담는다) */
function drawGroup(area: GroupArea, onEdit: () => void): GroupParts {
  const { group } = area
  const container = new Container()
  container.position.set(PAD_X + area.x * TILE, PAD_Y + area.y * TILE)
  const w = area.w * TILE
  const h = area.h * TILE
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
  // 글자가 이름표 위에 있어 맞으면 그룹 바닥을 누른 것이 된다 (부모가 interactive 면 글자도 맞는다)
  name.eventMode = 'none'

  container.addChild(drawPlant(w - 14, 8, true))
  container.addChild(drawPlant(6, h - 14, false))

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
  container.cursor = 'grab'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return { container, sign }
}

function drawZone(zone: Rect): Container {
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
  const name = label('로비', 7, 0x7a7f8e)
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
  // 그룹 이름표와 같은 이유
  name.eventMode = 'none'
  container.addChild(sign, name)
  container.eventMode = 'static'
  container.cursor = 'grab'
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
function drawDesk(session: Session, seat: Point, isSelected: boolean): DeskParts {
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
        app.stage.cursor = 'grab'
        const world = new Container()
        let zoom = DEFAULT_ZOOM
        world.scale.set(zoom)
        app.stage.addChild(world)

        /** 바탕 크기 (아트 px): 내용 + 오른쪽·아래로 화면 한 장 (그룹을 옮겨 놓을 빈 자리) */
        const map = { w: 0, h: 0 }
        const islandViews = new Map<string, Container>()
        // 빈 곳(이름표 밖)을 누르고 DRAG_THRESHOLD_PX 넘게 움직이면 맵 이동
        let pan: { start: Point; worldStart: Point; isMoved: boolean } | null = null
        // 이름표 끌기: 그룹(안의 섬·책상과 같이) 또는 팀 섬(책상과 같이). 끄는 동안 타일 단위로 그림만 옮기고 놓을 때 저장한다
        let signDrag: {
          start: Point
          /** 왼쪽·위로 갈 수 있는 한계 (타일, 0 이하) */
          minDelta: Point
          delta: Point
          views: { container: Container; x: number; y: number }[]
          drop: (delta: Point) => void
        } | null = null
        /** 이번 누름이 끌기였는지. 놓은 뒤 오는 pointertap(Pixi 는 pointerup 다음에 보낸다)이 선택·더블클릭 편집이 되지 않게 다음 누름까지 남긴다 */
        let isDragged = false
        /** 이름표를 끄는 동안 미룬 다시 그리기 (그 사이 다시 그리면 끌던 그림이 원래 자리로 돌아간다) */
        let isRedrawPending = false

        /** 화면 좌표 → world 아트 픽셀 */
        const toWorld = (event: FederatedPointerEvent) => ({
          x: (event.global.x - world.x) / zoom,
          y: (event.global.y - world.y) / zoom,
        })

        const clampPan = () => {
          world.x = Math.round(Math.max(app.screen.width - map.w * zoom, Math.min(0, world.x)))
          world.y = Math.round(Math.max(app.screen.height - map.h * zoom, Math.min(0, world.y)))
        }

        // 휠 = 확대·축소. 한 칸에 정수 배율 한 단계, 커서 아래 지점이 그대로 남게
        let wheelDelta = 0
        const onWheel = (event: WheelEvent) => {
          event.preventDefault()
          if (event.deltaY === 0 || pan || signDrag) return
          // 줄·쪽 단위(deltaMode 1·2)는 한 번이 한 칸
          const delta = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * WHEEL_STEP
          if (Math.sign(delta) !== Math.sign(wheelDelta)) wheelDelta = 0
          wheelDelta += delta
          if (Math.abs(wheelDelta) < WHEEL_STEP) return
          wheelDelta = 0
          // 아래로 굴리면 축소
          const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom - Math.sign(delta)))
          if (next === zoom) return
          const bounds = host.getBoundingClientRect()
          const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
          world.x = cursor.x - ((cursor.x - world.x) * next) / zoom
          world.y = cursor.y - ((cursor.y - world.y) * next) / zoom
          zoom = next
          world.scale.set(zoom)
          // 바탕 크기(화면 한 장 여유)가 배율에 따라 달라 다시 그린다 (그 안에서 clampPan)
          redraw()
        }
        host.addEventListener('wheel', onWheel, { passive: false })
        removeWheel = () => host.removeEventListener('wheel', onWheel)

        // resizeTo 는 창 크기가 바뀔 때만 다시 잰다. 패널을 여닫을 때처럼 사무실 칸만 바뀌어도 캔버스가 따라가게
        // (안 하면 패널이 열린 채 다시 보인 사무실이 580px 캔버스로 남아, 패널을 닫으면 오른쪽이 빈다)
        const resizeObserver = new ResizeObserver(() => app.resize())
        resizeObserver.observe(host)
        disconnectResize = () => resizeObserver.disconnect()

        const beginSignDrag = (
          event: FederatedPointerEvent,
          drag: { minDelta: Point; containers: Container[]; drop: (delta: Point) => void },
        ) => {
          // 맵 이동이 시작되지 않게
          event.stopPropagation()
          isDragged = false
          signDrag = {
            start: toWorld(event),
            minDelta: drag.minDelta,
            delta: { x: 0, y: 0 },
            views: drag.containers.map((container) => ({ container, x: container.x, y: container.y })),
            drop: drag.drop,
          }
        }

        const redraw = () => {
          if (signDrag) {
            isRedrawPending = true
            return
          }
          const { office, sessions, selectedId } = latest.current
          world.removeChildren()
          desks.clear()
          islandViews.clear()
          working.clear()
          const layout = layoutOffice(office, sessions)
          map.w = PAD_X + layout.right * TILE + Math.ceil(app.screen.width / zoom)
          map.h = PAD_Y + layout.bottom * TILE + Math.ceil(app.screen.height / zoom)
          world.addChild(drawBackground(map.w, map.h))
          clampPan()
          /** 그 팀들의 책상 그림 (끌 때 같이 옮긴다) */
          const deskViewsOf = (teamIds: Set<string>) =>
            layout.seated.flatMap((s) => (s.teamId && teamIds.has(s.teamId) ? (desks.get(s.id)?.container ?? []) : []))
          for (const area of layout.groupAreas) {
            const parts = drawGroup(area, () => {
              if (!isDragged) latest.current.onEditGroup(area.group)
            })
            parts.sign.on('pointerdown', (event: FederatedPointerEvent) => {
              const teamIds = new Set(layout.islands.filter((i) => i.team.groupId === area.group.id).map((i) => i.team.id))
              beginSignDrag(event, {
                // 그려지는 영역이 맵 왼쪽·위 끝을 넘지 않게 (그래서 안의 팀 앵커도 0 이상)
                minDelta: { x: -area.x, y: -area.y },
                containers: [parts.container, ...[...teamIds].flatMap((id) => islandViews.get(id) ?? []), ...deskViewsOf(teamIds)],
                drop: (delta) => latest.current.onMoveGroup(area.group.id, { x: area.group.x + delta.x, y: area.group.y + delta.y }),
              })
            })
            world.addChild(parts.container)
          }
          world.addChild(drawZone(layout.lobby))
          for (const island of layout.islands) {
            const { team } = island
            const parts = drawIsland(island, () => {
              if (!isDragged) latest.current.onEditTeam(team)
            })
            parts.sign.on('pointerdown', (event: FederatedPointerEvent) => {
              beginSignDrag(event, {
                // 섬 둘레 그룹 벽 여백까지 맵 안에 남게
                minDelta: { x: Math.min(0, GROUP_MARGIN - island.x), y: Math.min(0, GROUP_MARGIN - island.y) },
                containers: [parts.container, ...deskViewsOf(new Set([team.id]))],
                drop: (delta) => latest.current.onMoveTeam(team.id, dropIsland(layout, team, { x: team.x + delta.x, y: team.y + delta.y })),
              })
            })
            world.addChild(parts.container)
            islandViews.set(team.id, parts.container)
          }
          // 아래쪽 책상이 위쪽을 가리도록 y 순 정렬
          const ordered = [...layout.seated].sort((a, b) => layout.seats.get(a.id)!.y - layout.seats.get(b.id)!.y)
          for (const session of ordered) {
            const parts = drawDesk(session, layout.seats.get(session.id)!, session.id === selectedId)
            parts.container.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(session.id)
            })
            world.addChild(parts.container)
            desks.set(session.id, parts)
            if (parts.figure && session.status === 'working') working.add(session.id)
          }
        }
        redrawRef.current = redraw
        app.renderer.on('resize', redraw)

        // 이름표가 아닌 곳(배경·그룹·섬·로비·책상)을 누르면 맵 이동 후보. 이름표는 stopPropagation 해서 여기 안 온다
        app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
          isDragged = false
          pan = { start: { x: event.global.x, y: event.global.y }, worldStart: { x: world.x, y: world.y }, isMoved: false }
        })
        app.stage.on('pointermove', (event: FederatedPointerEvent) => {
          if (signDrag) {
            const point = toWorld(event)
            const next = {
              x: Math.max(signDrag.minDelta.x, Math.round((point.x - signDrag.start.x) / TILE)),
              y: Math.max(signDrag.minDelta.y, Math.round((point.y - signDrag.start.y) / TILE)),
            }
            if (next.x === signDrag.delta.x && next.y === signDrag.delta.y) return
            signDrag.delta = next
            isDragged = true
            for (const view of signDrag.views) view.container.position.set(view.x + next.x * TILE, view.y + next.y * TILE)
            return
          }
          if (!pan) return
          const moved = { x: event.global.x - pan.start.x, y: event.global.y - pan.start.y }
          if (!pan.isMoved && Math.hypot(moved.x, moved.y) < DRAG_THRESHOLD_PX) return
          pan.isMoved = true
          isDragged = true
          world.x = pan.worldStart.x + moved.x
          world.y = pan.worldStart.y + moved.y
          clampPan()
        })
        const endDrag = () => {
          pan = null
          if (!signDrag) return
          const { delta, drop } = signDrag
          signDrag = null
          if (delta.x !== 0 || delta.y !== 0) {
            // 저장하면 office 가 바뀌어 다시 그려진다 (미룬 다시 그리기도 그때 같이)
            isRedrawPending = false
            drop(delta)
          } else if (isRedrawPending) {
            isRedrawPending = false
            redraw()
          }
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
