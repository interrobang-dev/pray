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
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, false, characters)).toBe(pickDotCharacter(id, false, characters))
  })

  it('지시자는 리더 풀, 나머지는 팀원 풀에서만', () => {
    for (const id of ids) {
      expect(pickDotCharacter(id, true, characters)).toMatch(/^boss-/)
      expect(pickDotCharacter(id, false, characters)).toMatch(/^dev-/)
    }
  })

  it('풀의 인물이 고르게 나온다', () => {
    const picked = new Set(ids.map((id) => pickDotCharacter(id, false, characters)))
    expect(picked).toEqual(new Set(['dev-a', 'dev-b', 'dev-c']))
  })

  it('풀이 비면 전체에서, 인물이 없으면 null', () => {
    const membersOnly = characters.filter((character) => character.pool === 'member')
    expect(pickDotCharacter(ids[0], true, membersOnly)).toMatch(/^dev-/)
    expect(pickDotCharacter(ids[0], false, [])).toBeNull()
  })
})

describe('dotLookOf', () => {
  it('고른 인물이 아틀라스에 있으면 그 인물과 색', () => {
    const session = { id: ids[0], role: 'lead', character: { id: 'dev-b', hair: '#112233', top: null } }
    expect(dotLookOf(session, characters)).toEqual({ id: 'dev-b', hair: '#112233', top: null })
  })

  it('고른 것이 없거나 아틀라스에 없는 인물이면 해시로 고른 프리셋, 색은 없음', () => {
    for (const character of [null, undefined, { id: 'gone', hair: '#112233', top: '#445566' }]) {
      const look = dotLookOf({ id: ids[1], role: 'lead', character }, characters)
      expect(look).toEqual({ id: pickDotCharacter(ids[1], true, characters), hair: null, top: null })
    }
    expect(dotLookOf({ id: ids[1], role: null }, characters)?.id).toMatch(/^dev-/)
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

  it('picks a character of the same pool and gender', () => {
    for (const id of ids.slice(0, 50)) {
      expect(pickDotCharacter(id, false, gendered, 'female')).toMatch(/^dev-f/)
      expect(pickDotCharacter(id, false, gendered, 'male')).toMatch(/^dev-m/)
      expect(pickDotCharacter(id, true, gendered, 'female')).toBe('boss-f')
    }
    const picked = new Set(ids.map((id) => pickDotCharacter(id, false, gendered, 'female')))
    expect(picked).toEqual(new Set(['dev-f1', 'dev-f2']))
  })

  it('ignores the gender when the pool has no one of it, or the atlas has no genders', () => {
    const maleLeadsOnly = gendered.filter((c) => c.id !== 'boss-f')
    expect(pickDotCharacter(ids[0], true, maleLeadsOnly, 'female')).toBe('boss-m')
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, false, characters, 'male')).toBe(pickDotCharacter(id, false, characters))
  })

  it('is the same as before without a gender', () => {
    for (const id of ids.slice(0, 20)) expect(pickDotCharacter(id, false, gendered, null)).toBe(pickDotCharacter(id, false, gendered))
    const all = new Set(ids.map((id) => pickDotCharacter(id, false, gendered)))
    expect(all.size).toBe(4)
  })

  it('dotLookOf uses the session gender, but a chosen character comes first', () => {
    expect(dotLookOf({ id: ids[2], role: null, gender: 'female' }, gendered)?.id).toMatch(/^dev-f/)
    expect(dotLookOf({ id: ids[2], role: 'lead', gender: 'male' }, gendered)?.id).toBe('boss-m')
    const character = { id: 'dev-m1', hair: null, top: null }
    expect(dotLookOf({ id: ids[2], role: null, gender: 'female', character }, gendered)?.id).toBe('dev-m1')
  })
})

