import { describe, it, expect } from 'vitest'
import {
  intComma,
  unitPrefix,
  withBigUnits,
  formatSkaAtomsExact,
  xColumn,
  CHAINWORK_UNITS,
  HASHRATE_UNITS
} from './format'

describe('intComma', () => {
  it('formats with thousands separators and no fraction', () => {
    expect(intComma(1234567)).toBe('1,234,567')
  })
  it('renders an explicit "0" for a real zero (not a blank)', () => {
    expect(intComma(0)).toBe('0')
  })
  it('returns "" only for an absent/non-finite value (null, undefined, NaN)', () => {
    // null is how a log-scale series carries a geometry-nulled point (e.g. missed-votes);
    // it must read as "no value", distinct from a real 0.
    expect(intComma(null)).toBe('')
    expect(intComma(undefined)).toBe('')
    expect(intComma(NaN)).toBe('')
  })
})

describe('unitPrefix', () => {
  it('picks the SI prefix for the magnitude', () => {
    expect(unitPrefix(1)).toBe('')
    expect(unitPrefix(1500)).toBe('k')
    expect(unitPrefix(2_000_000)).toBe('M')
  })
  it('returns empty for non-positive', () => {
    expect(unitPrefix(0)).toBe('')
  })
})

describe('withBigUnits', () => {
  it('scales a hashrate value to the right unit, 3 decimals', () => {
    expect(withBigUnits(1500, HASHRATE_UNITS)).toBe('1.500 kH/s')
  })
  it('handles zero at the base unit', () => {
    expect(withBigUnits(0, CHAINWORK_UNITS)).toBe('0.000 H')
  })
})

describe('formatSkaAtomsExact — precision firewall', () => {
  it('round-trips an 18-decimal atom string with no float coercion', () => {
    expect(formatSkaAtomsExact('12345678901234567890123')).toBe('12,345.678901234567890123')
  })
  it('drops a pure-integer atom value to just the integer part', () => {
    expect(formatSkaAtomsExact('5000000000000000000')).toBe('5')
  })
  it('keeps a leading-zero fraction intact', () => {
    expect(formatSkaAtomsExact('1000000000000000001')).toBe('1.000000000000000001')
  })
})

describe('xColumn', () => {
  it('time axis → the raw seconds array', () => {
    const raw = { axis: 'time', t: [1000, 2000, 3000] }
    expect(xColumn(raw, 3)).toEqual([1000, 2000, 3000])
  })
  it('height axis + block bin → 0-based index (genesis=0), ignoring offset', () => {
    const raw = { axis: 'height', bin: 'block' }
    expect(xColumn(raw, 3)).toEqual([0, 1, 2])
    expect(xColumn(raw, 3, 100)).toEqual([0, 1, 2]) // block ignores offset
  })
  it('height axis + day bin → offset + height value (offset defaults to 1)', () => {
    const raw = { axis: 'height', bin: 'day', h: [10, 20, 30] }
    expect(xColumn(raw, 3)).toEqual([11, 21, 31])
  })
  it('honors an explicit offset on the height (non-block) branch', () => {
    const raw = { axis: 'height', bin: 'day', h: [10, 20] }
    expect(xColumn(raw, 2, 100)).toEqual([110, 120])
  })
})
