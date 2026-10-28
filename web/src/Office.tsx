import { useEffect, useRef, useState } from 'react'
import { PositionChip } from './PositionChip'
import { nameOf as sessionNameOf, positionOf } from './sessionPosition'
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
import { attendanceOf, offDutyLabel, statusLabel, type Office as OfficeData, type Session, type Team } from './types'
import { remainingCount } from './teamTodos'
import { dotLookOf, type DotCharacter, type DotLook } from './dotCharacter'
import { dotStateOf, loungeLabel, seatPlaceKey, seatPlaceOf, turnEndedAtOf, type DotState } from './dotState'
import { overflowNames, planLounge, type LoungeDirection, type LoungeMeta, type LoungePerson, type LoungePlan } from './lounge'
import { CHARACTER_ATLAS, loadRecolorArt, paintCharacter, type CharacterDirection, type RecolorArt } from './characterArt'
import {
  GROUP_LABEL_H,
  dropGroup,
  dropIsland,
  layoutOffice,
  minGroupDragDelta,
  type BlockRow,
  type GroupArea,
  type Island,
  type OfficeLayout,
  type Point,
  type Rect,
  type Seat,
} from './officeLayout'
import {
  PARTITION_W,
  WALL_BAY_TILES,
  cornerFixtures,
  deskItems,
  groupFixtures,
  loungeFixtures,
  wallFixtures,
  type Fixture,
  type PropSizes,
  type WallFixture,
} from './officeFixtures'
import {
  placeIdOf,
  planStreet,
  streetPlaceKey,
  type Size,
  type StreetDirection,
  type StreetMeta,
  type StreetPlaceId,
  type StreetPlaceMeta,
  type StreetPlan,
  type StreetPropMeta,
  type StreetState,
} from './offDutyStreet'

/**
 * 사무실 그림은 생성 도트 스프라이트(타일 48px, docs/plans/2026-10-22-office-sprites-design.md).
 * world 좌표는 "아트 픽셀"(타일 16px) 단위이고 world 를 DOT_SCALE 배 더 키워(타일 48 화면 px = 1배) 보인다.
 * 스프라이트·이름표·아이콘은 1/DOT_SCALE 로 줄인 하위 컨테이너에 도트 px(48px 타일) 좌표로 그린다 — 배치(officeLayout.ts)·끌기·포커스 계산은 아트 px 그대로다
 */
/**
 * 배율 단계 (타일 48px 기준). 정수 배율(1·2·3)만 도트가 고르고 그 사이 배율은 nearest 라 도트 굵기가 섞인다.
 * 단계는 0.25 배수로만 둔다 — 타일 48px × 배율이 정수여야 타일 경계가 화면 px 에 맞는다
 */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]
/** 마운트할 때 배율 = 1배 */
const DEFAULT_ZOOM_INDEX = ZOOM_STEPS.indexOf(1)
/** 도트 타일(48px) ÷ 아트 타일(16px) */
const DOT_SCALE = 3
const DOT_TILE = 48
/** 책상·의자·칸막이·부스·상태 아이콘·화분, 바닥 타일 corridor·desk-carpet·focus-navy, 자리 안 배치 메타 */
const DOT_PROPS_URL = '/office/office-v5-props.json'
/** 환경 (벽·창밖·그룹 화분) */
const DOT_ENV_URL = '/office/office-v2.json'
/** 데스크존 벽 장식 중 게시판·포스터·액자 (화이트보드·시계·풍경화는 office-v5-props) */
const DOT_WALL_URL = '/office/office-v5-wall.json'
/** 퇴근 거리 (Off Duty 띠의 장소·거리 소품·바닥 타일, 배치 메타 meta.jkCorp.street) */
const DOT_STREET_URL = '/office/office-v6-street.json'
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
  text: 0x2b2f3a,
  /** 공간 라벨(그룹·Lounge) 글자: 바닥에 쓴 진회색 */
  spaceLabel: 0x4a4f5c,
  /** 남색 Focus Zone 바닥 위 공간 라벨 글자 */
  spaceLabelOnNavy: 0xd9dff0,
  /** 팀 명판 테두리 */
  plateLine: 0xc3c7d1,
  /** 팀 명판 인원 수·파트 worktree 브랜치·남은 것이 없는 팀 TODO 아이콘 */
  labelMuted: 0x7a7f8e,
  /** 팀 TODO 버튼의 남은(미완료) 개수 배지 */
  todoBadge: 0xe8620c,
  partLabel: 0x5f6573,
  /** 끌 수 있는 라벨에 마우스를 올렸을 때의 테두리 */
  labelHover: 0x8f97a8,
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
  /** 퇴근 거리의 "+N" 을 누름: 왼쪽 목록의 Off Duty 를 펼쳐 보인다 */
  onShowOffDutyList: () => void
  /** 그룹 이름표를 끌어 놓음. 안의 팀들도 같은 만큼 옮긴다 */
  onMoveGroup: (groupId: string, position: { x: number; y: number }) => void
  /** 팀 섬을 끌어 놓음 */
  onMoveTeam: (teamId: string, anchor: { groupId: string; x: number; y: number }) => void
  onEditTeam: (team: Team) => void
  /** 팀 명판 옆 TODO 버튼을 누름: 그 팀의 TODO 모달을 연다 */
  onOpenTeamTodos: (teamId: string) => void
}

/** world 아트 픽셀 단위 글자(승인 화살표 배지·툴팁)의 해상도 = world 가 가장 크게 커질 때의 배율 9 (3배 × DOT_SCALE). 그래야 흐리지 않다 */
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

/** 이 PC 시각의 시간대. 창밖(위쪽 벽)과 Off Duty 띠만 바뀌고 사무실 안 색은 그대로 (띠의 색은 v6 메타 street.phases) */
type DayPhase = 'morning' | 'day' | 'dusk' | 'night'

/** 아침 6~9시, 낮 9~17시, 노을 17~19시, 밤 19~6시 */
function dayPhaseOf(date: Date): DayPhase {
  const hour = date.getHours()
  return hour >= 6 && hour < 9 ? 'morning' : hour >= 9 && hour < 17 ? 'day' : hour >= 17 && hour < 19 ? 'dusk' : 'night'
}

// ---------- 그룹 ----------

/** 끌 수 있는 라벨: 그룹 라벨은 그룹(안의 섬과 같이), 팀 명판은 섬을 옮긴다 */
interface DragLabel {
  /** 끌기 손잡이 (hitArea = 라벨 영역) */
  sign: Container
  /** 마우스를 올렸을 때·끄는 동안 보이는 테두리 (평소 숨김) */
  hover: Graphics
}

interface GroupParts extends DragLabel {
  container: Container
}

interface IslandParts extends DragLabel {
  container: Container
  /** 명판 오른쪽 TODO 버튼과 마우스를 올렸을 때의 테두리 */
  todoButton: Container
  todoHover: Graphics
}

// ---------- 자리 단위 ----------

interface SeatParts {
  /** 자리 사각형 = 클릭 영역 (그림은 블록 줄·부스 컨테이너에 있다) */
  hit: Container
  /** 모든 자리 위 층에 둔 선택 테두리·상태 아이콘 (끌 때 같이 옮긴다) */
  overlay: SeatOverlay
}

interface SeatOverlay {
  container: Container
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
  /** 인물 셀 크기·발 기준선·anchor x. 인물 아틀라스에만 있다 */
  spec?: { cell: [number, number]; baseline: number; anchorX: number }
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
  /** 책상 위 소품 프레임 이름 (prop/item-*) */
  items?: string[]
  /** 라운지 자리 (원탁·소파·안락의자). 없는 옛 판이면 라운지에 간 사람은 모두 "+N" */
  lounge?: LoungeMeta
}

interface DotArt {
  /** 방향별 인물 (office-v5-down·up·right). left 는 right 를 뒤집어 그린다 */
  people: Record<CharacterDirection, Spritesheet>
  /** 인물 프리셋 (정면 아틀라스의 목록. 세 방향 모두 같은 인물) */
  characters: DotCharacter[]
  /** 책상·의자·칸막이·부스·아이콘·화분 (office-v5-props) */
  props: Spritesheet
  propsMeta: PropsSheetMeta
  /** office-v5-props 소품 크기 (prop/ 뺀 이름 → 도트 px). 고정 꾸미기(라운지 탕비 줄)가 쓴다 */
  propSizes: PropSizes
  /** 책상 위 개인 소품 이름 (prop/ 뺀 것, 메타 items 순서) */
  deskItems: string[]
  /** 환경 소품 (office-v2: 그룹 화분) */
  env: Spritesheet
  /** 벽 장식 (office-v5-wall: 게시판·포스터·액자) */
  wall: Spritesheet
  /** 퇴근 거리 소품 (office-v6-street) */
  street: Spritesheet
  /** 퇴근 거리 배치 (meta.jkCorp.street) */
  streetMeta: StreetMeta
  /** 퇴근 거리 소품 메타: 불빛 그림·집 창·카페 의자 높이 */
  streetProps: Record<string, StreetPropMeta>
  /** 퇴근 거리 소품 크기 (프레임 이름 → 도트 px) */
  streetSizes: Record<string, Size>
  /** 반복 타일: office-v2 (벽·창밖 4시간대) + office-v5-props (통로·데스크존 카펫·Focus Zone 남색 카펫) + office-v6-street (보도·연석·잔디) */
  tiles: Record<string, { texture: Texture; meta: DotTileMeta }>
  /** 방향별 인물 머리·윗옷 색 바꾸기. 정면은 처음에 읽고, 뒷모습·옆모습은 고른 색이 있는 자리가 생길 때 읽는다 (읽는 중·실패면 기본색) */
  recolor: Map<CharacterDirection, RecolorArt | 'loading' | 'failed'>
  /** 뒷모습·옆모습 색 바꾸기를 다 읽으면 부른다 (다시 그리기) */
  onRecolorLoaded: () => void
  /** 색을 바꾼 인물 프레임: `방향|인물|머리|윗옷` → 프레임 이름 → 텍스처. 처음 그릴 때 만들고 계속 쓴다 */
  recolored: Map<string, Record<string, Texture>>
  /** 퇴근 거리 창 얼굴 (정면 idle 을 창만큼 자른 프레임들): `인물|머리|윗옷|원본 source|자른 곳` → 텍스처 */
  faces: Map<string, Texture[]>
  /** 라운지 사람 위에 덮는 소품 조각: `소품|자른 곳` → 텍스처 (창 얼굴과 같은 이유로 한 번 만든다) */
  fronts: Map<string, Texture>
}

