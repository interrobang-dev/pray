import { describe, expect, it } from 'vitest'
import { readUpdateVersion, updateBandText } from './updateReady'

describe('update band', () => {
  it('reads the version from the html attribute', () => {
    expect(readUpdateVersion('0.3.0')).toBe('0.3.0')
    expect(readUpdateVersion(' 0.3.0 ')).toBe('0.3.0')
    expect(readUpdateVersion(undefined)).toBeNull()
    expect(readUpdateVersion('')).toBeNull()
    expect(readUpdateVersion('x'.repeat(41))).toBeNull()
  })

  it('names the version', () => {
    expect(updateBandText('0.3.0')).toBe('Pray 0.3.0 is ready · Refresh to update')
  })
})
