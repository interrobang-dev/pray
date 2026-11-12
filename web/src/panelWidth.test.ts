import { describe, expect, it } from 'vitest'
import { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, clampPanelWidth, parsePanelWidth } from './panelWidth'

describe('clampPanelWidth', () => {
  it('keeps a width that fits', () => {
    expect(clampPanelWidth(700, 1920, 300)).toBe(700)
  })
  it('leaves room for the list and the office', () => {
    expect(clampPanelWidth(1500, 1920, 300)).toBe(1300)
  })
  it('follows the sidebar width', () => {
    // 1920 - 480 - 320
    expect(clampPanelWidth(1500, 1920, 480)).toBe(1120)
    // 1100 - 420 - 320
    expect(clampPanelWidth(520, 1100, 420)).toBe(360)
  })
  it('never goes below the minimum', () => {
    expect(clampPanelWidth(100, 1920, 300)).toBe(MIN_PANEL_WIDTH)
    expect(clampPanelWidth(900, 800, 300)).toBe(MIN_PANEL_WIDTH)
  })
  it('rounds to whole pixels', () => {
    expect(clampPanelWidth(600.6, 1920, 300)).toBe(601)
  })
})

describe('parsePanelWidth', () => {
  it('reads a stored width', () => {
    expect(parsePanelWidth('640')).toBe(640)
  })
  it('falls back to the default for missing or broken values', () => {
    expect(parsePanelWidth(null)).toBe(DEFAULT_PANEL_WIDTH)
    expect(parsePanelWidth('abc')).toBe(DEFAULT_PANEL_WIDTH)
    expect(parsePanelWidth('10')).toBe(DEFAULT_PANEL_WIDTH)
    expect(parsePanelWidth('')).toBe(DEFAULT_PANEL_WIDTH)
  })
})
