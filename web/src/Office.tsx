import { useEffect, useRef, useState } from 'react'
import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TilingSprite,
  type FederatedPointerEvent,
  Texture,
  type Spritesheet,
} from 'pixi.js'
import { attendanceOf, type Office as OfficeData, type Group, type Session, type Team } from './types'
import { dotLookOf, type DotCharacter } from './dotCharacter'
import { dotStateOf, dozingKey, type DotState } from './dotState'
import { HEAD_RECT, loadRecolorArt, paintCharacter, type RecolorArt } from './characterArt'
import { DEFAULT_DECOR, planDecor, themeOf, WALL_BAY_TILES, type DecorTheme, type FloorDecor, type PropSizes, type WallDecor } from './officeDecor'
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
 * 사무실 그림은 생성 도트 스프라이트(타일 48px, docs/plans/2026-10-22-office-sprites-design.md).
 * world 좌표는 "아트 픽셀"(타일 16px) 단위이고 world 를 DOT_SCALE 배 더 키워(타일 48 화면 px = 1배) 보인다.
 * 스프라이트·이름표·말풍선은 1/DOT_SCALE 로 줄인 하위 컨테이너에 도트 px(48px 타일) 좌표로 그린다 — 배치(officeLayout.ts)·끌기·포커스 계산은 아트 px 그대로다
 */
/** 배율 단계 (타일 48px 기준. 0.5배는 전체 보기용 예외) */
const ZOOM_STEPS = [0.5, 1, 2, 3]
/** 마운트할 때 배율 = 단계 목록의 이 번째 (1배) */
const DEFAULT_ZOOM_INDEX = 1
/** 도트 타일(48px) ÷ 아트 타일(16px) */
const DOT_SCALE = 3
const DOT_TILE = 48
/** 인물·책상·의자 */
const DOT_SHEET_URL = '/office/office-v3.json'
/** 환경 (바닥·벽·창밖·그룹·섬·Focus Zone·거리·소품) */
const DOT_ENV_URL = '/office/office-v2.json'
/** 꾸미기 소품 (바닥·벽 장식, officeDecor.ts 의 테마 풀) */
const DOT_DECOR_URL = '/office/office-v4.json'
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
  frame: 0xffffff,
  partition: 0xffffff,
  partitionShadow: 0xc9cbd6,
  green: 0x6fae5e,
  greenDark: 0x4f9a4a,
  deskLeg: 0xb9bbc6,
  chairLine: 0xcfd1db,
  screenOn: 0x4aa3e8,
  text: 0x2b2f3a,
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
  carpetBorder: 0xc8b598,
  carpetShadow: 0xb7a284,
  boothWallTop: 0xc69c68,
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

/** world 아트 픽셀 단위 글자(Off Duty +N·이름 툴팁, 승인 화살표 배지)의 해상도 = world 가 가장 크게 커질 때의 배율 9 (3배 × DOT_SCALE). 그래야 흐리지 않다 */
const TEXT_RESOLUTION = ZOOM_STEPS[ZOOM_STEPS.length - 1] * DOT_SCALE

