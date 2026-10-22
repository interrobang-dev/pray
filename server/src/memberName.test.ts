import { describe, expect, it } from 'vitest'
import { FEMALE_NAMES, givenNameOf, MALE_NAMES, parseGender, parseMemberRole, pickMemberName } from './memberName.js'

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

describe('parseGender', () => {
  it('accepts male and female only', () => {
    expect(parseGender('male')).toBe('male')
    expect(parseGender('female')).toBe('female')
    for (const value of ['Male', '', 'other', null, undefined, 1]) expect(parseGender(value), JSON.stringify(value)).toBeNull()
  })
})

describe('givenNameOf', () => {
  it('takes the part after the role, case-insensitive', () => {
    expect(givenNameOf('[FE] Minji')).toBe('minji')
    expect(givenNameOf('[BE] Junho 2')).toBe('junho 2')
    expect(givenNameOf(' [QA]  EMMA ')).toBe('emma')
    expect(givenNameOf('웹 개발자')).toBe('웹 개발자')
  })
})

describe('pickMemberName', () => {
  const ALL = [...FEMALE_NAMES, ...MALE_NAMES]

  it('has about 25 names per gender and no duplicates across both', () => {
    expect(FEMALE_NAMES.length).toBe(25)
    expect(MALE_NAMES.length).toBe(25)
    expect(new Set(ALL.map((n) => n.toLowerCase())).size).toBe(ALL.length)
  })

  it('makes "[role] name" with the gender of that name, using the injected random number', () => {
    expect(pickMemberName('FE', [], () => 0)).toEqual({ name: `[FE] ${FEMALE_NAMES[0]}`, gender: 'female' })
    expect(pickMemberName('BE', [], () => 0.9999)).toEqual({ name: `[BE] ${MALE_NAMES.at(-1)}`, gender: 'male' })
    expect(pickMemberName('BE', [], () => 1)).toEqual({ name: `[BE] ${MALE_NAMES.at(-1)}`, gender: 'male' })
  })

  it('skips names already used in the team even with another role', () => {
    const used = ALL.slice(0, 3).map((n, i) => `[${['FE', 'QA', 'Docs'][i]}] ${n.toUpperCase()}`)
    expect(pickMemberName('BE', used, () => 0).name).toBe(`[BE] ${ALL[3]}`)
  })

  it('never repeats a used name whatever the random number, and keeps the gender of the free one', () => {
    const free = FEMALE_NAMES.length + 4
    const used = ALL.filter((_, i) => i !== free).map((n) => `[FE] ${n}`)
    for (const r of [0, 0.3, 0.6, 0.99]) expect(pickMemberName('BE', used, () => r)).toEqual({ name: `[BE] ${ALL[free]}`, gender: 'male' })
  })

  it('works alongside old "[role] surname" names', () => {
    const used = ['[FE] Kim', '[BE] Park 2', '[QA] Smith', `[Dev] ${ALL[0]}`]
    expect(pickMemberName('Dev', used, () => 0).name).toBe(`[Dev] ${ALL[1]}`)
  })

  it('adds a number when every name is taken, then the next number', () => {
    const allTaken = ALL.map((n) => `[FE] ${n}`)
    expect(pickMemberName('BE', allTaken, () => 0)).toEqual({ name: `[BE] ${ALL[0]} 2`, gender: 'female' })
    const twoTaken = [...allTaken, ...ALL.map((n) => `[QA] ${n} 2`)]
    expect(pickMemberName('BE', twoTaken, () => 0).name).toBe(`[BE] ${ALL[0]} 3`)
  })
})
