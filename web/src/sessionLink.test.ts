import { describe, expect, it } from 'vitest'
import { resumeUrlOf, sessionIdFromHash, shouldRestoreLastSession } from './sessionLink'

describe('sessionIdFromHash', () => {
  it('#session=<id> 의 id', () => {
    expect(sessionIdFromHash('#session=0b3c9d7e-1111-2222-3333-444455556666')).toBe('0b3c9d7e-1111-2222-3333-444455556666')
    expect(sessionIdFromHash('#session=a%20b')).toBe('a b')
  })

  it('꼴이 다르거나 비었으면 null', () => {
    expect(sessionIdFromHash('')).toBeNull()
    expect(sessionIdFromHash('#session=')).toBeNull()
    expect(sessionIdFromHash('#other=1')).toBeNull()
    expect(sessionIdFromHash('#session=a&b=c')).toBeNull()
    expect(sessionIdFromHash('#session=%E0%A4%A')).toBeNull()
  })
})

describe('resumeUrlOf', () => {
  it('주소에 #resume 을 붙인다', () => {
    expect(resumeUrlOf('http://home:4710')).toBe('http://home:4710/#resume')
    expect(resumeUrlOf('http://100.64.0.2:4710/#session=a')).toBe('http://100.64.0.2:4710/#resume')
  })
})

describe('shouldRestoreLastSession', () => {
  it('#resume 으로 왔거나 새로고침이면 되살린다', () => {
    expect(shouldRestoreLastSession('#resume', 'navigate')).toBe(true)
    expect(shouldRestoreLastSession('', 'reload')).toBe(true)
  })

  it('그 밖은 첫 화면', () => {
    expect(shouldRestoreLastSession('', 'navigate')).toBe(false)
    expect(shouldRestoreLastSession('', undefined)).toBe(false)
    expect(shouldRestoreLastSession('#session=a', 'navigate')).toBe(false)
  })
})
