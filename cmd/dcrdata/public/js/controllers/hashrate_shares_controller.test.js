import { describe, it, expect } from 'vitest'
import {
  middleTruncate,
  colorForIndex,
  sliceLabelFits,
  arcPath,
  PIE,
  PALETTE
} from './hashrate_shares_controller'

describe('middleTruncate', () => {
  it('truncates the middle of a long address', () => {
    // head 8 = "VsAbCdEf", tail 6 = "Yz1234"
    expect(middleTruncate('VsAbCdEfGhIjKlMnOpQrStUvWxYz1234', 8, 6)).toBe('VsAbCdEf…Yz1234')
  })
  it('keeps short strings unchanged', () => {
    expect(middleTruncate('short', 8, 6)).toBe('short')
  })
})

describe('colorForIndex', () => {
  it('is deterministic and wraps the palette', () => {
    expect(colorForIndex(0)).toBe(PALETTE[0])
    expect(colorForIndex(1)).toBe(PALETTE[1])
    expect(colorForIndex(PALETTE.length)).toBe(PALETTE[0]) // wraps
  })
})

describe('sliceLabelFits', () => {
  it('numbers a large slice', () => {
    expect(sliceLabelFits(Math.PI / 2)).toBe(true) // 90deg
  })
  it('skips a sliver', () => {
    expect(sliceLabelFits(0.02)).toBe(false) // ~1.1deg
  })
})

describe('arcPath', () => {
  it('produces a wedge path string from center', () => {
    const d = arcPath(0, Math.PI / 2)
    expect(d.startsWith(`M ${PIE.cx} ${PIE.cy}`)).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })
  it('sets the large-arc flag based on sweep', () => {
    // path arc segment is "A 165 165 0 <largeArc> 1 ..." (PIE.r === 165)
    expect(arcPath(0, Math.PI / 2)).toContain('165 0 0 1') // <180deg -> large-arc 0
    expect(arcPath(0, (3 * Math.PI) / 2)).toContain('165 0 1 1') // >180deg -> large-arc 1
  })
})
