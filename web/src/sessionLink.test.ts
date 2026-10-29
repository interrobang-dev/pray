import { describe, expect, it } from 'vitest'
import { sessionIdFromHash } from './sessionLink'

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