function label(text: string, size: number, color = COLOR.text, wrapWidth?: number, resolution = TEXT_RESOLUTION): Text {
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
    resolution,
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

/** Off Duty 띠: 이름표 글자색, 밤에는 하늘에 별 */
const STREET_VIEW: Record<DayPhase, { label: number; hasStars: boolean }> = {
  morning: { label: 0x3a3550, hasStars: false },
  day: { label: 0x2b3a55, hasStars: false },
  dusk: { label: 0xfff1d6, hasStars: false },
  night: { label: 0xf5dfad, hasStars: true },
}

// ---------- 그룹 ----------

interface GroupParts {
  container: Container
  /** 끌면 그룹 이동 (안의 섬과 같이) */
  sign: Graphics
}

interface IslandParts {
  container: Container
  /** 끌면 섬(팀) 이동 */
  sign: Graphics
}

// ---------- 책상 단위 ----------

interface DeskParts {
  container: Container
  /** 캐릭터. 휴식 세션은 null. ticker 가 직접 update 한다 (Ticker.shared 에 안 붙인다) */
  animation: AnimatedSprite | null
  /** 말풍선이 없으면 null. 책상 컨테이너가 아니라 말풍선 층에 넣는다 */
  bubble: DeskBubble | null
}

const DESK_W = DESK_TILES_W * TILE
const DESK_H = DESK_TILES_H * TILE

// ---------- 도트 ----------

/** 반복 타일 메타 (build.py). top·bottom = 맨 위·아래 줄 최빈색, glass = 투명한 행 구간(벽의 창 유리) */
interface DotTileMeta {
  image: string
  w: number
  h: number
  top: string
  bottom: string
  glass?: { y: number; h: number }
}

/** 아틀라스 JSON 의 meta.jkCorp (tools/sprites/build.py 가 쓴다) */
interface DotSheetMeta {
  /** 인물 프리셋과 풀. v0 처럼 없으면 인물 id lead·member 를 그대로 쓴다 */
  characters?: DotCharacter[]
  animations: Record<string, { fps: number; loop: boolean }>
  tiles: Record<string, DotTileMeta>
  props: Record<string, { screen?: Rect }>
}

interface DotArt {
  /** 인물·책상·의자 (office-v3) */
  sheet: Spritesheet
  meta: DotSheetMeta
  /** 환경 소품 (office-v2) */
  env: Spritesheet
  /** 꾸미기 소품 (office-v4). 못 읽으면 null 이고 꾸미기 소품 없이 그린다 (v2 소품은 그대로 쓴다) */
  decor: Spritesheet | null
  /** 꾸미기에 쓰는 소품(v4·v2)이 차지하는 타일 크기 */
  decorSizes: PropSizes
  /** office-v2 반복 타일 (벽·창밖 4시간대·바닥·그룹 바닥·섬 러그·Focus Zone 카펫·거리) */
  tiles: Record<string, { texture: Texture; meta: DotTileMeta }>
  /** 인물 머리·윗옷 색 바꾸기 (못 읽으면 null 이고 고른 색 없이 그린다) */
  recolor: RecolorArt | null
  /** 색을 바꾼 인물 프레임: `인물|머리|윗옷` → 프레임 이름 → 텍스처. 처음 그릴 때 만들고 계속 쓴다 */
  recolored: Map<string, Record<string, Texture>>
  /** Off Duty 머리: `인물|머리|윗옷` → 텍스처 */
  heads: Map<string, Texture>
}

/** 아틀라스들과 반복 타일을 읽고 확대를 nearest 로 (전역 기본값을 바꾸면 글자까지 바뀌어 텍스처마다) */
async function loadDotArt(): Promise<DotArt> {
  const [sheet, env, recolor, decor] = await Promise.all([
    Assets.load<Spritesheet>(DOT_SHEET_URL),
    Assets.load<Spritesheet>(DOT_ENV_URL),
    loadRecolorArt().catch((error: unknown) => {
      console.error('도트 인물 색 바꾸기를 읽지 못해 기본색으로 그린다', error)
      return null
    }),
    Assets.load<Spritesheet>(DOT_DECOR_URL).catch((error: unknown) => {
      console.error('꾸미기 소품을 읽지 못해 소품 없이 그린다', error)
      return null
    }),
  ])
  const meta = (sheet.data.meta as unknown as { jkCorp: DotSheetMeta }).jkCorp
  const envMeta = (env.data.meta as unknown as { jkCorp: DotSheetMeta }).jkCorp
  const base = DOT_ENV_URL.slice(0, DOT_ENV_URL.lastIndexOf('/') + 1)
  const entries = await Promise.all(
    Object.entries(envMeta.tiles).map(async ([id, tile]) => [id, { texture: await Assets.load<Texture>(base + tile.image), meta: tile }] as const),
  )
  const tiles = Object.fromEntries(entries)
  for (const source of [sheet.textureSource, env.textureSource, ...(decor ? [decor.textureSource] : []), ...entries.map(([, tile]) => tile.texture.source)]) {
    source.scaleMode = 'nearest'
  }
  // 소품 그림 크기 → 차지하는 타일 (꾸미기 배치는 타일 단위)
  const decorSizes: PropSizes = {}
  for (const textures of [env.textures, ...(decor ? [decor.textures] : [])]) {
    for (const [name, texture] of Object.entries(textures)) {
      if (name.startsWith('prop/')) decorSizes[name.slice(5)] = { w: Math.ceil(texture.width / DOT_TILE), h: Math.ceil(texture.height / DOT_TILE) }
    }
  }
  return { sheet, meta, env, decor, decorSizes, tiles, recolor, recolored: new Map(), heads: new Map() }
}

/** 그 인물의 프레임 텍스처들. 고른 색이 있으면 색을 바꾼 것 (조합마다 한 번 만든다) */
function characterTextures(art: DotArt, character: string, hair: string | null, top: string | null): Record<string, Texture> {
  if ((!hair && !top) || !art.recolor) return art.sheet.textures
  const key = `${character}|${hair}|${top}`
  const cached = art.recolored.get(key)
  if (cached) return cached
  const prefix = `char/${character}/`
  const names = Object.keys(art.sheet.textures).filter((name) => name.startsWith(prefix))
  const originals = names.map((name) => art.sheet.textures[name])
  const canvas = paintCharacter(art.recolor, character, originals.map(({ frame }) => ({ x: frame.x, y: frame.y, w: frame.width, h: frame.height })), hair, top)
  if (!canvas) {
    art.recolored.set(key, art.sheet.textures)
    return art.sheet.textures
  }
  const source = Texture.from(canvas).source
  source.scaleMode = 'nearest'
  const textures: Record<string, Texture> = { ...art.sheet.textures }
  let x = 0
  names.forEach((name, index) => {
    const original = originals[index]
    textures[name] = new Texture({ source, frame: new Rectangle(x, 0, original.frame.width, original.frame.height), defaultAnchor: original.defaultAnchor })
    x += original.frame.width
  })
  art.recolored.set(key, textures)
  return textures
}

/** Off Duty 머리 (도트): 그 인물·색 idle 첫 칸의 머리 부분 (목록 아바타와 같은 자리). 인물이 없으면 null */
function dotHead(art: DotArt, session: Session): Sprite | null {
  const look = dotLookOf(session, art.meta.characters ?? [])
  if (!look) return null
  const key = `${look.id}|${look.hair}|${look.top}`
  let texture = art.heads.get(key)
  if (!texture) {
    const base = characterTextures(art, look.id, look.hair, look.top)[`char/${look.id}/idle/0`]
    if (!base) return null
    texture = new Texture({ source: base.source, frame: new Rectangle(base.frame.x + HEAD_RECT.x, base.frame.y + HEAD_RECT.y, HEAD_RECT.w, HEAD_RECT.h) })
    art.heads.set(key, texture)
  }
  const sprite = new Sprite(texture)
  sprite.scale.set(1 / DOT_SCALE)
  return sprite
}

/** 도트 px 로 그리는 하위 컨테이너 (1/DOT_SCALE) */
function dotLayer(): Container {
  const container = new Container()
  container.scale.set(1 / DOT_SCALE)
  return container
}

function dotTiling(art: DotArt, id: string, width: number, height: number): TilingSprite {
  return new TilingSprite({ texture: art.tiles[id].texture, width, height })
}

/** 소품 스프라이트 (꾸미기 소품 office-v4 → 환경 소품 office-v2 순으로 찾는다). 앵커는 아래 가운데 (build.py) */
function dotProp(art: DotArt, id: string, x: number, bottom: number): Sprite {
  const sprite = new Sprite(art.decor?.textures[`prop/${id}`] ?? art.env.textures[`prop/${id}`])
  sprite.position.set(x, bottom)
  return sprite
}

/** 꾸미기 바닥 소품 (도트 px, origin = 그 컨테이너 왼쪽 위의 배치 타일 좌표). 차지하는 칸 아래 가운데에서 4 위 (칸 경계에 붙지 않게) */
function dotDecorProps(art: DotArt, items: FloorDecor[], origin: Point): Sprite[] {
  return items.map((item) => dotProp(art, item.prop, (item.x - origin.x + item.w / 2) * DOT_TILE, (item.y - origin.y + item.h) * DOT_TILE - 4))
}

/** 테마 색을 곱한다 (null 이면 그대로) */
function tinted<T extends TilingSprite>(sprite: T, color: number | null): T {
  if (color !== null) sprite.tint = color
  return sprite
}

/** 벽 장식을 거는 창 칸: 유리 자리(벽 타일 x 8..136, 행은 build.py 메타의 glass)를 벽색으로 메운다 */
const WALL_GLASS_X = 8
const WALL_GLASS_W = 129
const WALL_PANEL = 0xefeae0
const WALL_PANEL_SHADE = 0xd9d3c6

/** '#rrggbb' → 0xrrggbb */
function hexColor(value: string): number {
  return parseInt(value.slice(1), 16)
}

/** 도트 그림의 외곽선색 (생성 에셋의 1px 진한 외곽선과 같은 쪽) */
const DOT_OUTLINE = 0x2b2a33

/**
 * 도트 바닥·벽·창밖. 벽 타일(144×120 = 벽 높이 WALL_H × DOT_SCALE)은 창 유리가 투명이라 그 뒤에 그 시간대 창밖을 깐다.
 * 창밖 타일 폭(432)은 창틀 기둥 간격(144)의 배수라 반복 경계가 늘 기둥 뒤에 숨는다. 창밖은 아래(지평선)를 유리 아래 끝에 맞춘다
 */
function drawDotBackground(widthPx: number, heightPx: number, art: DotArt, phase: DayPhase, theme: DecorTheme, wallDecor: WallDecor[]): Container {
  const container = dotLayer()
  const width = widthPx * DOT_SCALE
  const wallBottom = WALL_H * DOT_SCALE
  const floor = tinted(dotTiling(art, 'floor', width, heightPx * DOT_SCALE - wallBottom), theme.tint.floor)
  floor.y = wallBottom
  const wall = art.tiles.wall
  const glass = wall.meta.glass ?? { y: 0, h: wall.meta.h }
  const view = art.tiles[`view-${phase}`]
  const viewSprite = dotTiling(art, `view-${phase}`, width, view.meta.h)
  viewSprite.y = glass.y + glass.h - view.meta.h
  const wallSprite = dotTiling(art, 'wall', width, wall.meta.h)
  wallSprite.y = wallBottom - wall.meta.h
  container.addChild(viewSprite, wallSprite, floor)
  // 벽 장식: 그 창 칸 유리를 벽으로 메우고 유리 자리 가운데에 건다
  const bayWidth = WALL_BAY_TILES * DOT_TILE
  for (const item of wallDecor) {
    const x0 = item.bay * bayWidth
    const top = wallSprite.y + glass.y
    container.addChild(
      new Graphics().rect(x0 + WALL_GLASS_X, top, WALL_GLASS_W, glass.h).fill(WALL_PANEL).rect(x0 + WALL_GLASS_X, top, WALL_GLASS_W, 3).fill(WALL_PANEL_SHADE),
    )
    const sprite = dotProp(art, item.prop, x0 + bayWidth / 2, 0)
    sprite.y = Math.round(top + glass.h / 2 + sprite.height / 2)
    container.addChild(sprite)
  }
  return container
}

/** 도트 이름표 (도트 px). 흰 바탕 + 외곽선 + 아래 색 줄 */
function dotSign(text: Text, underline: number, padding = 8): Graphics {
  const width = Math.ceil(text.width) + padding * 2
  const height = Math.ceil(text.height) + 4
  return new Graphics()
    .rect(0, 0, width, height)
    .fill(0xffffff)
    .rect(0, height - 3, width, 3)
    .fill(underline)
    .rect(0, 0, width, height)
    .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 })
}