const DIRECTIONS: CharacterDirection[] = ['down', 'up', 'right']
/** office-v2 에서 쓰는 반복 타일: 벽·창밖 4시간대 */
const ENV_TILES = /^(wall|view-.+)$/

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
  const [[down, up, right], props, env, wall, street, recolor] = await Promise.all([
    Promise.all(DIRECTIONS.map((direction) => Assets.load<Spritesheet>(`/office/${CHARACTER_ATLAS[direction]}.json`))),
    loadSheetUncached(DOT_PROPS_URL),
    Assets.load<Spritesheet>(DOT_ENV_URL),
    Assets.load<Spritesheet>(DOT_WALL_URL),
    Assets.load<Spritesheet>(DOT_STREET_URL),
    loadRecolorArt('down').catch((error: unknown) => {
      console.error('도트 인물 색 바꾸기를 읽지 못해 기본색으로 그린다', error)
      return null
    }),
  ])
  const metaOf = <T = DotSheetMeta,>(sheet: Spritesheet) => (sheet.data.meta as unknown as { jkCorp: T }).jkCorp
  // office-v2 의 바닥·그룹·섬·Focus Zone·보도 타일은 office-v5-props·v6 타일로 바뀌어 읽지 않는다
  const streetSheetMeta = metaOf<DotSheetMeta & { props: Record<string, StreetPropMeta>; street: StreetMeta }>(street)
  const tileEntries = await Promise.all(
    [
      ...Object.entries(metaOf(env).tiles).filter(([id]) => ENV_TILES.test(id)),
      ...Object.entries(metaOf(props).tiles),
      ...Object.entries(streetSheetMeta.tiles),
    ].map(
      async ([id, tile]) => [id, { texture: await Assets.load<Texture>(`/office/${tile.image}`), meta: tile }] as const,
    ),
  )
  const people = { down, up, right }
  for (const source of [...[down, up, right, props, env, wall, street].map((sheet) => sheet.textureSource), ...tileEntries.map(([, tile]) => tile.texture.source)]) {
    source.scaleMode = 'nearest'
  }
  const propsMeta = metaOf<PropsSheetMeta>(props)
  const propSizes: PropSizes = {}
  for (const [name, texture] of Object.entries(props.textures)) {
    if (name.startsWith('prop/')) propSizes[name.slice(5)] = { w: texture.width, h: texture.height }
  }
  return {
    people,
    characters: metaOf(down).characters ?? [],
    props,
    propsMeta,
    propSizes,
    deskItems: (propsMeta.items ?? []).map((name) => name.replace(/^prop\//, '')),
    env,
    wall,
    street,
    streetMeta: streetSheetMeta.street,
    streetProps: streetSheetMeta.props,
    streetSizes: Object.fromEntries(Object.entries(street.textures).map(([name, texture]) => [name, { w: texture.width, h: texture.height }])),
    tiles: Object.fromEntries(tileEntries),
    recolor: new Map([['down', recolor ?? 'failed']]),
    onRecolorLoaded: () => {},
    recolored: new Map(),
    faces: new Map(),
    fronts: new Map(),
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

/** 도트 px 로 그리는 하위 컨테이너 (1/DOT_SCALE) */
function dotLayer(): Container {
  const container = new Container()
  container.scale.set(1 / DOT_SCALE)
  return container
}

function dotTiling(art: DotArt, id: string, width: number, height: number): TilingSprite {
  return new TilingSprite({ texture: art.tiles[id].texture, width, height })
}

/** office-v5-props 스프라이트를 왼쪽 위(x, y)에 (자리 안 배치 메타가 왼쪽 위 좌표라서) */
function v5Prop(art: DotArt, texture: Texture | string, x: number, y: number): Sprite {
  const sprite = new Sprite(typeof texture === 'string' ? art.props.textures[`prop/${texture}`] : texture)
  sprite.anchor.set(0)
  sprite.position.set(x, y)
  return sprite
}

/** 고정 꾸미기 소품 하나 (officeFixtures.ts 의 아래 가운데 좌표, 도트 px) */
function fixtureSprite(art: DotArt, fixture: Fixture): Sprite {
  const sheet = fixture.sheet === 'env' ? art.env : fixture.sheet === 'wall' ? art.wall : art.props
  const sprite = new Sprite(sheet.textures[`prop/${fixture.prop}`])
  sprite.anchor.set(0.5, 1)
  sprite.position.set(fixture.x, fixture.y)
  return sprite
}

/** '#rrggbb' → 0xrrggbb */
function hexColor(value: string): number {
  return parseInt(value.slice(1), 16)
}

/** 도트 그림의 외곽선색 (생성 에셋의 1px 진한 외곽선과 같은 쪽) */
const DOT_OUTLINE = 0x2b2a33

/** 벽 장식을 거는 창 칸: 유리 자리(벽 타일 x 8..136, 행은 build.py 메타의 glass)를 벽색으로 메운다 */
const WALL_GLASS_X = 8
const WALL_GLASS_W = 129
const WALL_PANEL = 0xefeae0
const WALL_PANEL_SHADE = 0xd9d3c6
/** 유리 위·아래 진한 창틀 줄 (벽 타일에서 3줄. 기둥 자리에서는 회색이라 이어 메운 벽에는 이 색으로 잇는다) */
const WALL_FRAME_H = 3
const WALL_FRAME = 0x16171a

/**
 * 도트 바닥·벽·창밖. 벽 타일(144×120 = 벽 높이 WALL_H × DOT_SCALE)은 창 유리가 투명이라 그 뒤에 그 시간대 창밖을 깐다.
 * 창밖 타일 폭(432)은 창틀 기둥 간격(144)의 배수라 반복 경계가 늘 기둥 뒤에 숨는다. 창밖은 아래(지평선)를 유리 아래 끝에 맞춘다.
 * 열린 바닥(통로)은 밝은 타일 (48 격자라 바닥 격자와 맞는다). 벽 장식을 거는 창 칸은 유리를 벽색으로 메우고,
 * 이웃한 두 칸이 모두 장식 칸이면 그 사이 기둥도 메워 한 벽으로 잇는다 (창틀 위·아래 줄도 잇는다).
 * 맵 왼쪽 위 벽 앞에 정수기·복합기 코너 (officeFixtures.ts)
 */
function drawDotBackground(widthPx: number, heightPx: number, art: DotArt, phase: DayPhase, wallDecor: WallFixture[]): Container {
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
  const bayWidth = WALL_BAY_TILES * DOT_TILE
  const glassTop = wallSprite.y + glass.y
  // 벽을 다 메운 뒤 장식을 건다 (이은 벽이 이웃 칸 장식을 덮지 않게)
  const panels = new Graphics()
  for (const item of wallDecor) {
    const x0 = item.bay * bayWidth
    const isJoinedRight = wallDecor.some((other) => other.bay === item.bay + 1)
    const panelW = isJoinedRight ? bayWidth + WALL_GLASS_W : WALL_GLASS_W
    panels.rect(x0 + WALL_GLASS_X, glassTop, panelW, glass.h).fill(WALL_PANEL).rect(x0 + WALL_GLASS_X, glassTop, panelW, 3).fill(WALL_PANEL_SHADE)
    if (isJoinedRight) {
      const pillarX = x0 + WALL_GLASS_X + WALL_GLASS_W
      const pillarW = bayWidth - WALL_GLASS_W
      panels
        .rect(pillarX, glassTop - WALL_FRAME_H, pillarW, WALL_FRAME_H)
        .fill(WALL_FRAME)
        .rect(pillarX, glassTop + glass.h, pillarW, WALL_FRAME_H)
        .fill(WALL_FRAME)
    }
  }
  container.addChild(panels)
  for (const item of wallDecor) {
    const x0 = item.bay * bayWidth
    const sprite = fixtureSprite(art, { sheet: item.sheet, prop: item.prop, x: x0 + bayWidth / 2, y: 0 })
    // 유리 자리 세로 가운데
    sprite.y = Math.round(glassTop + glass.h / 2 + sprite.height / 2)
    container.addChild(sprite)
  }
  for (const item of cornerFixtures(PAD_X / TILE)) {
    container.addChild(fixtureSprite(art, { ...item, x: PAD_X * DOT_SCALE + item.x, y: PAD_Y * DOT_SCALE + item.y }))
  }
  return container
}

/** 데스크존·라운지의 낮은 흰 파티션 (위·왼쪽·오른쪽, 아래는 회색 걸레받이) + 외곽선. w·h 는 도트 px */
function dotPartitions(w: number, h: number): Graphics {
  const wall = PARTITION_W
  return (
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
      .stroke({ width: 2, color: DOT_OUTLINE, alignment: 1 })
  )
}

/** 공간(그룹·Focus Zone·Lounge) 라벨·팀 명판·파트 라벨·그룹 TODO 개수 배지 글자 (도트 px). 계층 순 */
const DOT_FONT = { space: 18, team: 14, part: 12, badge: 11 }
/** 그룹·Lounge 라벨 글자 왼쪽 위 (공간 왼쪽 위 기준, 파티션 9 + 그늘 3 안쪽) */
const SPACE_LABEL = { x: 20, y: 16 }

function dotLabel(text: string, size: number, color = COLOR.text): Text {
  return label(text, size, color, undefined, dotTextResolution)
}

/** 라벨 글자 (도트 px). 굵기·자간은 라벨마다. 끌기는 감싼 손잡이가 받는다 — 부모가 interactive 면 Pixi 가 글자도 맞혀 손잡이가 아니라 바닥을 누른 것이 된다 */
function dotLabelText(content: string, size: number, color: number, fontWeight: 'normal' | 'bold' = 'normal', letterSpacing = 0): Text {
  const text = dotLabel(content, size, color)
  text.style.fontWeight = fontWeight
  text.style.letterSpacing = letterSpacing
  text.eventMode = 'none'
  return text
}

/**
 * 도트로 둥근 모서리(바깥 2px 를 깎고 안쪽 모서리에 한 칸 계단) 사각형: 테두리 2px + 안쪽 바탕.
 * 반투명이어도 진해지는 곳이 없게 칸을 겹치지 않게 나눠 칠한다
 */
function dotRoundRect(g: Graphics, x: number, y: number, w: number, h: number, line: number, fill: { color: number; alpha: number }): Graphics {
  return g
    .rect(x + 2, y, w - 4, 2)
    .rect(x + 2, y + h - 2, w - 4, 2)
    .rect(x, y + 2, 2, h - 4)
    .rect(x + w - 2, y + 2, 2, h - 4)
    .rect(x + 2, y + 2, 2, 2)
    .rect(x + w - 4, y + 2, 2, 2)
    .rect(x + 2, y + h - 4, 2, 2)
    .rect(x + w - 4, y + h - 4, 2, 2)
    .fill(line)
    .rect(x + 2, y + 4, w - 4, h - 8)
    .rect(x + 4, y + 2, w - 8, 2)
    .rect(x + 4, y + h - 4, w - 8, 2)
    .fill(fill)
}

/**
 * worktree 파트 라벨의 브랜치 아이콘 (목록 App.tsx WorktreeIcon 과 같은 모양: 왼쪽 위·아래 원과 그 사이 줄기, 오른쪽 위 원에서 줄기 쪽으로 휘어 드는 선).
 * 파트 글자(12 도트 px) 높이. # = 칠하는 도트 px 한 칸
 */
const WORKTREE_ICON = [
  '.##.......',
  '#..#...##.',
  '#..#..#..#',
  '.##...#..#',
  '.#.....##.',
  '.#.....#..',
  '.#...##...',
  '.#.##.....',
  '.##.......',
  '#..#......',
  '#..#......',
  '.##.......',
]

/**
 * 팀 명판 옆 TODO 버튼 아이콘 (목록 App.tsx TodoIcon 과 같은 모양: 체크한 줄 둘 + 빈 상자 줄 하나, 줄마다 오른쪽에 가로선).
 * 팀 명판 글자(14 도트 px)보다 조금 큰 높이
 */
const TODO_ICON = [
  '.....#.........',
  '#...#..########',
  '.#.#...........',
  '..#............',
  '...............',
  '.....#.........',
  '#...#..########',
  '.#.#...........',
  '..#............',
  '...............',
  '####...........',
  '#..#...########',
  '#..#...........',
  '####...........',
]

/** 도트 아이콘(WORKTREE_ICON·TODO_ICON)을 도트 px 사각형으로 찍는다 (정수 배율에서 또렷하게). 이벤트는 받지 않는다 — 라벨 글자(dotLabelText)와 같은 이유 */
function dotPixelIcon(rows: string[], color: number): Graphics {
  const icon = new Graphics()
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') icon.rect(x, y, 1, 1)
  })
  icon.fill(color)
  icon.eventMode = 'none'
  return icon
}

/**
 * 끌 수 있는 라벨의 손잡이: (x, y) 에 w×h 영역(hitArea)과 그 둘레 3px 밖의 옅은 테두리(마우스 올림·끄는 중에만). 내용은 부르는 쪽이 손잡이 안 (0, 0) 기준으로 넣는다
 */
function dragLabel(x: number, y: number, w: number, h: number): DragLabel {
  const sign = new Container()
  sign.position.set(x, y)
  sign.hitArea = new Rectangle(0, 0, w, h)
  sign.eventMode = 'static'
  sign.cursor = 'grab'
  const hover = dotRoundRect(new Graphics(), -3, -3, w + 6, h + 6, COLOR.labelHover, { color: 0xffffff, alpha: 0.45 })
  hover.visible = false
  sign.addChild(hover)
  return { sign, hover }
}

/** 공간 라벨 글자: 상자 없이 바닥에 쓴 굵은 글자 (자간 1) */
function spaceLabelText(content: string, color: number): Text {
  return dotLabelText(content, DOT_FONT.space, color, 'bold', 1)
}

/** TODO 버튼과 팀 명판 손잡이 사이 (도트 px). 둘의 마우스 올림 테두리(3px 밖)가 닿지 않게 */
const TODO_BUTTON_GAP = 8
/** TODO 버튼 흰 판의 아이콘 양옆 (테두리 2 포함, 도트 px) */
const TODO_PLATE_PAD_X = 7
/** 남은 개수 배지 줄마다 양 끝에서 깎는 칸 = 도트 원(지름 16)의 둥근 끝. 줄 수 = 배지 높이. 두 자리 이상은 가운데를 늘려 알약 */
const TODO_BADGE_INSET = [5, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 5]
/** 배지 왼쪽 끝 = 판 오른쪽 끝 − 이 값 (도트 px). 판 오른쪽 여백·테두리에만 걸쳐 아이콘(판 오른쪽 끝 − 8 까지)을 덮지 않는다. 두 자리 이상은 오른쪽으로 늘어난다 */
const TODO_BADGE_OVERLAP = 6
/** 배지 위 끝이 판 위 끝보다 올라오는 높이 (도트 px) */
const TODO_BADGE_RISE = 4

/** 남은 개수 배지: 주황 도트 원(한 자리)·알약(두 자리 이상) + 흰 굵은 숫자. 이벤트는 받지 않는다. w = 배지 폭 (도트 px) */
function dotCountBadge(count: number): { badge: Container; w: number } {
  const badge = new Container()
  badge.eventMode = 'none'
  const digits = dotLabelText(String(count), DOT_FONT.badge, 0xffffff, 'bold')
  const h = TODO_BADGE_INSET.length
  const w = Math.max(h, Math.ceil(digits.width) + 8)
  const shape = new Graphics()
  TODO_BADGE_INSET.forEach((inset, y) => shape.rect(inset, y, w - 2 * inset, 1))
  shape.fill(COLOR.todoBadge)
  digits.position.set(Math.round((w - digits.width) / 2), Math.round((h - digits.height) / 2))
  badge.addChild(shape, digits)
  return { badge, w }
}

/**
 * 도트 그룹(데스크존): 밝은 회색 카펫 + 낮은 흰 파티션(위·왼쪽·오른쪽, 아래는 회색 걸레받이) + 위 이름표 줄의 이름표·큰 화분(고정 꾸미기).
 * 크기는 저장된 w·h 가 아니라 그려지는 영역(섬이 있으면 섬들 + 위 이름표 줄, 없으면 저장 위치의 최소 크기)
 */
function drawDotGroup(area: GroupArea, art: DotArt): GroupParts {
  const { group } = area
  const container = new Container()
  container.position.set(PAD_X + area.x * TILE, PAD_Y + area.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const w = area.w * TILE * DOT_SCALE
  const h = area.h * TILE * DOT_SCALE

  // 라벨: 바닥에 쓴 글자. 손잡이 영역은 글자 둘레 6·3 (왼쪽 위 파티션 안쪽부터)
  const name = spaceLabelText(group.name, COLOR.spaceLabel)
  const signW = Math.ceil(name.width) + 12
  const signH = Math.ceil(name.height) + 6
  const { sign, hover } = dragLabel(SPACE_LABEL.x - 6, SPACE_LABEL.y - 3, signW, signH)
  name.position.set(6, 3)
  sign.addChild(name)

  dot.addChild(dotTiling(art, 'desk-carpet', w, h), dotPartitions(w, h))
  // 큰 화분은 이름표와 겹치면(좁은 그룹·긴 이름) 두지 않는다
  for (const item of groupFixtures(area, sign.x + signW)) dot.addChild(fixtureSprite(art, item))
  dot.addChild(sign)

  container.eventMode = 'static'
  container.cursor = 'grab'
  return { container, sign, hover }
}

/**
 * 도트 팀 섬: 테두리 안쪽에 데스크존 카펫보다 한 단 진한 회색 받침(참고 그림의 블록 받침) + 블록 줄마다 오른쪽 화분 +
 * 파트 구역(옅은 바탕 + 회색 테두리 + 회색 글자 라벨) + 팀 명판 + 그 오른쪽 TODO 버튼. 칸막이 블록(책상·사람)은 drawBlockRow 가 섬 위에 따로 그린다.
 * memberCount = 명판의 인원 수 (목록 팀 카드 배지와 같은 수).
 * TODO 버튼은 명판과 같은 흰 둥근 판(높이 = 명판) 안의 체크리스트 도트 아이콘. 남은(미완료) 것이 있으면 아이콘은 진회색이고
 * 판 오른쪽 위 모서리에 주황 개수 배지, 0 이면 흐린 아이콘만 (캔버스는 마우스 올림 때만 보이기가 어려워 늘 그린다). 누르기는 redraw 가 묶는다
 */
function drawDotIsland(island: Island, memberCount: number, onEdit: () => void, art: DotArt): IslandParts {
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
    // 라벨: 상자 없는 작은 회색 글자. worktree 파트만 이름 왼쪽에 브랜치 아이콘 (목록 파트 소제목과 같다. 브랜치 이름은 안 쓴다)
    const partName = dotLabelText(zone.part.name, DOT_FONT.part, COLOR.partLabel, 'bold')
    dot.addChild(new Graphics().rect(zx, zy, zw, zh).fill({ color: 0xffffff, alpha: 0.25 }).stroke({ width: 2, color: COLOR.partLine, alignment: 1 }), partName)
    let nameX = zx + 10
    if (zone.part.worktree) {
      const icon = dotPixelIcon(WORKTREE_ICON, COLOR.labelMuted)
      icon.position.set(nameX, zy + 8 + Math.round((partName.height - WORKTREE_ICON.length) / 2))
      dot.addChild(icon)
      nameX += WORKTREE_ICON[0].length + 6
    }
    partName.position.set(nameX, zy + 8)
  }
  // 화분 열: 블록 줄마다 오른쪽 끝 칸막이(6) 옆에 큰 화분 (블록 모듈 높이 가운데쯤)
  for (const plant of island.plants) {
    const { x, y } = local(plant)
    dot.addChild(v5Prop(art, 'plant-large', x + 6, y + 40))
  }
  // 명판: 받침 왼쪽 끝에 맞춰 섬 테두리(1타일) 안. 아래 끝이 첫 블록 줄 윗자리 머리·아이콘(섬 y 31~)보다 위
  const name = dotLabelText(island.team.name, DOT_FONT.team, COLOR.text, 'bold')
  const count = memberCount > 0 ? dotLabelText(` · ${memberCount}`, DOT_FONT.team, COLOR.labelMuted) : null
  const plateW = Math.ceil(name.width + (count?.width ?? 0)) + 16
  const plateH = Math.ceil(name.height) + 4
  const { sign, hover } = dragLabel(DOT_TILE - 24, 7, plateW, plateH)
  name.position.set(8, 2)
  count?.position.set(8 + Math.ceil(name.width), 2)
  sign.addChild(dotRoundRect(new Graphics(), 0, 0, plateW, plateH, COLOR.plateLine, { color: 0xffffff, alpha: 1 }), name, ...(count ? [count] : []))
  dot.addChild(sign)

  // TODO 버튼: 명판 오른쪽의 흰 판 + 아이콘 + 배지. 마우스 올림 테두리는 판 둘레 3px 밖, 클릭 영역은 배지까지
  const remaining = remainingCount(island.team)
  const todoPlateW = TODO_ICON[0].length + 2 * TODO_PLATE_PAD_X
  const todoButton = new Container()
  todoButton.position.set(sign.x + plateW + TODO_BUTTON_GAP, sign.y)
  todoButton.eventMode = 'static'
  todoButton.cursor = 'pointer'
  const todoHover = dotRoundRect(new Graphics(), -3, -3, todoPlateW + 6, plateH + 6, COLOR.labelHover, { color: 0xffffff, alpha: 0.45 })
  todoHover.visible = false
  const todoPlate = dotRoundRect(new Graphics(), 0, 0, todoPlateW, plateH, COLOR.plateLine, { color: 0xffffff, alpha: 1 })
  todoPlate.eventMode = 'none'
  const icon = dotPixelIcon(TODO_ICON, remaining > 0 ? COLOR.spaceLabel : COLOR.labelMuted)
  icon.position.set(TODO_PLATE_PAD_X, Math.round((plateH - TODO_ICON.length) / 2))
  todoButton.addChild(todoHover, todoPlate, icon)
  let buttonRight = todoPlateW
  let buttonTop = 0
  if (remaining > 0) {
    const { badge, w: badgeW } = dotCountBadge(remaining)
    badge.position.set(todoPlateW - TODO_BADGE_OVERLAP, -TODO_BADGE_RISE)
    todoButton.addChild(badge)
    buttonRight = Math.max(todoPlateW, badge.x + badgeW)
    buttonTop = badge.y
  }
  todoButton.hitArea = new Rectangle(0, buttonTop, buttonRight, plateH - buttonTop)
  dot.addChild(todoButton)

  container.eventMode = 'static'
  container.cursor = 'grab'
  container.on('pointertap', (event: FederatedPointerEvent) => {
    if (event.detail === 2) onEdit()
  })
  return { container, sign, hover, todoButton, todoHover }
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

  // 라벨 줄(맨 위 1타일) 안. 남색 바닥이라 밝은 글자
  const name = spaceLabelText('Focus Zone', COLOR.spaceLabelOnNavy)
  name.position.set(SPACE_LABEL.x, 12)
  dot.addChild(name)
  return container
}

/** 라운지 바닥 = 통로 타일에 따뜻한 색을 곱한 것 (통로·데스크존과 구분) */
const LOUNGE_FLOOR_TINT = 0xfaf0e2

/** 라운지 사람 위에 덮는 소품 조각 (그 소품 프레임 안 frame). 조합마다 한 번 만든다 */
function frontTexture(art: DotArt, prop: string, frame: Rect): Texture {
  const key = `${prop}|${frame.x},${frame.y},${frame.w},${frame.h}`
  let texture = art.fronts.get(key)
  if (!texture) {
    const base = art.props.textures[`prop/${prop}`]
    texture = new Texture({ source: base.source, frame: new Rectangle(base.frame.x + frame.x, base.frame.y + frame.y, frame.w, frame.h) })
    art.fronts.set(key, texture)
  }
  return texture
}

/**
 * 도트 라운지 (Focus Zone 오른쪽 고정 공간. 끌 수 없다): 따뜻한 바닥 + 데스크존과 같은 낮은 흰 파티션 +
 * 고정 꾸미기(탕비 줄·원탁·소파 띠, officeFixtures.ts 의 loungeFixtures. 아래 끝 y 순) + 왼쪽 위 이름표 (탕비 줄은 그 오른쪽부터).
 * 차례가 끝난 지 30분 넘은 사람(배치는 lounge.ts 의 planLounge)은 소품마다 "소품 → 앉은 사람(자리 y 순), 사람마다 바로 그 자리의 front" 로 그리고,
 * 못 앉은 사람은 이름표 아래 "+N". 선택 테두리는 책상과 같은 초록 사각형. 클릭·마우스 올림은 부르는 쪽이 얹는다
 */
function drawDotLounge(
  lounge: Rect,
  art: DotArt,
  fixtures: Fixture[],
  plan: LoungePlan,
  looks: Map<string, DotLook>,
  selectedId: string | null,
): { container: Container; animations: AnimatedSprite[]; plate: Rect | null } {
  const container = new Container()
  container.position.set(PAD_X + lounge.x * TILE, PAD_Y + lounge.y * TILE)
  const dot = dotLayer()
  container.addChild(dot)
  const w = lounge.w * DOT_TILE
  const h = lounge.h * DOT_TILE
  const floor = dotTiling(art, 'corridor', w, h)
  floor.tint = LOUNGE_FLOOR_TINT
  dot.addChild(floor, dotPartitions(w, h))
  const animations: AnimatedSprite[] = []
  fixtures.forEach((item, index) => {
    dot.addChild(fixtureSprite(art, item))
    for (const seat of plan.seats) {
      const look = seat.fixture === index ? looks.get(seat.sessionId) : undefined
      if (!look) continue
      const sprite = seatedPersonSprite(art, look, seat.dir, seat.state, seat.sessionId)
      sprite.position.set(seat.x, seat.y)
      dot.addChild(sprite)
      animations.push(sprite)
      for (const front of seat.front) dot.addChild(v5Prop(art, frontTexture(art, item.prop, front.frame), front.at.x, front.at.y))
    }
  })
  // 그룹 라벨과 같은 자리·모양
  const name = spaceLabelText('Lounge', COLOR.spaceLabel)
  name.position.set(SPACE_LABEL.x, SPACE_LABEL.y)
  dot.addChild(name)
  const plate = plan.more ? drawMorePlate(dot, plan.more.count, () => plan.more!) : null
  const selected = selectedId ? plan.figures.get(selectedId) : undefined
  if (selected) {
    // 책상 자리·퇴근 거리와 같은 선택 테두리 (아트 px)
    const outline = new Graphics()
      .rect(selected.x / DOT_SCALE - 2, selected.y / DOT_SCALE + 1, selected.w / DOT_SCALE + 4, selected.h / DOT_SCALE - 2)
      .stroke({ width: 1, color: COLOR.select })
    outline.eventMode = 'none'
    container.addChild(outline)
  }
  return { container, animations, plate }
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
 * 도트 하위 컨테이너(1/DOT_SCALE) 글자 해상도 = 지금 배율 (ZOOM_STEPS 의 값). redraw 가 배율을 바꾼 뒤 정한다.
 * 최대 배율(3)로 고정하면 1배에서 3배 축소돼 12px 한글의 가는 획이 빠진다
 */
let dotTextResolution = 1

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
/** 부스 명패 (부스 그림 왼쪽 위 기준, 책상 앞 가장자리 오른쪽 끝) */
const BOOTH_PLATE: Rect = { x: 80, y: 52, w: 22, h: 9 }

/** 책상에 사람이 앉아 있는 세션 (휴식·라운지에 간 사람은 빈 의자) */
function isSeatedPerson(session: Session | undefined, now: number): session is Session {
  return session !== undefined && attendanceOf(session) !== 'break' && seatPlaceOf(session, now) === 'desk'
}

function isScreenOn(session: Session | undefined, now: number): boolean {
  return isSeatedPerson(session, now) && session.status === 'working'
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

/** 세션이 앉을 인물과 색: 사용자가 고른 인물(아틀라스에 있을 때만)과 색 → 세션 ID 해시로 고른 프리셋 (지시자는 리더 풀) */
function lookOf(session: Session, art: DotArt): DotLook {
  return dotLookOf(session, art.characters) ?? { id: session.role === 'lead' ? 'lead' : 'member', hair: null, top: null }
}

/** 책상에 앉은 사람 (anchor 0). 휴식·라운지에 갔으면 null */
function personSprite(session: Session, direction: CharacterDirection, art: DotArt, now: number): AnimatedSprite | null {
  if (!isSeatedPerson(session, now)) return null
  const look = lookOf(session, art)
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
 * 아랫자리 사람 → 아랫자리 의자. 윗사람은 모듈 뒤(손만 상판 위), 아랫사람·의자는 모듈 앞. 사람 없는 자리(빈 자리·휴식·라운지에 감)는 의자만
 * (아랫자리는 책상 쪽으로 밀어 넣은 emptyChair). 명패는 그 위. 클릭은 자리 사각형(hit)이 받고 아이콘은 자리 위 층(drawSeatOverlay)
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
  const leadModule = row.leadId ? (isScreenOn(lead, now) ? block.lead.module : block.lead.moduleOff) : null
  const steps: Record<string, () => void> = {
    'top.chair': () => eachPair((_, dx) => add('prop/chair-down', block.pair.top.chair, dx)),
    'top.char': () => eachPair((pair, dx) => addPerson(sessionOf(pair.top), 'down', block.pair.top.char, dx)),
    'lead.chair': () => {
      if (row.leadId) add('prop/chair-right', block.lead.chair)
    },
    module: () => {
      eachPair((pair, dx) => add(isScreenOn(sessionOf(pair.bottom), now) ? block.pair.module : block.pair.moduleOff, [0, block.moduleY], dx))
      // 팀원 책상 위 개인 소품 (officeFixtures.ts). 휴식 중·라운지에 가도 남고 빈 자리에는 없다. 아랫자리 것은 뒤에 그리는 아랫사람이 앞에 선다
      eachPair((pair, dx) => {
        for (const side of ['top', 'bottom'] as const) {
          const session = sessionOf(pair[side])
          if (!session) continue
          for (const item of deskItems(session.id, side, session.kind === 'external', art.deskItems)) {
            dot.addChild(fixtureSprite(art, { ...item, x: item.x + dx }))
          }
        }
      })
    },
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
      if (!leadModule || !isSeatedPerson(lead, now)) return
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
        add('prop/chair-up', isSeatedPerson(sessionOf(pair.bottom), now) ? seat.chair : (seat.emptyChair ?? seat.chair), dx)
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

/** 앉은 부스 하나 (부스·사람·의자·명패). 클릭은 자리 사각형(hit), 아이콘은 자리 위 층 */
function drawBoothSeat(session: Session, seat: Seat, art: DotArt, now: number): { container: Container; animation: AnimatedSprite | null } {
  const container = new Container()
  container.position.set(PAD_X + seat.x * TILE, PAD_Y + seat.y * TILE)
  container.eventMode = 'none'
  const dot = dotLayer()
  container.addChild(dot)
  const animation = personSprite(session, 'up', art, now)
  dot.addChild(drawBoothArt(art, animation, isScreenOn(session, now), plateOf(session)))
  return { container, animation }
}

/** 자리 위 층에 놓는 자리 (origin 기준): 아이콘 왼쪽 위 (도트 px), 선택 테두리 = 자리 사각형 (아트 px) */
interface OverlayPlace {
  /** 아트 px 절대 위치 (블록 줄 원점 또는 부스 자리 왼쪽 위) */
  origin: Point
  icon: At
  rect: Rect
}

/**
 * 자리 위 층의 선택 테두리·상태 아이콘 (이벤트 없음). 아이콘은 배율과 관계없이 화면 18×15 px (iconScale = 1 / 지금 배율 → 화면에 원본 픽셀 1:1).
 * 선택 테두리도 여기 둔다 — 자리 그림은 블록 줄 단위라 자리 사각형이 따로 없다. 이름은 자리 카드(SeatCard)로 본다.
 * isAway = 자리에 사람이 없음 (휴식·라운지에 감. 아이콘 없음)
 */
function drawSeatOverlay(session: Session, place: OverlayPlace, isSelected: boolean, isAway: boolean, art: DotArt, iconScale: number): SeatOverlay {
  const container = new Container()
  container.position.set(place.origin.x, place.origin.y)
  container.eventMode = 'none'
  const dot = dotLayer()
  container.addChild(dot)
  const { rect } = place
  if (isSelected) container.addChild(new Graphics().rect(rect.x - 2, rect.y + 1, rect.w + 4, rect.h - 2).stroke({ width: 1, color: COLOR.select }))

  // 상태 아이콘: 승인 대기 빨간 "!", 내 차례 말풍선, 작업 중 점 셋 (휴식·라운지에 간 자리는 없다)
  const icons = art.propsMeta.icons
  let icon: AnimatedSprite | null = null
  const iconTextures = isAway
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
  return { container, icon: iconTextures && iconTextures.length > 1 ? icon : null }
}

/**
 * 자리 위 층에 놓을 자리. 블록 자리는 블록 줄 원점 기준(메타 block 의 아이콘 자리, 짝 i 는 x + 96·i), 부스는 그 자리 왼쪽 위 기준(메타 seat.booth)
 */
function overlayPlaceOf(seat: Seat, row: BlockRow | null, art: DotArt): OverlayPlace {
  const seatOrigin = { x: PAD_X + seat.x * TILE, y: PAD_Y + seat.y * TILE }
  if (!row) {
    return { origin: seatOrigin, icon: art.propsMeta.seat.booth.icon, rect: { x: 0, y: 0, w: seat.w * TILE, h: seat.h * TILE } }
  }
  const block = art.propsMeta.block
  const origin = { x: PAD_X + row.x * TILE, y: PAD_Y + row.y * TILE }
  const rect = { x: seatOrigin.x - origin.x, y: seatOrigin.y - origin.y, w: seat.w * TILE, h: seat.h * TILE }
  if (seat.dir === 'right') return { origin, icon: block.lead.icon, rect }
  const dx = (seat.x - row.x) * DOT_TILE
  const side = seat.dir === 'down' ? block.pair.top : block.pair.bottom
  return { origin, icon: [side.icon[0] + dx, side.icon[1]], rect }
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

/**
 * 마우스를 올린 것: 자리·라운지·퇴근한 사람(세션) 또는 퇴근 거리·라운지의 "+N". rectKey·key = 카드를 붙일 사각형 (cardRects 키):
 * 책상은 `desk:<세션 ID>`, 라운지·거리의 사람은 세션 ID (라운지에 간 세션은 책상과 라운지 둘 다 카드가 뜬다)
 */
type HoveredCard = { kind: 'session'; sessionId: string; rectKey: string } | { kind: 'more'; key: string; title: string; lines: string[] }

/**
 * 자리 카드 내용. 퇴근 세션은 이름(목록 Off Duty 줄처럼 "팀명 · 이름"), 퇴근 이유 · 시각(목록과 같은 offDutyLabel), 거리의 장소
 */
function SeatCard({ session, teamName, placeLabel }: { session: Session; teamName: string | null; placeLabel: string | null }) {
  if (attendanceOf(session) === 'off') {
    const name = sessionNameOf(session)
    const label = session.offDuty ? offDutyLabel(session.offDuty, Date.now()) : null
    return (
      <>
        <div className="office-card-head">
          <span className="status-dot off" />
          <b>
            {teamName ? `${teamName} · ` : ''}
            <PositionChip position={positionOf(session)} />
            {name}
          </b>
        </div>
        <div className="office-card-facts">
          {label && <span className={label.isError ? 'office-card-error' : undefined}>{label.text}</span>}
          {label && placeLabel && ' · '}
          {placeLabel}
        </div>
      </>
    )
  }
  const isOnBreak = attendanceOf(session) === 'break'
  const role = session.role === 'lead' ? (session.partId !== null ? 'Part lead' : 'Lead') : null
  const facts = [isOnBreak ? 'Break' : statusLabel[session.status], role, session.kind === 'external' ? 'External session' : null].filter(Boolean)
  const lounge = loungeLabel(session, Date.now())
  const text = session.lastAssistantText ?? ''
  return (
    <>
      <div className="office-card-head">
        <span className={`status-dot ${isOnBreak ? '' : session.status}`} />
        <b>
          <PositionChip position={positionOf(session)} />
          {sessionNameOf(session)}
        </b>
      </div>
      <div className="office-card-facts">{facts.join(' · ')}</div>
      {lounge && <div className="office-card-facts">{lounge}</div>}
      {!isOnBreak && session.status === 'needs-approval' && <div className="office-card-tool">Tool: {session.pendingTool ?? '?'}</div>}
      {!isOnBreak && (session.status === 'my-turn' || session.status === 'done') && text && (
        <p className="office-card-text">{text.length > CARD_TEXT_MAX_CHARS ? `${text.slice(0, CARD_TEXT_MAX_CHARS).trimEnd()}…` : text}</p>
      )}
    </>
  )
}

// ---------- 건물 밖 ----------

/** Off Duty 띠 높이 (아트 px) = v6 메타 street.band 240 도트 px */
const OFF_DUTY_HEIGHT = 5 * TILE
/** 가로등 아래 바닥의 옅은 빛 (노을·밤) */
const LAMP_LIGHT = 0xffd27a
const STAR = 0xdfe6f5
/** 공원 잔디 테두리 */
const GRASS_EDGE = 0x4f7a3a
/** "+N" 명판 높이 (도트 px) */
const MORE_PLATE_H = 18

/** 퇴근한 지 몇 분. 퇴근 기록이 없는 옛 서버 응답은 마지막 활동 시각, 그것도 없으면 오래된 것으로 (집) */
function offDutyMinutesOf(session: Session, now: number): number {
  const at = Date.parse(session.offDuty?.endedAt ?? session.lastAt ?? '')
  return Number.isFinite(at) ? (now - at) / 60_000 : Infinity
}

/** 퇴근 세션과 퇴근한 지 몇 분 */
function streetPeopleOf(sessions: Session[], now: number): { id: string; minutes: number }[] {
  return sessions.filter((session) => attendanceOf(session) === 'off').map((session) => ({ id: session.id, minutes: offDutyMinutesOf(session, now) }))
}

/** 거리·라운지에 앉은 사람 (그 방향 아틀라스 anchor = 정면·뒷모습 발 가운데, 옆모습 등). left 는 옆모습을 뒤집는다 */
function seatedPersonSprite(art: DotArt, look: DotLook, dir: LoungeDirection, state: DotState, seed: string): AnimatedSprite {
  const direction = dir === 'left' ? 'right' : dir
  const { textures, fps } = dotFrames(art, direction, look, state)
  const sprite = new AnimatedSprite({ textures, autoUpdate: false })
  const spec = (art.people[direction].data.meta as unknown as { jkCorp: DotSheetMeta }).jkCorp.spec
  if (spec) sprite.anchor.set(spec.anchorX / spec.cell[0], spec.baseline / spec.cell[1])
  if (dir === 'left') sprite.scale.x = -1
  if (textures.length > 1) {
    sprite.animationSpeed = fps / 60
    // 모두 같은 박자로 움직이지 않게 세션마다 시작 프레임을 다르게
    sprite.gotoAndPlay(parseInt(seed.slice(0, 2), 16) % textures.length || 0)
  }
  return sprite
}

/** 창 얼굴: 정면 프레임마다 crop 만큼 자른 텍스처 (조합마다 한 번 만든다 — 텍스처는 원본 source 에 리스너를 남겨 다시 그릴 때마다 만들면 쌓인다) */
function faceTextures(art: DotArt, look: DotLook, state: StreetState, crop: Rect): Texture[] {
  const { textures } = dotFrames(art, 'down', look, state)
  const key = `${look.id}|${look.hair}|${look.top}|${state}|${textures[0].source.uid}|${crop.x},${crop.y},${crop.w},${crop.h}`
  let faces = art.faces.get(key)
  if (!faces) {
    faces = textures.map(({ source, frame }) => new Texture({ source, frame: new Rectangle(frame.x + crop.x, frame.y + crop.y, crop.w, crop.h) }))
    art.faces.set(key, faces)
  }
  return faces
}

/** 가로등·공원등 아래 바닥의 옅은 빛 (도트 계단 타원) */
function lampLight(prop: string, x: number, y: number, front: number): Graphics {
  const isStreetLamp = prop === 'prop/street-lamp'
  const cx = isStreetLamp ? x + 19 : x
  const cy = Math.min(y, front) - 2
  const rx = isStreetLamp ? 36 : 26
  const ry = 8
  const g = new Graphics()
  for (let dy = -ry; dy <= ry; dy += 2) {
    const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2))
    g.rect(cx - half, cy + dy, half * 2, 2)
  }
  return g.fill({ color: LAMP_LIGHT, alpha: 0.28 })
}

/** "+N" 흰 명판 (둥근 모서리 4 · 진한 외곽선 1 · 굵은 12 글자, 도트 px). place = 명판 크기 → 왼쪽 위. 퇴근 거리·라운지가 같이 쓴다 */
function drawMorePlate(layer: Container, count: number, place: (w: number, h: number) => Point): Rect {
  const text = dotLabelText(`+${count}`, DOT_FONT.part, DOT_OUTLINE, 'bold')
  const w = Math.ceil(text.width) + 12
  const rect = { ...place(w, MORE_PLATE_H), w, h: MORE_PLATE_H }
  text.position.set(rect.x + 6, rect.y + 1)
  layer.addChild(new Graphics().roundRect(rect.x, rect.y, rect.w, rect.h, 4).fill(0xffffff).stroke({ width: 1, color: DOT_OUTLINE, alignment: 1 }), text)
  return rect
}

/** 퇴근 거리 "+N" 명판 (도트 px, 띠 왼쪽 위 기준) */
interface StreetPlate {
  place: StreetPlaceId
  count: number
  rect: Rect
}

/**
 * 도트 Off Duty 퇴근 거리 (도트 px, 띠 높이 OFF_DUTY_HEIGHT 의 3배. 배치는 offDutyStreet.ts 의 planStreet): 층은 하늘 → 바닥(보도·연석, 공원 잔디) →
 * back(장소 back·높은 채우기·집) → front(장소 front·사람·after, 나머지 채우기) → "+N"·"Off Duty" 이름표.
 * 시간대 색조는 스프라이트마다 (불빛 그림·불 켜진 창의 얼굴·하늘·이름표는 색조 없이). 클릭·마우스 올림은 부르는 쪽이 얹는다
 */
function drawDotStreet(
  art: DotArt,
  plan: StreetPlan,
  width: number,
  phase: DayPhase,
  looks: Map<string, DotLook>,
): { container: Container; animations: AnimatedSprite[]; plates: StreetPlate[] } {
  const meta = art.streetMeta
  const look = meta.phases[phase]
  const tint = hexColor(look.tint)
  const { front } = meta
  const container = new Container()
  const dot = dotLayer()
  container.addChild(dot)
  const w = width * DOT_SCALE
  const sky = new Graphics()
  const ground = new Container()
  const back = new Container()
  const fore = new Container()
  const top = new Container()
  dot.addChild(sky, ground, back, fore, top)
  const animations: AnimatedSprite[] = []

  // 하늘: skyTop → skyBottom 을 skySteps 단으로 (보도 위 끝까지), 밤엔 별
  const sidewalkY = front + meta.sidewalkTop
  const curbY = front + meta.curbTop
  const skyTop = hexColor(look.skyTop)
  const skyBottom = hexColor(look.skyBottom)
  for (let i = 0; i < meta.skySteps; i++) {
    const t = i / Math.max(1, meta.skySteps - 1)
    const mix = (shift: number) => Math.round(((skyTop >> shift) & 255) * (1 - t) + ((skyBottom >> shift) & 255) * t)
    sky.rect(0, Math.round((sidewalkY * i) / meta.skySteps), w, Math.ceil(sidewalkY / meta.skySteps) + 1).fill((mix(16) << 16) | (mix(8) << 8) | mix(0))
  }
  if (look.hasStars) for (let x = 40; x < w - 6; x += 97) sky.rect(x, 22 + ((x * 13) % 70), 3, 3).fill(STAR)
  const tiled = (id: string, x: number, y: number, tileW: number, tileH: number) => {
    const sprite = dotTiling(art, id, tileW, tileH)
    sprite.position.set(x, y)
    sprite.tint = tint
    ground.addChild(sprite)
  }
  tiled(meta.tiles.sidewalk, 0, sidewalkY, w, curbY - sidewalkY)
  tiled(meta.tiles.curb, 0, curbY, w, meta.band - curbY)

  /** 소품 (아래 가운데 anchor). 불빛 메타가 있으면 노을·밤에 불빛 그림을 색조 없이 바로 위에 */
  const prop = (name: string, x: number, y: number, layer: Container, isFlipped = false) => {
    const id = name.startsWith('prop/') ? name : `prop/${name}`
    const add = (frame: string, isTinted: boolean) => {
      const sprite = new Sprite(art.street.textures[frame])
      sprite.anchor.set(0.5, 1)
      sprite.position.set(x, y)
      if (isTinted) sprite.tint = tint
      if (isFlipped) sprite.scale.x = -1
      layer.addChild(sprite)
    }
    add(id, true)
    const glow = art.streetProps[id]?.glow
    if (glow && look.isLit) {
      add(glow, false)
      if (id.endsWith('lamp')) ground.addChild(lampLight(id, x, y, front))
    }
  }
  const items = (list: { prop: string; x: number; y: number }[] | undefined, x0: number, layerOf: (y: number) => Container) => {
    for (const item of list ?? []) prop(item.prop, x0 + item.x, front + item.y, layerOf(item.y))
  }
  const person = (sessionId: string | null, dir: StreetDirection, state: StreetState, x: number, y: number) => {
    const personLook = sessionId ? looks.get(sessionId) : undefined
    if (!sessionId || !personLook) return
    const sprite = seatedPersonSprite(art, personLook, dir, state, sessionId)
    sprite.position.set(x, y)
    sprite.tint = tint
    fore.addChild(sprite)
    animations.push(sprite)
  }
  const face = meta.places.find((place) => place.id === 'home')?.face?.state ?? 'idle'

  for (const piece of plan.pieces) {
    if (piece.kind === 'filler') {
      // 채우기 중 높은 것(가로수·화단)은 건물과 같은 back 층
      items(piece.items, piece.x, (y) => (y < -20 ? back : fore))
      continue
    }
    if (piece.kind === 'house') {
      // 창 안 색 → 집(유리가 뚫림) → 창 사람. 노을·밤엔 사람 있는 창만 불이 켜지고 그 얼굴은 색조 없이 (방 불빛)
      for (const window of piece.windows) {
        const color = !look.isLit ? meta.window.day : window.sessionId ? meta.window.lit : meta.window.dark
        back.addChild(new Graphics().rect(window.glass.x, window.glass.y, window.glass.w, window.glass.h).fill(hexColor(color)))
      }
      prop(piece.prop, piece.x, piece.bottom, back)
      for (const window of piece.windows) {
        const personLook = window.sessionId ? looks.get(window.sessionId) : undefined
        if (!window.sessionId || !personLook) continue
        const textures = faceTextures(art, personLook, face, window.crop)
        const sprite = new AnimatedSprite({ textures, autoUpdate: false })
        sprite.anchor.set(0)
        sprite.position.set(window.at.x, window.at.y)
        if (!look.isLit) sprite.tint = tint
        if (textures.length > 1) {
          sprite.animationSpeed = dotFrames(art, 'down', personLook, face).fps / 60
          sprite.gotoAndPlay(parseInt(window.sessionId.slice(0, 2), 16) % textures.length || 0)
        }
        back.addChild(sprite)
        animations.push(sprite)
      }
      continue
    }
    const { place, x: x0, seats } = piece
    if (place.ground === 'grass') {
      const grassW = place.w ?? 0
      tiled(meta.tiles.grass, x0, sidewalkY + 2, grassW, curbY - sidewalkY - 4)
      const edge = new Graphics()
        .rect(x0, sidewalkY + 1, grassW, 1)
        .rect(x0, curbY - 3, grassW, 1)
        .rect(x0 - 1, sidewalkY + 1, 1, curbY - sidewalkY - 3)
        .rect(x0 + grassW, sidewalkY + 1, 1, curbY - sidewalkY - 3)
        .fill(GRASS_EDGE)
      edge.tint = tint
      ground.addChild(edge)
    }
    items(place.back, x0, () => back)
    items(place.front, x0, () => fore)
    if (place.tables) {
      // 카페: 탁자마다 [자리마다 의자(앉은 사람 엉덩이 높이) → 사람] → 탁자 (무릎이 상판 뒤로 숨는다)
      place.tables.forEach((table, index) => {
        for (const seat of seats) {
          if (seat.table !== index) continue
          if (seat.chair) prop(seat.chair.prop, seat.chair.x, seat.y, fore, seat.chair.isFlipped)
          person(seat.sessionId, seat.dir, seat.state, seat.x, seat.y)
        }
        prop(table.prop, x0 + table.x, front + table.y, fore)
      })
    } else if (place.benches) {
      // 공원: 벤치마다 [벤치 → 그 벤치 사람]
      place.benches.forEach((bench, index) => {
        prop(bench.prop, x0 + bench.x, front + bench.y, fore)
        for (const seat of seats) if (seat.bench === index) person(seat.sessionId, seat.dir, seat.state, seat.x, seat.y)
      })
    } else {
      for (const seat of seats) person(seat.sessionId, seat.dir, seat.state, seat.x, seat.y)
    }
    items(place.after, x0, () => fore)
  }

  // "+N": 장소 오른쪽 위 하늘 줄 (명판 가운데 = 메타 more)
  const plates = plan.overflows.map(
    (overflow): StreetPlate => ({
      place: overflow.place,
      count: overflow.count,
      rect: drawMorePlate(top, overflow.count, (plateW, plateH) => ({ x: Math.round(overflow.x - plateW / 2), y: Math.round(overflow.y - plateH / 2) })),
    }),
  )
  const name = dotLabel('Off Duty', 20, hexColor(look.label))
  name.position.set(36, 14)
  top.addChild(name)
  container.eventMode = 'static'
  container.cursor = 'grab'
  return { container, animations, plates }
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
  /** 마우스를 올린 자리·퇴근한 사람·"+N". 카드는 이것, 없으면 고른 세션 */
  const [hoveredCard, setHoveredCard] = useState<HoveredCard | null>(null)
  /** 퇴근 거리 장소 (아틀라스를 읽으면 정해진다). 카드의 장소 이름을 지금 시각으로 고른다 */
  const streetPlacesRef = useRef<StreetPlaceMeta[] | null>(null)
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
        /** 퇴근 세션 → 포커스 이동할 사각형 (타일): 거리에 앉은 사람의 전신, 넘쳐 안 보이면 그 장소의 "+N" */
        const offDutyTargets = new Map<string, Rect>()
        /** 라운지에 앉은(보이는) 세션 → 전신 사각형 (타일). 포커스 이동은 이것이 먼저고, 넘쳐 안 보이면 책상 */
        const loungeTargets = new Map<string, Rect>()
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
          /** 끄는 동안 켜 두는 그 라벨의 테두리 */
          hover: Graphics
        } | null = null
        /** 마우스가 올라가 있는 라벨의 테두리. 놓은 뒤에도 마우스가 그 위면 테두리를 남긴다 */
        let hoveredLabel: Graphics | null = null
        /** 이번 누름이 끌기였는지. 놓은 뒤 오는 pointertap(Pixi 는 pointerup 다음에 보낸다)이 선택·더블클릭 편집이 되지 않게 다음 누름까지 남긴다 */
        let isDragged = false
        /** 이름표를 끄는 동안 미룬 다시 그리기 (그 사이 다시 그리면 끌던 그림이 원래 자리로 돌아간다) */
        let isRedrawPending = false
        /** 지금 그려진 시간대. 1분마다 바뀌었는지 보고 바뀌었으면 다시 그린다 */
        let drawnPhase = dayPhaseOf(new Date())
        /** 지금 그려진 근무 세션마다 있는 곳 (seatPlaceKey). 시간이 흘러 라운지로 가거나 라운지에서 졸기 시작하는 것도 1분마다 보고 바뀌었으면 다시 그린다 */
        let drawnSeatPlaces = ''
        /** 지금 그려진 퇴근 세션마다 거리 장소 (streetPlaceKey). 누가 1·6·24시간 경계를 넘으면 1분 안에 다시 그린다 */
        let drawnStreet = ''
        /** 마우스를 올린 카드 키(HoveredCard 의 rectKey·key). 이벤트 처리기가 지금 값을 보도록 여기도 둔다 (카드는 React 상태 hoveredCard) */
        let hoveredKey: string | null = null
        /**
         * 카드를 붙일 사각형 (타일): `desk:<세션 ID>` = 자리, 세션 ID = 라운지에 앉았으면 그 전신·아니면 자리 (고른 세션 카드),
         * 거리에 앉은 퇴근 세션의 전신, "+N" 명판(more:<장소>·more:lounge). 카드가 매 프레임 이 옆으로 따라간다
         */
        let cardRects = new Map<string, Rect>()
        const setHovered = (card: HoveredCard | null) => {
          hoveredKey = card ? (card.kind === 'session' ? card.rectKey : card.key) : null
          setHoveredCard(card)
        }
        streetPlacesRef.current = art.streetMeta.places
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
          const seat = loungeTargets.get(target.sessionId) ?? layout.seats.get(target.sessionId)
          if (seat) moveToRect(seat, true)
          else {
            const person = offDutyTargets.get(target.sessionId)
            if (person) moveToRect(person, true)
          }
        }
        focusRef.current = applyFocus

        // 휠 = 확대·축소. 한 칸에 배율 한 단계, 커서 아래 지점이 그대로 남게
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
          if (hoveredKey) setHovered(null)
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
          label: DragLabel,
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
            hover: label.hover,
          }
          label.hover.visible = true
          // 끄는 동안 커서 grabbing. 손잡이가 타일 단위로 따라와 마우스가 손잡이 밖일 때도 있어 Pixi 커서(대상마다)가 아니라 캔버스 클래스로
          host.classList.add('is-label-dragging')
        }

        /** 라벨 테두리: 마우스를 올리면 켜고, 끄는 동안은 그 라벨 것만 켜 둔다 (맵 이동·다른 라벨 끌기 중에는 켜지 않는다) */
        const bindDragLabel = (label: DragLabel) => {
          label.sign.on('pointerover', () => {
            if (pan?.isMoved || (signDrag && signDrag.hover !== label.hover)) return
            hoveredLabel = label.hover
            label.hover.visible = true
          })
          label.sign.on('pointerout', () => {
            if (hoveredLabel === label.hover) hoveredLabel = null
            if (signDrag?.hover !== label.hover) label.hover.visible = false
          })
        }

        /**
         * 퇴근 거리 (redraw 가 바닥 바로 위에 부른다 — 끄는 그룹·섬이 띠를 지날 때 가려지지 않게): 그림 + 퇴근한 사람 전신·"+N" 명판의 클릭 영역.
         * 사람 = 클릭(5px 미만)은 세션 선택, 마우스 올림은 자리 카드. "+N" = 클릭은 왼쪽 목록 Off Duty 펼치기, 마우스 올림은 안내 카드. 그 이상 끌면 맵 이동.
         * planWidth(아트 px) = 단계·집 묶음을 정하는 폭. 화면 크기·배율과 무관한 내용 폭이라 패널을 열거나 확대해도 앉은 자리가 그대로다
         */
        const drawStreet = (streetY: number, planWidth: number, now: number, selectedId: string | null, moreCards: Map<string, HoveredCard>) => {
          const { sessions } = latest.current
          const looks = new Map<string, DotLook>()
          for (const session of sessions) {
            const look = attendanceOf(session) === 'off' ? dotLookOf(session, art.characters) : null
            if (look) looks.set(session.id, look)
          }
          const people = streetPeopleOf(sessions, now)
          drawnStreet = streetPlaceKey(art.streetMeta.places, people)
          const plan = planStreet(
            art.streetMeta,
            planWidth * DOT_SCALE,
            people.flatMap((person) => {
              const look = looks.get(person.id)
              return look ? [{ ...person, character: look.id }] : []
            }),
            art.streetProps,
            art.streetSizes,
            map.w * DOT_SCALE,
          )
          const street = drawDotStreet(art, plan, map.w, drawnPhase, looks)
          street.container.y = streetY
          world.addChild(street.container)
          for (const animation of street.animations) animations.add(animation)
          /** 띠의 도트 px 사각형 → 띠 안 아트 px */
          const artRect = (rect: Rect): Rect => ({ x: rect.x / DOT_SCALE, y: rect.y / DOT_SCALE, w: rect.w / DOT_SCALE, h: rect.h / DOT_SCALE })
          /** 띠의 도트 px 사각형 → 자리 사각형과 같은 타일 좌표 (PAD 기준) */
          const tileRect = (rect: Rect): Rect => {
            const { x, y, w, h } = artRect(rect)
            return { x: (x - PAD_X) / TILE, y: (streetY + y - PAD_Y) / TILE, w: w / TILE, h: h / TILE }
          }
          const addHit = (rect: Rect) => {
            const { x, y, w, h } = artRect(rect)
            const hit = new Container()
            hit.eventMode = 'static'
            hit.cursor = 'pointer'
            hit.hitArea = new Rectangle(x, y, w, h)
            street.container.addChild(hit)
            return hit
          }
          for (const [sessionId, rect] of plan.figures) {
            cardRects.set(sessionId, tileRect(rect))
            offDutyTargets.set(sessionId, tileRect(rect))
            if (sessionId === selectedId) {
              // 책상 자리와 같은 선택 테두리
              const { x, y, w, h } = artRect(rect)
              const outline = new Graphics().rect(x - 2, y + 1, w + 4, h - 2).stroke({ width: 1, color: COLOR.select })
              outline.eventMode = 'none'
              street.container.addChild(outline)
            }
            const hit = addHit(rect)
            hit.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(sessionId)
            })
            hit.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              setHovered({ kind: 'session', sessionId, rectKey: sessionId })
            })
            hit.on('pointerout', () => {
              if (hoveredKey === sessionId) setHovered(null)
            })
          }
          const placeLabels = new Map(art.streetMeta.places.map((place) => [place.id, place.label]))
          for (const plate of street.plates) {
            const key = `more:${plate.place}`
            const card: HoveredCard = {
              kind: 'more',
              key,
              title: `${placeLabels.get(plate.place) ?? ''} · ${plate.count} more`,
              lines: ['Click to show them in the list'],
            }
            moreCards.set(key, card)
            cardRects.set(key, tileRect(plate.rect))
            // 넘쳐 안 보이는 사람은 목록에서 골라도 그 장소의 "+N" 으로 간다
            for (const [sessionId, place] of plan.placeOf) {
              if (place === plate.place && !plan.figures.has(sessionId)) offDutyTargets.set(sessionId, tileRect(plate.rect))
            }
            const hit = addHit(plate.rect)
            hit.on('pointertap', () => {
              if (!isDragged) latest.current.onShowOffDutyList()
            })
            hit.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              setHovered(card)
            })
            hit.on('pointerout', () => {
              if (hoveredKey === key) setHovered(null)
            })
          }
        }

        /**
         * 라운지 (redraw 가 Focus Zone 과 같이 부른다): 차례가 끝난 지 30분 넘은 근무 세션(seatPlaceOf)을 앉힌 그림 + 앉은 사람 전신·"+N" 명판의 마우스 영역.
         * 사람 = 클릭(5px 미만)은 세션 선택, 마우스 올림은 자리 카드. "+N" = 마우스 올림은 못 앉은 사람 이름 카드, 클릭은 아무것도 안 한다. 그 이상 끌면 맵 이동.
         * 자리가 있는 세션(layout.seated)만 간다. 배치(앉아 보이는 세션은 figures)를 돌려준다
         */
        const drawLounge = (layout: OfficeLayout, now: number, selectedId: string | null, moreCards: Map<string, HoveredCard>): LoungePlan => {
          const looks = new Map<string, DotLook>()
          const people: LoungePerson[] = []
          for (const session of layout.seated) {
            const place = seatPlaceOf(session, now)
            const endedAt = turnEndedAtOf(session)
            if (place === 'desk' || endedAt === null) continue
            const look = lookOf(session, art)
            looks.set(session.id, look)
            people.push({ id: session.id, endedAt, state: place === 'lounge-doze' ? 'doze' : 'idle', character: look.id })
          }
          const { lounge } = layout
          const fixtures = loungeFixtures(lounge, art.propSizes)
          const plan = planLounge(art.propsMeta.lounge ?? null, fixtures, art.propSizes, people)
          const drawn = drawDotLounge(lounge, art, fixtures, plan, looks, selectedId)
          world.addChild(drawn.container)
          for (const animation of drawn.animations) animations.add(animation)
          /** 라운지의 도트 px 사각형 → 자리 사각형과 같은 타일 좌표 */
          const tileRect = (rect: Rect): Rect => ({ x: lounge.x + rect.x / DOT_TILE, y: lounge.y + rect.y / DOT_TILE, w: rect.w / DOT_TILE, h: rect.h / DOT_TILE })
          const addHit = (rect: Rect, cursor: string) => {
            const hit = new Container()
            hit.eventMode = 'static'
            hit.cursor = cursor
            hit.hitArea = new Rectangle(rect.x / DOT_SCALE, rect.y / DOT_SCALE, rect.w / DOT_SCALE, rect.h / DOT_SCALE)
            drawn.container.addChild(hit)
            return hit
          }
          for (const [sessionId, rect] of plan.figures) {
            loungeTargets.set(sessionId, tileRect(rect))
            cardRects.set(sessionId, tileRect(rect))
            const hit = addHit(rect, 'pointer')
            hit.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(sessionId)
            })
            hit.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              setHovered({ kind: 'session', sessionId, rectKey: sessionId })
            })
            hit.on('pointerout', () => {
              if (hoveredKey === sessionId) setHovered(null)
            })
          }
          if (drawn.plate && plan.more) {
            const key = 'more:lounge'
            const nameOf = (id: string) => {
              const session = layout.seated.find((s) => s.id === id)
              return session ? sessionNameOf(session) : id.slice(0, 8)
            }
            const card: HoveredCard = { kind: 'more', key, title: `Lounge · ${plan.more.count} more`, lines: overflowNames(plan.overflow.map(nameOf)) }
            moreCards.set(key, card)
            cardRects.set(key, tileRect(drawn.plate))
            // 누르면 아무것도 안 한다 (끌면 맵 이동)
            const hit = addHit(drawn.plate, 'grab')
            hit.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              setHovered(card)
            })
            hit.on('pointerout', () => {
              if (hoveredKey === key) setHovered(null)
            })
          }
          return plan
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
          offDutyTargets.clear()
          loungeTargets.clear()
          approvalDesks = []
          islandViews.clear()
          const layout = layoutOffice(office, sessions)
          cardRects = new Map(
            layout.seated.flatMap((session) => {
              const { x, y, w, h } = layout.seats.get(session.id)!
              return [
                [session.id, { x, y, w, h }],
                [`desk:${session.id}`, { x, y, w, h }],
              ]
            }),
          )
          /** "+N" 카드 (more:<장소>·more:lounge). 마우스를 올려 둔 카드를 다시 그린 뒤 수로 고친다 */
          const moreCards = new Map<string, HoveredCard>()
          // 거리 배치 폭 = 내용 폭 (가장 좁은 거리 단계보다 좁으면 그 폭. 맵도 그만큼은 넓힌다 — 오른쪽 집이 잘리지 않게)
          const streetPlanWidth = Math.max(PAD_X + layout.right * TILE, Math.ceil(art.streetMeta.levels[art.streetMeta.levels.length - 1].minWidth / DOT_SCALE))
          map.w = Math.max(PAD_X + layout.right * TILE + Math.ceil(app.screen.width / zoom), streetPlanWidth)
          // 띠는 늘 내용(그룹·섬·Focus Zone·라운지) 아래 끝 + 1타일. 바닥 격자에 맞는다
          const streetY = PAD_Y + (layout.bottom + 1) * TILE
          map.h = streetY + OFF_DUTY_HEIGHT + Math.ceil(app.screen.height / zoom / TILE) * TILE
          const now = Date.now()
          drawnPhase = dayPhaseOf(new Date(now))
          drawnSeatPlaces = seatPlaceKey(sessions, now)
          dotTextResolution = zoom / DOT_SCALE
          world.addChild(drawDotBackground(map.w, map.h, art, drawnPhase, wallFixtures(layout, PAD_X / TILE)))
          drawStreet(streetY, streetPlanWidth, now, selectedId, moreCards)
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
            const parts = drawDotGroup(area, art)
            bindDragLabel(parts)
            parts.sign.on('pointerdown', (event: FederatedPointerEvent) => {
              const teamIds = new Set(layout.islands.filter((i) => i.team.groupId === area.group.id).map((i) => i.team.id))
              beginSignDrag(event, parts, {
                // 그려지는 상자가 맵 왼쪽·위 끝을 넘지 않고 저장 위치도 0 이상 (그래서 안의 팀 앵커도 0 이상)
                minDelta: minGroupDragDelta(area),
                containers: [parts.container, ...[...teamIds].flatMap((id) => islandViews.get(id) ?? []), ...deskViewsOf(teamIds)],
                // 상자 위치가 아니라 밀린 뒤 저장 위치(origin)에서 옮긴 곳을 저장한다
                drop: (delta) => latest.current.onMoveGroup(area.group.id, dropGroup(area, delta)),
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
          const loungePlan = drawLounge(layout, now, selectedId, moreCards)
          for (const island of layout.islands) {
            const { team } = island
            const onEdit = () => {
              if (!isDragged) latest.current.onEditTeam(team)
            }
            // 목록 팀 카드 배지(App.tsx renderTeam)와 같은 수: 그 팀(파트 포함)의 근무·휴식 세션
            const memberCount = sessions.filter((s) => s.teamId === team.id && attendanceOf(s) !== 'off').length
            const parts = drawDotIsland(island, memberCount, onEdit, art)
            bindDragLabel(parts)
            // TODO 버튼: 누르면 모달. 누르거나 끌어도 팀 명판 끌기·맵 이동이 시작되지 않게 pointerdown 을, 더블클릭 이름 변경이 되지 않게 pointertap 을 여기서 멈춘다
            parts.todoButton.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation())
            parts.todoButton.on('pointertap', (event: FederatedPointerEvent) => {
              event.stopPropagation()
              if (!isDragged) latest.current.onOpenTeamTodos(team.id)
            })
            parts.todoButton.on('pointerover', () => {
              if (!pan?.isMoved && !signDrag) parts.todoHover.visible = true
            })
            parts.todoButton.on('pointerout', () => {
              parts.todoHover.visible = false
            })
            parts.sign.on('pointerdown', (event: FederatedPointerEvent) => {
              beginSignDrag(event, parts, {
                // 섬과 그 위 그룹 이름표 줄까지 맵 안에 남게
                minDelta: { x: Math.min(0, -island.x), y: Math.min(0, GROUP_LABEL_H - island.y) },
                containers: [parts.container, ...deskViewsOf(new Set([team.id]))],
                drop: (delta) =>
                  latest.current.onMoveTeam(team.id, dropIsland(layout, team, { x: island.anchor.x + delta.x, y: island.anchor.y + delta.y })),
              })
            })
            world.addChild(parts.container)
            islandViews.set(team.id, parts.container)
          }
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
          // 클릭 영역(자리 사각형)은 그림 위, 선택 테두리·상태 아이콘은 그 위 층
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
            // 라운지에 앉아 보이는 세션의 선택 테두리는 라운지 쪽 (넘쳐 안 보이면 책상)
            const isSelected = session.id === selectedId && !loungePlan.figures.has(session.id)
            const isAway = attendanceOf(session) === 'break' || seatPlaceOf(session, now) !== 'desk'
            const overlay = drawSeatOverlay(session, overlayPlaceOf(seat, row, art), isSelected, isAway, art, iconScale)
            if (overlay.icon) animations.add(overlay.icon)
            const rectKey = `desk:${session.id}`
            hit.on('pointertap', () => {
              if (!isDragged) latest.current.onSelect(session.id)
            })
            hit.on('pointerover', () => {
              if (pan?.isMoved || signDrag) return
              setHovered({ kind: 'session', sessionId: session.id, rectKey })
            })
            hit.on('pointerout', () => {
              if (hoveredKey === rectKey) setHovered(null)
            })
            hitLayer.addChild(hit)
            overlayLayer.addChild(overlay.container)
            desks.set(session.id, { hit, overlay })
            if (session.status === 'needs-approval' && attendanceOf(session) === 'present') {
              approvalDesks.push({ session, rect: seat })
            }
          }
          // 고른 자리의 선택 테두리가 이웃 자리 아이콘에 가리지 않게 맨 위로
          const selectedOverlay = selectedId ? desks.get(selectedId)?.overlay.container : undefined
          if (selectedOverlay) overlayLayer.setChildIndex(selectedOverlay, overlayLayer.children.length - 1)
          world.addChild(hitLayer, overlayLayer)
          // 마우스를 올려 둔 "+N" 의 수가 바뀌었거나 명판이 없어졌으면 카드도 따라간다 (다시 그린 자리에는 pointerout 이 안 온다)
          if (hoveredKey?.startsWith('more:')) setHovered(moreCards.get(hoveredKey) ?? null)
        }
        redrawRef.current = redraw

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
          const sessionId = card.dataset.cardKey ?? ''
          const rect = cardRects.get(sessionId)
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
        // 시간대가 바뀌면 창밖·Off Duty 띠를, 근무 세션이 책상·라운지·라운지 졸기 사이를 옮기면 책상·라운지를, 퇴근 세션의 장소가 바뀌면 거리를 다시 그린다 (매 프레임이 아니라 1분마다 확인)
        const phaseTimer = setInterval(() => {
          const now = Date.now()
          const { sessions } = latest.current
          if (
            dayPhaseOf(new Date(now)) !== drawnPhase ||
            seatPlaceKey(sessions, now) !== drawnSeatPlaces ||
            streetPlaceKey(art.streetMeta.places, streetPeopleOf(sessions, now)) !== drawnStreet
          ) {
            redraw()
          }
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
          const names = arrow.targets.map(({ session }) => sessionNameOf(session))
          const shown = names.length > 6 ? [...names.slice(0, 5), `and ${names.length - 5} more`] : names
          arrowTooltipText.text = `Needs approval\n${shown.join('\n')}`
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

        // 이름표가 아닌 곳(배경·그룹·섬·로비·라운지·책상)을 누르면 맵 이동 후보. 이름표는 stopPropagation 해서 여기 안 온다
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
          const { delta, drop, hover } = signDrag
          signDrag = null
          host.classList.remove('is-label-dragging')
          if (hover !== hoveredLabel) hover.visible = false
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
        Couldn't load the office art ·{' '}
        <button type="button" className="link" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
  // 카드는 마우스를 올렸을 때만 (고른 세션은 패널에 같은 정보가 있어 띄워 두지 않는다)
  const cardSessionId = hoveredCard?.kind === 'session' ? hoveredCard.sessionId : null
  const cardSession = cardSessionId ? sessions.find((session) => session.id === cardSessionId) : undefined
  const cardKey = hoveredCard?.kind === 'session' ? hoveredCard.rectKey : cardSessionId
  const streetPlaces = streetPlacesRef.current
  const placeLabel =
    cardSession && streetPlaces && attendanceOf(cardSession) === 'off'
      ? (streetPlaces.find((place) => place.id === placeIdOf(streetPlaces, offDutyMinutesOf(cardSession, Date.now())))?.label ?? null)
      : null
  // 자리 옆 위치·보이기는 ticker 가 정한다 (처음엔 숨김. 거리에 안 보이는 퇴근 세션은 붙일 곳이 없어 숨긴 채). 마우스를 가로채지 않는다
  return (
    <div className="office">
      <div ref={hostRef} className="office-canvas" />
      {hoveredCard?.kind === 'more' ? (
        <div key={hoveredCard.key} ref={cardRef} className="office-card" data-card-key={hoveredCard.key} style={{ visibility: 'hidden' }}>
          <div className="office-card-head">
            <b>{hoveredCard.title}</b>
          </div>
          {hoveredCard.lines.map((line, index) => (
            <div key={index} className="office-card-facts">
              {line}
            </div>
          ))}
        </div>
      ) : (
        cardSession && (
          <div key={cardSession.id} ref={cardRef} className="office-card" data-card-key={cardKey ?? cardSession.id} style={{ visibility: 'hidden' }}>
            <SeatCard
              session={cardSession}
              teamName={office.teams.find((team) => team.id === cardSession.teamId)?.name ?? null}
              placeLabel={placeLabel}
            />
          </div>
        )
      )}
    </div>
  )
}
