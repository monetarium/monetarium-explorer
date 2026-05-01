import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitSkaAtoms } from './ska_helper'

// ---------------------------------------------------------------------------
// Reference implementation mirroring Go's skaDecimalParts(atomStr, false, 2)
// This is the source of truth for what SSR renders.
// ---------------------------------------------------------------------------

/**
 * Mirrors Go skaDecimalParts(atomStr, false, boldNumPlaces=2).
 * Returns { intPart, bold, rest, trailingZeros } matching splitSkaAtoms output.
 */
function goSkaDecimalParts(atomStr) {
  if (!atomStr || atomStr === '0') {
    return { intPart: '0', bold: '', rest: '', trailingZeros: '' }
  }

  const atoms = BigInt(atomStr)
  if (atoms === 0n) {
    return { intPart: '0', bold: '', rest: '', trailingZeros: '' }
  }

  const scale = BigInt('1000000000000000000') // 10^18
  const intPart = (atoms / scale).toString()
  const fracBig = atoms % scale
  const dec = fracBig.toString().padStart(18, '0')

  // right = trimmed (no trailing zeros), trailingZeros = stripped suffix
  const right = dec.replace(/0+$/, '')
  const trailingZeros = dec.slice(right.length)

  // boldNumPlaces = 2
  const places = Math.min(2, right.length)
  if (places === 0) {
    return { intPart: intPart, bold: '', rest: right, trailingZeros: trailingZeros }
  }

  const bold = right.slice(0, places)
  const rest = right.slice(places)
  return { intPart, bold, rest, trailingZeros }
}

// ---------------------------------------------------------------------------
// Example-based tests
// ---------------------------------------------------------------------------

describe('splitSkaAtoms', () => {
  it('returns zero parts for empty string', () => {
    expect(splitSkaAtoms('')).toEqual({ intPart: '0', bold: '', rest: '', trailingZeros: '' })
  })

  it('returns zero parts for "0"', () => {
    expect(splitSkaAtoms('0')).toEqual({ intPart: '0', bold: '', rest: '', trailingZeros: '' })
  })

  it('splits a value with significant decimals and trailing zeros', () => {
    // 0.423397760083333862 SKA → atoms = 423397760083333862
    const result = splitSkaAtoms('423397760083333862')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('42')
    expect(result.rest).toBe('3397760083333862')
    expect(result.trailingZeros).toBe('')
  })

  it('splits a whole-number value with trailing zeros in fraction', () => {
    // 1.000000000000000000 → trailing zeros fill entire fraction
    const result = splitSkaAtoms('1000000000000000000')
    expect(result.intPart).toBe('1')
    expect(result.bold).toBe('')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('000000000000000000')
  })

  it('splits a value where bold digits are present but rest is empty', () => {
    // 0.120000000000000000 → right = "12", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('120000000000000000')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('12')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('0000000000000000')
  })

  it('splits a value with a non-zero integer part', () => {
    // 2.500000000000000000 → frac = "500000000000000000", trimmed = "5"
    // bold = "5" (only 1 significant digit), rest = "", trailingZeros = "00000000000000000" (17 zeros)
    const result = splitSkaAtoms('2500000000000000000')
    expect(result.intPart).toBe('2')
    expect(result.bold).toBe('5')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('00000000000000000')
  })

  it('handles a value with only 1 significant decimal digit', () => {
    // 0.100000000000000000 → right = "1", bold = "1", rest = ""
    const result = splitSkaAtoms('100000000000000000')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('1')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('00000000000000000')
  })

  it('handles the per-year value from the voting card example', () => {
    // 0.802084821280017403
    const result = splitSkaAtoms('802084821280017403')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('80')
    expect(result.rest).toBe('2084821280017403')
    expect(result.trailingZeros).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Property-based tests: JS output must match the Go reference for all inputs
// ---------------------------------------------------------------------------

describe('splitSkaAtoms matches Go skaDecimalParts (property-based)', () => {
  it('matches for any positive atom string up to 33 digits', () => {
    fc.assert(
      fc.property(
        // Generate positive BigInt-safe atom strings (1 to 10^33)
        fc.bigInt({ min: 1n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          const got = splitSkaAtoms(atomStr)
          const want = goSkaDecimalParts(atomStr)
          expect(got).toEqual(want)
        }
      ),
      { numRuns: 1000 }
    )
  })

  it('intPart + bold + rest + trailingZeros reconstructs the original value', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          const { intPart, bold, rest, trailingZeros } = splitSkaAtoms(atomStr)
          // Reconstruct: intPart.bold+rest+trailingZeros padded to 18 decimals
          const fracFull = (bold + rest + trailingZeros).padEnd(18, '0')
          const reconstructed =
            BigInt(intPart) * BigInt('1000000000000000000') + BigInt(fracFull || '0')
          expect(reconstructed.toString()).toBe(atomStr)
        }
      ),
      { numRuns: 1000 }
    )
  })

  it('trailingZeros contains only zeros', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          const { trailingZeros } = splitSkaAtoms(atomStr)
          expect(trailingZeros).toMatch(/^0*$/)
        }
      ),
      { numRuns: 500 }
    )
  })

  it('rest contains no trailing zeros', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          const { rest } = splitSkaAtoms(atomStr)
          if (rest.length > 0) {
            expect(rest[rest.length - 1]).not.toBe('0')
          }
        }
      ),
      { numRuns: 500 }
    )
  })
})