/** 그룹 이름표·팀 이름표·파트 이름표·메모 글자 (도트 px). 책상 이름표(14)를 기준으로 계층 순 */
const DOT_FONT = { group: 16, team: 14, part: 12, note: 12 }

function dotLabel(text: string, size: number, color = COLOR.text, wrapWidth?: number): Text {
  return label(text, size, color, wrapWidth, dotTextResolution)
}

/** 도트 그룹: 그룹 카펫 + 낮은 흰 파티션(위·왼쪽·오른쪽) + 초록 걸레받이(아래) + 이름표·화분·메모. 크기는 저장된 w·h 가 아니라 그려지는 영역(안의 섬들을 다 담는다) */
function drawDotGroup(area: GroupArea, onEdit: () => void, art: DotArt, theme: DecorTheme, decor: FloorDecor[]): GroupParts {
  const { group } = area
  const container = new Container()
  container.position.set(PAD_X + area.x * TILE, PAD_Y + area.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const w = area.w * TILE * DOT_SCALE
  const h = area.h * TILE * DOT_SCALE
  // 카펫 무늬가 책상보다 눈에 띄지 않게 옅게 덮는다
  dot.addChild(tinted(dotTiling(art, 'group-floor', w, h), theme.tint.groupFloor), new Graphics().rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0.45 }))
  const wall = 9
  dot.addChild(
    new Graphics()
      // 파티션 윗면(밝게)과 앞면 그늘
      .rect(0, 0, w, wall)
      .fill(COLOR.partition)
      .rect(0, wall, w, 3)
      .fill(COLOR.partitionShadow)
      .rect(0, 0, wall, h)
      .fill(COLOR.partition)
      .rect(wall, wall, 3, h - wall)
      .fill(COLOR.partitionShadow)
      .rect(w - wall, 0, wall, h)
      .fill(COLOR.partition)
      .rect(0, h - 9, w, 9)
      .fill(COLOR.green)
      .rect(0, h - 9, w, 2)
      .fill(COLOR.greenDark)
      .rect(0, 0, w, h)
      .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 }),
  )
  dot.addChild(dotProp(art, 'plant-large', w - 36, 66))
  dot.addChild(dotProp(art, 'plant-small', 30, h - 12))
  // 꾸미기 소품 (그룹 안쪽 빈 자리. 그룹을 끌 때 같이 움직인다)
  if (decor.length) dot.addChild(...dotDecorProps(art, decor, area))

  const name = dotLabel(group.name, DOT_FONT.group)
  const sign = dotSign(name, COLOR.green)
  sign.position.set(18, 15)
  name.position.set(26, 17)
  dot.addChild(sign, name)
  sign.eventMode = 'static'
  sign.cursor = 'move'
  // 부모가 interactive 면 Pixi 가 글자도 맞혀 이름표가 아니라 바닥을 누른 것이 되고, 끌기가 맵 이동이 된다
  name.eventMode = 'none'

  if (group.waitingNote) {
    const text = dotLabel(group.waitingNote, DOT_FONT.note, COLOR.text, 200)
    const noteW = Math.ceil(text.width) + 16
    const noteH = Math.ceil(text.height) + 12
    const x = w - 72 - noteW
    const note = new Graphics()
      .rect(0, 0, noteW, noteH)
      .fill(COLOR.postit)
      .rect(0, 0, noteW, 4)
      .fill(0xe8cf4e)
      .rect(0, 0, noteW, noteH)
      .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 })
    note.position.set(x, 15)
    text.position.set(x + 8, 22)
    dot.addChild(note, text)
  }

  container.eventMode = 'static'
  container.cursor = 'grab'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return { container, sign }
}

