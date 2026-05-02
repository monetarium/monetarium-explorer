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

describe('humanize.formatAtomsAsCoinString', () => {
  it('returns dash for empty or invalid input', () => {
    expect(humanize.formatAtomsAsCoinString('', 0, 2)).toBe('—')
    expect(humanize.formatAtomsAsCoinString(null, 0, 2)).toBe('—')
    expect(humanize.formatAtomsAsCoinString(undefined, 0, 2)).toBe('—')
    expect(humanize.formatAtomsAsCoinString('abc', 0, 2)).toBe('—')
  })

  // VAR (8 decimals)
  it('formats VAR and trims trailing zeros', () => {
    expect(humanize.formatAtomsAsCoinString('123000000', 0, 2)).toBe('1.23')
  })

  it('keeps minimum trailing zeros', () => {
    expect(humanize.formatAtomsAsCoinString('120000000', 0, 2)).toBe('1.20')
    expect(humanize.formatAtomsAsCoinString('500000000', 0, 2)).toBe('5.00')
  })

  it('does not round (full precision preserved)', () => {
    expect(humanize.formatAtomsAsCoinString('123456789', 0, 2)).toBe('1.23456789')
  })

  it('trims only unnecessary zeros', () => {
    expect(humanize.formatAtomsAsCoinString('123450000', 0, 2)).toBe('1.2345')
  })

  it('respects custom minDecimals', () => {
    expect(humanize.formatAtomsAsCoinString('123400000', 0, 4)).toBe('1.2340')
  })

  // SKA (18 decimals)
  it('formats SKA correctly', () => {
    expect(humanize.formatAtomsAsCoinString('1234500000000000000', 1, 2)).toBe('1.2345')
  })

  it('keeps minimum decimals for SKA', () => {
    expect(humanize.formatAtomsAsCoinString('1200000000000000000', 1, 2)).toBe('1.20')
    expect(humanize.formatAtomsAsCoinString('1000000000000000000', 1, 2)).toBe('1.00')
  })

  it('handles full precision SKA values', () => {
    expect(humanize.formatAtomsAsCoinString('123456789123456789', 1, 2)).toBe(
      '0.123456789123456789'
    )
  })

  // commas
  it('adds thousands separators', () => {
    expect(humanize.formatAtomsAsCoinString('1234567890000000', 0, 2)).toBe('12,345,678.90')
  })

  // edge cases
  it('handles zero correctly', () => {
    expect(humanize.formatAtomsAsCoinString('0', 0, 2)).toBe('0.00')
  })
})

describe('humanize.bytes', () => {
  // sub-10: raw bytes with space
  it('formats 0 as "0 B"', () => expect(humanize.bytes(0)).toBe('0 B'))
  it('formats 1 as "1 B"', () => expect(humanize.bytes(1)).toBe('1 B'))
  it('formats 9 as "9 B"', () => expect(humanize.bytes(9)).toBe('9 B'))

  // boundary: 10 bytes enters the scaled path
  it('formats 10 as "10 B"', () => expect(humanize.bytes(10)).toBe('10 B'))
  it('formats 999 as "999 B"', () => expect(humanize.bytes(999)).toBe('999 B'))

  // kB range — one decimal place when val < 10, zero when val >= 10
  // key regression: trailing zero must be preserved (4.0 kB, not 4 kB)
  it('formats 4000 as "4.0 kB"', () => expect(humanize.bytes(4000)).toBe('4.0 kB'))
  it('formats 4096 as "4.1 kB"', () => expect(humanize.bytes(4096)).toBe('4.1 kB'))
  it('formats 1000 as "1.0 kB"', () => expect(humanize.bytes(1000)).toBe('1.0 kB'))
  it('formats 1500 as "1.5 kB"', () => expect(humanize.bytes(1500)).toBe('1.5 kB'))
  it('formats 9900 as "9.9 kB"', () => expect(humanize.bytes(9900)).toBe('9.9 kB'))
  it('formats 10000 as "10 kB"', () => expect(humanize.bytes(10000)).toBe('10 kB'))
  it('formats 99000 as "99 kB"', () => expect(humanize.bytes(99000)).toBe('99 kB'))
  it('formats 6570 as "6.6 kB"', () => expect(humanize.bytes(6570)).toBe('6.6 kB'))

  // MB range
  it('formats 1000000 as "1.0 MB"', () => expect(humanize.bytes(1000000)).toBe('1.0 MB'))
  it('formats 2930000 as "2.9 MB"', () => expect(humanize.bytes(2930000)).toBe('2.9 MB'))
  it('formats 10000000 as "10 MB"', () => expect(humanize.bytes(10000000)).toBe('10 MB'))

  // GB range
  it('formats 1000000000 as "1.0 GB"', () => expect(humanize.bytes(1000000000)).toBe('1.0 GB'))
  it('formats 10000000000 as "10 GB"', () => expect(humanize.bytes(10000000000)).toBe('10 GB'))
})

