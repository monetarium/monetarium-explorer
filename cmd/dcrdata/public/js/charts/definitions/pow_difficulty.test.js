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