/** 도트 팀 섬: 연한 러그 + 테두리, 파트 구역(옅은 바탕 + 은색 테두리 + 이름표). 파트 구역은 섬 컨테이너에 있어 섬을 끌면 같이 움직인다 */
function drawDotIsland(island: Island, onEdit: () => void, art: DotArt, theme: DecorTheme): IslandParts {
  const container = new Container()
  container.position.set(PAD_X + island.x * TILE, PAD_Y + island.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const w = island.w * TILE * DOT_SCALE
  const h = island.h * TILE * DOT_SCALE
  dot.addChild(
    tinted(dotTiling(art, 'island-rug', w, h), theme.tint.rug),
    new Graphics()
      .rect(0, 0, w, h)
      .stroke({ width: 3, color: COLOR.greenDark, alignment: 1 })
      .rect(3, 3, w - 6, h - 6)
      .stroke({ width: 1, color: 0xe7ecd9, alignment: 1 }),
  )
  for (const zone of island.zones) {
    // 책상 경계에서 좌우 12, 위로 이름표 자리 36, 아래 3
    const zx = ((zone.x - island.x) * TILE - 4) * DOT_SCALE
    const zy = ((zone.y - island.y) * TILE - 12) * DOT_SCALE
    const zw = (zone.w * TILE + 8) * DOT_SCALE
    const zh = (zone.h * TILE + 13) * DOT_SCALE
    const partName = dotLabel(zone.part.name, DOT_FONT.part, 0x4d5563)
    const partSign = dotSign(partName, COLOR.silver, 6)
    partSign.position.set(zx + 8, zy + 8)
    partName.position.set(zx + 14, zy + 10)
    dot.addChild(
      new Graphics().rect(zx, zy, zw, zh).fill({ color: 0xffffff, alpha: 0.35 }).stroke({ width: 2, color: COLOR.partLine, alignment: 1 }),
      partSign,
      partName,
    )
  }
  const name = dotLabel(island.team.name, DOT_FONT.team)
  const sign = dotSign(name, COLOR.greenDark, 7)
  sign.position.set(9, 9)
  name.position.set(16, 11)
  sign.eventMode = 'static'
  sign.cursor = 'move'
  // drawDotGroup 과 같은 이유
  name.eventMode = 'none'
  dot.addChild(sign, name)
  container.eventMode = 'static'
  container.cursor = 'grab'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return { container, sign }
}

/**
 * 도트 Focus Zone: 카펫 + 테두리, 자리마다 1인 부스(뒤·양옆 패널, 오른쪽 안 선반) + 선반 위 스탠드 조명·머그 또는 헤드폰,
 * 빈 자리에는 책상까지 (앉은 세션은 책상 컨테이너가 같은 자리에 책상을 다시 그린다), 오른쪽 가장자리 책장·화분.
 * 자리는 officeLayout.ts 의 로비 자리 (맨 위 LOBBY_SIGN_H 줄은 이름표, 2열·SEAT_STEP 간격). occupied = 앉은 자리의 구역 안 타일 좌표 "x,y"
 */
function drawDotZone(zone: Rect, art: DotArt, occupied: Set<string>, theme: DecorTheme): Container {
  const container = new Container()
  container.position.set(PAD_X + zone.x * TILE, PAD_Y + zone.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const step = TILE * DOT_SCALE
  const width = zone.w * step
  const height = zone.h * step
  dot.addChild(
    tinted(dotTiling(art, 'focus-carpet', width, height), theme.tint.focusCarpet),
    new Graphics()
      .rect(0, 0, width, height)
      .stroke({ width: 4, color: COLOR.carpetBorder, alignment: 1 })
      .rect(0, height - 4, width, 4)
      .fill(COLOR.carpetShadow)
      .rect(0, 0, width, height)
      .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 }),
  )

  const boothRows = Math.max(1, Math.floor((zone.h - LOBBY_SIGN_H - 2) / SEAT_STEP))
  const deskW = DESK_TILES_W * DOT_TILE
  for (let row = 0; row < boothRows; row++) {
    for (let column = 0; column < 2; column++) {
      const seatX = (1 + column * SEAT_STEP) * step
      const seatY = (LOBBY_SIGN_H + 1 + row * SEAT_STEP) * step
      // 부스(138×107)는 자리 왼쪽 9 밖에서 오른쪽 선반까지, 아래 끝은 책상 앞판 뒤
      dot.addChild(dotProp(art, 'booth', seatX + 60, seatY + 111))
      // 선반 위 (부스 그림의 선반 윗면 ≈ 부스 아래에서 50)
      dot.addChild(dotProp(art, 'desk-lamp', seatX + 112, seatY + 62))
      dot.addChild(dotProp(art, (row * 2 + column) % 2 ? 'headphones' : 'mug', seatX + 102, seatY + 86))
      if (!occupied.has(`${1 + column * SEAT_STEP},${LOBBY_SIGN_H + 1 + row * SEAT_STEP}`)) {
        const desk = new Sprite(art.sheet.textures['prop/desk'])
        desk.position.set(seatX + deskW / 2, seatY + DOT_DESK.deskBottom)
        dot.addChild(desk)
      }
    }
  }

  // 오른쪽 가장자리 (부스 오른쪽 끝 321 ~ 구역 끝 384)
  const signRowH = LOBBY_SIGN_H * step
  dot.addChild(dotProp(art, 'bookshelf-tall', width - 32, signRowH + 132))
  for (let y = signRowH + 300; y + 60 < height; y += 300) dot.addChild(dotProp(art, 'bookshelf-tall', width - 32, y))
  for (let y = signRowH + 210; y + 40 < height; y += 300) dot.addChild(dotProp(art, 'plant-small', width - 32, y))
  const seatsBottom = (LOBBY_SIGN_H + 1 + boothRows * SEAT_STEP) * step
  // 자리 아래가 3타일 넘게 남으면 (그룹이 더 높아 구역이 길 때) 낮은 책장
  if (height - seatsBottom >= 3 * step) dot.addChild(dotProp(art, 'bookshelf-low', 120, height - 24))
  dot.addChild(dotProp(art, 'plant-large', width - 30, height - 12))
  dot.addChild(dotProp(art, 'plant-small', 24, height - 12))

  const name = dotLabel('Focus Zone', DOT_FONT.group)
  const sign = dotSign(name, COLOR.boothWallTop)
  // 이름표 줄(맨 위 1타일) 안. 첫 줄 말풍선(자리 위) 에 닿지 않게 테두리 위에 붙인다
  sign.position.set(18, 6)
  name.position.set(26, 8)
  name.eventMode = 'none'
  dot.addChild(sign, name)
  return container
}

