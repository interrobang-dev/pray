import { describe, expect, it } from 'vitest'
import { pickDotCharacter, type DotCharacter } from './dotCharacter'

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
