import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { charactersOfSheet, makeCharacterSheetReader, parseCharacter } from './character.js'

describe('parseCharacter', () => {
  it('accepts a preset id with default colors', () => {
    expect(parseCharacter({ id: 'lead-suit' })).toEqual({ id: 'lead-suit', hair: null, top: null })
    expect(parseCharacter({ id: 'afro', hair: null, top: null })).toEqual({ id: 'afro', hair: null, top: null })
  })

  it('accepts colors and lowercases them', () => {
    expect(parseCharacter({ id: 'afro', hair: '#2B2622', top: '#c4453c' })).toEqual({ id: 'afro', hair: '#2b2622', top: '#c4453c' })
  })

  it('keeps isAuto only when true (a candidate picked with the Auto card)', () => {
    expect(parseCharacter({ id: 'afro', hair: '#2a2522', top: null, isAuto: true })).toEqual({ id: 'afro', hair: '#2a2522', top: null, isAuto: true })
    expect(parseCharacter({ id: 'afro', isAuto: false })).toEqual({ id: 'afro', hair: null, top: null })
    expect(parseCharacter({ id: 'afro', isAuto: 'yes' })).toBeUndefined()
  })

  it('clears with a null id', () => {
    expect(parseCharacter({ id: null })).toBeNull()
  })

  it('rejects a wrong shape', () => {
    for (const body of [null, 'afro', {}, { id: '' }, { id: 'Afro' }, { id: '../x' }, { id: 'a'.repeat(41) }, { id: 'afro', hair: 'red' }, { id: 'afro', top: '#fff' }, { id: 'afro', top: 1 }]) {
      expect(parseCharacter(body)).toBeUndefined()
    }
  })
})

describe('charactersOfSheet', () => {
  it('keeps well-formed characters only', () => {
    const sheet = { meta: { jkCorp: { characters: [{ id: 'lead', pool: 'lead', gender: 'male' }, { id: 'afro', pool: 'member', gender: 'x' }, { id: 'Bad', pool: 'member' }, { id: 'x', pool: 'boss' }, null] } } }
    expect(charactersOfSheet(sheet)).toEqual([{ id: 'lead', pool: 'lead', gender: 'male' }, { id: 'afro', pool: 'member' }])
  })

  it('is null without characters', () => {
    for (const sheet of [null, {}, { meta: {} }, { meta: { jkCorp: { characters: [] } } }, { meta: { jkCorp: { characters: 'x' } } }]) expect(charactersOfSheet(sheet)).toBeNull()
  })
})

describe('makeCharacterSheetReader', () => {
  it('reads, caches by mtime and size, and is null when missing or broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jk-sheet-'))
    try {
      const path = join(dir, 'sheet.json')
      const read = makeCharacterSheetReader(path)
      expect(read()).toBeNull()
      writeFileSync(path, JSON.stringify({ meta: { jkCorp: { characters: [{ id: 'lead', pool: 'lead' }] } } }))
      const first = read()
      expect(first).toEqual([{ id: 'lead', pool: 'lead' }])
      expect(read()).toBe(first)
      writeFileSync(path, '{ broken')
      expect(read()).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
