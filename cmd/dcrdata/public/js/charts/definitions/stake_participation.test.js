import { describe, it, expect } from 'vitest'
import { stakeParticipation } from './stake_participation'

const raw = {
  axis: 'time',
  t: [1000, 2000],
  poolval: [50_00000000, 60_00000000], // 50, 60 VAR
  circulation: [200_00000000, 200_00000000] // 200, 200 VAR
}

describe('stakeParticipation.toColumns', () => {
  it('plots poolval/circulation as a percent', () => {
    const cols = stakeParticipation.toColumns(raw, {})
    expect(cols[0]).toEqual([1000, 2000])
    expect(cols[1][0]).toBeCloseTo(25, 6) // 50/200*100
    expect(cols[1][1]).toBeCloseTo(30, 6) // 60/200*100
  })
})

describe('stakeParticipation.toColumns', () => {
  it('nulls out points where supply is zero (avoids Infinity poisoning the y-range)', () => {
    const withGenesis = {
      axis: 'time',
      t: [0, 1000],
      poolval: [0, 60_00000000],
      circulation: [0, 200_00000000] // genesis supply is 0
    }
    const cols = stakeParticipation.toColumns(withGenesis, {})
    expect(cols[1][0]).toBeNull()
    expect(cols[1][1]).toBeCloseTo(30, 6)
  })
})

describe('stakeParticipation.formatValue', () => {
  it('renders 4-decimal percent', () => {
    expect(stakeParticipation.formatValue(0, { idx: 0, payload: raw, value: 25 }, {})).toBe(
      '25.0000%'
    )
  })

  it('renders n/a for a null or non-finite value (gap point)', () => {
    expect(stakeParticipation.formatValue(0, { idx: 0, payload: raw, value: null }, {})).toBe('n/a')
    expect(stakeParticipation.formatValue(0, { idx: 0, payload: raw, value: Infinity }, {})).toBe(
      'n/a'
    )
  })
})

describe('stakeParticipation.legendExtra', () => {
  it('adds pool value + coin supply VAR lines at the cursor index', () => {
    expect(stakeParticipation.legendExtra({ idx: 1, payload: raw }, {})).toEqual([
      'Ticket Pool Value: 60 VAR',
      'Coin Supply: 200 VAR'
    ])
  })
})

describe('stakeParticipation.controls', () => {
  it('enables SCALE', () => expect(stakeParticipation.controls.scale).toBe(true))
})
