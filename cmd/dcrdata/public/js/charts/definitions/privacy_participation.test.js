import { describe, it, expect } from 'vitest'
import { privacyParticipation } from './privacy_participation'

describe('privacyParticipation.toColumns', () => {
  it('time axis: [t, anonymitySet*1e-8]', () => {
    const raw = { axis: 'time', t: [1000, 2000], anonymitySet: [0, 500000000] }
    expect(privacyParticipation.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [0, 5]
    ])
  })
})

describe('privacyParticipation.limits', () => {
  it('time axis: [firstStampWithValue*1000, lastStamp*1000]', () => {
    const raw = { axis: 'time', t: [1000, 2000, 3000], anonymitySet: [0, 5, 9] }
    expect(privacyParticipation.limits(raw)).toEqual([2000 * 1000, 3000 * 1000])
  })
  it('height/block axis: [firstIdxWithValue, lastIdx]', () => {
    const raw = { axis: 'height', bin: 'block', anonymitySet: [0, 0, 7] }
    expect(privacyParticipation.limits(raw)).toEqual([2, 2])
  })
})

describe('privacyParticipation.formatValue', () => {
  it('shows commas when positive', () => {
    expect(privacyParticipation.formatValue(0, { value: 1234 }, {})).toBe('1,234')
  })
  it('shows 0 VAR when zero', () => {
    expect(privacyParticipation.formatValue(0, { value: 0 }, {})).toBe('0 VAR')
  })
})

describe('privacyParticipation.controls', () => {
  it('is scale-disabled and hybrid', () => {
    expect(privacyParticipation.controls.scale).toBe(false)
    expect(privacyParticipation.controls.hybrid).toBe(true)
  })
})