describe('humanize.decimalParts', () => {
  // Helper: strip HTML tags so we can assert on the text content easily
  const strip = (html) => html.replace(/<[^>]+>/g, '')

  // --- basic structure ---
  it('returns a div.decimal-parts wrapper', () => {
    const html = humanize.decimalParts(1.5, false, 2)
    expect(html).toContain('class="decimal-parts d-inline-block"')
  })

  // --- precision clamping ---
  it('clamps precision > 8 to 8', () => {
    const html = humanize.decimalParts(1.123456789, false, 10)
    // 8 decimal places rendered
    expect(strip(html)).toContain('1')
    expect(html).toContain('12345679') // toFixed(8) rounds
  })

  it('treats NaN precision as 8', () => {
    const html = humanize.decimalParts(1.5, false, NaN)
    expect(html).toContain('decimal-parts')
  })

  // --- precision === 0: integer-only branch ---
  it('renders only int span when precision is 0', () => {
    // toFixed(0) rounds 42.9 → "43"
    const html = humanize.decimalParts(42.9, false, 0)
    expect(html).toContain('<span class="int">43</span>')
    expect(html).not.toContain('class="decimal dot"')
    expect(html).not.toContain('class="decimal"')
  })

  // --- standard decimal branch (no lgDecimals) ---
  it('renders int, dot, and decimal spans for a simple value', () => {
    const html = humanize.decimalParts(1.5, false, 2)
    expect(html).toContain('<span class="int">1</span>')
    expect(html).toContain('<span class="decimal dot">.</span>')
    expect(html).toContain('<span class="decimal">5</span>')
  })

  it('includes trailing-zeroes span when value has trailing zeros', () => {
    // 1.50 → decimalVals = "5", trailingZeros = "0"
    const html = humanize.decimalParts(1.5, false, 2)
    expect(html).toContain('<span class="decimal trailing-zeroes">0</span>')
  })

  it('omits trailing-zeroes span when there are no trailing zeros', () => {
    // 1.23 → no trailing zeros
    const html = humanize.decimalParts(1.23, false, 2)
    expect(html).toContain('<span class="decimal trailing-zeroes"></span>')
  })

  it('drops trailing-zeroes span entirely when dropTrailingZeros=true', () => {
    const html = humanize.decimalParts(1.5, false, 2, undefined, true)
    expect(html).not.toContain('trailing-zeroes')
  })

  it('drops trailing zeros from decimal value when dropTrailingZeros=true', () => {
    // 1.50 with dropTrailingZeros → decimal span should show "5" not "50"
    const html = humanize.decimalParts(1.5, false, 2, undefined, true)
    expect(html).toContain('<span class="decimal">5</span>')
  })

  // --- comma formatting ---
  it('formats integer part with commas when useCommas=true', () => {
    const html = humanize.decimalParts(1234567.89, true, 2)
    expect(html).toContain('<span class="int">1,234,567</span>')
  })

  it('does not add commas when useCommas=false', () => {
    const html = humanize.decimalParts(1234567.89, false, 2)
    expect(html).toContain('<span class="int">1234567</span>')
  })

  // --- lgDecimals branch ---
  it('merges int and first lgDecimals digits into the int span', () => {
    // v=1.23456, precision=5, lgDecimals=2
    // decimal="23456", lgPart=decimal.substring(0,2)="23"
    // decimalVals="23456" (no trailing zeros), restPart=decimalVals.substring(2)="456"
    const html = humanize.decimalParts(1.23456, false, 5, 2)
    expect(html).toContain('<span class="int">1.23</span>')
    expect(html).toContain('<span class="decimal">456</span>')
  })

  it('preserves zeros within lgDecimals even when they are trailing zeros (original bug)', () => {
    // 3.2 with precision=8, lgDecimals=2 → decimal="20000000"
    // lgPart should be "20" (from full decimal), not "2" (from trimmed decimalVals)
    // trailing zeros: "20000000" has 7 trailing zeros → trailingZeros="0000000"
    const html = humanize.decimalParts(3.2, false, 8, 2)
    expect(html).toContain('<span class="int">3.20</span>')
    expect(html).toContain('<span class="decimal trailing-zeroes">000000</span>')
  })

  it('int span includes zeros up to lgDecimals even when they are trailing zeros', () => {
    // v=1.00, precision=2, lgDecimals=2 → decimal="00" → lgPart="00" (from full decimal, not trimmed)
    const html = humanize.decimalParts(1.0, false, 2, 2, true)
    expect(html).toContain('<span class="int">1.00</span>')
  })

  it('includes trailing-zeroes span in lgDecimals branch when dropTrailingZeros=false', () => {
    // v=1.2, precision=4, lgDecimals=1 → decimalVals="2", restPart="", trailingZeros="000"
    const html = humanize.decimalParts(1.2, false, 4, 1)
    expect(html).toContain('trailing-zeroes')
    expect(html).toContain('000')
  })

  it('omits trailing-zeroes span in lgDecimals branch when dropTrailingZeros=true', () => {
    const html = humanize.decimalParts(1.2, false, 4, 1, true)
    expect(html).not.toContain('trailing-zeroes')
  })

  // --- edge cases ---
  it('handles v=0 correctly', () => {
    const html = humanize.decimalParts(0, false, 2)
    expect(html).toContain('<span class="int">0</span>')
    expect(html).toContain('<span class="decimal trailing-zeroes">00</span>')
  })

  it('handles negative values', () => {
    const html = humanize.decimalParts(-1.5, false, 2)
    expect(html).toContain('<span class="int">-1</span>')
    expect(html).toContain('<span class="decimal">5</span>')
  })

  it('handles string input that parses as a float', () => {
    const html = humanize.decimalParts('3.14', false, 2)
    expect(html).toContain('<span class="int">3</span>')
    expect(html).toContain('<span class="decimal">14</span>')
  })

  it('handles precision=1', () => {
    const html = humanize.decimalParts(9.87, false, 1)
    expect(html).toContain('<span class="int">9</span>')
    expect(html).toContain('<span class="decimal">9</span>')
  })

  it('handles full 8-decimal precision with no trailing zeros', () => {
    const html = humanize.decimalParts(1.23456789, false, 8)
    expect(html).toContain('<span class="decimal">23456789</span>')
    expect(html).toContain('<span class="decimal trailing-zeroes"></span>')
  })
})
