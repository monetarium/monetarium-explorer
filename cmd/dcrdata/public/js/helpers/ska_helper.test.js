import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitSkaAtoms, splitSkaAtomsNoTrailing } from './ska_helper'

// ---------------------------------------------------------------------------
// Reference implementation mirroring Go's fixed skaDecimalParts(atomStr, false, boldNumPlaces=2)
// Splits the full 18-digit zero-padded frac at boldPlaces, trims trailing
// zeros from rest only — matches the corrected Go implementation.
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
  const frac = fracBig.toString().padStart(18, '0') // full 18-digit dec string

  // boldNumPlaces = 2: split frac at 2, trim trailing zeros from rest only
  const bold = frac.slice(0, 2)
  const restRaw = frac.slice(2)
  const trimmedRest = restRaw.replace(/0+$/, '')
  const trailingZeros = restRaw.slice(trimmedRest.length)

  return { intPart: intPart, bold: bold, rest: trimmedRest, trailingZeros: trailingZeros }
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
    // frac = "423397760083333862", bold = "42", restRaw = "3397760083333862"
    // trimmedRest = "3397760083333862", trailingZeros = ""
    const result = splitSkaAtoms('423397760083333862')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('42')
    expect(result.rest).toBe('3397760083333862')
    expect(result.trailingZeros).toBe('')
  })

  it('splits a whole-number value with trailing zeros in fraction', () => {
    // 1.000000000000000000 → frac = "000000000000000000"
    // bold = "00", restRaw = "0000000000000000", trimmedRest = "", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('1000000000000000000')
    expect(result.intPart).toBe('1')
    expect(result.bold).toBe('00')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('0000000000000000')
  })

  it('splits a value where bold digits are present but rest is empty', () => {
    // 0.120000000000000000 → frac = "120000000000000000"
    // bold = "12", restRaw = "0000000000000000", trimmedRest = "", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('120000000000000000')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('12')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('0000000000000000')
  })

  it('splits a value with a non-zero integer part', () => {
    // 2.500000000000000000 → frac = "500000000000000000"
    // bold = "50", restRaw = "0000000000000000", trimmedRest = "", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('2500000000000000000')
    expect(result.intPart).toBe('2')
    expect(result.bold).toBe('50')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('0000000000000000')
  })

  it('handles a value with only 1 significant decimal digit', () => {
    // 0.100000000000000000 → frac = "100000000000000000"
    // bold = "10", restRaw = "0000000000000000", trimmedRest = "", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('100000000000000000')
    expect(result.intPart).toBe('0')
    expect(result.bold).toBe('10')
    expect(result.rest).toBe('')
    expect(result.trailingZeros).toBe('0000000000000000')
  })

  it('handles the per-year value from the voting card example', () => {
    // 0.802084821280017403 → frac = "802084821280017403"
    // bold = "80", restRaw = "2084821280017403", trimmedRest = "2084821280017403", trailingZeros = ""
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

// ---------------------------------------------------------------------------
// splitSkaAtoms — cases mirroring Go TestSkaDecimalParts
// ---------------------------------------------------------------------------

describe('splitSkaAtoms (mirrors Go TestSkaDecimalParts)', () => {
  it('normal value with bold — 332.39617174', () => {
    // 332.39617174 * 10^18 = 332396171740000000000
    // frac = "396171740000000000", bold = "39", restRaw = "6171740000000000"
    // trimmedRest = "617174", trailingZeros = "0000000000"
    const result = splitSkaAtoms('332396171740000000000', 2)
    expect(result).toEqual({
      intPart: '332',
      bold: '39',
      rest: '617174',
      trailingZeros: '0000000000'
    })
  })

  it('short decimal (previously broken case) — 3.2', () => {
    // 3.2 * 10^18 = 3200000000000000000
    // frac = "200000000000000000", bold = "20", restRaw = "0000000000000000"
    // trimmedRest = "", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('3200000000000000000', 2)
    expect(result).toEqual({
      intPart: '3',
      bold: '20',
      rest: '',
      trailingZeros: '0000000000000000'
    })
  })

  it('no bold mode — 3.2', () => {
    // boldPlaces = 0: trim trailing zeros from full frac
    // frac = "200000000000000000", trimmed = "2", trailingZeros = "00000000000000000"
    const result = splitSkaAtoms('3200000000000000000', false, 0)
    expect(result).toEqual({
      intPart: '3',
      bold: '',
      rest: '2',
      trailingZeros: '00000000000000000'
    })
  })

  it('integer value — 5.0', () => {
    // 5 * 10^18 = 5000000000000000000
    // frac = "000000000000000000", bold = "00", restRaw = "0000000000000000"
    // trimmedRest = "", trailingZeros = "0000000000000000"
    const result = splitSkaAtoms('5000000000000000000', false, 2)
    expect(result).toEqual({
      intPart: '5',
      bold: '00',
      rest: '',
      trailingZeros: '0000000000000000'
    })
  })

  it('exact integer (no rounding needed) — 2.0', () => {
    // 2 * 10^18 = 2000000000000000000
    const result = splitSkaAtoms('2000000000000000000', false, 2)
    expect(result).toEqual({
      intPart: '2',
      bold: '00',
      rest: '',
      trailingZeros: '0000000000000000'
    })
  })

  it('with commas — 12345.67', () => {
    // 12345.67 * 10^18 = 12345670000000000000000
    // useCommas=true → intPart formatted with thousands separator
    const result = splitSkaAtoms('12345670000000000000000', true, 2)
    expect(result).toEqual({
      intPart: '12,345',
      bold: '67',
      rest: '',
      trailingZeros: '0000000000000000'
    })
  })
})

// ---------------------------------------------------------------------------
// splitSkaAtomsNoTrailing — cases mirroring Go TestSkaDecimalPartsNoTrailing
// ---------------------------------------------------------------------------

describe('splitSkaAtomsNoTrailing (mirrors Go TestSkaDecimalPartsNoTrailing)', () => {
  it('short decimal bold (primary case) — 3.2, boldPlaces=2', () => {
    // splitSkaAtoms gives { bold:"20", rest:"", trailingZeros:"0000000000000000" }
    // NoTrailing strips trailingZeros → ""
    const result = splitSkaAtomsNoTrailing('3200000000000000000', false, 2)
    expect(result).toEqual({ intPart: '3', bold: '20', rest: '', trailingZeros: '' })
  })

  it('short decimal no bold — 3.2, boldPlaces=0', () => {
    // splitSkaAtoms gives { bold:"", rest:"2", trailingZeros:"00000000000000000" }
    // NoTrailing strips trailingZeros → ""
    const result = splitSkaAtomsNoTrailing('3200000000000000000', false, 0)
    expect(result).toEqual({ intPart: '3', bold: '', rest: '2', trailingZeros: '' })
  })

  it('integer value bold — 5.0, boldPlaces=2', () => {
    // splitSkaAtoms gives { bold:"00", rest:"", trailingZeros:"0000000000000000" }
    // NoTrailing strips trailingZeros → ""
    const result = splitSkaAtomsNoTrailing('5000000000000000000', false, 2)
    expect(result).toEqual({ intPart: '5', bold: '00', rest: '', trailingZeros: '' })
  })

  it('normal value with bold — 332.39617174, boldPlaces=2', () => {
    // splitSkaAtoms gives { bold:"39", rest:"617174", trailingZeros:"0000000000" }
    // NoTrailing strips trailingZeros → ""
    const result = splitSkaAtomsNoTrailing('332396171740000000000', false, 2)
    expect(result).toEqual({ intPart: '332', bold: '39', rest: '617174', trailingZeros: '' })
  })

  it('with commas — 12345.67, boldPlaces=2', () => {
    // useCommas=true → intPart formatted with thousands separator, trailingZeros stripped
    const result = splitSkaAtomsNoTrailing('12345670000000000000000', true, 2)
    expect(result).toEqual({ intPart: '12,345', bold: '67', rest: '', trailingZeros: '' })
  })
})
