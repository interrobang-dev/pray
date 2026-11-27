import { describe, expect, it } from 'vitest'
import { canvasPixelRatio, MAX_CANVAS_PIXELS, nextZoom, pageAt, pageLabel, ZOOM_STEPS, zoomLabel } from './pageLayout'

describe('canvasPixelRatio', () => {
  it('uses the device pixel ratio up to 3', () => {
    expect(canvasPixelRatio(344, 486, 3)).toBe(3)
    expect(canvasPixelRatio(344, 486, 4)).toBe(3)
    expect(canvasPixelRatio(344, 486, 1.5)).toBe(1.5)
  })

  it('treats a missing or small ratio as 1', () => {
    expect(canvasPixelRatio(344, 486, 0)).toBe(1)
    expect(canvasPixelRatio(344, 486, 0.5)).toBe(1)
  })

  it('lowers the ratio so a zoomed page stays under the pixel limit', () => {
    const ratio = canvasPixelRatio(1032, 1459, 3)
    expect(ratio).toBeLessThan(3)
    expect(1032 * 1459 * ratio * ratio).toBeCloseTo(MAX_CANVAS_PIXELS, -1)
  })

  it('keeps the ratio for an empty size', () => {
    expect(canvasPixelRatio(0, 0, 2)).toBe(2)
  })
})

describe('nextZoom', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.25)
    expect(nextZoom(1.25, -1)).toBe(1)
    expect(nextZoom(1, -1)).toBe(1)
    const last = ZOOM_STEPS[ZOOM_STEPS.length - 1]
    expect(nextZoom(last, 1)).toBe(last)
  })

  it('starts from fit width for an unknown zoom', () => {
    expect(nextZoom(1.1, 1)).toBe(1.25)
  })
})

describe('pageAt', () => {
  const tops = [8, 500, 992]

  it('finds the page under the probe', () => {
    expect(pageAt(tops, 0)).toBe(1)
    expect(pageAt(tops, 499)).toBe(1)
    expect(pageAt(tops, 500)).toBe(2)
    expect(pageAt(tops, 5000)).toBe(3)
  })

  it('is 1 without pages', () => {
    expect(pageAt([], 100)).toBe(1)
  })
})

describe('labels', () => {
  it('writes short English labels', () => {
    expect(pageLabel(3, 12)).toBe('Page 3 of 12')
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(1.25)).toBe('125%')
  })
})
