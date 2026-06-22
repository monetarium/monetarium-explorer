import { describe, it, expect } from 'vitest'
import { feesDef } from './fees'

describe('fees VAR (coinType 0)', () => {
  const def = feesDef(0)
  it('uses the bare name "fees" and VAR label', () => {
    expect(def.name).toBe('fees')
    expect(def.axes[0].label).toBe('Total Fee (VAR)')
  })
  it('toColumns scales atoms to VAR', () => {
    const raw = { axis: 'time', t: [1000], fees: [300000000] }
    expect(def.toColumns(raw, {})).toEqual([[1000], [3]])
  })
  it('formatValue renders VAR integer', () => {
    expect(def.formatValue(0, { value: 3 }, {})).toBe('3 VAR')
  })
})

describe('fees SKA (coinType 1) — precision firewall', () => {
  const def = feesDef(1)
  const raw = { axis: 'time', t: [1000], fees: ['1000000000000000001'] }
  it('uses name fees/1 and SKA1 label', () => {
    expect(def.name).toBe('fees/1')
    expect(def.axes[0].label).toBe('Total Fee (SKA1)')
  })
  it('formatValue returns the exact atom string (no Number())', () => {
    expect(def.formatValue(0, { idx: 0, payload: raw, value: 1.0 }, {})).toBe(
      '1.000000000000000001 SKA1'
    )
  })
})
