import { describe, it, expect } from 'vitest'
import { missedVotes } from './missed_votes'

describe('missedVotes.toColumns', () => {
  it('time axis: [t, missed]', () => {
    const raw = { t: [1000, 2000], missed: [1, 2] }
    expect(missedVotes.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [1, 2]
    ])
  })
  it('window axis: X = i*window + offset*window', () => {
    const raw = { missed: [1, 2, 3], window: 144, offset: 2 }
    expect(missedVotes.toColumns(raw, {})).toEqual([
      [288, 432, 576],
      [1, 2, 3]
    ])
  })
})

describe('missedVotes.controls', () => {
  it('is a window-unit chart', () => expect(missedVotes.controls.windowUnits).toBe(true))
})
