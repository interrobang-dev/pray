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
  Spritesheet,
  type SpritesheetData,
} from 'pixi.js'
import { attendanceOf, statusLabel, type Office as OfficeData, type Group, type Session, type Team } from './types'
import { dotLookOf, type DotCharacter, type DotLook } from './dotCharacter'
import { dotStateOf, dozingKey, type DotState } from './dotState'
import { CHARACTER_ATLAS, HEAD_RECT, loadRecolorArt, paintCharacter, type CharacterDirection, type RecolorArt } from './characterArt'
import {
  GROUP_MARGIN,
  dropIsland,
  layoutOffice,
  type BlockRow,
  type GroupArea,
  type Island,
  type Point,
  type Rect,
  type Seat,
} from './officeLayout'

/**
 * 사무실 그림은 생성 도트 스프라이트(타일 48px, docs/plans/2026-10-22-office-sprites-design.md).
 * world 좌표는 "아트 픽셀"(타일 16px) 단위이고 world 를 DOT_SCALE 배 더 키워(타일 48 화면 px = 1배) 보인다.
 * 스프라이트·이름표·아이콘은 1/DOT_SCALE 로 줄인 하위 컨테이너에 도트 px(48px 타일) 좌표로 그린다 — 배치(officeLayout.ts)·끌기·포커스 계산은 아트 px 그대로다
 */
/** 배율 단계 (타일 48px 기준. 0.5배는 전체 보기용 예외) */
const ZOOM_STEPS = [0.5, 1, 2, 3]
/** 마운트할 때 배율 = 단계 목록의 이 번째 (1배) */
const DEFAULT_ZOOM_INDEX = 1
/** 이 배율 이상이면 모든 자리의 이름표가 보인다 (그 밖에는 마우스를 올렸거나 고른 자리만) */
const NAME_TAG_ZOOM = 2
/** 도트 타일(48px) ÷ 아트 타일(16px) */
const DOT_SCALE = 3
const DOT_TILE = 48
/** 책상·의자·칸막이·부스·상태 아이콘·화분, 바닥 타일 corridor·desk-carpet·focus-navy, 자리 안 배치 메타 */
const DOT_PROPS_URL = '/office/office-v5-props.json'
/** 환경 (벽·창밖·Off Duty 거리·그룹 화분) */
const DOT_ENV_URL = '/office/office-v2.json'
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
  text: 0x2b2f3a,
  mutedText: 0x7a7f8e,
  postit: 0xfde77a,
  alert: 0xffd3d3,
  alertLine: 0xe05a5a,
  select: 0x3f9c4b,
  gold: 0xd9a63a,
  goldLight: 0xf4d77a,
  silver: 0xa9b0bd,
  silverLight: 0xdde1e8,
  external: 0x8a8f9c,
  externalLight: 0xb9bbc6,
  partLine: 0xa7acb7,
  islandLine: 0xaeb3bc,
  navy: 0x3b4f8a,
  navyDark: 0x1d2747,
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

// ---------- 자리 단위 ----------

interface SeatParts {
  /** 자리 사각형 = 클릭 영역 (그림은 블록 줄·부스 컨테이너에 있다) */
  hit: Container
  /** 모든 자리 위 층에 둔 선택 테두리·이름표·상태 아이콘 (끌 때 같이 옮긴다) */
  overlay: SeatOverlay
}

interface SeatOverlay {
  container: Container
  /** 이름표 (평소 숨김) */
  tag: Container
  /** working 아이콘 (4fps) */
  icon: AnimatedSprite | null
}

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
  /** 인물 프리셋과 풀. 인물 아틀라스에만 있다 */
  characters?: DotCharacter[]
  animations: Record<string, { fps: number; loop: boolean }>
  tiles: Record<string, DotTileMeta>
  /** screen = 화면 사각형, off = 화면을 끈 그림 (office-v5-props 의 desk-up·desk-right·booth-navy) */
  props: Record<string, { screen?: Rect; off?: string }>
}

/**
 * Focus Zone 부스 자리(96×144 도트 px) 안 배치 (office-v5-props.json meta.jkCorp.seat.booth). 좌표는 스프라이트 왼쪽 위, order 는 그리는 순서.
 * 메타의 seat.down·up·right·partition 은 책상을 자리마다 따로 그리던 때의 것이라 화면이 읽지 않는다 (섬은 block)
 */
interface SeatLayoutMeta {
  order: string[]
  chair?: [number, number]
  /** 사람이 없는 자리(빈 자리·휴식)의 의자. 책상 쪽으로 밀어 넣은 자리 (없으면 chair) */
  emptyChair?: [number, number]
  char?: [number, number]
  booth?: [number, number]
  icon: [number, number]
}

/** 칸막이 블록 안 자리 하나 (블록 원점 기준 도트 px) */
interface BlockSeatMeta {
  char: [number, number]
  chair: [number, number]
  emptyChair?: [number, number]
  icon: [number, number]
}

/**
 * 칸막이 블록 (office-v5-props.json meta.jkCorp.block, 도트 px, 스프라이트 왼쪽 위). 원점 = 블록 줄 첫 짝 왼쪽 위, 짝 i 는 x 에 pairW·i,
 * 블록 줄 높이 h(4타일), 모듈은 y moduleY. order = 그리는 단계 (단계마다 모든 짝)
 */
interface BlockMeta {
  h: number
  pairW: number
  moduleY: number
  pair: { module: string; moduleOff: string; top: BlockSeatMeta; bottom: BlockSeatMeta }
  lead: { module: string; moduleOff: string; moduleAt: [number, number]; char: [number, number]; chair: [number, number]; frontFrom: number; icon: [number, number] }
  endLeft: { sprite: string; at: [number, number] }
  /** at[0] 은 "pairs*pairW" (짝 수 × 짝 폭) */
  endRight: { sprite: string; at: [unknown, number] }
  order: string[]
}

interface PropsSheetMeta extends DotSheetMeta {
  seat: { booth: SeatLayoutMeta }
  block: BlockMeta
  /** 머리 위 상태 아이콘 (18×15, 꼬리 끝 아래 왼쪽 x 4) */
  icons: { approval: string; myTurn: string; working: { frames: string[]; fps: number } }
  /** 섬 받침 색 (그림 없이 Graphics) */
  islandBase: { color: string }
}

