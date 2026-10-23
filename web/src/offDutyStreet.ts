/**
 * 퇴근 거리(Off Duty 띠) 배치 (순수). 무엇을 어디에 그릴지만 정하고 그리기는 Office.tsx 가 한다.
 * 메타는 office-v6-street.json 의 meta.jkCorp.street, 규칙은 docs/plans/2026-10-22-office-sprites-design.md 의 "퇴근 거리 (v6)".
 * 좌표는 모두 도트 px 이고 띠 왼쪽 위 기준 (메타의 y 는 사람 발 선 front 기준이라 여기서 front 를 더한다)
 */

export type StreetPlaceId = 'bus' | 'cafe' | 'park' | 'home'
/** 거리에 앉은 사람의 방향. left 는 옆모습(right)을 좌우로 뒤집어 그린다 */
export type StreetDirection = 'down' | 'right' | 'left'
export type StreetState = 'idle' | 'doze'

export interface StreetItem {
  prop: string
  x: number
  y: number
}

interface StreetSeatMeta {
  x: number
  y: number
  dir: StreetDirection
  state: StreetState
  /** 카페: 그 자리의 탁자 번호 */
  table?: number
  /** 공원: 그 자리의 벤치 번호 */
  bench?: number
}

export interface StreetPlaceMeta {
  id: StreetPlaceId
  label: string
  /** 퇴근 후 [시작, 끝) 분. 끝이 null 이면 끝없음 */
  minutes: [number, number | null]
  w?: number
  back?: StreetItem[]
  front?: StreetItem[]
  after?: StreetItem[]
  seats?: StreetSeatMeta[]
  tables?: StreetItem[]
  chair?: { prop: string; dx: number }
  benches?: StreetItem[]
  ground?: 'grass'
  houseCycle?: string[]
  unit?: { w: number; houses: { x: number; y: number }[] }
  single?: { w: number }
  gap?: { w: number; items: StreetItem[] }
  seatsPerHouse?: number
  face?: { dir: StreetDirection; state: StreetState }
  more: { x: number; y: number }
}

export interface StreetPhase {
  skyTop: string
  skyBottom: string
  tint: string
  label: string
  isLit: boolean
  hasStars: boolean
}

export interface StreetMeta {
  band: number
  front: number
  back: number
  sidewalkTop: number
  curbTop: number
  tiles: { sidewalk: string; curb: string; grass: string }
  phases: Record<'morning' | 'day' | 'dusk' | 'night', StreetPhase>
  skySteps: number
  window: { day: string; lit: string; dark: string }
  fillers: Record<string, { w: number; items: StreetItem[] }>
  levels: { minWidth: number; fillers: boolean; houses: number }[]
  places: StreetPlaceMeta[]
  /** 상태 → 인물 → 카페 의자 높이 변화 */
  sideSeatLift: Record<string, Record<string, number>>
  /** 인물 → 창 얼굴 머리 [x0, top, x1] (정면 셀 안) */
  headBox: Record<string, [number, number, number]>
}

/** 아틀라스 소품 메타 (meta.jkCorp.props). 집 창은 집 그림 왼쪽 위 기준 */
export interface StreetPropMeta {
  glow?: string
  windows?: { x: number; y: number; w: number; h: number; frame: number }[]
  lifts?: Record<string, string>
}

