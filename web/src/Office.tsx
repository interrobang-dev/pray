import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import type { Office as OfficeData, Room, Seat, Session } from './types'

const TILE = 32
const PAD_X = 16
/** 첫 줄 책상의 말풍선이 잘리지 않도록 위쪽은 넉넉히 */
const PAD_Y = 72
const SEAT_STEP = 3

interface Props {
  office: OfficeData
  sessions: Session[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
  onMoveSeat: (sessionId: string, seat: Seat) => void
  onEditRoom: (room: Room) => void
}

/** 세션 ID 로 고정된 캐릭터 색 */
function colorOf(id: string, isExternal: boolean): { body: number; head: number } {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const sat = isExternal ? 10 : 65
  return { body: hsl(hue, sat, 45), head: hsl(hue, sat * 0.6, 75) }
}

function hsl(h: number, s: number, l: number): number {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
  }
  return (f(0) << 16) | (f(8) << 8) | f(4)
}

function roomAt(rooms: Room[], tileX: number, tileY: number): Room | null {
  return rooms.find((r) => tileX >= r.x && tileX < r.x + r.w && tileY >= r.y && tileY < r.y + r.h) ?? null
}

/** 자리가 없는 세션은 로비(첫 방)의 빈 칸에 임시 배치 */
function placeAll(office: OfficeData, sessions: Session[]): Map<string, Seat> {
  const seats = new Map<string, Seat>()
  const taken = new Set<string>()
  for (const session of sessions) {
    const seat = office.seats[session.id]
    if (seat) {
      seats.set(session.id, seat)
      taken.add(`${seat.x},${seat.y}`)
    }
  }
  const lobby = office.rooms[0]
  for (const session of sessions) {
    if (seats.has(session.id)) continue
    for (let y = lobby.y + 1; y < lobby.y + lobby.h - 1; y += SEAT_STEP) {
      for (let x = lobby.x + 1; x < lobby.x + lobby.w - 2; x += SEAT_STEP) {
        if (taken.has(`${x},${y}`)) continue
        taken.add(`${x},${y}`)
        seats.set(session.id, { roomId: lobby.id, x, y })
        y = Infinity
        break
      }
    }
    if (!seats.has(session.id)) seats.set(session.id, { roomId: lobby.id, x: lobby.x, y: lobby.y })
  }
  return seats
}

function drawRoom(room: Room, onEdit: () => void): Container {
  const container = new Container()
  container.position.set(PAD_X + room.x * TILE, PAD_Y + room.y * TILE)
  const floor = new Graphics()
  floor.rect(0, 0, room.w * TILE, room.h * TILE).fill(0x3b3f4a)
  for (let y = 0; y < room.h; y++) {
    for (let x = 0; x < room.w; x++) {
      if ((x + y) % 2 === 0) floor.rect(x * TILE, y * TILE, TILE, TILE).fill(0x40454f)
    }
  }
  floor.rect(0, 0, room.w * TILE, room.h * TILE).stroke({ width: 3, color: 0x8a7a5a })
  container.addChild(floor)

  const label = new Text({ text: room.name, style: { fontSize: 13, fill: 0xffffff, fontWeight: 'bold' } })
  label.position.set(6, 4)
  container.addChild(label)

  if (room.waitingNote) {
    const note = new Container()
    const noteText = new Text({
      text: room.waitingNote,
      style: { fontSize: 11, fill: 0x333333, wordWrap: true, wordWrapWidth: 120 },
    })
    const bg = new Graphics().rect(0, 0, noteText.width + 12, noteText.height + 10).fill(0xf5e663)
    noteText.position.set(6, 5)
    note.addChild(bg, noteText)
    note.position.set(room.w * TILE - bg.width - 6, 4)
    container.addChild(note)
  }

  container.eventMode = 'static'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return container
}

interface DeskParts {
  container: Container
  handLeft: Graphics
  handRight: Graphics
  raisedHand: Graphics | null
}

