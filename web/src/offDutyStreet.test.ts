import { describe, expect, it } from 'vitest'
import atlas from '../public/office/office-v6-street.json'
import { placeIdOf, planStreet, streetPlaceKey, type Rect, type StreetMeta, type StreetPerson, type StreetPropMeta } from './offDutyStreet'

const street = atlas.meta.jkCorp.street as unknown as StreetMeta
const props = atlas.meta.jkCorp.props as Record<string, StreetPropMeta>
const sizes = Object.fromEntries(Object.entries(atlas.frames).map(([name, frame]) => [name, { w: frame.frame.w, h: frame.frame.h }]))

const person = (id: string, minutes: number, character = 'member'): StreetPerson => ({ id, minutes, character })
const plan = (width: number, people: StreetPerson[]) => planStreet(street, width, people, props, sizes)
const pieceXs = (width: number) =>
  plan(width, []).pieces.map((piece) => `${piece.kind === 'place' ? piece.place.id : piece.kind === 'house' ? 'house' : piece.id}@${piece.x}`)

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('placeIdOf', () => {
  it('퇴근 후 [0,60) 버스 · [60,360) 카페 · [360,1440) 공원 · 1440 부터 집, 음수는 버스', () => {
    const cases: [number, string][] = [
      [-5, 'bus'],
      [0, 'bus'],
      [59, 'bus'],
      [60, 'cafe'],
      [359, 'cafe'],
      [360, 'park'],
      [1439, 'park'],
      [1440, 'home'],
      [7 * 1440, 'home'],
      [Infinity, 'home'],
    ]
    for (const [minutes, id] of cases) expect(placeIdOf(street.places, minutes)).toBe(id)
  })
})

describe('streetPlaceKey', () => {
  it('누가 장소 경계를 넘을 때만 바뀐다 (순서와 무관)', () => {
    const at = (minutes: number) => streetPlaceKey(street.places, [{ id: 'b', minutes: 300 }, { id: 'a', minutes }])
    expect(at(10)).toBe(at(59))
    expect(at(59)).not.toBe(at(60))
    expect(streetPlaceKey(street.places, [{ id: 'a', minutes: 1 }, { id: 'b', minutes: 2 }])).toBe(
      streetPlaceKey(street.places, [{ id: 'b', minutes: 2 }, { id: 'a', minutes: 1 }]),
    )
  })
})

describe('planStreet 폭 단계', () => {
  it('minWidth 가 폭 이하인 첫 단계, 없으면 마지막 단계', () => {
    expect([3000, 2006, 2005, 1768, 1767, 1480, 900].map((width) => plan(width, []).level)).toEqual([0, 0, 1, 1, 2, 2, 2])
  })

  it('0단계: 사이 채우기가 있고 집 묶음이 minWidth 끝에서 끝난 뒤 거리 채우기를 띠 끝까지', () => {
    expect(pieceXs(2400)).toEqual([
      'start@0',
      'bus@40',
      'bus@498',
      'cafe@562',
      'cafe@892',
      'park@962',
      'park@1362',
      'house@1570',
      'house@1858',
      'street@2006',
      'street@2326',
    ])
  })

  it('단계·집 묶음은 width 로 정하고 거리 채우기는 fillWidth(띠 끝)까지', () => {
    const result = planStreet(street, 1480, [], props, sizes, 2400)
    expect(result.level).toBe(2)
    expect(result.pieces.filter((piece) => piece.kind === 'filler').map((piece) => piece.x)).toEqual([1480, 1800, 2120])
  })

  it('1단계는 장소끼리 붙고 집 2채, 2단계는 집 1채 (둘 다 minWidth 에서 끝난다)', () => {
    expect(pieceXs(1768)).toEqual(['bus@0', 'cafe@458', 'park@788', 'house@1332', 'house@1620'])
    expect(pieceXs(1480)).toEqual(['bus@0', 'cafe@458', 'park@788', 'house@1332'])
  })
})

