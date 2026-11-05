import { describe, expect, it } from 'vitest'
import {
  FEMALE_NAMES,
  givenNameOf,
  MALE_NAMES,
  nameAndPosition,
  parseGender,
  parseMemberRole,
  parsePositionInput,
  pickMemberName,
  withPosition,
} from './memberName.js'

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

describe('parsePositionInput', () => {
  it('treats a missing, null or blank position as none', () => {
    for (const value of [undefined, null, '', '   ']) expect(parsePositionInput(value), JSON.stringify(value)).toBeNull()
  })

  it('trims a valid position and refuses a malformed one', () => {
    expect(parsePositionInput(' FE ')).toBe('FE')
    for (const value of ['a'.repeat(13), '[FE]', 'F\nE', 3, {}]) expect(parsePositionInput(value), JSON.stringify(value)).toBeUndefined()
  })
})

describe('givenNameOf', () => {
  it('compares names trimmed and case-insensitive', () => {
    expect(givenNameOf('Minji')).toBe('minji')
    expect(givenNameOf(' Junho 2 ')).toBe('junho 2')
    expect(givenNameOf('웹 개발자')).toBe('웹 개발자')
  })

  it('takes the part after the role of an old name not moved yet', () => {
    expect(givenNameOf('[FE] Minji')).toBe('minji')
    expect(givenNameOf('[BE] Junho 2')).toBe('junho 2')
    expect(givenNameOf(' [QA]  EMMA ')).toBe('emma')
  })
})

describe('nameAndPosition', () => {
  it('keeps a plain name and the given position', () => {
    expect(nameAndPosition(' Jisoo ', 'FE')).toEqual({ name: 'Jisoo', position: 'FE' })
    expect(nameAndPosition('웹 개발자', null)).toEqual({ name: '웹 개발자', position: null })
    expect(nameAndPosition('  ', 'QA')).toEqual({ name: null, position: 'QA' })
    expect(nameAndPosition(null, null)).toEqual({ name: null, position: null })
  })

  it('splits an old "[role] name" and lets a given position win', () => {
    expect(nameAndPosition('[FE] Jisoo', null)).toEqual({ name: 'Jisoo', position: 'FE' })
    expect(nameAndPosition('[FE] Jisoo', 'BE')).toEqual({ name: 'Jisoo', position: 'BE' })
    expect(nameAndPosition('[Lead]', null)).toEqual({ name: null, position: 'Lead' })
  })

  it('leaves brackets that are not a role in the name', () => {
    expect(nameAndPosition('[] Jisoo', null)).toEqual({ name: '[] Jisoo', position: null })
    expect(nameAndPosition(`[${'a'.repeat(13)}] Jisoo`, 'FE')).toEqual({ name: `[${'a'.repeat(13)}] Jisoo`, position: 'FE' })
  })
})

describe('withPosition', () => {
  it('puts the position in front of the name', () => {
    expect(withPosition('Jisoo', 'FE')).toBe('[FE] Jisoo')
    expect(withPosition('Jisoo', null)).toBe('Jisoo')
  })
})

describe('pickMemberName', () => {
  const ALL = [...FEMALE_NAMES, ...MALE_NAMES]

  it('has 50 names per gender and no duplicates across both', () => {
    expect(FEMALE_NAMES.length).toBe(50)
    expect(MALE_NAMES.length).toBe(50)
    expect(new Set(ALL.map((n) => n.toLowerCase())).size).toBe(ALL.length)
  })

  it('picks a name without a role, with the gender of that name, using the injected random number', () => {
    expect(pickMemberName([], () => 0)).toEqual({ name: FEMALE_NAMES[0], gender: 'female' })
    expect(pickMemberName([], () => 0.9999)).toEqual({ name: MALE_NAMES.at(-1), gender: 'male' })
    expect(pickMemberName([], () => 1)).toEqual({ name: MALE_NAMES.at(-1), gender: 'male' })
  })

  it('skips names already used in the team, case-insensitive', () => {
    const used = ALL.slice(0, 3).map((n) => n.toUpperCase())
    expect(pickMemberName(used, () => 0).name).toBe(ALL[3])
  })

  it('also skips old "[role] name" names not moved yet', () => {
    const used = ALL.slice(0, 3).map((n, i) => `[${['FE', 'QA', 'Docs'][i]}] ${n}`)
    expect(pickMemberName(used, () => 0).name).toBe(ALL[3])
  })

  it('never repeats a used name whatever the random number, and keeps the gender of the free one', () => {
    const free = FEMALE_NAMES.length + 4
    const used = ALL.filter((_, i) => i !== free)
    for (const r of [0, 0.3, 0.6, 0.99]) expect(pickMemberName(used, () => r)).toEqual({ name: ALL[free], gender: 'male' })
  })

  it('works alongside old "[role] surname" names', () => {
    const used = ['[FE] Kim', '[BE] Park 2', '[QA] Smith', ALL[0]]
    expect(pickMemberName(used, () => 0).name).toBe(ALL[1])
  })

  it('picks only the given gender, and its numbered names when all are taken', () => {
    for (const r of [0, 0.5, 0.99]) {
      expect(pickMemberName([], () => r, 'male').gender).toBe('male')
      expect(MALE_NAMES).toContain(pickMemberName([], () => r, 'male').name)
      expect(FEMALE_NAMES).toContain(pickMemberName([], () => r, 'female').name)
    }
    expect(pickMemberName(FEMALE_NAMES, () => 0, 'female')).toEqual({ name: `${FEMALE_NAMES[0]} 2`, gender: 'female' })
    expect(pickMemberName(FEMALE_NAMES, () => 0, 'male')).toEqual({ name: MALE_NAMES[0], gender: 'male' })
  })

  it('adds a number when every name is taken, then the next number', () => {
    expect(pickMemberName(ALL, () => 0)).toEqual({ name: `${ALL[0]} 2`, gender: 'female' })
    const twoTaken = [...ALL, ...ALL.map((n) => `[QA] ${n} 2`)]
    expect(pickMemberName(twoTaken, () => 0).name).toBe(`${ALL[0]} 3`)
  })
})
