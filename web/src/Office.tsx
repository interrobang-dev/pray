import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import type { Office as OfficeData, Room, Seat, Session } from './types'
import { avatarOf, type Avatar } from './avatar'

/**
 * 도트 사무실. 모든 좌표는 "아트 픽셀" 단위이고 world 컨테이너를 2배로 키워 도트가 선명하게 보이게 한다.
 * 타일 하나 = 16 아트 px = 화면 32px.
 */
const SCALE = 2
const TILE = 16
const WALL_H = 40
const PAD_X = 8
const PAD_Y = WALL_H + 28
const SEAT_STEP = 3

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
}

interface Props {
  office: OfficeData
  sessions: Session[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
  onMoveSeat: (sessionId: string, seat: Seat) => void
  onEditRoom: (room: Room) => void
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

function roomAt(rooms: Room[], tileX: number, tileY: number): Room | null {
  return rooms.find((r) => tileX >= r.x && tileX < r.x + r.w && tileY >= r.y && tileY < r.y + r.h) ?? null
}

/** 파견 구역: 외부(터미널·IDE) 세션이 모이는 고정 구역. 방들의 오른쪽 끝에 붙는다 */
const ZONE_COLUMNS = 2
const ZONE_W = 1 + ZONE_COLUMNS * SEAT_STEP + 1

function externalZone(office: OfficeData, count: number): Room {
  const x = Math.max(...office.rooms.map((r) => r.x + r.w)) + 1
  const tallest = Math.max(...office.rooms.map((r) => r.y + r.h))
  const rows = Math.max(1, Math.ceil(count / ZONE_COLUMNS))
  return { id: 'external', name: '파견 (터미널·IDE)', x, y: 0, w: ZONE_W, h: Math.max(tallest, rows * SEAT_STEP + 2) }
}

/** 웹 세션: 저장된 자리 또는 로비 빈 칸. 외부 세션: 파견 구역에 순서대로 (저장된 자리 무시) */
function placeAll(office: OfficeData, sessions: Session[], zone: Room): Map<string, Seat> {
  const seats = new Map<string, Seat>()
  const taken = new Set<string>()
  const externals = sessions.filter((s) => s.kind === 'external')
  externals.forEach((session, index) => {
    seats.set(session.id, {
      roomId: zone.id,
      x: zone.x + 1 + (index % ZONE_COLUMNS) * SEAT_STEP,
      y: zone.y + 1 + Math.floor(index / ZONE_COLUMNS) * SEAT_STEP,
    })
  })
  const webs = sessions.filter((s) => s.kind === 'web')
  for (const session of webs) {
    const seat = office.seats[session.id]
    if (seat) {
      seats.set(session.id, seat)
      taken.add(`${seat.x},${seat.y}`)
    }
  }
  const lobby = office.rooms[0]
  for (const session of webs) {
    if (seats.has(session.id)) continue
    outer: for (let y = lobby.y + 1; y < lobby.y + lobby.h - 1; y += SEAT_STEP) {
      for (let x = lobby.x + 1; x < lobby.x + lobby.w - 2; x += SEAT_STEP) {
        if (taken.has(`${x},${y}`)) continue
        taken.add(`${x},${y}`)
        seats.set(session.id, { roomId: lobby.id, x, y })
        break outer
      }
    }
    if (!seats.has(session.id)) seats.set(session.id, { roomId: lobby.id, x: lobby.x, y: lobby.y })
  }
  return seats
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

// ---------- 방 ----------

function drawRoom(room: Room, onEdit: () => void): Container {
  const container = new Container()
  container.position.set(PAD_X + room.x * TILE, PAD_Y + room.y * TILE)
  const w = room.w * TILE
  const h = room.h * TILE
  const g = new Graphics()
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.25 })
  g.rect(0, 0, w, 3).fill(COLOR.partition).rect(0, 3, w, 1).fill(COLOR.partitionShadow)
  g.rect(0, 0, 3, h).fill(COLOR.partition).rect(3, 0, 1, h).fill(COLOR.partitionShadow)
  g.rect(w - 3, 0, 3, h).fill(COLOR.partition).rect(w - 4, 0, 1, h).fill(COLOR.partitionShadow)
  g.rect(0, h - 4, w, 2).fill(COLOR.partition).rect(0, h - 2, w, 2).fill(COLOR.green)
  container.addChild(g)

  const name = label(room.name, 7)
  const sign = new Graphics().rect(0, 0, name.width + 8, 11).fill(COLOR.partition).rect(0, 10, name.width + 8, 1).fill(COLOR.green)
  sign.position.set(6, 5)
  name.position.set(10, 6)
  container.addChild(sign, name)

  container.addChild(drawPlant(w - 14, 8, true))
  container.addChild(drawPlant(6, h - 14, false))

  if (room.waitingNote) {
    const text = label(room.waitingNote, 6, COLOR.text, 70)
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
  return container
}

function drawZone(zone: Room): Container {
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
  figure: Figure
}

const DESK_W = 36
const DESK_H = 46

function drawDesk(session: Session, seat: Seat, isSelected: boolean): DeskParts {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  const avatar = avatarOf(session.id)
  const isWorking = session.status === 'working'
  const isExternal = session.kind === 'external'

  // 의자 등받이
  const chair = new Graphics().rect(5, 4, 14, 14).fill(COLOR.chair).rect(5, 4, 14, 1).fill(COLOR.chairLine)
  chair.rect(4, 6, 1, 10).fill(COLOR.chairLine).rect(19, 6, 1, 10).fill(COLOR.chairLine)
  container.addChild(chair)

  const figure = drawFigure(avatar, session.status)
  figure.container.position.set(4, 2)
  container.addChild(figure.container)

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
  monitor.rect(23, 10, 12, 9).fill(COLOR.bezel)
  monitor.rect(24, 11, 10, 7).fill(isWorking ? COLOR.screenOn : COLOR.screenOff)
  if (isWorking) monitor.rect(25, 12, 4, 3).fill(0xdff0ff).rect(30, 13, 3, 2).fill(0xdff0ff)
  monitor.rect(28, 19, 2, 2).fill(COLOR.bezel).rect(26, 21, 6, 1).fill(COLOR.bezel)
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
  const name = label(session.title ?? session.id.slice(0, 8), 6, isExternal ? 0x7a7f8e : COLOR.text)
  const tagW = Math.min(name.width + 4, DESK_W)
  const tag = new Graphics().rect(0, 0, tagW, 9).fill(0xffffff).rect(0, 8, tagW, 1).fill(isExternal ? COLOR.chairLine : COLOR.green)
  tag.position.set(Math.floor((DESK_W - tagW) / 2), 39)
  name.position.set(tag.x + 2, 40)
  const mask = new Graphics().rect(tag.x, 39, tagW, 9).fill(0xffffff)
  name.mask = mask
  container.addChild(tag, mask, name)

  // 말풍선
  const bubbleText =
    session.status === 'needs-approval'
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

export function Office({ office, sessions, selectedId, onSelect, onMoveSeat, onEditRoom }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const latest = useRef({ office, sessions, selectedId, onSelect, onMoveSeat, onEditRoom })
  latest.current = { office, sessions, selectedId, onSelect, onMoveSeat, onEditRoom }
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
          start: { x: number; y: number }
          offset: { x: number; y: number }
          isMoved: boolean
        } | null = null

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

        const redraw = () => {
          const { office, sessions, selectedId, onSelect, onEditRoom } = latest.current
          world.removeChildren()
          desks.clear()
          working.clear()
          const alive = sessions.filter((s) => s.isAlive)
          const zone = externalZone(office, alive.filter((s) => s.kind === 'external').length)
          content.w = PAD_X * 2 + (zone.x + zone.w) * TILE
          content.h = PAD_Y + 16 + Math.max(zone.y + zone.h, ...office.rooms.map((r) => r.y + r.h)) * TILE
          const bgW = Math.max(content.w, Math.ceil(app.screen.width / SCALE))
          const bgH = Math.max(content.h, Math.ceil(app.screen.height / SCALE))
          world.addChild(drawBackground(bgW, bgH))
          for (const room of office.rooms) world.addChild(drawRoom(room, () => onEditRoom(room)))
          world.addChild(drawZone(zone))
          clampPan()
          const seats = placeAll(office, alive, zone)
          // 아래쪽 책상이 위쪽을 가리도록 y 순 정렬
          const ordered = [...alive].sort((a, b) => seats.get(a.id)!.y - seats.get(b.id)!.y)
          for (const session of ordered) {
            const seat = seats.get(session.id)!
            const parts = drawDesk(session, seat, session.id === selectedId)
            if (session.kind === 'web') {
              parts.container.on('pointerdown', (event: FederatedPointerEvent) => {
                drag = {
                  sessionId: session.id,
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
            if (session.status === 'working') working.add(session.id)
          }
        }
        redrawRef.current = redraw
        app.renderer.on('resize', redraw)

        app.stage.on('pointermove', (event: FederatedPointerEvent) => {
          if (!drag) return
          const parts = desks.get(drag.sessionId)
          if (!parts) return
          if (Math.hypot(event.global.x - drag.start.x, event.global.y - drag.start.y) > 4) drag.isMoved = true
          if (drag.isMoved) {
            parts.container.position.set(
              Math.round((event.global.x - world.x) / SCALE - drag.offset.x),
              Math.round((event.global.y - world.y) / SCALE - drag.offset.y),
            )
          }
        })
        const endDrag = () => {
          if (!drag) return
          const current = drag
          drag = null
          if (!current.isMoved) return
          const parts = desks.get(current.sessionId)
          if (!parts) return
          const tileX = Math.round((parts.container.x - PAD_X) / TILE)
          const tileY = Math.round((parts.container.y - PAD_Y) / TILE)
          const { office, onMoveSeat } = latest.current
          const room = roomAt(office.rooms, tileX, tileY) ?? office.rooms[0]
          const x = Math.min(Math.max(tileX, room.x), room.x + room.w - 3)
          const y = Math.min(Math.max(tileY, room.y), room.y + room.h - 3)
          onMoveSeat(current.sessionId, { roomId: room.id, x, y })
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