describe('planStreet 자리', () => {
  it('장소 안은 최근 퇴근부터, 남는 사람은 그 장소 more 자리에 +N', () => {
    const people = [5, 1, 30, 12, 50, 8, 3].map((minutes, i) => person(`s${i}`, minutes))
    const result = plan(2400, people)
    const bus = result.pieces.find((piece) => piece.kind === 'place' && piece.place.id === 'bus')
    expect(bus?.kind === 'place' && bus.seats.map((seat) => seat.sessionId)).toEqual(['s1', 's6', 's0', 's5', 's3'])
    expect(result.overflows).toEqual([{ place: 'bus', count: 2, x: 40 + 432, y: 206 - 180 }])
    expect(result.placeOf.get('s4')).toBe('bus')
    expect(result.figures.has('s4')).toBe(false)
  })

  it('정면 자리는 발 가운데, 전신 사각형은 발 위로', () => {
    const result = plan(2400, [person('a', 1)])
    expect(result.figures.get('a')).toEqual({ x: 40 + 72 - 24, y: 206 - 112, w: 48, h: 112 })
  })

  it('카페 의자는 앉은 사람 엉덩이 높이(sideSeatLift)에 맞춘 그림, left 는 뒤집어 x − dx. 빈 자리는 변화 0 의자', () => {
    const result = plan(2400, [person('a', 100, 'flannel'), person('b', 120, 'afro')])
    const cafe = result.pieces.find((piece) => piece.kind === 'place' && piece.place.id === 'cafe')
    if (cafe?.kind !== 'place') throw new Error('카페 없음')
    expect(cafe.seats.map((seat) => [seat.sessionId, seat.dir, seat.chair])).toEqual([
      ['a', 'right', { prop: 'prop/cafe-chair-h48', x: 562 + 14 + 7, isFlipped: false }],
      ['b', 'left', { prop: 'prop/cafe-chair-h42', x: 562 + 136 - 7, isFlipped: true }],
      [null, 'right', { prop: 'prop/cafe-chair', x: 562 + 174 + 7, isFlipped: false }],
      [null, 'left', { prop: 'prop/cafe-chair', x: 562 + 296 - 7, isFlipped: true }],
    ])
    // 왼쪽을 보는 사람의 사각형은 등에서 왼쪽으로
    expect(result.figures.get('b')).toEqual({ x: 562 + 136 + 8 - 56, y: 206 - 104, w: 56, h: 104 })
  })

  it('집 창 얼굴: 머리 가운데를 창 가운데에 두고 창 + 위·옆 창틀만큼 자른다', () => {
    const result = plan(2400, [person('a', 2000, 'afro')])
    const house = result.pieces.find((piece) => piece.kind === 'house')
    if (house?.kind !== 'house') throw new Error('집 없음')
    expect(house.prop).toBe('prop/house-cream')
    // 집 그림 280×168, 아래 가운데 (1570, 176) → 왼쪽 위 (1430, 8). 창 0 = (43, 94) 46×36 창틀 3, afro 머리 [15, 20, 66]
    expect(house.windows[0]).toEqual({
      sessionId: 'a',
      glass: { x: 1473, y: 102, w: 46, h: 36 },
      at: { x: 1470, y: 99 },
      crop: { x: 14, y: 19, w: 52, h: 39 },
    })
    expect(house.windows[1].sessionId).toBeNull()
    expect(result.figures.get('a')).toEqual({ x: 1470, y: 99, w: 52, h: 39 })
  })

  it('보이는 사람의 전신 사각형은 서로 겹치지 않고, 앉은 수 + N = 전체', () => {
    const minutes = [2, 5, 9, 14, 22, 31, 47, 75, 110, 150, 230, 300, 420, 700, 1000, 1600, 2900, 4400, 6000, 8000, 9000, 9500]
    const result = plan(2400, minutes.map((m, i) => person(`s${i}`, m, ['afro', 'flannel', 'professor', 'hijab'][i % 4])))
    const rects = [...result.figures.values()]
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false)
    const overflow = result.overflows.reduce((sum, item) => sum + item.count, 0)
    expect(rects.length + overflow).toBe(minutes.length)
    expect(result.overflows.map((item) => [item.place, item.count])).toEqual([
      ['bus', 2],
      ['cafe', 1],
      ['home', 3],
    ])
    // "+N" 은 장소마다 오른쪽 위 같은 하늘 줄 (발 선 −180)
    expect(result.overflows.map((item) => item.y)).toEqual([26, 26, 26])
  })
})

describe('planStreet 집 묶음', () => {
  const home = (count: number) => Array.from({ length: count }, (_, i) => person(`h${i}`, 2000 + i))

  it('0단계는 폭이 허락하고 집 인원이 넘칠 때만 묶음을 늘린다 (묶음 사이 gap, 집 색은 차례로)', () => {
    expect(plan(2006 + 644, home(4)).units).toBe(1)
    const two = plan(2006 + 644, home(5))
    expect(two.units).toBe(2)
    expect(two.pieces.filter((piece) => piece.kind === 'house').map((piece) => piece.kind === 'house' && `${piece.prop}@${piece.x}`)).toEqual([
      'prop/house-cream@1570',
      'prop/house-sage@1858',
      'prop/house-blue@2214',
      'prop/house-peach@2502',
    ])
    expect(two.pieces.some((piece) => piece.kind === 'filler' && piece.id === 'gap' && piece.x === 2006)).toBe(true)
    expect(two.overflows).toEqual([])
    // 폭이 모자라면 묶음 1에 +N 은 마지막 집 오른쪽 처마 끝 위
    expect(plan(2006 + 643, home(5)).units).toBe(1)
    expect(plan(2006 + 643, home(5)).overflows).toEqual([{ place: 'home', count: 1, x: 1858 + 140, y: 206 - 30 - 150 }])
  })

  it('1·2단계는 묶음을 늘리지 않는다', () => {
    expect(plan(1800, home(12)).units).toBe(1)
    expect(plan(1500, home(12)).overflows).toEqual([{ place: 'home', count: 10, x: 1332 + 140, y: 206 - 30 - 150 }])
  })
})
