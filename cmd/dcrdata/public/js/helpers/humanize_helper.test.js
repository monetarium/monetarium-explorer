import { describe, expect, it } from 'vitest'
import humanize from './humanize_helper'

describe('humanize.formatCoinAtoms', () => {
  // VAR: coinType 0, 8 decimal places
  it('formats VAR atoms "1000000000" as "10.0"', () =>
    expect(humanize.formatCoinAtoms('1000000000', 0)).toBe('10.0'))
  it('formats VAR atoms "100000000" as "1.00"', () =>
    expect(humanize.formatCoinAtoms('100000000', 0)).toBe('1.00'))
  it('formats VAR atoms "0" as "0"', () => expect(humanize.formatCoinAtoms('0', 0)).toBe('0'))

  // SKA: coinType != 0, 18 decimal places
  it('formats SKA atoms "1000000000000000000" as "1.00"', () =>
    expect(humanize.formatCoinAtoms('1000000000000000000', 1)).toBe('1.00'))
  it('formats SKA atoms "1000000000000000000000" as "1.00k"', () =>
    expect(humanize.formatCoinAtoms('1000000000000000000000', 2)).toBe('1.00k'))
  it('formats SKA atoms "0" as "0"', () => expect(humanize.formatCoinAtoms('0', 1)).toBe('0'))
})

describe('humanize.threeSigFigs', () => {
  // >= 1e11 - integer billions
  it('formats 1e11 as "100B"', () => expect(humanize.threeSigFigs(1e11)).toBe('100B'))
  it('formats 2.5e11 as "250B"', () => expect(humanize.threeSigFigs(2.5e11)).toBe('250B'))
  it('formats 1.999e11 as "200B"', () => expect(humanize.threeSigFigs(1.999e11)).toBe('200B'))

  // >= 1e10 - one-decimal billions
  it('formats 1e10 as "10.0B"', () => expect(humanize.threeSigFigs(1e10)).toBe('10.0B'))
  it('formats 1.55e10 as "15.5B"', () => expect(humanize.threeSigFigs(1.55e10)).toBe('15.5B'))
  it('formats 9.99e10 as "99.9B" - stays in bracket, no round-up', () =>
    expect(humanize.threeSigFigs(9.99e10)).toBe('99.9B'))

  // >= 1e9 - two-decimal billions
  it('formats 1e9 as "1.00B"', () => expect(humanize.threeSigFigs(1e9)).toBe('1.00B'))
  it('formats 1.235e9 as "1.24B"', () => expect(humanize.threeSigFigs(1.235e9)).toBe('1.24B'))
  it('formats 9.999e9 as "10.00B" - stays in bracket, no round-up', () =>
    expect(humanize.threeSigFigs(9.999e9)).toBe('10.00B'))

  // >= 1e8 - integer millions
  it('formats 1e8 as "100M"', () => expect(humanize.threeSigFigs(1e8)).toBe('100M'))
  it('formats 4.5e8 as "450M"', () => expect(humanize.threeSigFigs(4.5e8)).toBe('450M'))

  // >= 1e7 - one-decimal millions
  it('formats 1e7 as "10.0M"', () => expect(humanize.threeSigFigs(1e7)).toBe('10.0M'))
  it('formats 1.55e7 as "15.5M"', () => expect(humanize.threeSigFigs(1.55e7)).toBe('15.5M'))

  // >= 1e6 - two-decimal millions
  it('formats 1e6 as "1.00M"', () => expect(humanize.threeSigFigs(1e6)).toBe('1.00M'))
  it('formats 1.235e6 as "1.24M"', () => expect(humanize.threeSigFigs(1.235e6)).toBe('1.24M'))

  // >= 1e5 - integer thousands
  it('formats 1e5 as "100k"', () => expect(humanize.threeSigFigs(1e5)).toBe('100k'))
  it('formats 4.5e5 as "450k"', () => expect(humanize.threeSigFigs(4.5e5)).toBe('450k'))

  // >= 1e4 - one-decimal thousands
  it('formats 1e4 as "10.0k"', () => expect(humanize.threeSigFigs(1e4)).toBe('10.0k'))
  it('formats 1.55e4 as "15.5k"', () => expect(humanize.threeSigFigs(1.55e4)).toBe('15.5k'))

  // >= 1e3 - two-decimal thousands
  it('formats 1e3 as "1.00k"', () => expect(humanize.threeSigFigs(1e3)).toBe('1.00k'))
  it('formats 1.235e3 as "1.24k"', () => expect(humanize.threeSigFigs(1.235e3)).toBe('1.24k'))

  // sub-thousand
  it('formats 100 as "100"', () => expect(humanize.threeSigFigs(100)).toBe('100'))
  it('formats 456 as "456"', () => expect(humanize.threeSigFigs(456)).toBe('456'))
  it('formats 999 as "999"', () => expect(humanize.threeSigFigs(999)).toBe('999'))

  it('formats 10 as "10.0"', () => expect(humanize.threeSigFigs(10)).toBe('10.0'))
  it('formats 15.5 as "15.5"', () => expect(humanize.threeSigFigs(15.5)).toBe('15.5'))
  it('formats 99.9 as "99.9"', () => expect(humanize.threeSigFigs(99.9)).toBe('99.9'))

  it('formats 1 as "1.00"', () => expect(humanize.threeSigFigs(1)).toBe('1.00'))
  it('formats 1.23 as "1.23"', () => expect(humanize.threeSigFigs(1.23)).toBe('1.23'))
  it('formats 9.99 as "9.99"', () => expect(humanize.threeSigFigs(9.99)).toBe('9.99'))

  // sub-1: fractional coin values (e.g. VAR fees)
  it('formats 0.5 as "0.500"', () => expect(humanize.threeSigFigs(0.5)).toBe('0.500'))
  it('formats 0.1 as "0.100"', () => expect(humanize.threeSigFigs(0.1)).toBe('0.100'))
  it('formats 0.01 as "0.0100"', () => expect(humanize.threeSigFigs(0.01)).toBe('0.0100'))
  it('formats 0.001 as "0.00100"', () => expect(humanize.threeSigFigs(0.001)).toBe('0.00100'))

  // zero
  it('formats 0 as "0"', () => expect(humanize.threeSigFigs(0)).toBe('0'))
})

