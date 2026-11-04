import { describe, expect, it } from 'vitest'
import { cacheRateOf, contextLevel, contextSizeOf, contextSizeText, contextSizeTitle, turnCacheOf } from './contextSize'

describe('contextSizeText', () => {
  it('1000 미만은 그대로, 1만 미만은 k 소수 한 자리, 100만 미만은 k 정수, 그 이상은 M', () => {
    expect(contextSizeText(0)).toBe('0')
    expect(contextSizeText(950)).toBe('950')
    expect(contextSizeText(999.4)).toBe('999')
    expect(contextSizeText(1000)).toBe('1k')
    expect(contextSizeText(1234)).toBe('1.2k')
    expect(contextSizeText(9949)).toBe('9.9k')
    expect(contextSizeText(9950)).toBe('10k')
    expect(contextSizeText(143_254)).toBe('143k')
    expect(contextSizeText(999_499)).toBe('999k')
    expect(contextSizeText(999_500)).toBe('1M')
    expect(contextSizeText(1_234_567)).toBe('1.2M')
    expect(contextSizeText(-5)).toBe('0')
  })
})

describe('contextLevel', () => {
  it('12만 이상 주의, 15만 이상 경고', () => {
    expect(contextLevel(119_999)).toBe('normal')
    expect(contextLevel(120_000)).toBe('caution')
    expect(contextLevel(149_999)).toBe('caution')
    expect(contextLevel(150_000)).toBe('warn')
    expect(contextLevel(1_000_000)).toBe('warn')
  })
})

describe('contextSizeOf', () => {
  it('툴팁은 천 단위 쉼표, 모르면 null', () => {
    expect(contextSizeTitle(143_254)).toBe('Context 143,254 tokens')
    expect(contextSizeOf(143_254)).toEqual({ text: '143k', level: 'caution', title: 'Context 143,254 tokens' })
    expect(contextSizeOf(null)).toBeNull()
    expect(contextSizeOf(undefined)).toBeNull()
    expect(contextSizeOf(Number.NaN)).toBeNull()
  })
})

describe('cacheRateOf', () => {
  it('is cache read over all input, rounded', () => {
    expect(cacheRateOf({ inputTokens: 2, cacheCreationTokens: 12_000, cacheReadTokens: 34_000 })).toBe(74)
    expect(cacheRateOf({ inputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 999 })).toBe(100)
    expect(cacheRateOf({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })).toBeNull()
  })
})

describe('turnCacheOf', () => {
  it('gives the text and the counts in the tooltip', () => {
    expect(turnCacheOf({ inputTokens: 2, cacheCreationTokens: 12_000, cacheReadTokens: 34_000 })).toEqual({
      text: '74% cached',
      title: 'Last turn: cache read 34,000 of 46,002 input tokens (cache write 12,000, uncached 2)',
    })
  })

  it('shows nothing without usage or input', () => {
    expect(turnCacheOf(null)).toBeNull()
    expect(turnCacheOf(undefined)).toBeNull()
    expect(turnCacheOf({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 })).toBeNull()
  })
})