export interface Size {
  w: number
  h: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 거리에 놓을 퇴근 세션. minutes = 퇴근한 지 몇 분, character = 그릴 인물 id (카페 의자 높이·창 얼굴 자리가 인물마다 다르다) */
export interface StreetPerson {
  id: string
  minutes: number
  character: string
}

/** 장소 자리 하나 (메타 seats 순서, 빈 자리 포함). x·y = 사람 anchor (정면 = 발 가운데, 옆모습 = 등) */
export interface StreetSeat {
  sessionId: string | null
  x: number
  y: number
  dir: StreetDirection
  state: StreetState
  table?: number
  bench?: number
  /** 카페 의자: 앉은 사람 엉덩이에 맞춘 높이의 그림, 아래 가운데 x (left 는 뒤집는다). 빈 자리는 변화 0 의자 */
  chair?: { prop: string; x: number; isFlipped: boolean }
}

/** 집 창 하나 (창 왼쪽부터). 사람은 정면 셀을 crop 만큼 잘라 cell + crop 자리에 그린다 */
export interface StreetWindow {
  sessionId: string | null
  /** 창 유리 (창 안 색을 칠할 곳) */
  glass: Rect
  /** 사람 그림 왼쪽 위 = 창 + 위·왼쪽·오른쪽 창틀 */
  at: { x: number; y: number }
  /** 정면 셀 안에서 잘라 보일 곳 */
  crop: Rect
}

export type StreetPiece =
  | { kind: 'filler'; id: string; x: number; items: StreetItem[] }
  | { kind: 'place'; place: StreetPlaceMeta; x: number; seats: StreetSeat[] }
  | { kind: 'house'; prop: string; x: number; bottom: number; windows: StreetWindow[] }

/** 장소에 다 못 앉은 사람 수 "+N" (x·y = 명판 가운데) */
export interface StreetOverflow {
  place: StreetPlaceId
  count: number
  x: number
  y: number
}

export interface StreetPlan {
  /** 고른 폭 단계 (levels 번호) */
  level: number
  /** 집 묶음 수 */
  units: number
  /** 그리는 조각 (왼쪽부터) */
  pieces: StreetPiece[]
  overflows: StreetOverflow[]
  /** 앉은(보이는) 사람의 전신 사각형 = 마우스 올림·클릭·선택 테두리·포커스 */
  figures: Map<string, Rect>
  /** 모든 사람의 장소 (넘쳐 안 보이는 사람 포함) */
  placeOf: Map<string, StreetPlaceId>
}

/**
 * 앉은 사람 전신 사각형 (anchor 기준, 도트 px): v5 앉은 그림 18명 idle·doze 모든 칸의 보이는 범위에서 잡았다.
 * 정면(셀 80×132, 발 가운데 40·128)·뒷모습(셀 92×128, 발 가운데 46·124)은 몸 폭, 옆모습(셀 88×128, 등 18·124)은 등 뒤 조금 ~ 무릎. left 는 뒤집는다.
 * 뒷모습은 라운지 자리만 쓴다 (lounge.ts)
 */
const FIGURE: Record<'down' | 'up' | 'right', Rect> = {
  down: { x: -24, y: -112, w: 48, h: 112 },
  up: { x: -26, y: -98, w: 52, h: 98 },
  right: { x: -8, y: -104, w: 56, h: 104 },
}

/** headBox 가 없는 인물의 머리 (셀 가운데) */
const DEFAULT_HEAD_BOX: [number, number, number] = [20, 18, 60]

/** 퇴근한 지 minutes 분인 사람의 장소 (음수는 막 퇴근한 것으로) */
export function placeIdOf(places: StreetPlaceMeta[], minutes: number): StreetPlaceId {
  const m = Math.max(0, minutes)
  const place = places.find((p) => m >= p.minutes[0] && (p.minutes[1] === null || m < p.minutes[1]))
  return (place ?? places[places.length - 1]).id
}

/** 1분 타이머가 비교하는 키: 사람마다 장소. 누가 장소 경계(1·6·24시간)를 넘으면 바뀐다 */
export function streetPlaceKey(places: StreetPlaceMeta[], people: { id: string; minutes: number }[]): string {
  return people
    .map((person) => `${person.id}:${placeIdOf(places, person.minutes)}`)
    .sort()
    .join(',')
}

/** 앉은 사람 (x, y = anchor) 의 전신 사각형 (방향별, left 는 좌우 반전) */
export function figureRect(dir: StreetDirection | 'up', x: number, y: number): Rect {
  const box = FIGURE[dir === 'left' ? 'right' : dir]
  return { x: dir === 'left' ? x - box.x - box.w : x + box.x, y: y + box.y, w: box.w, h: box.h }
}

/**
 * 폭 width(도트 px)에 퇴근한 사람들을 놓는다. 단계 = minWidth 가 width 이하인 첫 단계(없으면 마지막),
 * 조각 = 채우기 start → 버스 → 채우기 → 카페 → 채우기 → 공원 → 채우기 → 집 묶음(사이 gap) → 채우기 street 되풀이 (fillWidth 까지. 사이 채우기는 단계가 있을 때만).
 * 장소 안은 최근에 퇴근한 사람부터 자리를 채우고 남는 사람은 "+N". 집 묶음은 사이 채우기가 있는 단계에서만 폭과 인원이 허락하는 만큼 늘린다.
 * fillWidth = 띠 끝 (기본 width). 단계·집 묶음은 width 로만 정한다 — 화면 크기·배율에 따라 달라지는 띠 폭으로 정하면 패널을 열거나 확대할 때 사람이 "+N" 으로 들어갔다 나온다
 */
export function planStreet(
  street: StreetMeta,
  width: number,
  people: StreetPerson[],
  props: Record<string, StreetPropMeta>,
  sizes: Record<string, Size>,
  fillWidth = width,
): StreetPlan {
  const fitting = street.levels.findIndex((level) => width >= level.minWidth)
  const levelIndex = fitting === -1 ? street.levels.length - 1 : fitting
  const level = street.levels[levelIndex]
  const { front } = street
  const placeById = new Map(street.places.map((place) => [place.id, place]))
  const byPlace = new Map<StreetPlaceId, StreetPerson[]>(street.places.map((place) => [place.id, []]))
  const placeOf = new Map<string, StreetPlaceId>()
  const sorted = [...people].sort((a, b) => a.minutes - b.minutes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const person of sorted) {
    const id = placeIdOf(street.places, person.minutes)
    placeOf.set(person.id, id)
    byPlace.get(id)!.push(person)
  }
  const pieces: StreetPiece[] = []
  const overflows: StreetOverflow[] = []
  const figures = new Map<string, Rect>()
  const pushOverflow = (place: StreetPlaceId, count: number, x: number, y: number) => {
    if (count > 0) overflows.push({ place, count, x, y })
  }
  let x = 0
  const filler = (id: string) => {
    if (!level.fillers) return
    const meta = street.fillers[id]
    pieces.push({ kind: 'filler', id, x, items: meta.items })
    x += meta.w
  }

  filler('start')
  for (const id of ['bus', 'cafe', 'park'] as const) {
    const place = placeById.get(id)!
    const members = byPlace.get(id)!
    const seatsMeta = place.seats ?? []
    const seats = seatsMeta.map((seat, index): StreetSeat => {
      const person = members[index]
      const at = { x: x + seat.x, y: front + seat.y }
      const result: StreetSeat = { sessionId: person?.id ?? null, ...at, dir: seat.dir, state: seat.state, table: seat.table, bench: seat.bench }
      if (place.chair) {
        const lift = person ? (street.sideSeatLift[seat.state]?.[person.character] ?? 0) : 0
        const isFlipped = seat.dir === 'left'
        const lifts = props[`prop/${place.chair.prop}`]?.lifts ?? {}
        result.chair = { prop: lifts[String(lift)] ?? `prop/${place.chair.prop}`, x: at.x + (isFlipped ? -place.chair.dx : place.chair.dx), isFlipped }
      }
      if (person) figures.set(person.id, figureRect(seat.dir, at.x, at.y))
      return result
    })
    pieces.push({ kind: 'place', place, x, seats })
    pushOverflow(id, members.length - Math.min(members.length, seatsMeta.length), x + place.more.x, front + place.more.y)
    x += place.w ?? 0
    filler(id)
  }

  const home = placeById.get('home')!
  const homeMembers = byPlace.get('home')!
  const housesPerUnit = level.houses
  const unitW = housesPerUnit >= 2 ? home.unit!.w : home.single!.w
  const seatsPerHouse = home.seatsPerHouse ?? 2
  const seatsPerUnit = housesPerUnit * seatsPerHouse
  const gap = home.gap!
  let units = 1
  if (level.fillers) {
    const byWidth = 1 + Math.floor((width - level.minWidth) / (gap.w + unitW))
    units = Math.max(1, Math.min(byWidth, Math.ceil(homeMembers.length / seatsPerUnit)))
  }
  const cycle = home.houseCycle ?? []
  let houseIndex = 0
  let lastHouse: { x: number; bottom: number } | null = null
  for (let u = 0; u < units; u++) {
    if (u > 0) {
      pieces.push({ kind: 'filler', id: 'gap', x, items: gap.items })
      x += gap.w
    }
    for (let h = 0; h < housesPerUnit; h++) {
      const at = home.unit!.houses[h]
      const prop = `prop/${cycle[houseIndex % cycle.length]}`
      const size = sizes[prop] ?? { w: 0, h: 0 }
      const houseX = x + at.x
      const bottom = front + at.y
      const left = houseX - size.w / 2
      const top = bottom - size.h
      const windows = (props[prop]?.windows ?? []).slice(0, seatsPerHouse).map((glass, wi): StreetWindow => {
        const person = homeMembers[houseIndex * seatsPerHouse + wi]
        const m = glass.frame
        const [x0, headTop, x1] = (person && street.headBox[person.character]) || DEFAULT_HEAD_BOX
        // 머리 가운데 = 창 가운데, 가장 높이 들썩인 칸에서도 머리 위가 창틀 안. 보이는 곳 = 창 + 위·왼쪽·오른쪽 창틀 (아래는 창턱 위까지)
        const cellX = glass.x + Math.floor(glass.w / 2) - Math.floor((x0 + x1) / 2)
        const cellY = glass.y - m + 1 - headTop
        const crop = { x: glass.x - m - cellX, y: glass.y - m - cellY, w: glass.w + 2 * m, h: glass.h + m }
        const visible = { x: left + glass.x - m, y: top + glass.y - m }
        if (person) figures.set(person.id, { ...visible, w: crop.w, h: crop.h })
        return { sessionId: person?.id ?? null, glass: { x: left + glass.x, y: top + glass.y, w: glass.w, h: glass.h }, at: visible, crop }
      })
      pieces.push({ kind: 'house', prop, x: houseX, bottom, windows })
      lastHouse = { x: houseX, bottom }
      houseIndex++
    }
    x += unitW
  }
  const homeSeats = houseIndex * seatsPerHouse
  if (lastHouse) pushOverflow('home', homeMembers.length - Math.min(homeMembers.length, homeSeats), lastHouse.x + home.more.x, lastHouse.bottom + home.more.y)
  // 집 오른쪽 남는 폭은 단계와 관계없이 거리 채우기를 되풀이 (끝 조각은 띠 밖으로 잘린다)
  const streetFiller = street.fillers.street
  while (x < fillWidth && streetFiller.w > 0) {
    pieces.push({ kind: 'filler', id: 'street', x, items: streetFiller.items })
    x += streetFiller.w
  }
  return { level: levelIndex, units, pieces, overflows, figures, placeOf }
}
