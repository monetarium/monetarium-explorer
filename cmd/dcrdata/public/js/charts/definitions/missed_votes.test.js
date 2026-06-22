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

describe('missedVotes.toColumns — zeros are unplottable on a log axis', () => {
  it('time axis: a 0-missed window becomes null (no bar), x kept', () => {
    const raw = { t: [1000, 2000, 3000], missed: [0, 5, 0] }
    expect(missedVotes.toColumns(raw, {})).toEqual([
      [1000, 2000, 3000],
      [null, 5, null]
    ])
  })
  it('window axis: zeros become null, x positions preserved', () => {
    const raw = { missed: [0, 2, 0], window: 144, offset: 2 }
    expect(missedVotes.toColumns(raw, {})).toEqual([
      [288, 432, 576],
      [null, 2, null]
    ])
  })
})

describe('missedVotes.formatValue — honest count from the raw payload', () => {
  it('shows the real 0 for a zero window even though the plotted value is null', () => {
    const datum = { idx: 0, payload: { missed: [0, 5] }, value: null }
    expect(missedVotes.formatValue(0, datum)).toBe('0')
  })
  it('formats a positive count with thousands separators from the payload, not the plotted value', () => {
    const datum = { idx: 1, payload: { missed: [0, 1234] }, value: null }
    expect(missedVotes.formatValue(0, datum)).toBe('1,234')
  })
})

describe('missedVotes.controls', () => {
  it('is a window-unit chart', () => expect(missedVotes.controls.windowUnits).toBe(true))
})
