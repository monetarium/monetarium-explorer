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
})

describe('powDifficulty.controls', () => {
  it('is a window-unit chart', () => expect(powDifficulty.controls.windowUnits).toBe(true))
})
