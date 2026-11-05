import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as host from '../../host/src/dotCharacter'
import { candidatesOf, dotLookOf, hashOf, pickDotCharacter, type DotCharacter } from './dotCharacter'

/** 실제 정면 아틀라스의 인물 목록 (화면·서버와 같은 판) */
const sheet = JSON.parse(readFileSync(join(__dirname, '..', '..', 'web', 'public', 'office', `${host.CHARACTER_SHEET}.json`), 'utf8')) as {
  meta: { jkCorp: { characters: DotCharacter[] } }
}
const characters = sheet.meta.jkCorp.characters
const ids = Array.from({ length: 300 }, (_, index) => `${index.toString(16).padStart(8, '0')}-4cb5-a498-${(index * 7919).toString(36)}`)
const roles = ['lead', 'member', null] as const
const genders = ['male', 'female', null] as const

describe('dotCharacter (host/src/dotCharacter.ts 사본)', () => {
  it('아틀라스 인물이 있다', () => {
    expect(characters.length).toBeGreaterThan(0)
  })

  it('hashOf 가 같다', () => {
    for (const id of ids) expect(hashOf(id)).toBe(host.hashOf(id))
  })

  it('candidatesOf·pickDotCharacter 가 같다 (성별·빈 목록)', () => {
    for (const gender of genders) {
      expect(candidatesOf(characters, gender)).toEqual(host.candidatesOf(characters, gender))
      expect(candidatesOf([], gender)).toEqual(host.candidatesOf([], gender))
      for (const id of ids) expect(pickDotCharacter(id, characters, gender)).toBe(host.pickDotCharacter(id, characters, gender))
    }
  })

  it('dotLookOf 가 같다 (저장된 것 → 해시, 아틀라스에 없는 저장 인물은 해시)', () => {
    const saved = [
      null,
      undefined,
      { id: characters[0].id, hair: '#e3b860', top: null },
      { id: 'gone', hair: null, top: '#c83a3a' },
      { id: characters[characters.length - 1].id, hair: null, top: null, isAuto: true },
    ]
    for (const [index, id] of ids.entries()) {
      const session = { id, role: roles[index % 3], gender: genders[index % 3], character: saved[index % saved.length] }
      expect(dotLookOf(session, characters)).toEqual(host.dotLookOf(session, characters))
    }
    expect(dotLookOf({ id: 'x', role: null }, [])).toBeNull()
  })
})
