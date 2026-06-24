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
  it('formatValue keeps decimal precision (does not round via intComma)', () => {
    expect(def.formatValue(0, { value: 0.0001346 })).toBe('0.0001346 VAR')
    expect(def.formatValue(0, { value: 1.23456789 })).toBe('1.23456789 VAR')
  })
  it('formatValue groups thousands without introducing float artifacts', () => {
    expect(def.formatValue(0, { value: 1234567.89 })).toBe('1,234,567.89 VAR')
  })
  it('formatValue blanks non-finite values', () => {
    expect(def.formatValue(0, { value: null })).toBe('')
    expect(def.formatValue(0, { value: NaN })).toBe('')
  })
  it('formatValue renders a whole number cleanly', () => {
    expect(def.formatValue(0, { value: 7000 })).toBe('7,000 VAR')
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
