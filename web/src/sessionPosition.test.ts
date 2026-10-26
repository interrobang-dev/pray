import { describe, expect, it } from 'vitest'
import { cleanPosition, editableNameOf, memberOf, modalName, modalPosition, nameOf, positionOf, renamePatch, splitLegacyName } from './sessionPosition'

const base = { id: '12345678-aaaa', title: null, name: null }

describe('splitLegacyName', () => {
  it('옛 꼴 "[FE] Park" 을 역할과 이름으로 가른다', () => {
    expect(splitLegacyName('[FE] Park')).toEqual({ position: 'FE', name: 'Park' })
    expect(splitLegacyName('[UI/UX]Minji 2')).toEqual({ position: 'UI/UX', name: 'Minji 2' })
  })
  it('대괄호가 없거나 비어 있으면 역할 없이 그대로', () => {
    expect(splitLegacyName('Park')).toEqual({ position: null, name: 'Park' })
    expect(splitLegacyName('[] Park')).toEqual({ position: null, name: 'Park' })
  })
})

describe('positionOf · nameOf', () => {
  it('서버가 준 position 이 먼저, 이름은 그대로', () => {
    const session = { ...base, name: 'Jisoo', position: 'FE' }
    expect(positionOf(session)).toBe('FE')
    expect(nameOf(session)).toBe('Jisoo')
  })
  it('position 이 없는 옛 응답은 이름 앞 [역할] 을 칩으로 뗀다', () => {
    const session = { ...base, name: '[FE] Park' }
    expect(positionOf(session)).toBe('FE')
    expect(nameOf(session)).toBe('Park')
  })
  it('position 이 null 이어도 옛 꼴 이름은 뗀다 (서버가 아직 옮기지 않은 기록)', () => {
    expect(positionOf({ ...base, name: '[Lead] Ann', position: null })).toBe('Lead')
    expect(nameOf({ ...base, name: '[Lead] Ann', position: null })).toBe('Ann')
  })
  it('역할이 없으면 칩 없이, 이름이 없으면 제목 → ID 앞 8자리', () => {
    expect(positionOf({ ...base, name: 'Kim' })).toBeNull()
    expect(nameOf({ ...base, title: 'Auto title' })).toBe('Auto title')
    expect(nameOf(base)).toBe('12345678')
  })
  it('역할만 있고 이름이 없으면 자동 제목에 칩이 붙는다', () => {
    expect(positionOf({ ...base, position: 'QA' })).toBe('QA')
    expect(nameOf({ ...base, position: 'QA', title: 'T' })).toBe('T')
  })
})

describe('memberOf (지시·보고 한 줄)', () => {
  it('새 꼴: position 이 따로', () => {
    expect(memberOf('Jisoo', 'FE')).toEqual({ name: 'Jisoo', position: 'FE' })
  })
  it('옛 꼴: 이름에서 역할을 뗀다', () => {
    expect(memberOf('[FE] Park')).toEqual({ name: 'Park', position: 'FE' })
    expect(memberOf('[FE] Park', null)).toEqual({ name: 'Park', position: 'FE' })
  })
  it('역할이 없으면 이름만', () => {
    expect(memberOf('Park', '  ')).toEqual({ name: 'Park', position: null })
  })
})

describe('세션 추가 모달 칸', () => {
  it('팀 모달: Role 은 세그먼트로 Dev↔Lead, 직접 고치면 그 뒤로 안 바뀐다', () => {
    expect(modalPosition(null, 'member', true)).toBe('Dev')
    expect(modalPosition(null, 'lead', true)).toBe('Lead')
    expect(modalPosition('FE', 'lead', true)).toBe('FE')
    expect(modalPosition('', 'lead', true)).toBe('')
  })
  it('로비 모달은 Role 도 비운다', () => {
    expect(modalPosition(null, 'member', false)).toBe('')
    expect(modalName(null, 'Jisoo', false)).toBe('')
  })
  it('Name 은 추천 이름, 직접 고치기 시작하면 그것', () => {
    expect(modalName(null, 'Jisoo', true)).toBe('Jisoo')
    expect(modalName(null, null, true)).toBe('')
    expect(modalName('Mine', 'Jisoo', true)).toBe('Mine')
    expect(modalName('', 'Jisoo', true)).toBe('')
  })
})

describe('이름 바꾸기', () => {
  it('Name 칸 초기값은 사용자가 붙인 이름만 (옛 꼴이면 역할을 뗀다)', () => {
    expect(editableNameOf({ name: null, position: null })).toBe('')
    expect(editableNameOf({ name: 'Jisoo', position: 'FE' })).toBe('Jisoo')
    expect(editableNameOf({ name: '[FE] Park' })).toBe('Park')
  })
  it('바뀐 것만 보낸다', () => {
    const session = { name: 'Jisoo', position: 'FE' }
    expect(renamePatch(session, 'Jisoo', 'FE')).toEqual({})
    expect(renamePatch(session, 'Mina', 'FE')).toEqual({ name: 'Mina' })
    expect(renamePatch(session, 'Jisoo', 'BE')).toEqual({ position: 'BE' })
    expect(renamePatch(session, ' Jisoo ', 'FE')).toEqual({})
  })
  it('역할을 비우면 빈 값으로 지운다', () => {
    expect(renamePatch({ name: 'Jisoo', position: 'FE' }, 'Jisoo', '')).toEqual({ position: '' })
  })
  it('옛 꼴 이름은 이름·역할을 둘 다 보내 새 꼴로 옮긴다', () => {
    expect(renamePatch({ name: '[FE] Park' }, 'Park', 'FE')).toEqual({ name: 'Park', position: 'FE' })
  })
  it('이름이 없던 세션에 역할만 더하면 역할만', () => {
    expect(renamePatch({ name: null, position: null }, '', 'QA')).toEqual({ position: 'QA' })
  })
})

describe('cleanPosition', () => {
  it('공백뿐이면 null', () => {
    expect(cleanPosition('  ')).toBeNull()
    expect(cleanPosition(' FE ')).toBe('FE')
    expect(cleanPosition(undefined)).toBeNull()
  })
})