/**
 * 그 인물·상태의 프레임과 fps. 아틀라스에 없는 상태(v0 의 idle·doze)는 typing 0번에 멈춘 한 장이고, doze 대역은 흐리게(isDim) 한다
 */
function dotFrames(art: DotArt, character: string, state: DotState, frames: Record<string, Texture>): { textures: Texture[]; fps: number; isDim: boolean } {
  const key = `char/${character}/${state}`
  const names = art.sheet.data.animations?.[key]
  if (names) return { textures: names.map((name) => frames[name]), fps: art.meta.animations[key]?.fps ?? 6, isDim: false }
  return { textures: [frames[`char/${character}/typing/0`]], fps: 0, isDim: state === 'doze' }
}

/** 자리(96×144, 도트 px) 안 배치. 사람은 키보드 앞(가운데보다 조금 왼쪽), 모니터는 책상 오른쪽 */
const DOT_DESK = {
  personX: 42,
  /** 캐릭터 발 기준선. 셀을 y=-20 에 둔 것 (손이 책상 윗면 위로 보이게. 든 손은 윗줄 이름표에 걸친다) */
  baseline: 104,
  /** 의자 아래 끝 (사람 뒤, 책상에 가려진다) */
  chairBottom: 100,
  /** 책상 아래 끝 = 이름표 위 끝 */
  deskBottom: 124,
  tagH: 20,
  fontSize: 14,
}
/**
 * 도트 하위 컨테이너(1/DOT_SCALE) 글자 해상도 = 지금 배율 (0.5·1·2·3). redraw 가 배율을 바꾼 뒤 정한다.
 * 최대 배율(3)로 고정하면 1배에서 3배 축소돼 12px 한글의 가는 획이 빠진다
 */
let dotTextResolution = 1