describe('humanize.skaCoinValue', () => {
  it('returns 0 for empty string', () => expect(humanize.skaCoinValue('')).toBe(0))
  it('returns 0 for "0"', () => expect(humanize.skaCoinValue('0')).toBe(0))
  it('returns 0 for invalid input', () => expect(humanize.skaCoinValue('notanumber')).toBe(0))

  it('converts exactly 1 SKA coin (10^18 atoms)', () =>
    expect(humanize.skaCoinValue('1000000000000000000')).toBe(1.0))
  it('converts 1.5 SKA coins', () => expect(humanize.skaCoinValue('1500000000000000000')).toBe(1.5))
  it('converts 0.5 SKA coins', () => expect(humanize.skaCoinValue('500000000000000000')).toBe(0.5))
  it('converts 0.1 SKA coins', () => expect(humanize.skaCoinValue('100000000000000000')).toBe(0.1))
  it('converts 0.001 SKA coins', () =>
    expect(humanize.skaCoinValue('1000000000000000')).toBe(0.001))
  it('converts a single atom (1e-18)', () => expect(humanize.skaCoinValue('1')).toBe(1e-18))
  it('converts 1000 SKA coins', () =>
    expect(humanize.skaCoinValue('1000000000000000000000')).toBe(1000))
  it('converts 1 000 000 SKA coins', () =>
    expect(humanize.skaCoinValue('1000000000000000000000000')).toBe(1e6))

  it('does not lose precision on a 33-digit atom string', () => {
    // 123456789012345 * 10^18 - integer part is 123456789012345 coins
    const result = humanize.skaCoinValue('123456789012345000000000000000000')
    expect(result).toBeCloseTo(123456789012345, -3)
  })
})