interface DotArt {
  /** 방향별 인물 (office-v5-down·up·right). left 는 right 를 뒤집어 그린다 */
  people: Record<CharacterDirection, Spritesheet>
  /** 인물 프리셋 (정면 아틀라스의 목록. 세 방향 모두 같은 인물) */
  characters: DotCharacter[]
  /** 책상·의자·칸막이·부스·아이콘·화분 (office-v5-props) */
  props: Spritesheet
  propsMeta: PropsSheetMeta
  /** 환경 소품 (office-v2: 집·가로등·그룹 화분) */
  env: Spritesheet
  /** 반복 타일: office-v2 (벽·창밖 4시간대·거리) + office-v5-props (통로·데스크존 카펫·Focus Zone 남색 카펫) */
  tiles: Record<string, { texture: Texture; meta: DotTileMeta }>
  /** 방향별 인물 머리·윗옷 색 바꾸기. 정면은 처음에 읽고, 뒷모습·옆모습은 고른 색이 있는 자리가 생길 때 읽는다 (읽는 중·실패면 기본색) */
  recolor: Map<CharacterDirection, RecolorArt | 'loading' | 'failed'>
  /** 뒷모습·옆모습 색 바꾸기를 다 읽으면 부른다 (다시 그리기) */
  onRecolorLoaded: () => void
  /** 색을 바꾼 인물 프레임: `방향|인물|머리|윗옷` → 프레임 이름 → 텍스처. 처음 그릴 때 만들고 계속 쓴다 */
  recolored: Map<string, Record<string, Texture>>
  /** Off Duty 머리: `인물|머리|윗옷` → 텍스처 */
  heads: Map<string, Texture>
}

const DIRECTIONS: CharacterDirection[] = ['down', 'up', 'right']
/** office-v2 에서 쓰는 반복 타일: 벽·창밖 4시간대·Off Duty 보도 */
const ENV_TILES = /^(wall|street|view-.+)$/

/**
 * 아틀라스를 Assets 캐시에 프레임 이름을 올리지 않고 읽는다. office-v2 와 office-v5-props 에 같은 프레임 이름(prop/plant-large)이 있어
 * 둘 다 Assets.load 하면 캐시 키가 겹친다는 경고가 난다 (그림은 아틀라스마다 따로 찾으므로 맞게 나온다)
 */
async function loadSheetUncached(url: string): Promise<Spritesheet> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  const data = (await response.json()) as SpritesheetData
  const texture = await Assets.load<Texture>(url.slice(0, url.lastIndexOf('/') + 1) + data.meta.image)
  const sheet = new Spritesheet(texture, data)
  await sheet.parse()
  return sheet
}

/** 아틀라스들과 반복 타일을 읽고 확대를 nearest 로 (전역 기본값을 바꾸면 글자까지 바뀌어 텍스처마다) */
async function loadDotArt(): Promise<DotArt> {
  const [[down, up, right], props, env, recolor] = await Promise.all([
    Promise.all(DIRECTIONS.map((direction) => Assets.load<Spritesheet>(`/office/${CHARACTER_ATLAS[direction]}.json`))),
    loadSheetUncached(DOT_PROPS_URL),
    Assets.load<Spritesheet>(DOT_ENV_URL),
    loadRecolorArt('down').catch((error: unknown) => {
      console.error('도트 인물 색 바꾸기를 읽지 못해 기본색으로 그린다', error)
      return null
    }),
  ])
  const metaOf = <T = DotSheetMeta,>(sheet: Spritesheet) => (sheet.data.meta as unknown as { jkCorp: T }).jkCorp
  // office-v2 의 바닥·그룹·섬·Focus Zone 타일은 office-v5-props 타일로 바뀌어 읽지 않는다
  const tileEntries = await Promise.all(
    [...Object.entries(metaOf(env).tiles).filter(([id]) => ENV_TILES.test(id)), ...Object.entries(metaOf(props).tiles)].map(
      async ([id, tile]) => [id, { texture: await Assets.load<Texture>(`/office/${tile.image}`), meta: tile }] as const,
    ),
  )
  const people = { down, up, right }
  for (const source of [...[down, up, right, props, env].map((sheet) => sheet.textureSource), ...tileEntries.map(([, tile]) => tile.texture.source)]) {
    source.scaleMode = 'nearest'
  }
  return {
    people,
    characters: metaOf(down).characters ?? [],
    props,
    propsMeta: metaOf<PropsSheetMeta>(props),
    env,
    tiles: Object.fromEntries(tileEntries),
    recolor: new Map([['down', recolor ?? 'failed']]),
    onRecolorLoaded: () => {},
    recolored: new Map(),
    heads: new Map(),
  }
}

/** 그 방향 색 바꾸기. 아직 안 읽었으면 읽기 시작하고 null (다 읽으면 onRecolorLoaded) */
function recolorOf(art: DotArt, direction: CharacterDirection): RecolorArt | null {
  const state = art.recolor.get(direction)
  if (state === undefined) {
    art.recolor.set(direction, 'loading')
    loadRecolorArt(direction).then(
      (loaded) => {
        art.recolor.set(direction, loaded)
        art.onRecolorLoaded()
      },
      (error: unknown) => {
        console.error(`도트 인물 색 바꾸기(${direction})를 읽지 못해 기본색으로 그린다`, error)
        art.recolor.set(direction, 'failed')
      },
    )
    return null
  }
  return state === 'loading' || state === 'failed' ? null : state
}

/** 그 방향 인물 애니메이션 이름. 정면은 v3 때 그대로 `char/<id>/<상태>`, 뒷모습·옆모습은 `char/<id>/<방향>/<상태>` */
function animationKey(direction: CharacterDirection, character: string, state: DotState): string {
  return direction === 'down' ? `char/${character}/${state}` : `char/${character}/${direction}/${state}`
}

/** 그 방향·인물의 프레임 텍스처들. 고른 색이 있으면 색을 바꾼 것 (조합마다 한 번 만든다) */
function characterTextures(art: DotArt, direction: CharacterDirection, look: DotLook): Record<string, Texture> {
  const sheet = art.people[direction]
  const { id: character, hair, top } = look
  if (!hair && !top) return sheet.textures
  const recolor = recolorOf(art, direction)
  if (!recolor) return sheet.textures
  const key = `${direction}|${character}|${hair}|${top}`
  const cached = art.recolored.get(key)
  if (cached) return cached
  const prefix = direction === 'down' ? `char/${character}/` : `char/${character}/${direction}/`
  const names = Object.keys(sheet.textures).filter((name) => name.startsWith(prefix))
  const originals = names.map((name) => sheet.textures[name])
  const canvas = paintCharacter(recolor, character, originals.map(({ frame }) => ({ x: frame.x, y: frame.y, w: frame.width, h: frame.height })), hair, top)
  if (!canvas) {
    art.recolored.set(key, sheet.textures)
    return sheet.textures
  }
  const source = Texture.from(canvas).source
  source.scaleMode = 'nearest'
  const textures: Record<string, Texture> = { ...sheet.textures }
  let x = 0
  names.forEach((name, index) => {
    const original = originals[index]
    textures[name] = new Texture({ source, frame: new Rectangle(x, 0, original.frame.width, original.frame.height), defaultAnchor: original.defaultAnchor })
    x += original.frame.width
  })
  art.recolored.set(key, textures)
  return textures
}