function drawDesk(session: Session, seat: Seat, isSelected: boolean): DeskParts {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  const isExternal = session.kind === 'external'
  const { body, head } = colorOf(session.id, isExternal)
  const isDim = session.status === 'idle' || session.status === 'unknown'

  const desk = new Graphics()
  desk.rect(-4, TILE - 6, TILE * 2 + 8, 14).fill(0x8b6b43)
  desk.rect(-4, TILE + 8, 4, 10).fill(0x5c4630)
  desk.rect(TILE * 2, TILE + 8, 4, 10).fill(0x5c4630)
  desk.rect(TILE + 4, TILE - 16, 20, 12).fill(0x222222)
  desk.rect(TILE + 6, TILE - 14, 16, 8).fill(session.status === 'working' ? 0x7ec8ff : 0x334455)
  container.addChild(desk)

  const figure = new Container()
  figure.position.set(10, 2)
  figure.alpha = isDim ? 0.55 : 1
  const bodyG = new Graphics().rect(2, 12, 12, 12).fill(body)
  const headG = new Graphics().rect(3, 0, 10, 10).fill(head)
  const eyes = new Graphics().rect(5, 4, 2, 2).fill(0x222222).rect(9, 4, 2, 2).fill(0x222222)
  const handLeft = new Graphics().rect(0, 18, 3, 3).fill(head)
  const handRight = new Graphics().rect(13, 18, 3, 3).fill(head)
  figure.addChild(bodyG, headG, eyes, handLeft, handRight)

  let raisedHand: Graphics | null = null
  if (session.status === 'my-turn' || session.status === 'needs-approval') {
    raisedHand = new Graphics().rect(14, 2, 3, 8).fill(head)
    figure.addChild(raisedHand)
  }
  container.addChild(figure)

  if (isSelected) {
    container.addChild(new Graphics().rect(-8, -8, TILE * 2 + 16, TILE + 32).stroke({ width: 2, color: 0xffd866 }))
  }

  const name = new Text({
    text: seat.label ?? (session.title ?? session.id.slice(0, 8)).slice(0, 9),
    style: { fontSize: 10, fill: 0xdddddd },
  })
  name.position.set(0, TILE + 20)
  container.addChild(name)

  const bubbleText =
    session.status === 'needs-approval'
      ? `승인 필요: ${session.pendingTool ?? '?'}`
      : session.status === 'my-turn'
        ? (session.lastAssistantText?.split('\n')[0] ?? '끝났어요').slice(0, 60)
        : null
  if (bubbleText) {
    const bubble = new Container()
    const text = new Text({
      text: bubbleText,
      style: { fontSize: 11, fill: 0x111111, wordWrap: true, wordWrapWidth: 150 },
    })
    const bg = new Graphics()
      .roundRect(0, 0, text.width + 12, text.height + 10, 4)
      .fill(session.status === 'needs-approval' ? 0xffb3b3 : 0xffffff)
    bg.moveTo(10, text.height + 10).lineTo(16, text.height + 18).lineTo(22, text.height + 10).fill(bg.fillStyle.color)
    text.position.set(6, 5)
    bubble.addChild(bg, text)
    bubble.position.set(0, -bg.height - 12)
    container.addChild(bubble)
  }

  container.eventMode = 'static'
  container.cursor = 'pointer'
  return { container, handLeft, handRight, raisedHand }
}

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

    void app.init({ resizeTo: host, background: 0x1e2026, antialias: false }).then(() => {
      if (isDisposed) {
        app.destroy(true)
        return
      }
      host.appendChild(app.canvas)
      appRef.current = app
      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen
      const world = new Container()
      app.stage.addChild(world)

      let drag: { sessionId: string; start: { x: number; y: number }; offset: { x: number; y: number }; isMoved: boolean } | null =
        null

      const redraw = () => {
        const { office, sessions, selectedId, onSelect, onEditRoom } = latest.current
        world.removeChildren()
        desks.clear()
        working.clear()
        for (const room of office.rooms) world.addChild(drawRoom(room, () => onEditRoom(room)))
        const alive = sessions.filter((s) => s.isAlive)
        const seats = placeAll(office, alive)
        for (const session of alive) {
          const seat = seats.get(session.id)!
          const parts = drawDesk(session, seat, session.id === selectedId)
          parts.container.on('pointerdown', (event: FederatedPointerEvent) => {
            drag = {
              sessionId: session.id,
              start: { x: event.global.x, y: event.global.y },
              offset: { x: event.global.x - parts.container.x, y: event.global.y - parts.container.y },
              isMoved: false,
            }
            world.setChildIndex(parts.container, world.children.length - 1)
          })
          parts.container.on('pointertap', () => {
            if (!drag?.isMoved) onSelect(session.id)
          })
          world.addChild(parts.container)
          desks.set(session.id, parts)
          if (session.status === 'working') working.add(session.id)
        }
      }
      redrawRef.current = redraw

      app.stage.on('pointermove', (event: FederatedPointerEvent) => {
        if (!drag) return
        const parts = desks.get(drag.sessionId)
        if (!parts) return
        if (Math.hypot(event.global.x - drag.start.x, event.global.y - drag.start.y) > 4) drag.isMoved = true
        if (drag.isMoved) parts.container.position.set(event.global.x - drag.offset.x, event.global.y - drag.offset.y)
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
        const x = Math.min(Math.max(tileX, room.x), room.x + room.w - 2)
        const y = Math.min(Math.max(tileY, room.y), room.y + room.h - 2)
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
          if (working.has(id)) {
            parts.handLeft.y = frame ? -2 : 0
            parts.handRight.y = frame ? 0 : -2
          }
          if (parts.raisedHand) parts.raisedHand.y = frame ? -2 : 0
        }
      })

      redraw()
    })

    return () => {
      isDisposed = true
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
