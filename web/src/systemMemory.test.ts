import { describe, expect, it } from 'vitest'
import { memoryLabel, memoryPercent, parseSystemMemory } from './systemMemory'

const GB = 1024 ** 3

describe('memoryPercent', () => {
  it('(전체 − 여유) / 전체 를 정수로 반올림', () => {
    expect(memoryPercent({ totalBytes: 32 * GB, freeBytes: 12.2 * GB })).toBe(62)
    expect(memoryPercent({ totalBytes: 100, freeBytes: 0 })).toBe(100)
    expect(memoryPercent({ totalBytes: 100, freeBytes: 100 })).toBe(0)
  })
  it('전체가 0 이면 null, 여유가 전체보다 커도 0~100 안', () => {
    expect(memoryPercent({ totalBytes: 0, freeBytes: 0 })).toBeNull()
    expect(memoryPercent({ totalBytes: 100, freeBytes: 150 })).toBe(0)
  })
})

describe('memoryLabel', () => {
  it('사용량 / 전체 GB 소수 한 자리', () => {
    expect(memoryLabel({ totalBytes: 32 * GB, freeBytes: 12.2 * GB })).toBe('Memory 19.8 / 32.0 GB')
  })
})

describe('parseSystemMemory', () => {
  it('꼴이 맞을 때만 값', () => {
    expect(parseSystemMemory({ totalBytes: 10, freeBytes: 4 })).toEqual({ totalBytes: 10, freeBytes: 4 })
    expect(parseSystemMemory(null)).toBeNull()
    expect(parseSystemMemory({ totalBytes: '10', freeBytes: 4 })).toBeNull()
    expect(parseSystemMemory({ totalBytes: 0, freeBytes: 0 })).toBeNull()
  })
})
