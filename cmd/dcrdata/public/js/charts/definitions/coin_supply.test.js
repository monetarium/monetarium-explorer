import { describe, it, expect } from 'vitest'
import { coinSupplyDef } from './coin_supply'

describe('coin-supply VAR (coinType 0)', () => {
  const def = coinSupplyDef(0)
  it('name + axis label use VAR', () => {
    expect(def.name).toBe('coin-supply/0')
    expect(def.axes[0].label).toBe('Coin Supply (VAR)')
  })
  it('toColumns scales atoms to VAR', () => {
    const raw = { axis: 'time', t: [1000], supply: [500000000] }
    expect(def.toColumns(raw, {})).toEqual([[1000], [5]])
  })
  it('formatValue renders VAR integer', () => {
    expect(def.formatValue(0, { idx: 0, payload: { supply: [5] }, value: 5 }, {})).toBe('5 VAR')
  })
})

describe('coin-supply SKA (coinType 2) — precision firewall', () => {
  const def = coinSupplyDef(2)
  const raw = { axis: 'time', t: [1000], supply: ['12345678901234567890123'] }
  it('name + axis label use SKA2', () => {
    expect(def.name).toBe('coin-supply/2')
    expect(def.axes[0].label).toBe('Coin Supply (SKA2)')
  })
  it('toColumns plots a lossy number for geometry only', () => {
    const cols = def.toColumns(raw, {})
    expect(cols[0]).toEqual([1000])
    expect(typeof cols[1][0]).toBe('number') // geometry — precision loss OK
  })
  it('formatValue returns the EXACT 18-decimal string from the raw payload (no Number())', () => {
    const datum = { idx: 0, payload: raw, value: 12345.678 } // value is the lossy plot number
    expect(def.formatValue(0, datum, {})).toBe('12,345.678901234567890123 SKA2')
  })
})
