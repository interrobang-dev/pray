import { describe, expect, it } from 'vitest'
import { parseCharacter } from './character.js'

describe('parseCharacter', () => {
  it('accepts a preset id with default colors', () => {
    expect(parseCharacter({ id: 'lead-suit' })).toEqual({ id: 'lead-suit', hair: null, top: null })
    expect(parseCharacter({ id: 'afro', hair: null, top: null })).toEqual({ id: 'afro', hair: null, top: null })
  })

  it('accepts colors and lowercases them', () => {
    expect(parseCharacter({ id: 'afro', hair: '#2B2622', top: '#c4453c' })).toEqual({ id: 'afro', hair: '#2b2622', top: '#c4453c' })
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
