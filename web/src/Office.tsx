import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js'
import { attendanceOf, type Office as OfficeData, type Group, type Session, type Team } from './types'
import { avatarOf, type Avatar } from './avatar'
import {
  DESK_TILES_H,
  DESK_TILES_W,
  GROUP_MARGIN,
  LOBBY_SIGN_H,
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
/** 팀·책상으로 부드럽게 이동하는 시간 (ms) */
const FOCUS_DURATION_MS = 300
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
  alertText: 0xc22f2f,
  select: 0x3f9c4b,
  gold: 0xd9a63a,
  silver: 0xa9b0bd,
  partLine: 0xc3c7d2,
  carpet: 0xede3d2,
  carpetPattern: 0xe2d5bf,
  carpetHighlight: 0xf6efe3,
  carpetBorder: 0xc8b598,
  carpetShadow: 0xb7a284,
  boothMat: 0xe5d9c5,
  boothWall: 0xdfd5c5,
  boothWallTop: 0xc69c68,
  boothWallShadow: 0xb5a792,
  woodLight: 0xd8b88c,
  woodMid: 0xb89466,
  woodDark: 0x755638,
  lampShade: 0xd99b38,
  lampGlow: 0xffe885,
}

/** 사무실 화면이 이동해 보여 줄 대상. 같은 대상을 다시 눌러도 움직이도록 매번 새 id 를 붙인다 */
export type OfficeFocus =
  | { id: number; kind: 'team'; teamId: string }
  | { id: number; kind: 'session'; sessionId: string }

