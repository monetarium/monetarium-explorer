import { describe, it, expect } from 'vitest'
import { secondsFromTimes, balanceDef } from './address'

describe('secondsFromTimes', () => {
  it('converts RFC3339 strings to integer seconds', () => {
    expect(secondsFromTimes(['1970-01-01T00:00:00Z', '2024-06-01T22:00:00Z'])).toEqual([
      0, 1717279200
    ])
  })
})

describe('balanceDef VAR (coin 0)', () => {
  const def = balanceDef(0)
  const raw = { time: ['2024-06-01T22:00:00Z'], balance: [12.5] }
  it('is a single stepped series', () => {
    expect(def.series).toHaveLength(1)
    expect(def.series[0].kind).toBe('stepped')
  })
  it('toColumns maps time->seconds and balance->ys', () => {
    expect(def.toColumns(raw)).toEqual([[1717279200], [12.5]])
  })
  it('formatValue renders VAR with the value', () => {
    expect(def.formatValue(0, { idx: 0, payload: raw, value: 12.5 }, {})).toBe('12.5 VAR')
  })
})

describe('balanceDef SKA (coin 2) — precision firewall', () => {
  const def = balanceDef(2)
  const raw = { time: ['2024-06-01T22:00:00Z'], balance_atoms: ['12345678901234567890123'] }
  it('toColumns plots a lossy number for geometry only', () => {
    const cols = def.toColumns(raw)
    expect(cols[0]).toEqual([1717279200])
    expect(typeof cols[1][0]).toBe('number')
  })
  it('formatValue returns the EXACT 18-decimal string (no Number())', () => {
    const datum = { idx: 0, payload: raw, value: 12345.678 }
    expect(def.formatValue(0, datum, {})).toBe('12,345.678901234567890123 SKA2')
  })
})
