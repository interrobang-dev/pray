import { describe, expect, it } from 'vitest'
import { dotLookOf, pickDotCharacter, type DotCharacter } from './dotCharacter'

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
