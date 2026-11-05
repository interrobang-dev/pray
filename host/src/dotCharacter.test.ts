import { describe, expect, it } from 'vitest'
import { assignCharacter, charactersInUse, dotLookOf, HAIR_COLORS, pickDotCharacter, TOP_COLORS, type CharacterInUse, type DotCharacter, type DotLook } from './dotCharacter.js'

const characters: DotCharacter[] = [
  { id: 'boss-a', pool: 'lead' },
  { id: 'boss-b', pool: 'lead' },
  { id: 'dev-a', pool: 'member' },
  { id: 'dev-b', pool: 'member' },
  { id: 'dev-c', pool: 'member' },
]
const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)

describe('pickDotCharacter', () => {
  it('같은 세션은 늘 같은 인물', () => {
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, characters)).toBe(pickDotCharacter(id, characters))
  })

  it('역할 구분 없이 전체 인물이 고르게 나온다 (아틀라스의 pool 은 보지 않는다)', () => {
    const picked = new Set(ids.map((id) => pickDotCharacter(id, characters)))
    expect(picked).toEqual(new Set(characters.map((character) => character.id)))
  })

  it('인물이 없으면 null', () => {
    expect(pickDotCharacter(ids[0], [])).toBeNull()
  })
})

describe('dotLookOf', () => {
  it('고른 인물이 아틀라스에 있으면 그 인물과 색', () => {
    const session = { id: ids[0], role: 'lead', character: { id: 'dev-b', hair: '#112233', top: null } }
    expect(dotLookOf(session, characters)).toEqual({ id: 'dev-b', hair: '#112233', top: null })
  })

  it('고른 것이 없거나 아틀라스에 없는 인물이면 해시로 고른 프리셋, 색은 없음 — 역할과 무관', () => {
    for (const character of [null, undefined, { id: 'gone', hair: '#112233', top: '#445566' }]) {
      const look = dotLookOf({ id: ids[1], role: 'lead', character }, characters)
      expect(look).toEqual({ id: pickDotCharacter(ids[1], characters), hair: null, top: null })
    }
    for (const id of ids.slice(0, 20)) expect(dotLookOf({ id, role: 'lead' }, characters)).toEqual(dotLookOf({ id, role: null }, characters))
  })

  it('인물이 없으면 null', () => {
    expect(dotLookOf({ id: ids[0], role: null }, [])).toBeNull()
  })
})

describe('gender', () => {
  const gendered: DotCharacter[] = [
    { id: 'boss-m', pool: 'lead', gender: 'male' },
    { id: 'boss-f', pool: 'lead', gender: 'female' },
    { id: 'dev-m1', pool: 'member', gender: 'male' },
    { id: 'dev-m2', pool: 'member', gender: 'male' },
    { id: 'dev-f1', pool: 'member', gender: 'female' },
    { id: 'dev-f2', pool: 'member', gender: 'female' },
  ]

  it('picks a character of the same gender from every pool', () => {
    const female = new Set(ids.map((id) => pickDotCharacter(id, gendered, 'female')))
    expect(female).toEqual(new Set(['boss-f', 'dev-f1', 'dev-f2']))
    const male = new Set(ids.map((id) => pickDotCharacter(id, gendered, 'male')))
    expect(male).toEqual(new Set(['boss-m', 'dev-m1', 'dev-m2']))
  })

  it('ignores the gender when no one has it, or the atlas has no genders', () => {
    const malesOnly = gendered.filter((c) => c.gender === 'male')
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, malesOnly, 'female')).toBe(pickDotCharacter(id, malesOnly))
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, characters, 'male')).toBe(pickDotCharacter(id, characters))
  })

  it('is the same as before without a gender', () => {
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, gendered, null)).toBe(pickDotCharacter(id, gendered))
    expect(new Set(ids.map((id) => pickDotCharacter(id, gendered))).size).toBe(6)
  })

  it('dotLookOf uses the session gender, but a chosen character comes first', () => {
    expect(dotLookOf({ id: ids[2], role: null, gender: 'female' }, gendered)?.id).toMatch(/-f/)
    expect(dotLookOf({ id: ids[2], role: 'lead', gender: 'male' }, gendered)?.id).toMatch(/-m/)
    const character = { id: 'dev-m1', hair: null, top: null }
    expect(dotLookOf({ id: ids[2], role: null, gender: 'female', character }, gendered)?.id).toBe('dev-m1')
  })
})