interface Props {
  office: OfficeData
  sessions: Session[]
  selectedId: string | null
  focus: OfficeFocus | null
  /** 질문 카드가 떠 있으면 숫자 키는 질문 카드가 쓴다 */
  hasQuestionCard: boolean
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

// ---------- 시간대 ----------

/** 이 PC 시각의 시간대. 창밖(위쪽 벽)과 Off Duty 띠만 바뀌고 사무실 안 색은 그대로 */
type DayPhase = 'morning' | 'day' | 'dusk' | 'night'

/** 아침 6~9시, 낮 9~17시, 노을 17~19시, 밤 19~6시 */
function dayPhaseOf(date: Date): DayPhase {
  const hour = date.getHours()
  return hour >= 6 && hour < 9 ? 'morning' : hour >= 9 && hour < 17 ? 'day' : hour >= 17 && hour < 19 ? 'dusk' : 'night'
}

/** 창밖: 하늘 세 띠(위→아래), 도시 실루엣, 건물 창 (아침·낮은 불 꺼진 유리색, 노을·밤은 불빛), 밤만 별 */
const WINDOW_VIEW: Record<DayPhase, { sky: [number, number, number]; city: number; cityWindow: number; hasStars: boolean }> = {
  morning: { sky: [0xc4dcf0, 0xf3dccd, 0xfbe9cf], city: 0xb4b7c9, cityWindow: 0xe4dfd6, hasStars: false },
  day: { sky: [0xcfe6f5, 0xdff0f9, 0xeef7fb], city: 0xb7c3d1, cityWindow: 0xd8e2ec, hasStars: false },
  dusk: { sky: [0x8a7cb8, 0xe7a083, 0xf6c98a], city: 0x5e5674, cityWindow: 0xf5cd7b, hasStars: false },
  night: { sky: [0x1d2745, 0x26335a, 0x34426c], city: 0x141c30, cityWindow: 0xf5cd7b, hasStars: true },
}

/** Off Duty 띠: 하늘·맨 위 띠, 집·문, 집 창(불빛 또는 꺼진 유리)·창살, 가로등 불·불빛 아래 번짐, 이름표 글자색 */
const STREET_VIEW: Record<
  DayPhase,
  { sky: number; skyTop: number; house: number; door: number; windows: [number, number]; mullion: number; lamp: number; lampGlow: number | null; label: number; hasStars: boolean }
> = {
  morning: { sky: 0xf0cfb4, skyTop: 0xc6d4ea, house: 0x5f6a85, door: 0x444e67, windows: [0xd9e3ea, 0xd2dde6], mullion: 0x8a9bb0, lamp: 0xd5dae2, lampGlow: null, label: 0x3a3550, hasStars: false },
  day: { sky: 0xa9d2ee, skyTop: 0x8fc0e4, house: 0x6f7d96, door: 0x4c5870, windows: [0xc7dbe8, 0xbdd3e2], mullion: 0x8a9bb0, lamp: 0xd5dae2, lampGlow: null, label: 0x2b3a55, hasStars: false },
  dusk: { sky: 0xd98a72, skyTop: 0x6f5f9c, house: 0x2d2a42, door: 0x1f1d30, windows: [0xf5cd7b, 0xe8b568], mullion: 0x7d654e, lamp: 0xffdf96, lampGlow: 0xa8936c, label: 0xfff1d6, hasStars: false },
  night: { sky: 0x202b46, skyTop: 0x111a2d, house: 0x111c30, door: 0x26344a, windows: [0xf5cd7b, 0xe8b568], mullion: 0x7d654e, lamp: 0xffdf96, lampGlow: 0xa8936c, label: 0xf5dfad, hasStars: true },
}

// ---------- 배경 ----------

function drawBackground(widthPx: number, heightPx: number, phase: DayPhase): Container {
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
  const view = WINDOW_VIEW[phase]
  g.rect(0, winTop, widthPx, 9).fill(view.sky[0])
  g.rect(0, winTop + 9, widthPx, 9).fill(view.sky[1])
  g.rect(0, winTop + 18, widthPx, winH - 18).fill(view.sky[2])
  if (view.hasStars) for (let x = 9; x < widthPx; x += 23) g.rect(x, winTop + 2 + (x % 4) * 2, 1, 1).fill(0xbfcde2)
  // 도시 실루엣 (결정적 난수)
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let x = 2; x < widthPx; ) {
    const w = 3 + Math.floor(rand() * 4)
    const h = 3 + Math.floor(rand() * 8)
    g.rect(x, winTop + winH - h, w, h).fill(view.city)
    for (let wy = winTop + winH - h + 1; wy < winTop + winH - 1; wy += 2) {
      if (rand() > 0.5) g.rect(x + 1, wy, 1, 1).fill(view.cityWindow)
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

/** Focus Zone 가장자리 원목 책장. isHorizontal 이면 위쪽 벽면 가로 책장, 아니면 오른쪽 가장자리 3단 세로 책장 */
function drawBookshelf(x: number, y: number, isHorizontal: boolean): Graphics {
  const graphics = new Graphics()
  const bookColors = [0xd96b52, 0x6fae5e, 0x5b8ec9, 0xd9a63a, 0x8c73b8, 0xf1ebe1]
  if (isHorizontal) {
    const width = 32
    const height = 10
    graphics.rect(x, y, width, height).fill(COLOR.woodMid)
    graphics.rect(x, y, width, 2).fill(COLOR.woodLight)
    graphics.rect(x + 2, y + 2, width - 4, height - 4).fill(COLOR.woodDark)
    graphics.rect(x, y + height - 2, width, 2).fill(COLOR.woodLight)
    const books: [number, number, number, number][] = [
      [3, 3, 3, bookColors[0]],
      [6, 4, 2, bookColors[5]],
      [8, 3, 3, bookColors[2]],
      [11, 4, 2, bookColors[3]],
      [15, 3, 3, bookColors[1]],
      [18, 4, 3, bookColors[4]],
      [21, 3, 2, bookColors[5]],
      [25, 3, 3, bookColors[0]],
      [28, 4, 2, bookColors[2]],
    ]
    for (const [offsetX, offsetY, bookWidth, bookColor] of books) {
      graphics.rect(x + offsetX, y + offsetY, bookWidth, height - 2 - offsetY).fill(bookColor)
    }
    return graphics
  }
  const width = 12
  const height = 32
  graphics.rect(x, y, width, height).fill(COLOR.woodMid)
  graphics.rect(x, y, width, 2).fill(COLOR.woodLight)
  for (let shelfIndex = 0; shelfIndex < 3; shelfIndex++) {
    const shelfTop = y + 3 + shelfIndex * 9
    graphics.rect(x + 2, shelfTop, width - 4, 7).fill(COLOR.woodDark)
    graphics.rect(x + 1, shelfTop + 7, width - 2, 2).fill(COLOR.woodLight)
    const firstColor = bookColors[(shelfIndex * 2) % bookColors.length]
    const secondColor = bookColors[(shelfIndex * 2 + 1) % bookColors.length]
    const thirdColor = bookColors[(shelfIndex * 2 + 3) % bookColors.length]
    graphics.rect(x + 2, shelfTop + 1, 2, 6).fill(firstColor)
    graphics.rect(x + 4, shelfTop + 2, 2, 5).fill(secondColor)
    graphics.rect(x + 6, shelfTop + 1, 3, 6).fill(thirdColor)
  }
  return graphics
}

/**
 * Focus Zone 자리마다 그리는 1인 칸막이 부스(낮은 파티션 + 우드 사이드 선반)와 스탠드 조명·머그·헤드폰.
 * 책상(0..32, 20..39)·캐릭터(4..21, 2..23)·모니터(22..32, 10..22)·이름표(-6..38, 39..48)·말풍선(y<0) 바깥에 그려 가리지 않는다
 */
function drawFocusBooth(graphics: Graphics, seatX: number, seatY: number, seatIndex: number): void {
  const mugColors = [0xd96b52, 0x5d9b78, 0x5b8ec9, 0xd9a63a]
  const mugColor = mugColors[seatIndex % mugColors.length]

  // 부스 안쪽 바닥 매트
  graphics.rect(seatX - 1, seatY + 2, 41, 34).fill(COLOR.boothMat)

  // ㄷ자형 낮은 파티션 (뒷벽·왼쪽 날개·오른쪽 날개)
  graphics.rect(seatX - 3, seatY, 46, 2).fill(COLOR.boothWall)
  graphics.rect(seatX - 3, seatY, 46, 1).fill(COLOR.boothWallTop)
  graphics.rect(seatX + 22, seatY + 2, 21, 1).fill(COLOR.boothWall).rect(seatX + 22, seatY + 3, 21, 1).fill(COLOR.boothWallShadow)

  graphics.rect(seatX - 3, seatY, 2, 36).fill(COLOR.boothWall)
  graphics.rect(seatX - 3, seatY, 1, 36).fill(COLOR.boothWallTop)
  graphics.rect(seatX - 1, seatY + 2, 1, 34).fill(COLOR.boothWallShadow)
  graphics.rect(seatX - 3, seatY + 35, 4, 2).fill(COLOR.boothWallShadow)

  graphics.rect(seatX + 40, seatY, 2, 36).fill(COLOR.boothWall)
  graphics.rect(seatX + 41, seatY, 1, 36).fill(COLOR.boothWallTop)
  graphics.rect(seatX + 42, seatY + 1, 1, 35).fill(COLOR.boothWallShadow)
  graphics.rect(seatX + 35, seatY + 35, 8, 2).fill(COLOR.boothWallShadow)

  // 책상 오른쪽 보조 사이드 선반과 빈 부스용 기본 상판 (세션이 앉으면 drawDesk 가 0..32 상판을 덮어 그린다)
  graphics.rect(seatX, seatY + 20, 32, 9).fill(COLOR.woodLight)
  graphics.rect(seatX, seatY + 29, 32, 6).fill(COLOR.woodMid)
  graphics.rect(seatX + 32, seatY + 4, 8, 28).fill(COLOR.woodLight)
  graphics.rect(seatX + 32, seatY + 32, 8, 3).fill(COLOR.woodMid)
  graphics.rect(seatX + 32, seatY + 4, 1, 28).fill(COLOR.woodMid)

  // 스탠드 조명 (사이드 선반 위쪽)
  graphics
    .rect(seatX + 33, seatY + 7, 4, 3)
    .fill({ color: COLOR.lampGlow, alpha: 0.55 })
    .rect(seatX + 34, seatY + 7, 2, 2)
    .fill({ color: 0xfff8cc, alpha: 0.85 })
  graphics.rect(seatX + 36, seatY + 11, 3, 2).fill(0x5a6070)
  graphics.rect(seatX + 38, seatY + 6, 1, 5).fill(0x7a8090).rect(seatX + 36, seatY + 5, 2, 1).fill(0x7a8090)
  graphics.rect(seatX + 34, seatY + 5, 3, 2).fill(COLOR.lampShade).rect(seatX + 34, seatY + 5, 3, 1).fill(0xf0ba59)

  // 머그컵 (사이드 선반 가운데)
  graphics.rect(seatX + 34, seatY + 20, 4, 1).fill(COLOR.woodMid)
  graphics.rect(seatX + 34, seatY + 16, 4, 4).fill(mugColor)
  graphics.rect(seatX + 35, seatY + 16, 2, 1).fill(0x5c3a21)
  graphics.rect(seatX + 38, seatY + 17, 1, 2).fill(mugColor)
  graphics.rect(seatX + 35, seatY + 14, 1, 1).fill({ color: 0xffffff, alpha: 0.65 })

  // 헤드폰 (사이드 선반 아래쪽)
  graphics
    .rect(seatX + 35, seatY + 24, 3, 1)
    .fill(0x3a3e4a)
    .rect(seatX + 34, seatY + 25, 1, 2)
    .fill(0x3a3e4a)
    .rect(seatX + 38, seatY + 25, 1, 2)
    .fill(0x3a3e4a)
  graphics.rect(seatX + 34, seatY + 27, 2, 3).fill(0x2b2f3a).rect(seatX + 37, seatY + 27, 2, 3).fill(0x2b2f3a)
  graphics.rect(seatX + 34, seatY + 28, 1, 1).fill(mugColor).rect(seatX + 38, seatY + 28, 1, 1).fill(mugColor)
}

/** Focus Zone(팀 없는 세션 구역): 따뜻한 색 카펫 바닥(옅은 무늬) + 자리마다 1인 칸막이 부스·조명·소품 + 가장자리 책장·화분 */
function drawZone(zone: Rect): Container {
  const container = new Container()
  container.position.set(PAD_X + zone.x * TILE, PAD_Y + zone.y * TILE)
  const width = zone.w * TILE
  const height = zone.h * TILE
  const graphics = new Graphics()

  // 따뜻한 색 카펫 바닥과 테두리
  graphics.rect(0, 0, width, height).fill(COLOR.carpet)
  graphics.rect(0, 0, width, 2).fill(COLOR.carpetBorder).rect(0, height - 2, width, 2).fill(COLOR.carpetShadow)
  graphics.rect(0, 0, 2, height).fill(COLOR.carpetBorder).rect(width - 2, 0, 2, height).fill(COLOR.carpetBorder)
  graphics.rect(3, 3, width - 6, 1).fill(COLOR.carpetPattern).rect(3, height - 4, width - 6, 1).fill(COLOR.carpetPattern)
  graphics.rect(3, 3, 1, height - 6).fill(COLOR.carpetPattern).rect(width - 4, 3, 1, height - 6).fill(COLOR.carpetPattern)

  // 카펫 옅은 직조 무늬
  for (let y = 6; y < height - 6; y += 8) {
    for (let x = 6; x < width - 6; x += 8) {
      graphics.rect(x, y, 2, 1).fill(COLOR.carpetPattern).rect(x, y + 1, 1, 1).fill(COLOR.carpetPattern)
      if (x + 4 < width - 6 && y + 4 < height - 6) {
        graphics.rect(x + 4, y + 4, 2, 1).fill(COLOR.carpetHighlight)
      }
    }
  }

  // 2열 자리마다 1인 칸막이 부스·스탠드 조명·머그·헤드폰
  // 맨 위 1타일은 이름표 줄이라 자리(부스)는 그 아래부터 (officeLayout.ts 의 자리와 같다)
  const signRowH = LOBBY_SIGN_H * TILE
  const boothRows = Math.max(1, Math.floor((zone.h - LOBBY_SIGN_H - 2) / SEAT_STEP))
  for (let row = 0; row < boothRows; row++) {
    for (let column = 0; column < 2; column++) {
      const seatX = (1 + column * SEAT_STEP) * TILE
      const seatY = (LOBBY_SIGN_H + 1 + row * SEAT_STEP) * TILE
      drawFocusBooth(graphics, seatX, seatY, row * 2 + column)
    }
  }

  container.addChild(graphics)

  // 구역 가장자리 책장·화분 (자리와 같이 이름표 줄만큼 내린다. 첫 줄 말풍선 자리 오른쪽은 비워 둔다)
  container.addChild(drawPlant(4, signRowH + 24, false))
  container.addChild(drawBookshelf(width - 16, signRowH + 18, false))
  if (height >= signRowH + 120) container.addChild(drawPlant(width - 14, signRowH + 58, false))
  if (height >= signRowH + 176) container.addChild(drawBookshelf(width - 16, signRowH + 80, false))
  if (height >= signRowH + 220) container.addChild(drawPlant(width - 14, signRowH + 122, false))
  container.addChild(drawBookshelf(46, height - 13, true))
  container.addChild(drawPlant(width - 16, height - 11, true))
  container.addChild(drawPlant(4, height - 9, false))

  const name = label('Focus Zone', 7, COLOR.text)
  const sign = new Graphics()
    .rect(0, 0, name.width + 8, 11)
    .fill(COLOR.partition)
    .rect(0, 10, name.width + 8, 1)
    .fill(COLOR.boothWallTop)
  // 이름표 줄(맨 위 1타일) 안. 첫 줄 자리 말풍선 상자 위 끝(y=12)에 닿지 않게 테두리 위에 붙인다
  sign.position.set(6, 1)
  name.position.set(10, 2)
  name.eventMode = 'none'
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

/** 책상과 퇴근 띠에서 같은 머리 스타일·색을 쓴다. 몸통 없이 정수 아트 픽셀 그대로 */
function drawHead(avatar: Avatar, status: Session['status']): Container {
  const container = new Container()
  const isIdle = status === 'idle' || status === 'unknown' || status === 'ended'
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

  return container
}

function drawFigure(avatar: Avatar, status: Session['status']): Figure {
  const container = new Container()
  const hasRaisedHand = status === 'my-turn' || status === 'needs-approval'

  // 몸통 (셔츠) 10x8, 어깨 둥글게
  const body = new Graphics()
  body.rect(3, 12, 10, 9).fill(avatar.shirt)
  body.rect(2, 13, 1, 7).fill(avatar.shirt).rect(13, 13, 1, 7).fill(avatar.shirt)
  body.rect(7, 12, 2, 2).fill(COLOR.text)
  container.addChild(body)

  container.addChild(drawHead(avatar, status))

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
  /** 말풍선이 없으면 null. 책상 컨테이너가 아니라 말풍선 층에 넣는다 */
  bubble: DeskBubble | null
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

  container.eventMode = 'static'
  container.cursor = 'pointer'
  return { container, figure, bubble: drawBubble(session, container.x, container.y) }
}

// ---------- 말풍선 ----------

/** 접힌 말풍선 최대 폭 (책상 폭 + 조금. 자리 간격 48px 안이라 옆 자리 말풍선과 안 겹친다) */
const BUBBLE_MAX_W = 44
/** 펼친 말풍선 줄바꿈 폭과 최대 글자 수 */
const BUBBLE_EXPANDED_W = 160
const BUBBLE_EXPANDED_MAX_CHARS = 300
/**
 * 말풍선 상자 아래 끝 (책상 기준). 자리 간격이 책상 높이와 같아 위아래 책상 사이에 빈 줄이 없으므로,
 * 상자는 윗줄 책상 이름표(이 책상 기준 -9..0) 위에 두고 가는 꼬리를 자기 머리(1)까지 내려 누구 것인지 보인다
 */
const BUBBLE_BOX_BOTTOM = -10
const BUBBLE_TAIL_END = 1

interface DeskBubble {
  /** 책상과 같은 자리에 둔다 (말풍선 층은 모든 책상 위. 끌 때 책상과 같이 옮긴다) */
  container: Container
  compact: Container
  expanded: Container
}

/** 한 줄로 maxWidth 안에 들어가게 끝을 … 로 자른다 */
function fitOneLine(text: Text, content: string, maxWidth: number): void {
  text.text = content
  if (text.width <= maxWidth) return
  const characters = Array.from(content)
  let low = 0
  let high = characters.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    text.text = `${characters.slice(0, middle).join('').trimEnd()}…`
    if (text.width <= maxWidth) low = middle
    else high = middle - 1
  }
  text.text = `${characters.slice(0, low).join('').trimEnd()}…`
}

/** 말풍선 상자(아래 끝 BUBBLE_BOX_BOTTOM) + 자기 머리까지 내려오는 꼬리 */
function bubbleBox(text: Text, isAlert: boolean): Container {
  const box = new Container()
  const bw = Math.ceil(text.width) + 4
  const bh = Math.ceil(text.height) + 2
  const fill = isAlert ? COLOR.alert : COLOR.bubble
  const line = isAlert ? COLOR.alertLine : COLOR.bubbleLine
  const g = new Graphics()
  g.rect(0, 0, bw, bh).fill(fill)
  g.rect(0, 0, bw, bh).stroke({ width: 1, color: line })
  // 윗줄 이름표를 지나므로 이름 글자를 덜 가리게 왼쪽 끝 (이름표는 가운데 정렬이라 여기는 대개 "[" 자리)
  g.rect(1, bh, 1, BUBBLE_TAIL_END - BUBBLE_BOX_BOTTOM).fill(line)
  text.position.set(2, 1)
  box.addChild(g, text)
  box.position.set(2, BUBBLE_BOX_BOTTOM - bh)
  return box
}

/**
 * my-turn 은 마지막 말, 승인 대기는 빨간 "! 도구". 접힌 것은 한 줄 말줄임으로 책상 폭 안,
 * 펼친 것(마우스를 올렸거나 선택한 세션)은 전체 글. 휴식 세션은 훅 상태가 남아 있어도 없다
 */
function drawBubble(session: Session, x: number, y: number): DeskBubble | null {
  if (attendanceOf(session) === 'break') return null
  const isAlert = session.status === 'needs-approval'
  const tool = session.pendingTool ?? '?'
  const lastText = session.lastAssistantText ?? '끝났어요'
  const compactText = isAlert ? `! ${tool}` : session.status === 'my-turn' ? (lastText.split('\n')[0] ?? '') : ''
  if (!compactText) return null
  const fullText = isAlert
    ? `승인 필요: ${tool}`
    : lastText.length > BUBBLE_EXPANDED_MAX_CHARS
      ? `${lastText.slice(0, BUBBLE_EXPANDED_MAX_CHARS).trimEnd()}…`
      : lastText
  const textColor = isAlert ? COLOR.alertText : COLOR.text
  const compactLabel = label('', 6, textColor)
  fitOneLine(compactLabel, compactText, BUBBLE_MAX_W - 4)
  const expandedLabel = new Text({
    text: fullText,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 6,
      fill: textColor,
      wordWrap: true,
      wordWrapWidth: BUBBLE_EXPANDED_W,
      breakWords: true,
    },
    resolution: MAX_ZOOM,
  })
  const compact = bubbleBox(compactLabel, isAlert)
  const expanded = bubbleBox(expandedLabel, isAlert)
  expanded.visible = false
  const container = new Container()
  container.position.set(x, y)
  container.addChild(compact, expanded)
  // 보이기만 한다. 아래에 깔린 윗줄 책상·팀/파트 이름표(끌기)를 누르는 것을 가로채지 않게
  container.eventMode = 'none'
  return { container, compact, expanded }
}

// ---------- 건물 밖 ----------

const OFF_DUTY_HEIGHT = 6 * TILE
const OFF_DUTY_HEAD_STEP = 24

/** 사무실 내용 바로 아래, 맵 전체 폭의 거리. 인원이 없어도 그린다 */
function drawOffDuty(width: number, phase: DayPhase): Container {
  const container = new Container()
  const view = STREET_VIEW[phase]
  const scenery = new Graphics()
  scenery.rect(0, 0, width, OFF_DUTY_HEIGHT).fill(view.sky)
  scenery.rect(0, 0, width, 3).fill(view.skyTop)
  if (view.hasStars) for (let x = 20; x < width - 2; x += 37) scenery.rect(x, 12 + (x % 3) * 5, 1, 1).fill(0xbfcde2)
  // 지붕은 계단 모양 픽셀. 창과 가로등은 노을·밤에 따뜻한 불빛, 아침·낮엔 꺼짐
  for (let x = 12; x + 80 < width; x += 96) {
    scenery.rect(x, 38, 44, 27).fill(view.house)
    for (let step = 0; step < 5; step++) scenery.rect(x + step * 4, 36 - step * 2, 44 - step * 8, 2).fill(view.house)
    scenery.rect(x + 8, 46, 6, 8).fill(view.windows[0])
    scenery.rect(x + 28, 46, 6, 8).fill(view.windows[1])
    scenery.rect(x + 10, 46, 1, 8).fill(view.mullion)
    scenery.rect(x + 30, 46, 1, 8).fill(view.mullion)
    scenery.rect(x + 20, 54, 7, 11).fill(view.door)
    scenery.rect(x + 67, 35, 2, 30).fill(0x8390a4)
    scenery.rect(x + 63, 32, 10, 2).fill(0x101c31)
    scenery.rect(x + 64, 34, 8, 4).fill(view.lamp)
    if (view.lampGlow !== null) scenery.rect(x + 65, 38, 6, 2).fill(view.lampGlow)
  }
  scenery.rect(0, 64, width, 2).fill(0xb2a691)
  scenery.rect(0, 66, width, 26).fill(0x626b7b)
  scenery.rect(0, 92, width, 4).fill(0x343f53)
  for (let x = 0; x < width; x += TILE) scenery.rect(x, 88, Math.min(TILE - 1, width - x), 1).fill(0x77808e)
  const name = label('Off Duty', 8, view.label)
  name.position.set(12, 7)
  container.addChild(scenery, name)
  container.eventMode = 'static'
  container.cursor = 'grab'
  return container
}

// ---------- 승인 대기 화살표 ----------

/** 화면 밖 승인 대기 책상 쪽. 세로 먼저 (up-left 처럼) */
type ApprovalDirection = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left'

/** 화살표 도트 (9×9, # = 칠함). 위·오른쪽 위만 그리고 나머지는 90도씩 돌린다 (각도로 돌리면 도트가 뭉개진다) */
const ARROW_UP = ['....#....', '...###...', '..#####..', '.#######.', '#########', '...###...', '...###...', '...###...', '...###...']
const ARROW_UP_RIGHT = ['...######', '....#####', '.....####', '....#####', '...###.##', '..###...#', '.###.....', '###......', '.#.......']
/** 화살표 도트 한 칸 = 화면 3px (캔버스 배율과 관계없이 같은 크기) */
const ARROW_PIXEL = 3
/** 흰 테두리 1칸을 둘러 11칸 */
const ARROW_SIZE = (ARROW_UP.length + 2) * ARROW_PIXEL
const ARROW_MARGIN = 6

function rotateClockwise(rows: string[]): string[] {
  return rows.map((_, r) => rows.map((row) => row[r]).reverse().join(''))
}

function arrowShape(direction: ApprovalDirection): string[] {
  const isDiagonal = direction.includes('-')
  const turns = { up: 0, 'up-right': 0, right: 1, 'down-right': 1, down: 2, 'down-left': 2, left: 3, 'up-left': 3 }[direction]
  let rows = isDiagonal ? ARROW_UP_RIGHT : ARROW_UP
  for (let i = 0; i < turns; i++) rows = rotateClockwise(rows)
  return rows
}

/** 승인 말풍선과 같은 빨강에 흰 테두리 (어느 바탕 위에서도 보이게) */
function drawApprovalArrow(direction: ApprovalDirection): Graphics {
  const rows = arrowShape(direction)
  const isFilled = (r: number, c: number) => rows[r]?.[c] === '#'
  const g = new Graphics()
  for (let r = -1; r <= rows.length; r++) {
    for (let c = -1; c <= rows.length; c++) {
      if (isFilled(r, c)) continue
      const isEdge = [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => isFilled(r + dr, c + dc)))
      if (isEdge) g.rect((c + 1) * ARROW_PIXEL, (r + 1) * ARROW_PIXEL, ARROW_PIXEL, ARROW_PIXEL).fill(COLOR.frame)
    }
  }
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') g.rect((c + 1) * ARROW_PIXEL, (r + 1) * ARROW_PIXEL, ARROW_PIXEL, ARROW_PIXEL).fill(COLOR.alertLine)
    }
  })
  return g
}

