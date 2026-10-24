import { figureRect, type Rect } from './offDutyStreet'
import type { Fixture, PropSizes } from './officeFixtures'

/**
 * 라운지에 앉는 사람 배치 (순수). 차례가 끝난 지 30분 넘은 근무 세션(dotState.ts 의 seatPlaceOf)이 책상을 비우고 여기 앉는다.
 * 무엇을 어디에 그릴지만 정하고 그리기는 Office.tsx 가 한다. 자리 메타는 office-v5-props.json 의 meta.jkCorp.lounge,
 * 소품 자리는 officeFixtures.ts 의 loungeFixtures. 좌표는 모두 도트 px 이고 라운지 왼쪽 위 기준
 */

/** 앉은 사람이 보는 쪽. left 는 옆모습(right)을 좌우로 뒤집어 그린다 */
export type LoungeDirection = 'down' | 'up' | 'right' | 'left'
export type LoungeState = 'idle' | 'doze'

/** 사람이 앉는 소품. 자리를 채우는 순서이기도 하다 (원탁들 → 소파 → 안락의자) */
export const LOUNGE_SEAT_PROPS = ['lounge-table-set', 'sofa', 'armchair'] as const
export type LoungeSeatProp = (typeof LOUNGE_SEAT_PROPS)[number]

/** 메타의 자리 하나. x·y = 사람 anchor (정면·뒷모습 발 가운데, 옆모습 등)의 소품 anchor(아래 가운데) 기준 위치 */
export interface LoungeSeatMeta {
  dir: LoungeDirection
  x: number
  y: number
  /** 사람 위에 그 소품 프레임에서 다시 덮어 그릴 사각형 [x, y, w, h] (프레임 왼쪽 위 기준) */
  front?: [number, number, number, number][]
}

/** office-v5-props.json 의 meta.jkCorp.lounge */
export interface LoungeMeta {
  seats: Partial<Record<LoungeSeatProp, LoungeSeatMeta[]>>
  /** 옆모습 자리의 사람 y 에 인물별로 더할 값 (음수 = 위로). 없으면 0 */
  sideOffsetY?: Partial<Record<LoungeState, Record<string, number>>>
}

/** 라운지에 갈 세션. endedAt = 차례가 끝난 시각 (ms), character = 그릴 인물 id (옆모습 높이가 인물마다 다르다) */
export interface LoungePerson {
  id: string
  endedAt: number
  state: LoungeState
  character: string
}

/** 사람 위에 덮을 소품 조각: 소품 프레임 안 frame 을 라운지의 at(왼쪽 위)에 */
export interface LoungeFront {
  frame: Rect
  at: { x: number; y: number }
}

/** 앉은 자리 하나 */
export interface LoungeSeat {
  /** 앉힌 소품 = loungeFixtures 결과의 번호 */
  fixture: number
  sessionId: string
  dir: LoungeDirection
  state: LoungeState
  /** 사람 anchor (옆모습은 sideOffsetY 를 더한 것) */
  x: number
  y: number
  front: LoungeFront[]
}

export interface LoungePlan {
  /** 앉은 자리. 그리는 순서 = 소품 번호 → 자리 y (같으면 메타 순서) */
  seats: LoungeSeat[]
  /** 자리가 모자라 못 앉은 세션 (최근에 차례가 끝난 순) */
  overflow: string[]
  /** 앉은 사람 전신 사각형 = 마우스 올림·클릭·선택 테두리·포커스 */
  figures: Map<string, Rect>
  /** "+N" 명판 왼쪽 위. 못 앉은 사람이 없으면 null */
  more: { count: number; x: number; y: number } | null
}

/** "+N" 명판 왼쪽 위: "Lounge" 이름표 바로 아래 (왼쪽 2타일은 이름표 자리라 탕비 줄·원탁이 오지 않는다) */
export const LOUNGE_MORE_AT = { x: 20, y: 46 }

/**
 * 라운지에 사람을 앉힌다. 자리 = 원탁들(loungeFixtures 순서, 원탁마다 메타 배열 순서) → 소파 → 안락의자,
 * 사람 = 차례가 끝난 시각이 가장 최근인 사람부터 (같으면 id 순). 남는 사람은 "+N". 메타가 없으면(아틀라스가 아직 옛 판) 모두 "+N"
 */
export function planLounge(meta: LoungeMeta | null, fixtures: Fixture[], sizes: PropSizes, people: LoungePerson[]): LoungePlan {
  const slots: { fixture: number; seat: LoungeSeatMeta; order: number }[] = []
  for (const prop of LOUNGE_SEAT_PROPS) {
    fixtures.forEach((fixture, index) => {
      if (fixture.sheet !== 'props' || fixture.prop !== prop) return
      for (const seat of meta?.seats[prop] ?? []) slots.push({ fixture: index, seat, order: slots.length })
    })
  }
  const sorted = [...people].sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const seated = sorted.slice(0, slots.length).map((person, index) => {
    const { fixture: fixtureIndex, seat, order } = slots[index]
    const fixture = fixtures[fixtureIndex]
    const size = sizes[fixture.prop] ?? { w: 0, h: 0 }
    const isSide = seat.dir === 'right' || seat.dir === 'left'
    const offset = isSide ? (meta?.sideOffsetY?.[person.state]?.[person.character] ?? 0) : 0
    const left = fixture.x - size.w / 2
    const top = fixture.y - size.h
    const result: LoungeSeat = {
      fixture: fixtureIndex,
      sessionId: person.id,
      dir: seat.dir,
      state: person.state,
      x: fixture.x + seat.x,
      y: fixture.y + seat.y + offset,
      front: (seat.front ?? []).map(([x, y, w, h]) => ({ frame: { x, y, w, h }, at: { x: left + x, y: top + y } })),
    }
    return { result, order }
  })
  seated.sort((a, b) => a.result.fixture - b.result.fixture || a.result.y - b.result.y || a.order - b.order)
  const seats = seated.map(({ result }) => result)
  const overflow = sorted.slice(slots.length).map((person) => person.id)
  return {
    seats,
    overflow,
    figures: new Map(seats.map((seat) => [seat.sessionId, figureRect(seat.dir, seat.x, seat.y)])),
    more: overflow.length > 0 ? { count: overflow.length, ...LOUNGE_MORE_AT } : null,
  }
}

/** "+N" 카드의 이름 목록: 5명까지는 다, 넘으면 5명 + "and N more" */
export function overflowNames(names: string[], max = 5): string[] {
  return names.length > max ? [...names.slice(0, max), `and ${names.length - max} more`] : names
}
