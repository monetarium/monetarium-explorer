import { describe, it, expect } from 'vitest'
import { powDifficulty } from './pow_difficulty'

describe('powDifficulty.toColumns', () => {
  it('time axis: [t, diff]', () => {
    const raw = { t: [1000, 2000], diff: [5, 6] }
    expect(powDifficulty.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [5, 6]
    ])
  })
  it('window axis: X = i*window', () => {
    const raw = { diff: [5, 6, 7], window: 144 }
    expect(powDifficulty.toColumns(raw, {})).toEqual([
      [0, 144, 288],
      [5, 6, 7]
    ])
  })
  it('height axis: explicit h takes precedence over window index', () => {
    // The live-tip point is appended at a window start that need not equal
    // i*window (last height 290, not 288), so h must win over the derivation.
    const raw = { diff: [5, 6, 7], h: [0, 144, 290], window: 144 }
    expect(powDifficulty.toColumns(raw, {})).toEqual([
      [0, 144, 290],
      [5, 6, 7]
    ])
  })
})

describe('powDifficulty.controls', () => {
  it('is a window-unit chart', () => expect(powDifficulty.controls.windowUnits).toBe(true))
})

describe('powDifficulty.formatValue', () => {
  it('keeps decimals (does not round to an integer)', () => {
    expect(powDifficulty.formatValue(0, { value: 3.5 })).toBe('3.5')
    expect(powDifficulty.formatValue(0, { value: 1.23456789 })).toBe('1.23456789')
  })
  it('groups thousands without introducing float artifacts', () => {
    expect(powDifficulty.formatValue(0, { value: 16307.420422 })).toBe('16,307.420422')
  })
  it('renders a whole number cleanly', () => {
    expect(powDifficulty.formatValue(0, { value: 7000 })).toBe('7,000')
  })
  it('blanks a non-finite (log-scale-nulled) point', () => {
    expect(powDifficulty.formatValue(0, { value: null })).toBe('')
    expect(powDifficulty.formatValue(0, { value: NaN })).toBe('')
  })
})