describe('assignCharacter', () => {
  const pool: DotCharacter[] = [
    { id: 'boss-m1', pool: 'lead', gender: 'male' },
    { id: 'boss-f1', pool: 'lead', gender: 'female' },
    { id: 'boss-m2', pool: 'lead', gender: 'male' },
    { id: 'boss-f2', pool: 'lead', gender: 'female' },
    { id: 'dev-m1', pool: 'member', gender: 'male' },
    { id: 'dev-f1', pool: 'member', gender: 'female' },
    { id: 'dev-m2', pool: 'member', gender: 'male' },
  ]
  const use = (sessionId: string, look: Partial<DotLook> & { id: string }, teamId: string | null = null): CharacterInUse => ({
    sessionId,
    teamId,
    look: { hair: null, top: null, ...look },
  })
  const lead = (id: string, teamId: string | null = null, gender: 'male' | 'female' | null = null) => ({ id, isLead: true, gender, teamId })

  it('picks the least used candidate of the pool', () => {
    const inUse = [use('a', { id: 'boss-m1' }), use('b', { id: 'boss-f1' }), use('c', { id: 'boss-m2' }), use('d', { id: 'dev-m1' })]
    for (const id of ids.slice(0, 30)) expect(assignCharacter(lead(id), pool, inUse)).toEqual({ id: 'boss-f2', hair: null, top: null })
    const member = assignCharacter({ id: ids[0], isLead: false, gender: null, teamId: null }, pool, inUse)
    expect(['dev-f1', 'dev-m2']).toContain(member?.id)
  })

  it('spreads leads one per character before any repeats', () => {
    const inUse: CharacterInUse[] = []
    for (const id of ids.slice(0, 4)) inUse.push({ sessionId: id, teamId: null, look: assignCharacter(lead(id), pool, inUse)! })
    expect(new Set(inUse.map((u) => u.look.id))).toEqual(new Set(['boss-m1', 'boss-f1', 'boss-m2', 'boss-f2']))
    expect(inUse.every((u) => u.look.hair === null && u.look.top === null)).toBe(true)
  })

  it('among the least used, prefers one the same team does not use', () => {
    const inUse = [use('a', { id: 'boss-m1' }, 'team-1'), use('b', { id: 'boss-f1' }, 'team-2')]
    for (const id of ids.slice(0, 30)) {
      const picked = assignCharacter(lead(id, 'team-1'), pool, [...inUse, use('c', { id: 'boss-m2' }, 'team-1'), use('d', { id: 'boss-f2' }, 'team-3')])
      // 모두 한 번씩 쓰였으니 team-1 이 안 쓰는 boss-f1·boss-f2 중에서
      expect(['boss-f1', 'boss-f2']).toContain(picked?.id)
    }
  })

  it('falls back to the session hash among equals, and is deterministic', () => {
    const picks = new Set(ids.map((id) => assignCharacter(lead(id), pool, [])?.id))
    expect(picks).toEqual(new Set(['boss-m1', 'boss-f1', 'boss-m2', 'boss-f2']))
    for (const id of ids.slice(0, 10)) expect(assignCharacter(lead(id), pool, [])).toEqual(assignCharacter(lead(id), pool, []))
    // 같은 팀이 다 쓰고 있으면 팀 조건을 무시하고 해시
    const allInTeam = pool.filter((c) => c.pool === 'lead').map((c, i) => use(`t${i}`, { id: c.id }, 'team-1'))
    expect(assignCharacter(lead(ids[0], 'team-1'), pool, allInTeam)?.id).toBe(pickDotCharacter(ids[0], true, pool))
  })

  it('gives an unused color combo when the character is taken: default colors first, then the lists', () => {
    const oneMale = pool.filter((c) => c.id !== 'boss-m2')
    // boss-m1 하나뿐이고 기본색이 비어 있다
    const first = assignCharacter(lead(ids[0], null, 'male'), oneMale, [use('a', { id: 'boss-m1', hair: '#2a2522', top: '#f2f2f0' })])
    expect(first).toEqual({ id: 'boss-m1', hair: null, top: null })
    const second = assignCharacter(lead(ids[0], null, 'male'), oneMale, [use('a', { id: 'boss-m1' })])!
    expect(second.id).toBe('boss-m1')
    expect(HAIR_COLORS).toContain(second.hair)
    expect(TOP_COLORS).toContain(second.top)
    // 다섯째부터는 색이 모두 다르다
    const inUse: CharacterInUse[] = []
    for (const id of ids.slice(0, 40)) inUse.push({ sessionId: id, teamId: null, look: assignCharacter(lead(id), pool, inUse)! })
    expect(new Set(inUse.map((u) => `${u.look.id}|${u.look.hair}|${u.look.top}`)).size).toBe(40)
    expect(inUse.slice(4).every((u) => u.look.hair !== null && u.look.top !== null)).toBe(true)
  })

  it('reuses the hash combo when every combo is taken', () => {
    const full = [use('base', { id: 'dev-f1' }), ...HAIR_COLORS.flatMap((hair) => TOP_COLORS.map((top) => use(`${hair}${top}`, { id: 'dev-f1', hair, top })))]
    const picked = assignCharacter({ id: ids[0], isLead: false, gender: 'female', teamId: null }, pool, full)
    expect(picked?.id).toBe('dev-f1')
    expect(picked?.hair).not.toBeNull()
  })

  it('uses the gender when given, ignores it when null or missing in the pool', () => {
    for (const id of ids.slice(0, 20)) expect(assignCharacter(lead(id, null, 'female'), pool, [])?.id).toMatch(/^boss-f/)
    const noFemaleMembers = pool.filter((c) => c.id !== 'dev-f1')
    expect(assignCharacter({ id: ids[0], isLead: false, gender: 'female', teamId: null }, noFemaleMembers, [])?.id).toMatch(/^dev-m/)
  })

  it('falls back to the other pool when one is empty, null without characters, and ignores its own session', () => {
    const membersOnly = pool.filter((c) => c.pool === 'member')
    expect(assignCharacter(lead(ids[0]), membersOnly, [])?.id).toMatch(/^dev-/)
    expect(assignCharacter(lead(ids[0]), [], [])).toBeNull()
    const self = [use(ids[0], { id: 'boss-m1' }), use('b', { id: 'boss-f1' }), use('c', { id: 'boss-m2' })]
    const picked = assignCharacter(lead(ids[0]), pool, self)
    expect(['boss-m1', 'boss-f2']).toContain(picked?.id)
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
      { sessionId: ids[1], teamId: null, look: { id: pickDotCharacter(ids[1], false, characters), hair: null, top: null } },
    ])
    expect(charactersInUse(sessions, [])).toEqual([])
  })
})