/** 도트 책상. 그리는 순서: 의자 → 캐릭터 → 책상 → 모니터 켜짐 → 외부 측판·명패 → 이름표. 선택 테두리는 아트 px, 말풍선은 별도 층 */
function drawDotDesk(session: Session, seat: Point, isSelected: boolean, art: DotArt, now: number): DeskParts {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  const dot = new Container()
  dot.scale.set(1 / DOT_SCALE)
  container.addChild(dot)
  const isOnBreak = attendanceOf(session) === 'break'
  const isWorking = session.status === 'working' && !isOnBreak
  const isExternal = session.kind === 'external'
  const isLead = session.role === 'lead'
  const deskW = DESK_TILES_W * DOT_TILE

  const chair = new Sprite(art.sheet.textures['prop/chair'])
  chair.position.set(DOT_DESK.personX, DOT_DESK.chairBottom)
  dot.addChild(chair)

  let animation: AnimatedSprite | null = null
  if (!isOnBreak) {
    // 사용자가 고른 인물(아틀라스에 있을 때만)과 색 → 세션 ID 해시로 고른 프리셋 (지시자는 리더 풀)
    const look = dotLookOf(session, art.meta.characters ?? [])
    const character = look?.id ?? (isLead ? 'lead' : 'member')
    const frames = look ? characterTextures(art, character, look.hair, look.top) : art.sheet.textures
    const { textures, fps, isDim } = dotFrames(art, character, dotStateOf(session, now), frames)
    animation = new AnimatedSprite({ textures, autoUpdate: false })
    animation.position.set(DOT_DESK.personX, DOT_DESK.baseline)
    // 반투명은 뒤 의자가 비쳐 보여 색만 어둡게
    if (isDim) animation.tint = 0xb4b8c4
    if (textures.length > 1) {
      animation.animationSpeed = fps / 60
      // 모두 같은 박자로 치지 않게 세션마다 시작 프레임을 다르게
      animation.gotoAndPlay(parseInt(session.id.slice(0, 2), 16) % textures.length || 0)
    }
    dot.addChild(animation)
  }

  const desk = new Sprite(art.sheet.textures['prop/desk'])
  desk.position.set(deskW / 2, DOT_DESK.deskBottom)
  dot.addChild(desk)
  const deskLeft = desk.x - desk.width / 2
  const deskTop = desk.y - desk.height
  const screen = art.meta.props['prop/desk']?.screen
  if (isWorking && screen) {
    const sx = deskLeft + screen.x
    const sy = deskTop + screen.y
    dot.addChild(
      new Graphics()
        .rect(sx, sy, screen.w, screen.h)
        .fill(COLOR.screenOn)
        .rect(sx + 3, sy + 3, 9, 6)
        .fill(0xdff0ff)
        .rect(sx + 15, sy + 3, 6, 3)
        .fill(0xdff0ff)
        .rect(sx + 15, sy + 9, 9, 2)
        .fill(0xdff0ff),
    )
  }
  // 외부 세션: 책상 왼쪽 측판을 회색으로
  if (isExternal) dot.addChild(new Graphics().rect(deskLeft + 4, deskTop + 42, 6, 24).fill(COLOR.deskLeg))
  // 팀장·파트장: 책상 앞판에 금색 명패 (둘은 이름표 밑줄로 구분)
  if (isLead) dot.addChild(new Graphics().rect(30, deskTop + 46, 36, 9).fill(COLOR.gold).rect(33, deskTop + 49, 30, 3).fill(0xf4d77a))

  const isPartLead = isLead && session.partId !== null
  const name = label(session.name ?? session.title ?? session.id.slice(0, 8), DOT_DESK.fontSize, isExternal ? 0x7a7f8e : COLOR.text, undefined, dotTextResolution)
  const tagW = Math.min(Math.ceil(name.width) + 12, SEAT_STEP * DOT_TILE - 12)
  const underline = isExternal ? COLOR.chairLine : isPartLead ? COLOR.silver : isLead ? COLOR.gold : COLOR.green
  const tagY = DOT_DESK.deskBottom
  const tag = new Graphics().rect(0, 0, tagW, DOT_DESK.tagH).fill(0xffffff).rect(0, DOT_DESK.tagH - 3, tagW, 3).fill(underline)
  tag.position.set(Math.floor((deskW - tagW) / 2), tagY)
  name.position.set(tag.x + 6, tagY + 1)
  const mask = new Graphics().rect(tag.x, tagY, tagW, DOT_DESK.tagH).fill(0xffffff)
  name.mask = mask
  if (isOnBreak) {
    tag.alpha = 0.5
    name.alpha = 0.5
  }
  dot.addChild(tag, mask, name)

  if (isSelected) {
    container.addChild(new Graphics().rect(-2, 1, DESK_W + 4, DESK_H - 2).stroke({ width: 1, color: COLOR.select }))
  }
  container.eventMode = 'static'
  container.cursor = 'pointer'
  // 든 손·의자처럼 자리 밖으로 나온 부분이 아니라 자리(2×3 타일)만 누르는 곳으로
  container.hitArea = new Rectangle(0, 0, DESK_W, DESK_H)
  return { container, animation, bubble: drawBubble(session, container.x, container.y) }
}

// ---------- 말풍선 ----------

/**
 * 말풍선 크기. 도트 px (책상 이름표 글자 14 보다 조금 작게) 이고 1/DOT_SCALE 층에 그린다.
 * maxW = 접힌 말풍선 최대 폭 (책상 폭 + 조금. 자리 간격 안이라 옆 자리 말풍선과 안 겹친다), expandedW = 펼친 말풍선 줄바꿈 폭.
 * boxBottom = 상자 아래 끝 (책상 기준). 자리 간격이 책상 높이와 같아 위아래 책상 사이에 빈 줄이 없으므로,
 * 상자는 윗줄 책상 이름표(-20..0) 위에 두고 가는 꼬리를 자기 머리(tailEnd)까지 내려 누구 것인지 보인다
 */