// ---------- 컴포넌트 ----------

export function Office(props: Props) {
  const { office, sessions, selectedId, focus } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const latest = useRef(props)
  latest.current = props
  const redrawRef = useRef<() => void>(() => {})
  const focusRef = useRef<(target: OfficeFocus) => void>(() => {})
  const handledFocusIdRef = useRef(focus?.id ?? 0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let isDisposed = false
    const app = new Application()
    const desks = new Map<string, DeskParts>()
    const working = new Set<string>()
    let frame = 0
    let removeListeners = () => {}
    let disconnectResize = () => {}
    let stopPhaseTimer = () => {}

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

        /** 바탕 크기 (아트 px): 내용 + Off Duty 띠 + 오른쪽·아래로 화면 한 장 (그룹을 옮겨 놓을 빈 자리) */
        const map = { w: 0, h: 0 }
        const offDutyHeads = new Map<string, Rect>()
        const islandViews = new Map<string, Container>()
        /** 근무 중인 승인 대기 책상 (타일 사각형). redraw 가 정하고 화살표가 매 프레임 화면 밖인지 본다 */
        let approvalDesks: { session: Session; rect: Rect }[] = []
        // 팀·책상으로 부드럽게 이동하는 애니메이션 (300ms ease-out). 휠·끌기를 시작하면 멈춘다
        let focusMove: { from: Point; to: Point; elapsed: number } | null = null
        // 빈 곳(이름표 밖)을 누르고 DRAG_THRESHOLD_PX 넘게 움직이면 맵 이동
        let pan: { start: Point; worldStart: Point; isMoved: boolean } | null = null
        // 이름표 끌기: 그룹(안의 섬·책상과 같이) 또는 팀 섬(책상과 같이). 끄는 동안 타일 단위로 그림만 옮기고 놓을 때 저장한다
        let signDrag: {
          start: Point
          /** 왼쪽·위로 갈 수 있는 한계 (타일, 0 이하) */
          minDelta: Point
          maxDeltaY: number
          delta: Point
          views: { container: Container; x: number; y: number }[]
          drop: (delta: Point) => void
        } | null = null
        /** 이번 누름이 끌기였는지. 놓은 뒤 오는 pointertap(Pixi 는 pointerup 다음에 보낸다)이 선택·더블클릭 편집이 되지 않게 다음 누름까지 남긴다 */
        let isDragged = false
        /** 이름표를 끄는 동안 미룬 다시 그리기 (그 사이 다시 그리면 끌던 그림이 원래 자리로 돌아간다) */
        let isRedrawPending = false
        /** 지금 그려진 시간대. 1분마다 바뀌었는지 보고 바뀌었으면 다시 그린다 */
        let drawnPhase = dayPhaseOf(new Date())
        /** 마우스를 올린 책상(또는 그 말풍선)의 세션. 다시 그려도 펼친 채 남게 여기 둔다 */
        let hoveredDeskId: string | null = null

        /** 화면 좌표 → world 아트 픽셀 */
        const toWorld = (event: FederatedPointerEvent) => ({
          x: (event.global.x - world.x) / zoom,
          y: (event.global.y - world.y) / zoom,
        })

        const clampWorld = (x: number, y: number): Point => ({
          x: Math.round(Math.max(app.screen.width - map.w * zoom, Math.min(0, x))),
          y: Math.round(Math.max(app.screen.height - map.h * zoom, Math.min(0, y))),
        })

        const clampPan = () => {
          const clamped = clampWorld(world.x, world.y)
          world.position.set(clamped.x, clamped.y)
        }

        // 세션을 골라 오른쪽 패널이 열리거나 닫힌 직후에는 ResizeObserver 보다 먼저 불리므로 바뀐 칸 크기로 먼저 맞춘다
        const syncSize = () => {
          if (host.clientWidth > 0 && host.clientHeight > 0 && (host.clientWidth !== app.screen.width || host.clientHeight !== app.screen.height)) {
            app.resize()
          }
        }

        /** 타일 사각형이 화면 가운데 오도록 이동한다. isOnlyOutside 면 이미 화면 안에 다 보일 때는 움직이지 않는다 */
        const moveToRect = (rect: Rect, isOnlyOutside: boolean) => {
          syncSize()
          const left = PAD_X + rect.x * TILE
          const top = PAD_Y + rect.y * TILE
          const width = rect.w * TILE
          const height = rect.h * TILE
          if (
            isOnlyOutside &&
            world.x + left * zoom >= 0 &&
            world.x + (left + width) * zoom <= app.screen.width &&
            world.y + top * zoom >= 0 &&
            world.y + (top + height) * zoom <= app.screen.height
          ) {
            focusMove = null
            return
          }
          const to = clampWorld(
            app.screen.width / 2 - (left + width / 2) * zoom,
            app.screen.height / 2 - (top + height / 2) * zoom,
          )
          if (to.x === world.x && to.y === world.y) {
            focusMove = null
            return
          }
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            focusMove = null
            world.position.set(to.x, to.y)
            return
          }
          focusMove = { from: { x: world.x, y: world.y }, to, elapsed: 0 }
        }

        const focusTeam = (teamId: string) => {
          const layout = layoutOffice(latest.current.office, latest.current.sessions)
          const island = layout.islands.find((i) => i.team.id === teamId)
          if (island) moveToRect(island, false)
        }

        const applyFocus = (target: OfficeFocus) => {
          handledFocusIdRef.current = target.id
          if (target.kind === 'team') {
            focusTeam(target.teamId)
            return
          }
          const layout = layoutOffice(latest.current.office, latest.current.sessions)
          const seat = layout.seats.get(target.sessionId)
          if (seat) moveToRect({ ...seat, w: DESK_TILES_W, h: DESK_TILES_H }, true)
          else {
            const head = offDutyHeads.get(target.sessionId)
            if (head) moveToRect(head, true)
          }
        }
        focusRef.current = applyFocus

        // 휠 = 확대·축소. 한 칸에 정수 배율 한 단계, 커서 아래 지점이 그대로 남게
        let wheelDelta = 0
        const onWheel = (event: WheelEvent) => {
          event.preventDefault()
          if (event.deltaY === 0 || pan || signDrag) return
          focusMove = null
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

        let isPointerInside = host.matches(':hover')
        const onMouseMove = (event: MouseEvent) => {
          const bounds = host.getBoundingClientRect()
          isPointerInside =
            event.clientX >= bounds.left && event.clientX < bounds.right && event.clientY >= bounds.top && event.clientY < bounds.bottom
        }
        const onMouseLeave = () => {
          isPointerInside = false
        }
        // 마우스가 사무실 위에 있을 때 숫자 키 1~9 = 왼쪽 목록 순서의 n번째 팀 섬으로 이동 (질문 카드 숫자 키가 우선)
        const onKeyDown = (event: KeyboardEvent) => {
          if (!isPointerInside && !host.matches(':hover')) return
          if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing || !/^[1-9]$/.test(event.key)) return
          if (latest.current.hasQuestionCard || document.querySelector('.question-card')) return
          const active = document.activeElement
          if (
            (event.target instanceof HTMLElement &&
              (event.target.isContentEditable || Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]')))) ||
            (active instanceof HTMLElement &&
              (active.isContentEditable || Boolean(active.closest('input, textarea, select, [contenteditable="true"]'))))
          ) {
            return
          }
          const { office } = latest.current
          // App.tsx 가 왼쪽 목록에 팀을 그리는 순서 그대로 (그룹별 팀 → 그룹이 지워진 팀)
          const orderedTeams = [
            ...office.groups.flatMap((group) => office.teams.filter((t) => t.groupId === group.id)),
            ...office.teams.filter((t) => !office.groups.some((g) => g.id === t.groupId)),
          ]
          const team = orderedTeams[Number(event.key) - 1]
          if (team) focusTeam(team.id)
        }
        host.addEventListener('wheel', onWheel, { passive: false })
        host.addEventListener('mouseleave', onMouseLeave)
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('keydown', onKeyDown)
        removeListeners = () => {
          host.removeEventListener('wheel', onWheel)
          host.removeEventListener('mouseleave', onMouseLeave)
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('keydown', onKeyDown)
        }

        // resizeTo 는 창 크기가 바뀔 때만 다시 잰다. 패널을 여닫을 때처럼 사무실 칸만 바뀌어도 캔버스가 따라가게
        // (안 하면 패널이 열린 채 다시 보인 사무실이 580px 캔버스로 남아, 패널을 닫으면 오른쪽이 빈다)
        const resizeObserver = new ResizeObserver(() => syncSize())
        resizeObserver.observe(host)
        disconnectResize = () => resizeObserver.disconnect()

        const beginSignDrag = (
          event: FederatedPointerEvent,
          drag: { minDelta: Point; containers: Container[]; drop: (delta: Point) => void },
        ) => {
          // 맵 이동이 시작되지 않게
          event.stopPropagation()
          focusMove = null
          isDragged = false
          signDrag = {
            start: toWorld(event),
            minDelta: drag.minDelta,
            // 띠 아래 빈 자리까지는 갈 수 있다. 놓으면 띠가 다시 내용 아래 끝을 따라가므로 띠와 겹친 채 남지 않는다
            maxDeltaY: Math.floor((map.h - TILE - Math.max(...drag.containers.map((container) => container.y + container.height))) / TILE),
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
          offDutyHeads.clear()
          approvalDesks = []
          islandViews.clear()
          working.clear()
          const layout = layoutOffice(office, sessions)
          map.w = PAD_X + layout.right * TILE + Math.ceil(app.screen.width / zoom)
          // 띠는 늘 내용(그룹·섬·Focus Zone) 아래 끝 + 1타일. 바닥 격자에 맞는다
          const streetY = PAD_Y + (layout.bottom + 1) * TILE
          map.h = streetY + OFF_DUTY_HEIGHT + Math.ceil(app.screen.height / zoom / TILE) * TILE
          drawnPhase = dayPhaseOf(new Date())
          world.addChild(drawBackground(map.w, map.h, drawnPhase))
          // 끄는 그룹·섬이 띠를 지날 때 가려지지 않게 바닥 바로 위에 둔다
          const street = drawOffDuty(map.w, drawnPhase)
          street.y = streetY
          world.addChild(street)
          clampPan()
          /** 그 팀들의 책상 그림 (끌 때 같이 옮긴다) */
          const deskViewsOf = (teamIds: Set<string>) =>
            layout.seated.flatMap((s) => {
              const parts = s.teamId && teamIds.has(s.teamId) ? desks.get(s.id) : undefined
              return parts ? [parts.container, ...(parts.bubble ? [parts.bubble.container] : [])] : []
            })
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
                // 밀려 그려졌으면 그려진 자리에서 옮긴 곳을 저장한다
                drop: (delta) => latest.current.onMoveGroup(area.group.id, { x: area.origin.x + delta.x, y: area.origin.y + delta.y }),
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
                drop: (delta) =>
                  latest.current.onMoveTeam(team.id, dropIsland(layout, team, { x: island.anchor.x + delta.x, y: island.anchor.y + delta.y })),
              })
            })
            world.addChild(parts.container)
            islandViews.set(team.id, parts.container)
          }
          const offDuty = sessions.filter((session) => attendanceOf(session) === 'off')
          const capacity = Math.max(0, Math.floor((map.w - 2 * PAD_X) / OFF_DUTY_HEAD_STEP))
          // 넘치면 마지막 칸부터 +N 글자 폭을 확보한다. 이름은 hover 때만
          const overflow = label('', 7, 0xffe4a9)
          let visibleCount = Math.min(offDuty.length, capacity)
          while (visibleCount < offDuty.length) {
            overflow.text = `+${offDuty.length - visibleCount}`
            if (PAD_X + visibleCount * OFF_DUTY_HEAD_STEP + overflow.width <= map.w - PAD_X || visibleCount === 0) break
            visibleCount--
          }
          const tooltip = new Container()
          tooltip.eventMode = 'none'
          tooltip.visible = false
          const tooltipBackground = new Graphics()
          const tooltipName = label('', 7, 0xffffff, Math.min(160, map.w - 16))
          tooltip.addChild(tooltipBackground, tooltipName)
          offDuty.slice(0, visibleCount).forEach((session, index) => {
            const head = drawHead(avatarOf(session.id), 'ended')
            head.position.set(PAD_X + index * OFF_DUTY_HEAD_STEP, 70)
            if (session.id === selectedId) head.addChildAt(new Graphics().rect(-2, -2, 22, 19).fill(0xa2bfaa), 0)
            head.eventMode = 'static'
            head.cursor = 'pointer'
            head.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              tooltipName.text = session.name ?? session.title ?? session.id.slice(0, 8)
              tooltipName.position.set(4, 2)
              tooltipBackground.clear().rect(0, 0, tooltipName.width + 8, tooltipName.height + 4).fill(0x101a2e)
              tooltip.position.set(Math.max(4, Math.min(head.x, map.w - tooltipName.width - 12)), head.y - tooltipName.height - 9)
              tooltip.visible = true
            })
            head.on('pointerout', () => { tooltip.visible = false })
            head.on('pointerdown', () => { tooltip.visible = false })
            head.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(session.id)
            })
            street.addChild(head)
            offDutyHeads.set(session.id, { x: (head.x - PAD_X) / TILE, y: (street.y + head.y - PAD_Y) / TILE, w: 1.25, h: 1 })
          })
          if (visibleCount < offDuty.length) {
            overflow.position.set(PAD_X + visibleCount * OFF_DUTY_HEAD_STEP, 73)
            street.addChild(overflow)
          }
          street.addChild(tooltip)
          // 아래쪽 책상이 위쪽을 가리도록 y 순 정렬. 말풍선은 모든 책상 위 층
          const ordered = [...layout.seated].sort((a, b) => layout.seats.get(a.id)!.y - layout.seats.get(b.id)!.y)
          const bubbleLayer = new Container()
          for (const session of ordered) {
            const parts = drawDesk(session, layout.seats.get(session.id)!, session.id === selectedId)
            parts.container.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(session.id)
            })
            parts.container.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              hoveredDeskId = session.id
              updateBubbles()
            })
            parts.container.on('pointerout', () => {
              if (hoveredDeskId !== session.id) return
              hoveredDeskId = null
              updateBubbles()
            })
            world.addChild(parts.container)
            if (parts.bubble) bubbleLayer.addChild(parts.bubble.container)
            desks.set(session.id, parts)
            if (parts.figure && session.status === 'working') working.add(session.id)
            if (session.status === 'needs-approval' && attendanceOf(session) === 'present') {
              approvalDesks.push({ session, rect: { ...layout.seats.get(session.id)!, w: DESK_TILES_W, h: DESK_TILES_H } })
            }
          }
          world.addChild(bubbleLayer)
          updateBubbles()
        }
        redrawRef.current = redraw

        /** 마우스를 올린 책상과 선택한 세션의 말풍선만 전체 글로 펼치고 맨 위로 (마우스를 올린 것이 가장 위) */
        const updateBubbles = () => {
          const { selectedId } = latest.current
          for (const [id, parts] of desks) {
            if (!parts.bubble) continue
            const isExpanded = id === selectedId || id === hoveredDeskId
            parts.bubble.compact.visible = !isExpanded
            parts.bubble.expanded.visible = isExpanded
          }
          for (const id of [selectedId, hoveredDeskId]) {
            const bubble = id ? desks.get(id)?.bubble : undefined
            const layer = bubble?.container.parent
            if (bubble && layer) layer.setChildIndex(bubble.container, layer.children.length - 1)
          }
        }
        // 시간대가 바뀌면 창밖·Off Duty 띠를 다시 그린다 (매 프레임이 아니라 1분마다 확인)
        const phaseTimer = setInterval(() => {
          if (dayPhaseOf(new Date()) !== drawnPhase) redraw()
        }, 60_000)
        stopPhaseTimer = () => clearInterval(phaseTimer)

        // 승인 대기 책상이 화면 밖이면 그쪽 가장자리에 빨간 화살표. 화면 좌표라 world 가 아니라 stage 에 둔다 (redraw 가 지우지 않는다)
        const overlay = new Container()
        app.stage.addChild(overlay)
        const arrows = new Map<
          ApprovalDirection,
          { container: Container; badge: Container; badgeText: Text; badgeBackground: Graphics; targets: { session: Session; rect: Rect }[] }
        >()
        let hoveredDirection: ApprovalDirection | null = null
        const arrowTooltip = new Container()
        arrowTooltip.eventMode = 'none'
        arrowTooltip.visible = false
        const arrowTooltipBackground = new Graphics()
        const arrowTooltipText = label('', 11)
        arrowTooltipText.position.set(6, 4)
        arrowTooltip.addChild(arrowTooltipBackground, arrowTooltipText)
        /** 방향 → 화면 쪽 단위 벡터 */
        const unitOf = (direction: ApprovalDirection): Point => ({
          x: direction.endsWith('left') ? -1 : direction.endsWith('right') ? 1 : 0,
          y: direction.startsWith('up') ? -1 : direction.startsWith('down') ? 1 : 0,
        })
        const showArrowTooltip = (direction: ApprovalDirection) => {
          const arrow = arrows.get(direction)
          if (!arrow || pan?.isMoved || signDrag) {
            arrowTooltip.visible = false
            return
          }
          const names = arrow.targets.map(({ session }) => session.name ?? session.title ?? session.id.slice(0, 8))
          const shown = names.length > 6 ? [...names.slice(0, 5), `외 ${names.length - 5}명`] : names
          arrowTooltipText.text = `승인 대기\n${shown.join('\n')}`
          const w = arrowTooltipText.width + 12
          const h = arrowTooltipText.height + 8
          arrowTooltipBackground.clear().rect(0, 0, w, h).fill(COLOR.alert).rect(0, 0, w, h).stroke({ width: 1, color: COLOR.alertLine })
          // 화살표에서 화면 안쪽으로
          const unit = unitOf(direction)
          const { x, y } = arrow.container
          const left = unit.x > 0 ? x - w - 4 : unit.x < 0 ? x + ARROW_SIZE + 4 : x + ARROW_SIZE / 2 - w / 2
          const top = unit.y > 0 ? y - h - 4 : unit.y < 0 ? y + ARROW_SIZE + 4 : y + ARROW_SIZE / 2 - h / 2
          arrowTooltip.position.set(
            Math.round(Math.max(4, Math.min(app.screen.width - w - 4, left))),
            Math.round(Math.max(4, Math.min(app.screen.height - h - 4, top))),
          )
          arrowTooltip.visible = true
        }
        const createArrow = (direction: ApprovalDirection) => {
          const container = new Container()
          container.addChild(drawApprovalArrow(direction))
          const badge = new Container()
          const badgeBackground = new Graphics()
          const badgeText = label('', 10, COLOR.frame)
          badgeText.position.set(3, 0)
          badge.addChild(badgeBackground, badgeText)
          container.addChild(badge)
          container.eventMode = 'static'
          container.cursor = 'pointer'
          container.hitArea = new Rectangle(0, 0, ARROW_SIZE, ARROW_SIZE)
          // 맵 이동이 시작되지 않게 (휠·숫자 키는 host·window 에서 받아 그대로 된다)
          container.on('pointerdown', (event: FederatedPointerEvent) => {
            event.stopPropagation()
            isDragged = false
          })
          container.on('pointertap', () => {
            const nearest = arrows.get(direction)?.targets[0]
            if (nearest) moveToRect(nearest.rect, true)
          })
          container.on('pointerover', () => {
            hoveredDirection = direction
            showArrowTooltip(direction)
          })
          container.on('pointerout', () => {
            if (hoveredDirection === direction) hoveredDirection = null
            arrowTooltip.visible = false
          })
          overlay.addChild(container)
          const arrow = { container, badge, badgeText, badgeBackground, targets: [] }
          arrows.set(direction, arrow)
          return arrow
        }
        /** 책상 그림(2×3 타일) 전체가 화면 안에 보이지 않으면 화면 밖. 같은 쪽은 하나로 합치고 화면 가운데에서 가까운 순 */
        const updateApprovalArrows = () => {
          const width = app.screen.width
          const height = app.screen.height
          const center = { x: width / 2, y: height / 2 }
          const groups = new Map<ApprovalDirection, { session: Session; rect: Rect; screen: Point; distance: number }[]>()
          for (const target of approvalDesks) {
            const left = world.x + (PAD_X + target.rect.x * TILE) * zoom
            const top = world.y + (PAD_Y + target.rect.y * TILE) * zoom
            const right = left + target.rect.w * TILE * zoom
            const bottom = top + target.rect.h * TILE * zoom
            const horizontal = left < 0 ? 'left' : right > width ? 'right' : ''
            const vertical = top < 0 ? 'up' : bottom > height ? 'down' : ''
            if (!horizontal && !vertical) continue
            const direction = (vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal) as ApprovalDirection
            const screen = { x: (left + right) / 2, y: (top + bottom) / 2 }
            const list = groups.get(direction) ?? []
            list.push({ ...target, screen, distance: Math.hypot(screen.x - center.x, screen.y - center.y) })
            groups.set(direction, list)
          }
          for (const [direction, arrow] of arrows) {
            if (groups.has(direction)) continue
            arrow.container.destroy({ children: true })
            arrows.delete(direction)
            if (hoveredDirection === direction) {
              hoveredDirection = null
              arrowTooltip.visible = false
            }
          }
          // 가장자리 화살표는 모서리 화살표 자리를 비워 둔다
          const edgeMin = ARROW_MARGIN + ARROW_SIZE + 4
          const clampEdge = (value: number, size: number) => Math.round(Math.max(edgeMin, Math.min(size - edgeMin - ARROW_SIZE, value - ARROW_SIZE / 2)))
          for (const [direction, list] of groups) {
            list.sort((a, b) => a.distance - b.distance)
            const arrow = arrows.get(direction) ?? createArrow(direction)
            const isCountChanged = arrow.targets.length !== list.length
            arrow.targets = list
            const unit = unitOf(direction)
            const nearest = list[0].screen
            arrow.container.position.set(
              unit.x < 0 ? ARROW_MARGIN : unit.x > 0 ? width - ARROW_MARGIN - ARROW_SIZE : clampEdge(nearest.x, width),
              unit.y < 0 ? ARROW_MARGIN : unit.y > 0 ? height - ARROW_MARGIN - ARROW_SIZE : clampEdge(nearest.y, height),
            )
            if (isCountChanged) {
              arrow.badge.visible = list.length > 1
              arrow.badgeText.text = String(list.length)
              const w = arrow.badgeText.width + 6
              const h = arrow.badgeText.height
              arrow.badgeBackground.clear().rect(0, 0, w, h).fill(COLOR.alertLine).rect(0, 0, w, h).stroke({ width: 1, color: COLOR.frame })
              // 개수는 화살표 안쪽 (화면 밖으로 나가지 않게)
              arrow.badge.position.set(
                Math.round(ARROW_SIZE / 2 - w / 2 - unit.x * (ARROW_SIZE / 2 + w / 2 - 2)),
                Math.round(ARROW_SIZE / 2 - h / 2 - unit.y * (ARROW_SIZE / 2 + h / 2 - 2)),
              )
            }
          }
          overlay.addChild(arrowTooltip)
          if (hoveredDirection) showArrowTooltip(hoveredDirection)
        }
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
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
              y: Math.min(signDrag.maxDeltaY, Math.max(signDrag.minDelta.y, Math.round((point.y - signDrag.start.y) / TILE))),
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
          if (!pan.isMoved) {
            focusMove = null
            pan.worldStart = { x: world.x - moved.x, y: world.y - moved.y }
          }
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
          if (focusMove) {
            focusMove.elapsed += ticker.deltaMS
            const progress = Math.min(1, focusMove.elapsed / FOCUS_DURATION_MS)
            const eased = 1 - (1 - progress) ** 3
            const next = clampWorld(
              focusMove.from.x + (focusMove.to.x - focusMove.from.x) * eased,
              focusMove.from.y + (focusMove.to.y - focusMove.from.y) * eased,
            )
            world.position.set(next.x, next.y)
            if (progress >= 1) focusMove = null
          }
          // 확대·이동·데이터 갱신을 따라가게 매 프레임 (승인 대기 책상은 몇 개뿐이라 가볍다)
          updateApprovalArrows()
          elapsed += ticker.deltaMS
          if (elapsed < 350) return
          elapsed = 0
          frame = (frame + 1) % 2
          for (const arrow of arrows.values()) arrow.container.alpha = frame && !reducedMotion.matches ? 0.55 : 1
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
        if (latest.current.focus && latest.current.focus.id !== handledFocusIdRef.current) {
          applyFocus(latest.current.focus)
        }
      })

    return () => {
      isDisposed = true
      removeListeners()
      disconnectResize()
      stopPhaseTimer()
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

  useEffect(() => {
    if (!focus || focus.id === handledFocusIdRef.current) return
    focusRef.current(focus)
  }, [focus])

  return <div ref={hostRef} className="office" />
}
