import { describe, expect, it } from 'vitest'
import { parseMemberRole, pickMemberName, surnameOf, SURNAMES } from './memberName.js'

describe('parseMemberRole', () => {
  it('trims and accepts 1 to 12 characters', () => {
    expect(parseMemberRole(' FE ')).toBe('FE')
    expect(parseMemberRole('UI/UX')).toBe('UI/UX')
    expect(parseMemberRole('Research')).toBe('Research')
    expect(parseMemberRole('a'.repeat(12))).toBe('a'.repeat(12))
  })

  it('refuses empty, too long, brackets, line breaks and non-strings', () => {
    for (const role of ['', '   ', 'a'.repeat(13), '[FE]', 'F]E', 'F[E', 'FE\nBE', 'F\rE', 3, null, undefined]) {
      expect(parseMemberRole(role), JSON.stringify(role)).toBeNull()
    }
  })

  it('checks line breaks after trimming, so a trailing one is just trimmed', () => {
    expect(parseMemberRole('FE\r\n')).toBe('FE')
  })
})

describe('surnameOf', () => {
  it('takes the part after the role, case-insensitive', () => {
    expect(surnameOf('[FE] Hong')).toBe('hong')
    expect(surnameOf('[BE] Kim 2')).toBe('kim 2')
    expect(surnameOf(' [QA]  SMITH ')).toBe('smith')
    expect(surnameOf('웹 개발자')).toBe('웹 개발자')
  })
})

describe('pickMemberName', () => {
  it('has no duplicate surnames', () => {
    expect(new Set(SURNAMES.map((s) => s.toLowerCase())).size).toBe(SURNAMES.length)
  })

  it('makes "[role] surname" with the injected random number', () => {
    expect(pickMemberName('FE', [], () => 0)).toBe(`[FE] ${SURNAMES[0]}`)
    expect(pickMemberName('BE', [], () => 0.9999)).toBe(`[BE] ${SURNAMES.at(-1)}`)
    expect(pickMemberName('BE', [], () => 1)).toBe(`[BE] ${SURNAMES.at(-1)}`)
  })

  it('skips surnames already used in the team even with another role', () => {
    const used = SURNAMES.slice(0, 3).map((s, i) => `[${['FE', 'QA', 'Docs'][i]}] ${s.toUpperCase()}`)
    expect(pickMemberName('BE', used, () => 0)).toBe(`[BE] ${SURNAMES[3]}`)
  })

  it('never repeats a used surname whatever the random number', () => {
    const used = SURNAMES.filter((_, i) => i !== 7).map((s) => `[FE] ${s}`)
    for (const r of [0, 0.3, 0.6, 0.99]) expect(pickMemberName('BE', used, () => r)).toBe(`[BE] ${SURNAMES[7]}`)
  })

  it('adds a number when every surname is taken, then the next number', () => {
    const allTaken = SURNAMES.map((s) => `[FE] ${s}`)
    expect(pickMemberName('BE', allTaken, () => 0)).toBe(`[BE] ${SURNAMES[0]} 2`)
    const twoTaken = [...allTaken, ...SURNAMES.map((s) => `[QA] ${s} 2`)]
    expect(pickMemberName('BE', twoTaken, () => 0)).toBe(`[BE] ${SURNAMES[0]} 3`)
  })
})