/** 꼬리 끝은 도트 머리 위 끝(셀 16 - 20 = 자리 -4)까지 */
const BUBBLE_SIZE = { font: 12, maxW: 132, expandedW: 330, boxBottom: -24, tailEnd: -6, line: 2, padX: 5, padY: 2, x: 6 }
type BubbleSize = typeof BUBBLE_SIZE
const BUBBLE_EXPANDED_MAX_CHARS = 300

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

/** 말풍선 상자(아래 끝 size.boxBottom) + 자기 머리까지 내려오는 꼬리 */
function bubbleBox(text: Text, isAlert: boolean, size: BubbleSize): Container {
  const box = new Container()
  const bw = Math.ceil(text.width) + size.padX * 2
  const bh = Math.ceil(text.height) + size.padY * 2
  const fill = isAlert ? COLOR.alert : COLOR.bubble
  const line = isAlert ? COLOR.alertLine : COLOR.bubbleLine
  const g = new Graphics()
  g.rect(0, 0, bw, bh).fill(fill)
  g.rect(0, 0, bw, bh).stroke({ width: size.line, color: line })
  // 윗줄 이름표를 지나므로 이름 글자를 덜 가리게 왼쪽 끝 (이름표는 가운데 정렬이라 여기는 대개 "[" 자리)
  g.rect(size.line, bh, size.line, size.tailEnd - size.boxBottom).fill(line)
  text.position.set(size.padX, size.padY)
  box.addChild(g, text)
  box.position.set(size.x, size.boxBottom - bh)
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
  const size = BUBBLE_SIZE
  const resolution = dotTextResolution
  const textColor = isAlert ? COLOR.alertText : COLOR.text
  const compactLabel = label('', size.font, textColor, undefined, resolution)
  fitOneLine(compactLabel, compactText, size.maxW - size.padX * 2)
  const expandedLabel = new Text({
    text: fullText,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: size.font,
      fill: textColor,
      wordWrap: true,
      wordWrapWidth: size.expandedW,
      breakWords: true,
    },
    resolution,
  })
  const compact = bubbleBox(compactLabel, isAlert, size)
  const expanded = bubbleBox(expandedLabel, isAlert, size)
  expanded.visible = false
  const container = new Container()
  container.position.set(x, y)
  const layer = dotLayer()
  layer.addChild(compact, expanded)
  container.addChild(layer)
  // 보이기만 한다. 아래에 깔린 윗줄 책상·팀/파트 이름표(끌기)를 누르는 것을 가로채지 않게
  container.eventMode = 'none'
  return { container, compact, expanded }
}

// ---------- 건물 밖 ----------

const OFF_DUTY_HEIGHT = 6 * TILE
const OFF_DUTY_HEAD_STEP = 24

/**
 * 도트 Off Duty 거리 (도트 px, 띠 높이 OFF_DUTY_HEIGHT 의 3배): 하늘(창밖 그림 맨 위 색) + 먼 도시(그 시간대 창밖 그림) + 집·가로등(시간대별 스프라이트) + 보도.
 * 집·가로등은 96 아트 px(288) 마다. 퇴근 머리·이름은 부르는 쪽이 아트 px 로 얹는다
 */
