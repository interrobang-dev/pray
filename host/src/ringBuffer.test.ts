import { describe, expect, it } from 'vitest'
import { RingBuffer } from './ringBuffer.js'
import { LineDecoder } from './protocol.js'

describe('RingBuffer', () => {
  it('keeps everything under the limit', () => {
    const ring = new RingBuffer(10)
    ring.push('abc')
    ring.push('def')
    expect(ring.toString()).toBe('abcdef')
  })

  it('drops oldest chunks past the limit', () => {
    const ring = new RingBuffer(5)
    ring.push('abc')
    ring.push('def')
    expect(ring.toString()).toBe('def')
  })

  it('trims a single oversized chunk from the front', () => {
    const ring = new RingBuffer(4)
    ring.push('abcdefgh')
    expect(ring.toString()).toBe('efgh')
  })
})

describe('LineDecoder', () => {
  it('reassembles messages split across chunks and skips bad lines', () => {
    const decoder = new LineDecoder()
    expect(decoder.push('{"a":1}\n{"b":')).toEqual([{ a: 1 }])
    expect(decoder.push('2}\nnot json\n')).toEqual([{ b: 2 }])
    expect(decoder.push('')).toEqual([])
  })
})