describe('humanize.skaCoinValue + threeSigFigs', () => {
  it('formats 1 coin as "1.00"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('1000000000000000000'))).toBe('1.00'))
  it('formats 1.23 coins as "1.23"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('1230000000000000000'))).toBe('1.23'))
  it('formats 1000 coins as "1.00k"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('1000000000000000000000'))).toBe('1.00k'))
  it('formats 1 000 000 coins as "1.00M"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('1000000000000000000000000'))).toBe('1.00M'))
  it('formats 1 000 000 000 coins as "1.00B"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('1000000000000000000000000000'))).toBe(
      '1.00B'
    ))
  it('formats 0.5 coins as "0.500"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('500000000000000000'))).toBe('0.500'))
  it('formats 0.1 coins as "0.100"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('100000000000000000'))).toBe('0.100'))
  it('formats 0.001 coins as "0.00100"', () =>
    expect(humanize.threeSigFigs(humanize.skaCoinValue('1000000000000000'))).toBe('0.00100'))
})

describe('humanize.formatCoinAtomsFull', () => {
  // VAR: coinType 0, 8 decimal places, trailing zeros stripped
  it('returns "0" for empty string', () => expect(humanize.formatCoinAtomsFull('', 0)).toBe('0'))
  it('returns "0" for invalid input', () =>
    expect(humanize.formatCoinAtomsFull('notanumber', 0)).toBe('0'))
  it('formats whole VAR amount — no decimal point', () =>
    expect(humanize.formatCoinAtomsFull('100000000', 0)).toBe('1'))
  it('formats VAR with decimal, trailing zeros stripped', () =>
    expect(humanize.formatCoinAtomsFull('150000000', 0)).toBe('1.5'))
  it('formats VAR with full 8 decimal precision', () =>
    expect(humanize.formatCoinAtomsFull('100000001', 0)).toBe('1.00000001'))
  it('formats VAR zero atoms as "0"', () => expect(humanize.formatCoinAtomsFull('0', 0)).toBe('0'))
  it('formats large VAR circulating supply (151399680000000 atoms)', () =>
    expect(humanize.formatCoinAtomsFull('151399680000000', 0)).toBe('1513996.8'))

  // SKA: coinType != 0, 18 decimal places, trailing zeros stripped
  it('returns "0" for empty SKA string', () =>
    expect(humanize.formatCoinAtomsFull('', 1)).toBe('0'))
  it('formats whole SKA amount — no decimal point', () =>
    expect(humanize.formatCoinAtomsFull('1000000000000000000', 1)).toBe('1'))
  it('formats SKA with trailing-zero stripping', () =>
    expect(humanize.formatCoinAtomsFull('1500000000000000000', 1)).toBe('1.5'))
  it('formats SKA with two significant decimals', () =>
    expect(humanize.formatCoinAtomsFull('1840000000000000000', 1)).toBe('1.84'))
  it('formats SKA zero atoms as "0"', () => expect(humanize.formatCoinAtomsFull('0', 1)).toBe('0'))
  it('formats exact WS payload in_circulation value', () =>
    expect(humanize.formatCoinAtomsFull('899999999991999840000000000000000', 1)).toBe(
      '899999999991999.84'
    ))
  it('formats exact WS payload total_issued value (whole number)', () =>
    expect(humanize.formatCoinAtomsFull('900000000000000000000000000000000', 1)).toBe(
      '900000000000000'
    ))
  it('formats exact WS payload total_burned value', () =>
    expect(humanize.formatCoinAtomsFull('8000160000000000000000', 1)).toBe('8000.16'))
  it('handles a single atom (10^-18)', () =>
    expect(humanize.formatCoinAtomsFull('1', 1)).toBe('0.000000000000000001'))
  it('strips all 18 trailing decimal zeros for whole coin', () =>
    expect(humanize.formatCoinAtomsFull('5000000000000000000', 1)).toBe('5'))
  it('coinType 2 uses same 18-decimal SKA rules', () =>
    expect(humanize.formatCoinAtomsFull('1230000000000000000', 2)).toBe('1.23'))
})