function drawDotOffDuty(width: number, phase: DayPhase, art: DotArt): Container {
  const container = new Container()
  const dot = dotLayer()
  container.addChild(dot)
  const w = width * DOT_SCALE
  const groundY = 64 * DOT_SCALE
  const view = art.tiles[`view-${phase}`]
  const skyline = dotTiling(art, `view-${phase}`, w, view.meta.h)
  skyline.y = groundY - view.meta.h
  const sky = new Graphics().rect(0, 0, w, skyline.y).fill(hexColor(view.meta.top))
  // 창밖 그림의 별은 그림 안에만 있어 그 위 단색 하늘에도 띄엄띄엄
  if (STREET_VIEW[phase].hasStars) for (let x = 60; x < w - 6; x += 111) sky.rect(x, 30 + (x % 3) * 18, 3, 3).fill(0xbfcde2)
  dot.addChild(sky, skyline)
  const street = dotTiling(art, 'street', w, OFF_DUTY_HEIGHT * DOT_SCALE - groundY)
  street.y = groundY
  dot.addChild(street)
  for (let x = 36; x + 240 < w; x += 288) {
    dot.addChild(dotProp(art, `house-${phase}`, x + 66, groundY + 4))
    dot.addChild(dotProp(art, `street-lamp-${phase}`, x + 204, groundY + 6))
  }
  const name = dotLabel('Off Duty', 20, STREET_VIEW[phase].label)
  name.position.set(36, 18)
  dot.addChild(name)
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
  /** 아틀라스를 못 읽어 캔버스를 만들지 않았다 */
  const [isArtFailed, setIsArtFailed] = useState(false)
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
    let frame = 0
    let removeListeners = () => {}
    let disconnectResize = () => {}
    let stopPhaseTimer = () => {}

    const animations = new Set<AnimatedSprite>()

    void app
      .init({ resizeTo: host, background: COLOR.floor, antialias: false, roundPixels: true, resolution: 1 })
      .then(async () => {
        // 첫 그리기 전에 아틀라스를 다 읽는다. 못 읽으면 캔버스 없이 안내만 (목록·대화는 그대로)
        let art: DotArt
        try {
          art = await loadDotArt()
        } catch (error) {
          console.error('사무실 그림(도트 에셋)을 읽지 못함', error)
          app.destroy(true)
          if (!isDisposed) setIsArtFailed(true)
          return
        }
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
        let zoomIndex = DEFAULT_ZOOM_INDEX
        /** world 배율 (아트 px → 화면 px) */
        let zoom = ZOOM_STEPS[zoomIndex] * DOT_SCALE
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
        /** 지금 그려진 조는 세션들 (dozingKey). 시간이 흘러 졸기 시작하는 것도 1분마다 보고 바뀌었으면 다시 그린다 */
        let drawnDozing = ''
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
          const nextIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex - Math.sign(delta)))
          if (nextIndex === zoomIndex) return
          zoomIndex = nextIndex
          const next = ZOOM_STEPS[zoomIndex] * DOT_SCALE
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
          animations.clear()
          offDutyHeads.clear()
          approvalDesks = []
          islandViews.clear()
          const layout = layoutOffice(office, sessions)
          // 꾸미기: 테마(바닥·카펫 색과 소품 풀)와 시드로 놓은 소품. 벽 칸은 내용 오른쪽 끝(PAD_X 포함)까지
          const decorTheme = themeOf(office.decor?.theme)
          const decorPlan = planDecor(layout, office.decor ?? DEFAULT_DECOR, art.decorSizes, Math.ceil((PAD_X / TILE + layout.right) / WALL_BAY_TILES))
          map.w = PAD_X + layout.right * TILE + Math.ceil(app.screen.width / zoom)
          // 띠는 늘 내용(그룹·섬·Focus Zone) 아래 끝 + 1타일. 바닥 격자에 맞는다
          const streetY = PAD_Y + (layout.bottom + 1) * TILE
          map.h = streetY + OFF_DUTY_HEIGHT + Math.ceil(app.screen.height / zoom / TILE) * TILE
          const now = Date.now()
          drawnPhase = dayPhaseOf(new Date(now))
          drawnDozing = dozingKey(sessions, now)
          dotTextResolution = zoom / DOT_SCALE
          world.addChild(drawDotBackground(map.w, map.h, art, drawnPhase, decorTheme, decorPlan.wall))
          // 끄는 그룹·섬이 띠를 지날 때 가려지지 않게 바닥 바로 위에 둔다
          const street = drawDotOffDuty(map.w, drawnPhase, art)
          street.y = streetY
          world.addChild(street)
          // 그룹 밖 꾸미기 소품 (열린 바닥·벽 앞 줄). 그룹·섬과 겹치지 않는 자리라 그 아래 층이어도 가려지지 않는다
          const openDecor = decorPlan.floor.filter((item) => item.groupId === null)
          if (openDecor.length) {
            const decorLayer = dotLayer()
            decorLayer.position.set(PAD_X, PAD_Y)
            decorLayer.eventMode = 'none'
            decorLayer.addChild(...dotDecorProps(art, openDecor, { x: 0, y: 0 }))
            world.addChild(decorLayer)
          }
          clampPan()
          /** 그 팀들의 책상 그림 (끌 때 같이 옮긴다) */
          const deskViewsOf = (teamIds: Set<string>) =>
            layout.seated.flatMap((s) => {
              const parts = s.teamId && teamIds.has(s.teamId) ? desks.get(s.id) : undefined
              return parts ? [parts.container, ...(parts.bubble ? [parts.bubble.container] : [])] : []
            })
          for (const area of layout.groupAreas) {
            const onEdit = () => {
              if (!isDragged) latest.current.onEditGroup(area.group)
            }
            const parts = drawDotGroup(area, onEdit, art, decorTheme, decorPlan.floor.filter((item) => item.groupId === area.group.id))
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
          const occupied = new Set(
            layout.seated.flatMap((session) => {
              const seat = session.teamId ? undefined : layout.seats.get(session.id)
              return seat ? [`${seat.x - layout.lobby.x},${seat.y - layout.lobby.y}`] : []
            }),
          )
          world.addChild(drawDotZone(layout.lobby, art, occupied, decorTheme))
          for (const island of layout.islands) {
            const { team } = island
            const onEdit = () => {
              if (!isDragged) latest.current.onEditTeam(team)
            }
            const parts = drawDotIsland(island, onEdit, art, decorTheme)
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
            // 그 세션 인물 머리 (책상·목록 아바타와 같은 인물·색). 인물이 없으면(아틀라스에 인물이 없음) 빈 자리
            const dotHeadSprite = dotHead(art, session)
            const head = new Container()
            if (dotHeadSprite) {
              dotHeadSprite.position.set(2, 0)
              head.addChild(dotHeadSprite)
            }
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
            const seat = layout.seats.get(session.id)!
            const parts = drawDotDesk(session, seat, session.id === selectedId, art, now)
            if (parts.animation) animations.add(parts.animation)
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
        // 시간대가 바뀌면 창밖·Off Duty 띠를, 조는 세션이 바뀌면 책상을 다시 그린다 (매 프레임이 아니라 1분마다 확인)
        const phaseTimer = setInterval(() => {
          const now = Date.now()
          if (dayPhaseOf(new Date(now)) !== drawnPhase || dozingKey(latest.current.sessions, now) !== drawnDozing) redraw()
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
          for (const animation of animations) animation.update(ticker)
          elapsed += ticker.deltaMS
          if (elapsed < 350) return
          elapsed = 0
          frame = (frame + 1) % 2
          for (const arrow of arrows.values()) arrow.container.alpha = frame && !reducedMotion.matches ? 0.55 : 1
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

  if (isArtFailed) {
    return (
      <div className="office office-failed">
        사무실 그림을 읽지 못함 ·{' '}
        <button type="button" className="link" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    )
  }
  return <div ref={hostRef} className="office" />
}
