import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  parseSidebarWidth,
  reservedWidth,
} from './sidebarWidth'

describe('clampSidebarWidth', () => {
  it('keeps a width that fits', () => {
    expect(clampSidebarWidth(420, 1920, false)).toBe(420)
  })
  it('stays within the min and max', () => {
    expect(clampSidebarWidth(100, 1920, false)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(900, 1920, false)).toBe(MAX_SIDEBAR_WIDTH)
  })
  it('leaves room for the office and the panel', () => {
    // 1100 - 320 - 360
    expect(clampSidebarWidth(480, 1100, false)).toBe(420)
  })
  it('leaves room for the panel only when the office is hidden', () => {
    // 700 - 360
    expect(clampSidebarWidth(480, 700, true)).toBe(340)
    expect(clampSidebarWidth(480, 1100, true)).toBe(480)
  })
  it('never goes below the minimum in a tiny window', () => {
    expect(clampSidebarWidth(400, 800, false)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(400, 500, true)).toBe(MIN_SIDEBAR_WIDTH)
  })
  it('rounds to whole pixels', () => {
    expect(clampSidebarWidth(333.6, 1920, false)).toBe(334)
  })
})

describe('reservedWidth', () => {
  it('reserves the office and panel minimums', () => {
    expect(reservedWidth(false)).toBe(680)
    expect(reservedWidth(true)).toBe(360)
  })
})

describe('parseSidebarWidth', () => {
  it('reads a stored width', () => {
    expect(parseSidebarWidth('420')).toBe(420)
  })
  it('falls back to the default for missing or broken values', () => {
    expect(parseSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(parseSidebarWidth('')).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(parseSidebarWidth('abc')).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
  it('brings an out of range value back into range', () => {
    expect(parseSidebarWidth('10')).toBe(MIN_SIDEBAR_WIDTH)
    expect(parseSidebarWidth('2000')).toBe(MAX_SIDEBAR_WIDTH)
  })
})