/** Off Duty 머리 (도트): 그 인물·색 정면 idle 첫 칸의 머리 부분 (목록 아바타와 같은 자리). 인물이 없으면 null */
function dotHead(art: DotArt, session: Session): Sprite | null {
  const look = dotLookOf(session, art.characters)
  if (!look) return null
  const key = `${look.id}|${look.hair}|${look.top}`
  let texture = art.heads.get(key)
  if (!texture) {
    const base = characterTextures(art, 'down', look)[`char/${look.id}/idle/0`]
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

/** 환경(office-v2) 소품 스프라이트. 앵커는 아래 가운데 (build.py) */
function dotProp(art: DotArt, id: string, x: number, bottom: number): Sprite {
  const sprite = new Sprite(art.env.textures[`prop/${id}`])
  sprite.position.set(x, bottom)
  return sprite
}

/** office-v5-props 스프라이트를 왼쪽 위(x, y)에 (자리 안 배치 메타가 왼쪽 위 좌표라서) */
function v5Prop(art: DotArt, texture: Texture | string, x: number, y: number): Sprite {
  const sprite = new Sprite(typeof texture === 'string' ? art.props.textures[`prop/${texture}`] : texture)
  sprite.anchor.set(0)
  sprite.position.set(x, y)
  return sprite
}

/** '#rrggbb' → 0xrrggbb */
function hexColor(value: string): number {
  return parseInt(value.slice(1), 16)
}

/** 도트 그림의 외곽선색 (생성 에셋의 1px 진한 외곽선과 같은 쪽) */
const DOT_OUTLINE = 0x2b2a33

/**
 * 도트 바닥·벽·창밖. 벽 타일(144×120 = 벽 높이 WALL_H × DOT_SCALE)은 창 유리가 투명이라 그 뒤에 그 시간대 창밖을 깐다.
 * 창밖 타일 폭(432)은 창틀 기둥 간격(144)의 배수라 반복 경계가 늘 기둥 뒤에 숨는다. 창밖은 아래(지평선)를 유리 아래 끝에 맞춘다.
 * 열린 바닥(통로)은 밝은 타일 (48 격자라 바닥 격자와 맞는다)
 */
function drawDotBackground(widthPx: number, heightPx: number, art: DotArt, phase: DayPhase): Container {
  const container = dotLayer()
  const width = widthPx * DOT_SCALE
  const wallBottom = WALL_H * DOT_SCALE
  const floor = dotTiling(art, 'corridor', width, heightPx * DOT_SCALE - wallBottom)
  floor.y = wallBottom
  const wall = art.tiles.wall
  const glass = wall.meta.glass ?? { y: 0, h: wall.meta.h }
  const view = art.tiles[`view-${phase}`]
  const viewSprite = dotTiling(art, `view-${phase}`, width, view.meta.h)
  viewSprite.y = glass.y + glass.h - view.meta.h
  const wallSprite = dotTiling(art, 'wall', width, wall.meta.h)
  wallSprite.y = wallBottom - wall.meta.h
  container.addChild(viewSprite, wallSprite, floor)
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

/** 그룹 이름표·팀 이름표·파트 이름표·메모 글자 (도트 px). 자리 이름표(14)를 기준으로 계층 순 */
const DOT_FONT = { group: 16, team: 14, part: 12, note: 12, seat: 14 }

function dotLabel(text: string, size: number, color = COLOR.text, wrapWidth?: number): Text {
  return label(text, size, color, wrapWidth, dotTextResolution)
}

/**
 * 도트 그룹(데스크존): 밝은 회색 카펫 + 낮은 흰 파티션(위·왼쪽·오른쪽, 아래는 회색 걸레받이) + 이름표·화분·메모.
 * 크기는 저장된 w·h 가 아니라 그려지는 영역(안의 섬들을 다 담는다)
 */
function drawDotGroup(area: GroupArea, onEdit: () => void, art: DotArt): GroupParts {
  const { group } = area
  const container = new Container()
  container.position.set(PAD_X + area.x * TILE, PAD_Y + area.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const w = area.w * TILE * DOT_SCALE
  const h = area.h * TILE * DOT_SCALE
  dot.addChild(dotTiling(art, 'desk-carpet', w, h))
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
      .fill(0xe9eaef)
      .rect(0, h - 9, w, 2)
      .fill(COLOR.partitionShadow)
      .rect(0, 0, w, h)
      .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 }),
  )
  dot.addChild(dotProp(art, 'plant-large', w - 36, 66))
  dot.addChild(dotProp(art, 'plant-small', 30, h - 12))

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

/**
 * 도트 팀 섬: 테두리 안쪽에 데스크존 카펫보다 한 단 진한 회색 받침(참고 그림의 블록 받침) + 블록 줄마다 오른쪽 화분 +
 * 파트 구역(옅은 바탕 + 회색 테두리 + 이름표) + 팀 이름표. 칸막이 블록(책상·사람)은 drawBlockRow 가 섬 위에 따로 그린다
 */
function drawDotIsland(island: Island, onEdit: () => void, art: DotArt): IslandParts {
  const container = new Container()
  container.position.set(PAD_X + island.x * TILE, PAD_Y + island.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const w = island.w * TILE * DOT_SCALE
  const h = island.h * TILE * DOT_SCALE
  /** 섬 안 타일 좌표 → 이 섬 도트 px */
  const local = (point: Point) => ({ x: (point.x - island.x) * DOT_TILE, y: (point.y - island.y) * DOT_TILE })
  // 받침: 단위들(테두리 1타일 안쪽)에서 왼쪽 24(지휘자 없는 블록의 왼쪽 끝 판 12 바깥)·오른쪽 12·위 12·아래 24(아랫자리 의자가 블록 줄 아래로 23 나온다) 넓게
  dot.addChild(
    new Graphics()
      .rect(DOT_TILE - 24, DOT_TILE - 12, w - 2 * DOT_TILE + 36, h - 2 * DOT_TILE + 36)
      .fill(hexColor(art.propsMeta.islandBase.color))
      .stroke({ width: 2, color: COLOR.islandLine, alignment: 1 }),
  )
  for (const zone of island.zones) {
    // 단위 경계에서 왼쪽 18·오른쪽 12, 위로 이름표 자리 60(파트 앞 여백 2타일 안), 아래 24(아랫자리 의자 밖. 섬 받침 아래 끝과 같은 선)
    const { x, y } = local(zone)
    const zx = x - 18
    const zy = y - 60
    const zw = zone.w * DOT_TILE + 30
    const zh = zone.h * DOT_TILE + 84
    const partName = dotLabel(zone.part.name, DOT_FONT.part, 0x4d5563)
    const partSign = dotSign(partName, COLOR.silver, 6)
    partSign.position.set(zx + 8, zy + 8)
    partName.position.set(zx + 14, zy + 10)
    dot.addChild(
      new Graphics().rect(zx, zy, zw, zh).fill({ color: 0xffffff, alpha: 0.25 }).stroke({ width: 2, color: COLOR.partLine, alignment: 1 }),
      partSign,
      partName,
    )
  }
  // 화분 열: 블록 줄마다 오른쪽 끝 칸막이(6) 옆에 큰 화분 (블록 모듈 높이 가운데쯤)
  for (const plant of island.plants) {
    const { x, y } = local(plant)
    dot.addChild(v5Prop(art, 'plant-large', x + 6, y + 40))
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
 * 도트 Focus Zone(집중공간): 남색 카펫 + 테두리, 빈 부스(화면 꺼짐 + 빈 의자. 앉은 자리는 drawBoothSeat 가 부스째 그린다) + 화분·이름표.
 * 부스 자리는 officeLayout.ts 의 layout.booths, occupied = 앉은 부스의 "x,y" (절대 타일)
 */
function drawDotZone(zone: Rect, booths: Seat[], art: DotArt, occupied: Set<string>): Container {
  const container = new Container()
  container.position.set(PAD_X + zone.x * TILE, PAD_Y + zone.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const width = zone.w * DOT_TILE
  const height = zone.h * DOT_TILE
  dot.addChild(
    dotTiling(art, 'focus-navy', width, height),
    new Graphics()
      .rect(0, 0, width, height)
      .stroke({ width: 4, color: COLOR.navyDark, alignment: 1 })
      .rect(0, 0, width, height)
      .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 }),
  )
  for (const booth of booths) {
    if (occupied.has(`${booth.x},${booth.y}`)) continue
    const boothArt = drawBoothArt(art, null, false, null)
    boothArt.position.set((booth.x - zone.x) * DOT_TILE, (booth.y - zone.y) * DOT_TILE)
    dot.addChild(boothArt)
  }
  // 오른쪽 가장자리 (부스 오른쪽 끝 ~ 구역 끝)
  const plant = art.props.textures['prop/plant']
  for (let y = 2 * DOT_TILE; y + plant.height < height - 12; y += 4 * DOT_TILE) dot.addChild(v5Prop(art, plant, width - plant.width - 14, y))

  const name = dotLabel('Focus Zone', DOT_FONT.group)
  const sign = dotSign(name, COLOR.navy)
  // 이름표 줄(맨 위 1타일) 안
  sign.position.set(18, 6)
  name.position.set(26, 8)
  name.eventMode = 'none'
  dot.addChild(sign, name)
  return container
}

/**
 * 그 인물·방향·상태의 프레임과 fps. 그 방향에 그 상태가 없으면(단계 사이) 그 방향 idle(없으면 typing) 0번에 멈춘 한 장이고
 * doze 대역은 흐리게(isDim) 한다. 그 방향 그림이 아예 없으면 정면으로
 */
function dotFrames(art: DotArt, direction: CharacterDirection, look: DotLook, state: DotState): { textures: Texture[]; fps: number; isDim: boolean } {
  const sheet = art.people[direction]
  const key = animationKey(direction, look.id, state)
  const frames = characterTextures(art, direction, look)
  const names = sheet.data.animations?.[key]
  if (names) {
    const meta = (sheet.data.meta as unknown as { jkCorp: DotSheetMeta }).jkCorp
    return { textures: names.map((name) => frames[name]), fps: meta.animations[key]?.fps ?? 6, isDim: false }
  }
  const still = frames[`${animationKey(direction, look.id, 'idle')}/0`] ?? frames[`${animationKey(direction, look.id, 'typing')}/0`]
  if (still) return { textures: [still], fps: 0, isDim: state === 'doze' }
  if (direction !== 'down') return dotFrames(art, 'down', look, state)
  return { textures: [frames[`char/${look.id}/typing/0`]], fps: 0, isDim: state === 'doze' }
}

/**
 * 도트 하위 컨테이너(1/DOT_SCALE) 글자 해상도 = 지금 배율 (0.5·1·2·3). redraw 가 배율을 바꾼 뒤 정한다.
 * 최대 배율(3)로 고정하면 1배에서 3배 축소돼 12px 한글의 가는 획이 빠진다
 */
let dotTextResolution = 1

const TAG_H = 20
/** 이름표 최대 폭 = 짝(자리 열) 폭 96 - 6 */
const TAG_MAX_W = 90

/** 도트 px 위치 [x, y] (스프라이트 왼쪽 위) */
type At = [number, number]

/**
 * 블록 안 명패 (도트 px, 블록 원점 기준. 짝 자리는 그 짝 왼쪽 위 기준): 지휘자 금·은은 block-lead 앞면(79~95줄, x 1~34),
 * 외부 세션 회색은 윗자리 = 윗책상 상판 오른쪽(모니터 뒷면 옆. 윗책상 앞판은 가운데 칸막이가 가린다), 아랫자리 = 아랫책상 앞판 오른쪽 끝(사람 옆)
 */
const BLOCK_PLATE: Record<'lead' | 'top' | 'bottom', Rect> = {
  lead: { x: -44, y: 131, w: 28, h: 9 },
  top: { x: 74, y: 66, w: 18, h: 7 },
  bottom: { x: 68, y: 131, w: 22, h: 9 },
}
/**
 * 블록 안 이름표 위 끝 y (블록 원점 기준): 윗자리는 윗책상 상판(모니터 뒷면 앞), 아랫자리는 의자 아래쪽(다음 블록 줄 윗사람 아이콘 위 끝 −17 보다 위),
 * 지휘자는 옆 책상 아래 끝(144) 바로 밑 — 지휘자 열 아래쪽은 늘 빈 받침이고 앞면 명패를 가리지 않는다
 */
const BLOCK_TAG_Y = { top: 58, bottom: 196, lead: 146 }
/** 부스 명패 (부스 그림 왼쪽 위 기준, 책상 앞 가장자리 오른쪽 끝)·이름표 위 끝 */
const BOOTH_PLATE: Rect = { x: 80, y: 52, w: 22, h: 9 }
const BOOTH_TAG_Y = 124

/** 사람이 앉아 있는 세션 (휴식은 빈 의자) */
function isSeatedPerson(session: Session | undefined): session is Session {
  return session !== undefined && attendanceOf(session) !== 'break'
}

function isScreenOn(session: Session | undefined): boolean {
  return isSeatedPerson(session) && session.status === 'working'
}

/** 책상 앞면 명패 색: 팀장 금·파트장 은·외부 세션 회색. 팀원은 없다 */
function plateOf(session: Session): { color: number; light: number } | null {
  const isLead = session.role === 'lead'
  if (isLead && session.partId !== null) return { color: COLOR.silver, light: COLOR.silverLight }
  if (isLead) return { color: COLOR.gold, light: COLOR.goldLight }
  if (session.kind === 'external') return { color: COLOR.external, light: COLOR.externalLight }
  return null
}

function drawPlate(plate: { color: number; light: number }, at: Rect): Graphics {
  return new Graphics()
    .rect(at.x, at.y, at.w, at.h)
    .fill(plate.color)
    .rect(at.x + 3, at.y + 3, at.w - 6, 3)
    .fill(plate.light)
    .rect(at.x, at.y, at.w, at.h)
    .stroke({ width: 1, color: DOT_OUTLINE, alignment: 1 })
}

/** 앉은 사람 (anchor 0). 휴식이면 null. 사용자가 고른 인물(아틀라스에 있을 때만)과 색 → 세션 ID 해시로 고른 프리셋 (지시자는 리더 풀) */
function personSprite(session: Session, direction: CharacterDirection, art: DotArt, now: number): AnimatedSprite | null {
  if (!isSeatedPerson(session)) return null
  const look = dotLookOf(session, art.characters) ?? { id: session.role === 'lead' ? 'lead' : 'member', hair: null, top: null }
  const { textures, fps, isDim } = dotFrames(art, direction, look, dotStateOf(session, now))
  const animation = new AnimatedSprite({ textures, autoUpdate: false })
  animation.anchor.set(0)
  // 반투명은 뒤 의자가 비쳐 보여 색만 어둡게
  if (isDim) animation.tint = 0xb4b8c4
  if (textures.length > 1) {
    animation.animationSpeed = fps / 60
    // 모두 같은 박자로 치지 않게 세션마다 시작 프레임을 다르게
    animation.gotoAndPlay(parseInt(session.id.slice(0, 2), 16) % textures.length || 0)
  }
  return animation
}

/**
 * 칸막이 블록 줄 하나 (office-v5-props 메타 block, 도트 px, 원점 = 첫 짝 왼쪽 위): 메타 order 의 단계마다 모든 짝을 그린 뒤 다음 단계 —
 * 윗자리 의자 → 윗자리 사람 → 지휘자 의자 → 짝 모듈(화면은 아랫자리 것) → 지휘자 책상(block-lead) → 끝 마감 → 지휘자 사람 → block-lead 앞쪽 →
 * 아랫자리 사람 → 아랫자리 의자. 윗사람은 모듈 뒤(손만 상판 위), 아랫사람·의자는 모듈 앞. 사람 없는 자리(빈 자리·휴식)는 의자만
 * (아랫자리는 책상 쪽으로 밀어 넣은 emptyChair). 명패는 그 위. 클릭은 자리 사각형(hit)이 받고 아이콘·이름표는 자리 위 층(drawSeatOverlay)
 */
function drawBlockRow(art: DotArt, row: BlockRow, sessionById: Map<string, Session>, now: number): { container: Container; animations: AnimatedSprite[] } {
  const block = art.propsMeta.block
  const container = new Container()
  container.position.set(PAD_X + row.x * TILE, PAD_Y + row.y * TILE)
  container.eventMode = 'none'
  const dot = dotLayer()
  container.addChild(dot)
  const animations: AnimatedSprite[] = []
  const sessionOf = (id: string | null) => (id ? sessionById.get(id) : undefined)
  const add = (texture: string, at: At, dx = 0) => dot.addChild(v5Prop(art, art.props.textures[texture], at[0] + dx, at[1]))
  const addPerson = (session: Session | undefined, direction: CharacterDirection, at: At, dx = 0) => {
    const sprite = session ? personSprite(session, direction, art, now) : null
    if (!sprite) return
    sprite.position.set(at[0] + dx, at[1])
    dot.addChild(sprite)
    animations.push(sprite)
  }
  const eachPair = (draw: (pair: BlockRow['pairs'][number], dx: number) => void) => row.pairs.forEach((pair, index) => draw(pair, index * block.pairW))
  const lead = sessionOf(row.leadId)
  const leadModule = row.leadId ? (isScreenOn(lead) ? block.lead.module : block.lead.moduleOff) : null
  const steps: Record<string, () => void> = {
    'top.chair': () => eachPair((_, dx) => add('prop/chair-down', block.pair.top.chair, dx)),
    'top.char': () => eachPair((pair, dx) => addPerson(sessionOf(pair.top), 'down', block.pair.top.char, dx)),
    'lead.chair': () => {
      if (row.leadId) add('prop/chair-right', block.lead.chair)
    },
    module: () => eachPair((pair, dx) => add(isScreenOn(sessionOf(pair.bottom)) ? block.pair.module : block.pair.moduleOff, [0, block.moduleY], dx)),
    'lead.module': () => {
      if (leadModule) add(leadModule, block.lead.moduleAt)
    },
    endLeft: () => {
      if (!row.leadId) add(block.endLeft.sprite, block.endLeft.at)
    },
    endRight: () => {
      if (row.pairs.length) add(block.endRight.sprite, [row.pairs.length * block.pairW, block.endRight.at[1]])
    },
    'lead.char': () => addPerson(lead, 'right', block.lead.char),
    'lead.front': () => {
      // 지휘자 책상의 frontFrom 아래(타자 치는 손 아래 끝 + 1)를 사람 위에 한 번 더: 손은 키보드 위, 허벅지·무릎은 책상 윗면 뒤
      if (!leadModule || !isSeatedPerson(lead)) return
      const texture = art.props.textures[leadModule]
      const { frame } = texture
      const from = block.lead.frontFrom
      const front = new Texture({ source: texture.source, frame: new Rectangle(frame.x, frame.y + from, frame.width, frame.height - from) })
      dot.addChild(v5Prop(art, front, block.lead.moduleAt[0], block.lead.moduleAt[1] + from))
    },
    'bottom.char': () => eachPair((pair, dx) => addPerson(sessionOf(pair.bottom), 'up', block.pair.bottom.char, dx)),
    'bottom.chair': () =>
      eachPair((pair, dx) => {
        const seat = block.pair.bottom
        add('prop/chair-up', isSeatedPerson(sessionOf(pair.bottom)) ? seat.chair : (seat.emptyChair ?? seat.chair), dx)
      }),
  }
  // icon 단계는 자리 위 층(drawSeatOverlay)이 그린다
  for (const step of block.order) steps[step]?.()
  const leadPlate = lead ? plateOf(lead) : null
  if (leadPlate) dot.addChild(drawPlate(leadPlate, BLOCK_PLATE.lead))
  eachPair((pair, dx) => {
    for (const side of ['top', 'bottom'] as const) {
      const session = sessionOf(pair[side])
      const plate = session ? plateOf(session) : null
      if (plate) dot.addChild(drawPlate(plate, { ...BLOCK_PLATE[side], x: BLOCK_PLATE[side].x + dx }))
    }
  })
  return { container, animations }
}

/**
 * Focus Zone 부스 그림 (도트 px, 부스 왼쪽 위 기준): office-v5-props 메타 seat.booth 의 순서대로 부스(켜짐·꺼짐) → 사람(뒷모습) → 의자.
 * person 이 null 이면 빈 의자 (책상 쪽으로 밀어 넣은 emptyChair)
 */
function drawBoothArt(art: DotArt, person: AnimatedSprite | null, isOn: boolean, plate: { color: number; light: number } | null): Container {
  const layout = art.propsMeta.seat.booth
  const container = new Container()
  const off = art.propsMeta.props['prop/booth-navy']?.off
  const booth = art.props.textures[isOn || !off ? 'prop/booth-navy' : off]
  const chairAt = person ? layout.chair : (layout.emptyChair ?? layout.chair)
  for (const part of layout.order) {
    if (part === 'booth') container.addChild(v5Prop(art, booth, ...(layout.booth ?? [0, 0])))
    else if (part === 'char' && person && layout.char) {
      person.position.set(...layout.char)
      container.addChild(person)
    } else if (part === 'chair' && chairAt) container.addChild(v5Prop(art, 'chair-up', ...chairAt))
  }
  if (plate) container.addChild(drawPlate(plate, BOOTH_PLATE))
  return container
}

/** 앉은 부스 하나 (부스·사람·의자·명패). 클릭은 자리 사각형(hit), 아이콘·이름표는 자리 위 층 */
function drawBoothSeat(session: Session, seat: Seat, art: DotArt, now: number): { container: Container; animation: AnimatedSprite | null } {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  container.eventMode = 'none'
  const dot = dotLayer()
  container.addChild(dot)
  const animation = personSprite(session, 'up', art, now)
  dot.addChild(drawBoothArt(art, animation, isScreenOn(session), plateOf(session)))
  return { container, animation }
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

/** 자리 위 층에 놓는 자리 (origin 기준): 아이콘 왼쪽 위·이름표 가운데 x 와 위 끝 y (도트 px), 선택 테두리 = 자리 사각형 (아트 px) */
interface OverlayPlace {
  /** 아트 px 절대 위치 (블록 줄 원점 또는 부스 자리 왼쪽 위) */
  origin: Point
  icon: At
  tag: Point
  rect: Rect
}

/**
 * 자리 위 층의 선택 테두리·이름표·상태 아이콘 (이벤트 없음). 아이콘은 배율과 관계없이 화면 18×15 px (iconScale = 1 / 지금 배율 → 화면에 원본 픽셀 1:1).
 * 선택 테두리도 여기 둔다 — 자리 그림은 블록 줄 단위라 자리 사각형이 따로 없다
 */
function drawSeatOverlay(session: Session, place: OverlayPlace, isSelected: boolean, art: DotArt, iconScale: number): SeatOverlay {
  const container = new Container()
  container.position.set(place.origin.x, place.origin.y)
  container.eventMode = 'none'
  const dot = dotLayer()
  container.addChild(dot)
  const isOnBreak = attendanceOf(session) === 'break'
  const isExternal = session.kind === 'external'
  const isLead = session.role === 'lead'
  const isPartLead = isLead && session.partId !== null
  const { rect } = place
  if (isSelected) container.addChild(new Graphics().rect(rect.x - 2, rect.y + 1, rect.w + 4, rect.h - 2).stroke({ width: 1, color: COLOR.select }))

  const tag = new Container()
  const name = label('', DOT_FONT.seat, isExternal ? COLOR.mutedText : COLOR.text, undefined, dotTextResolution)
  fitOneLine(name, session.name ?? session.title ?? session.id.slice(0, 8), TAG_MAX_W - 12)
  const tagW = Math.ceil(name.width) + 12
  const underline = isExternal ? COLOR.externalLight : isPartLead ? COLOR.silver : isLead ? COLOR.gold : COLOR.green
  const tagX = Math.floor(place.tag.x - tagW / 2)
  const tagY = place.tag.y
  const background = new Graphics()
    .rect(tagX, tagY, tagW, TAG_H)
    .fill(0xffffff)
    .rect(tagX, tagY + TAG_H - 3, tagW, 3)
    .fill(underline)
    .rect(tagX, tagY, tagW, TAG_H)
    .stroke({ width: 1, color: DOT_OUTLINE, alignment: 1 })
  name.position.set(tagX + 6, tagY + 1)
  tag.addChild(background, name)
  if (isOnBreak) tag.alpha = 0.6
  tag.visible = false
  dot.addChild(tag)

  // 상태 아이콘: 승인 대기 빨간 "!", 내 차례 말풍선, 작업 중 점 셋 (휴식은 없다)
  const icons = art.propsMeta.icons
  let icon: AnimatedSprite | null = null
  const iconTextures = isOnBreak
    ? null
    : session.status === 'needs-approval'
      ? [art.props.textures[icons.approval]]
      : session.status === 'my-turn'
        ? [art.props.textures[icons.myTurn]]
        : session.status === 'working'
          ? icons.working.frames.map((frame) => art.props.textures[frame])
          : null
  if (iconTextures) {
    icon = new AnimatedSprite({ textures: iconTextures, autoUpdate: false })
    // 꼬리 끝(아래 왼쪽 x 4)을 메타 자리에 두고 배율만큼 줄인다
    icon.anchor.set(4 / 18, 1)
    icon.position.set(place.icon[0] + 4, place.icon[1] + 15)
    icon.scale.set(iconScale)
    if (iconTextures.length > 1) {
      icon.animationSpeed = icons.working.fps / 60
      icon.play()
    }
    dot.addChild(icon)
  }
  return { container, tag, icon: iconTextures && iconTextures.length > 1 ? icon : null }
}

/**
 * 자리 위 층에 놓을 자리. 블록 자리는 블록 줄 원점 기준(메타 block 의 아이콘 자리, 짝 i 는 x + 96·i), 부스는 그 자리 왼쪽 위 기준(메타 seat.booth)
 */
function overlayPlaceOf(seat: Seat, row: BlockRow | null, art: DotArt): OverlayPlace {
  const seatOrigin = { x: PAD_X + seat.x * TILE, y: PAD_Y + seat.y * TILE }
  if (!row) {
    return { origin: seatOrigin, icon: art.propsMeta.seat.booth.icon, tag: { x: 48, y: BOOTH_TAG_Y }, rect: { x: 0, y: 0, w: seat.w * TILE, h: seat.h * TILE } }
  }
  const block = art.propsMeta.block
  const origin = { x: PAD_X + row.x * TILE, y: PAD_Y + row.y * TILE }
  const rect = { x: seatOrigin.x - origin.x, y: seatOrigin.y - origin.y, w: seat.w * TILE, h: seat.h * TILE }
  if (seat.dir === 'right') return { origin, icon: block.lead.icon, tag: { x: -block.pairW / 2, y: BLOCK_TAG_Y.lead }, rect }
  const dx = (seat.x - row.x) * DOT_TILE
  const side = seat.dir === 'down' ? block.pair.top : block.pair.bottom
  return {
    origin,
    icon: [side.icon[0] + dx, side.icon[1]],
    tag: { x: dx + block.pairW / 2, y: seat.dir === 'down' ? BLOCK_TAG_Y.top : BLOCK_TAG_Y.bottom },
    rect,
  }
}

/** 자리 사각형 = 클릭 영역 (투명). 자리 그림은 블록 줄·부스 컨테이너에 있다 */
function drawSeatHit(seat: Seat): Container {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  container.eventMode = 'static'
  container.cursor = 'pointer'
  container.hitArea = new Rectangle(0, 0, seat.w * TILE, seat.h * TILE)
  return container
}

// ---------- 자리 카드 ----------

/** 마우스를 올렸거나 고른 자리 근처에 띄우는 HTML 카드 (캔버스 위). 자리와 화면 끝 사이 여백 */
const CARD_GAP = 6
const CARD_MARGIN = 4
const CARD_TEXT_MAX_CHARS = 300

function SeatCard({ session }: { session: Session }) {
  const isOnBreak = attendanceOf(session) === 'break'
  const role = session.role === 'lead' ? (session.partId !== null ? '파트장' : '팀장') : null
  const facts = [isOnBreak ? '휴식' : statusLabel[session.status], role, session.kind === 'external' ? '외부 세션' : null].filter(Boolean)
  const text = session.lastAssistantText ?? ''
  return (
    <>
      <div className="office-card-head">
        <span className={`status-dot ${isOnBreak ? '' : session.status}`} />
        <b>{session.name ?? session.title ?? session.id.slice(0, 8)}</b>
      </div>
      <div className="office-card-facts">{facts.join(' · ')}</div>
      {!isOnBreak && session.status === 'needs-approval' && <div className="office-card-tool">도구: {session.pendingTool ?? '?'}</div>}
      {!isOnBreak && session.status === 'my-turn' && text && (
        <p className="office-card-text">{text.length > CARD_TEXT_MAX_CHARS ? `${text.slice(0, CARD_TEXT_MAX_CHARS).trimEnd()}…` : text}</p>
      )}
    </>
  )
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

/** 승인 대기 아이콘과 같은 쪽의 빨강에 흰 테두리 (어느 바탕 위에서도 보이게) */
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
  /** 마우스를 올린 자리의 세션. 카드는 이것, 없으면 고른 세션 */
  const [hoveredSeatId, setHoveredSeatId] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
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
    const desks = new Map<string, SeatParts>()
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
        /** 마우스를 올린 자리의 세션. 다시 그려도 이름표가 보인 채 남게 여기 둔다 (카드는 React 상태 hoveredSeatId) */
        let hoveredDeskId: string | null = null
        /** 자리가 있는 세션의 자리 사각형 (타일). 카드가 매 프레임 이 자리 옆으로 따라간다 */
        let seatRects = new Map<string, Rect>()
        const setHovered = (id: string | null) => {
          hoveredDeskId = id
          setHoveredSeatId(id)
          updateOverlays()
        }
        art.onRecolorLoaded = () => {
          if (!isDisposed) redraw()
        }

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
          if (seat) moveToRect(seat, true)
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
          // 다시 그린 사이 사라진 자리는 pointerout 이 안 올 수 있어 사무실을 떠나면 비운다
          if (hoveredDeskId) setHovered(null)
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
          seatRects = new Map(
            layout.seated.map((session) => {
              const { x, y, w, h } = layout.seats.get(session.id)!
              return [session.id, { x, y, w, h }]
            }),
          )
          map.w = PAD_X + layout.right * TILE + Math.ceil(app.screen.width / zoom)
          // 띠는 늘 내용(그룹·섬·Focus Zone) 아래 끝 + 1타일. 바닥 격자에 맞는다
          const streetY = PAD_Y + (layout.bottom + 1) * TILE
          map.h = streetY + OFF_DUTY_HEIGHT + Math.ceil(app.screen.height / zoom / TILE) * TILE
          const now = Date.now()
          drawnPhase = dayPhaseOf(new Date(now))
          drawnDozing = dozingKey(sessions, now)
          dotTextResolution = zoom / DOT_SCALE
          world.addChild(drawDotBackground(map.w, map.h, art, drawnPhase))
          // 끄는 그룹·섬이 띠를 지날 때 가려지지 않게 바닥 바로 위에 둔다
          const street = drawDotOffDuty(map.w, drawnPhase, art)
          street.y = streetY
          world.addChild(street)
          clampPan()
          /** 팀마다 섬 컨테이너 밖에 그린 것 (칸막이 블록 줄). 끌 때 같이 옮긴다 */
          const teamViews = new Map<string, Container[]>()
          const addTeamView = (teamId: string, container: Container) => teamViews.set(teamId, [...(teamViews.get(teamId) ?? []), container])
          /** 그 팀들의 자리 그림·클릭 영역·자리 위 층 (끌 때 같이 옮긴다) */
          const deskViewsOf = (teamIds: Set<string>) => [
            ...[...teamIds].flatMap((id) => teamViews.get(id) ?? []),
            ...layout.seated.flatMap((s) => {
              const parts = s.teamId && teamIds.has(s.teamId) ? desks.get(s.id) : undefined
              return parts ? [parts.hit, parts.overlay.container] : []
            }),
          ]
          for (const area of layout.groupAreas) {
            const onEdit = () => {
              if (!isDragged) latest.current.onEditGroup(area.group)
            }
            const parts = drawDotGroup(area, onEdit, art)
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
              return seat ? [`${seat.x},${seat.y}`] : []
            }),
          )
          world.addChild(drawDotZone(layout.lobby, layout.booths, art, occupied))
          for (const island of layout.islands) {
            const { team } = island
            const onEdit = () => {
              if (!isDragged) latest.current.onEditTeam(team)
            }
            const parts = drawDotIsland(island, onEdit, art)
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
          // 칸막이 블록 줄: 섬마다 위 줄부터 (섬끼리는 겹치지 않는다). 부스는 자리마다
          const sessionById = new Map(layout.seated.map((session) => [session.id, session]))
          /** 자리 위 층을 블록 줄 기준으로 놓으려고 세션 → 그 자리가 있는 블록 줄 */
          const rowOf = new Map<string, BlockRow>()
          for (const island of layout.islands) {
            for (const row of island.rows) {
              const drawn = drawBlockRow(art, row, sessionById, now)
              for (const animation of drawn.animations) animations.add(animation)
              world.addChild(drawn.container)
              addTeamView(island.team.id, drawn.container)
              for (const id of [row.leadId, ...row.pairs.flatMap((pair) => [pair.top, pair.bottom])]) if (id) rowOf.set(id, row)
            }
          }
          // 클릭 영역(자리 사각형)은 그림 위, 선택 테두리·이름표·상태 아이콘은 그 위 층
          const hitLayer = new Container()
          const overlayLayer = new Container()
          const iconScale = 1 / ZOOM_STEPS[zoomIndex]
          for (const session of layout.seated) {
            const seat = layout.seats.get(session.id)!
            const row = rowOf.get(session.id) ?? null
            if (!row) {
              const booth = drawBoothSeat(session, seat, art, now)
              if (booth.animation) animations.add(booth.animation)
              world.addChild(booth.container)
            }
            const hit = drawSeatHit(seat)
            const overlay = drawSeatOverlay(session, overlayPlaceOf(seat, row, art), session.id === selectedId, art, iconScale)
            if (overlay.icon) animations.add(overlay.icon)
            hit.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(session.id)
            })
            hit.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              setHovered(session.id)
            })
            hit.on('pointerout', () => {
              if (hoveredDeskId === session.id) setHovered(null)
            })
            hitLayer.addChild(hit)
            overlayLayer.addChild(overlay.container)
            desks.set(session.id, { hit, overlay })
            if (session.status === 'needs-approval' && attendanceOf(session) === 'present') {
              approvalDesks.push({ session, rect: seatRects.get(session.id)! })
            }
          }
          world.addChild(hitLayer, overlayLayer)
          updateOverlays()
        }
        redrawRef.current = redraw

        /** 이름표: 배율이 NAME_TAG_ZOOM 이상이면 모든 자리, 아니면 마우스를 올린 자리와 고른 자리만. 그 둘은 맨 위로 (마우스를 올린 것이 가장 위) */
        const updateOverlays = () => {
          const { selectedId } = latest.current
          const isAllShown = ZOOM_STEPS[zoomIndex] >= NAME_TAG_ZOOM
          for (const [id, parts] of desks) parts.overlay.tag.visible = isAllShown || id === selectedId || id === hoveredDeskId
          for (const id of [selectedId, hoveredDeskId]) {
            const container = id ? desks.get(id)?.overlay.container : undefined
            const layer = container?.parent
            if (container && layer) layer.setChildIndex(container, layer.children.length - 1)
          }
        }

        /** 자리 카드: React 가 내용을 그리고 여기서 자리 위(넘치면 아래)에 붙인다. 자리가 화면 밖이면 숨긴다. 값이 바뀔 때만 쓴다 */
        let placedCard = ''
        let placedCardElement: HTMLDivElement | null = null
        const placeCard = () => {
          const card = cardRef.current
          if (!card) return
          // 같은 세션 카드가 다시 마운트되면 새 요소라 처음부터 놓는다
          if (card !== placedCardElement) {
            placedCardElement = card
            placedCard = ''
          }
          const sessionId = card.dataset.sessionId ?? ''
          const rect = seatRects.get(sessionId)
          const width = app.screen.width
          const height = app.screen.height
          let position: Point | null = null
          if (rect) {
            const left = world.x + (PAD_X + rect.x * TILE) * zoom
            const top = world.y + (PAD_Y + rect.y * TILE) * zoom
            const right = left + rect.w * TILE * zoom
            const bottom = top + rect.h * TILE * zoom
            if (right > 0 && left < width && bottom > 0 && top < height) {
              const cardW = card.offsetWidth
              const cardH = card.offsetHeight
              const clamp = (value: number, size: number) => Math.round(Math.max(CARD_MARGIN, Math.min(size - CARD_MARGIN, value)))
              const above = top - CARD_GAP - cardH
              const below = bottom + CARD_GAP
              position = {
                x: clamp((left + right) / 2 - cardW / 2, width - cardW),
                y: clamp(above >= CARD_MARGIN ? above : below + cardH <= height - CARD_MARGIN ? below : above, height - cardH),
              }
            }
          }
          const key = `${sessionId}|${position ? `${position.x},${position.y}` : 'hidden'}`
          if (key === placedCard) return
          placedCard = key
          if (!position) {
            card.style.visibility = 'hidden'
            return
          }
          card.style.transform = `translate(${position.x}px, ${position.y}px)`
          card.style.visibility = 'visible'
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
          placeCard()
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
  const cardSessionId = hoveredSeatId ?? selectedId
  const cardSession = cardSessionId ? sessions.find((session) => session.id === cardSessionId) : undefined
  return (
    <div className="office">
      <div ref={hostRef} className="office-canvas" />
      {cardSession && attendanceOf(cardSession) !== 'off' && (
        // 자리 옆 위치·보이기는 ticker 가 정한다 (처음엔 숨김). 마우스를 가로채지 않는다
        <div key={cardSession.id} ref={cardRef} className="office-card" data-session-id={cardSession.id} style={{ visibility: 'hidden' }}>
          <SeatCard session={cardSession} />
        </div>
      )}
    </div>
  )
}