describe('assignCharacter', () => {
  const pool: DotCharacter[] = [
    { id: 'boss-m1', pool: 'lead', gender: 'male' },
    { id: 'boss-f1', pool: 'lead', gender: 'female' },
    { id: 'dev-m1', pool: 'member', gender: 'male' },
    { id: 'dev-f1', pool: 'member', gender: 'female' },
  ]
  const use = (sessionId: string, look: Partial<DotLook> & { id: string }, teamId: string | null = null): CharacterInUse => ({
    sessionId,
    teamId,
    look: { hair: null, top: null, ...look },
  })
  const session = (id: string, teamId: string | null = null, gender: 'male' | 'female' | null = null) => ({ id, gender, teamId })

  it('picks the least used character of the whole atlas', () => {
    const inUse = [use('a', { id: 'boss-m1' }), use('b', { id: 'boss-f1' }), use('c', { id: 'dev-m1' })]
    for (const id of ids.slice(0, 30)) expect(assignCharacter(session(id), pool, inUse)).toEqual({ id: 'dev-f1', hair: null, top: null })
  })

  it('spreads sessions one per character before any repeats', () => {
    const inUse: CharacterInUse[] = []
    for (const id of ids.slice(0, 4)) inUse.push({ sessionId: id, teamId: null, look: assignCharacter(session(id), pool, inUse)! })
    expect(new Set(inUse.map((u) => u.look.id))).toEqual(new Set(pool.map((c) => c.id)))
    expect(inUse.every((u) => u.look.hair === null && u.look.top === null)).toBe(true)
  })

  it('among the least used, prefers one the same team does not use', () => {
    const inUse = [use('a', { id: 'boss-m1' }, 'team-1'), use('b', { id: 'boss-f1' }, 'team-2'), use('c', { id: 'dev-m1' }, 'team-1'), use('d', { id: 'dev-f1' }, 'team-3')]
    for (const id of ids.slice(0, 30)) {
      // 모두 한 번씩 쓰였으니 team-1 이 안 쓰는 boss-f1·dev-f1 중에서
      expect(['boss-f1', 'dev-f1']).toContain(assignCharacter(session(id, 'team-1'), pool, inUse)?.id)
    }
  })

  it('falls back to the session hash among equals, and is deterministic', () => {
    const picks = new Set(ids.map((id) => assignCharacter(session(id), pool, [])?.id))
    expect(picks).toEqual(new Set(pool.map((c) => c.id)))
    for (const id of ids.slice(0, 10)) expect(assignCharacter(session(id), pool, [])).toEqual(assignCharacter(session(id), pool, []))
    // 같은 팀이 다 쓰고 있으면 팀 조건을 무시하고 해시
    const allInTeam = pool.map((c, i) => use(`t${i}`, { id: c.id }, 'team-1'))
    expect(assignCharacter(session(ids[0], 'team-1'), pool, allInTeam)?.id).toBe(pickDotCharacter(ids[0], pool))
  })

  it('gives an unused color combo when the character is taken: default colors first, then the lists', () => {
    const oneMale = pool.filter((c) => c.id !== 'dev-m1')
    // 남자는 boss-m1 하나뿐이고 기본색이 비어 있다
    const first = assignCharacter(session(ids[0], null, 'male'), oneMale, [use('a', { id: 'boss-m1', hair: '#2a2522', top: '#f2f2f0' })])
    expect(first).toEqual({ id: 'boss-m1', hair: null, top: null })
    const second = assignCharacter(session(ids[0], null, 'male'), oneMale, [use('a', { id: 'boss-m1' })])!
    expect(second.id).toBe('boss-m1')
    expect(HAIR_COLORS).toContain(second.hair)
    expect(TOP_COLORS).toContain(second.top)
    // 다섯째부터는 색이 모두 다르다
    const inUse: CharacterInUse[] = []
    for (const id of ids.slice(0, 40)) inUse.push({ sessionId: id, teamId: null, look: assignCharacter(session(id), pool, inUse)! })
    expect(new Set(inUse.map((u) => `${u.look.id}|${u.look.hair}|${u.look.top}`)).size).toBe(40)
    expect(inUse.slice(4).every((u) => u.look.hair !== null && u.look.top !== null)).toBe(true)
  })

  it('after the default colors, varies both hair and top from pick to pick (shuffled by the session hash)', () => {
    const one: DotCharacter[] = [{ id: 'solo', pool: 'member' }]
    const inUse: CharacterInUse[] = []
    for (let step = 0; step < 9; step++) inUse.push({ sessionId: `s${step}`, teamId: null, look: assignCharacter(session(ids[0]), one, inUse)! })
    const colored = inUse.slice(1).map((u) => u.look)
    expect(new Set(colored.map((look) => look.hair)).size).toBeGreaterThan(3)
    expect(new Set(colored.map((look) => look.top)).size).toBeGreaterThan(3)
    // 같은 세션이면 같은 순서
    expect(assignCharacter(session(ids[0]), one, inUse.slice(0, 3))).toEqual(assignCharacter(session(ids[0]), one, inUse.slice(0, 3)))
  })

  it('reuses the hash combo when every combo is taken', () => {
    const full = [use('base', { id: 'dev-f1' }), ...HAIR_COLORS.flatMap((hair) => TOP_COLORS.map((top) => use(`${hair}${top}`, { id: 'dev-f1', hair, top })))]
    const oneFemale = pool.filter((c) => c.id !== 'boss-f1')
    const picked = assignCharacter(session(ids[0], null, 'female'), oneFemale, full)
    expect(picked?.id).toBe('dev-f1')
    expect(picked?.hair).not.toBeNull()
  })

  it('uses the gender when given, ignores it when null or missing in the atlas', () => {
    for (const id of ids.slice(0, 20)) expect(['boss-f1', 'dev-f1']).toContain(assignCharacter(session(id, null, 'female'), pool, [])?.id)
    const noFemales = pool.filter((c) => c.gender !== 'female')
    expect(['boss-m1', 'dev-m1']).toContain(assignCharacter(session(ids[0], null, 'female'), noFemales, [])?.id)
  })

  it('is null without characters, and ignores its own session', () => {
    expect(assignCharacter(session(ids[0]), [], [])).toBeNull()
    const self = [use(ids[0], { id: 'boss-m1' }), use('b', { id: 'boss-f1' }), use('c', { id: 'dev-m1' })]
    const picked = assignCharacter(session(ids[0]), pool, self)
    expect(['boss-m1', 'dev-f1']).toContain(picked?.id)
    expect(picked?.hair).toBeNull()
  })
})

describe('dotLookOf with an auto assignment', () => {
  it('shows the saved assignment and its colors', () => {
    const character = { id: 'dev-c', hair: '#2a2522', top: '#f2f2f0', isAuto: true }
    expect(dotLookOf({ id: ids[0], role: null, character }, characters)).toEqual({ id: 'dev-c', hair: '#2a2522', top: '#f2f2f0' })
  })
})

describe('charactersInUse', () => {
  it('uses the saved look, else the hash pick, and drops sessions with no character', () => {
    const sessions = [
      { id: ids[0], role: 'lead', teamId: 't', character: { id: 'dev-a', hair: '#2a2522', top: null, isAuto: true } },
      { id: ids[1], role: null, teamId: null },
    ]
    expect(charactersInUse(sessions, characters)).toEqual([
      { sessionId: ids[0], teamId: 't', look: { id: 'dev-a', hair: '#2a2522', top: null } },
      { sessionId: ids[1], teamId: null, look: { id: pickDotCharacter(ids[1], characters), hair: null, top: null } },
    ])
    expect(charactersInUse(sessions, [])).toEqual([])
  })
})
