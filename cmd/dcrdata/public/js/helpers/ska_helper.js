/**
 * renderCoinType returns the display label for a coin_type value.
 *
 * Accepts a number or a numeric string (e.g. from JSON object keys or
 * WebSocket payloads). Floats, non-numeric strings, empty strings, null,
 * undefined, and out-of-range values all return the safe fallback "-".
 *
 * Mapping:
 *   0        → "VAR"
 *   1–255    → "SKA1"–"SKA255"
 *   anything else → "-"
 *
 * @param {number|string|null|undefined} coinType
 * @returns {string}
 */
export function renderCoinType(coinType) {
  if (coinType === null || coinType === undefined) return '-'
  const n = typeof coinType === 'string' ? (coinType === '' ? NaN : Number(coinType)) : coinType
  if (!Number.isInteger(n)) return '-'
  if (n === 0) return 'VAR'
  if (n >= 1 && n <= 255) return `SKA${n}`
  return '-'
}

/**
 * splitSkaAtoms converts a raw SKA atom string (integer, 18 decimal places)
 * into display parts, using BigInt to avoid float64 precision loss.
 *
 * Mirrors Go skaDecimalParts(atomStr, useCommas, boldNumPlaces).
 * Splits the full 18-digit zero-padded fractional string at boldPlaces,
 * then extracts trailing zeros from the rest portion only.
 *
 * @param {string} atomStr - e.g. "1583594312551510000"
 * @param {boolean} [useCommas=false] - insert thousands separators into intPart
 * @param {number} [boldPlaces=2] - number of leading decimal digits to bold
 * @returns {{ intPart: string, bold: string, rest: string, trailingZeros: string }}
 */
export function splitSkaAtoms(atomStr, useCommas = false, boldPlaces = 2) {
  if (!atomStr || atomStr === '0') return { intPart: '0', bold: '', rest: '', trailingZeros: '' }
  let atoms
  try {
    atoms = BigInt(atomStr)
  } catch {
    return { intPart: atomStr, bold: '', rest: '', trailingZeros: '' }
  }
  const divisor = BigInt('1000000000000000000') // 10^18
  const intBig = atoms / divisor
  const intPart = useCommas && intBig > 0n ? intBig.toLocaleString('en-US') : intBig.toString()
  const fracBig = atoms % divisor
  // Zero-pad to 18 digits — this is `dec` in Go
  const frac = fracBig.toString().padStart(18, '0')

  if (boldPlaces === 0) {
    // Non-bold mode: trim trailing zeros from the full frac string
    const trimmed = frac.replace(/0+$/, '')
    const trailingZeros = frac.slice(trimmed.length)
    return { intPart: intPart, bold: '', rest: trimmed, trailingZeros: trailingZeros }
  }

  // Bold mode: split frac at boldPlaces, then trim trailing zeros from rest only
  const clampedPlaces = Math.min(boldPlaces, 18)
  const bold = frac.slice(0, clampedPlaces)
  const restRaw = frac.slice(clampedPlaces)
  const trimmedRest = restRaw.replace(/0+$/, '')
  const trailingZeros = restRaw.slice(trimmedRest.length)
  return { intPart: intPart, bold: bold, rest: trimmedRest, trailingZeros: trailingZeros }
}

/**
 * splitSkaAtomsNoTrailing is the SKA-atom equivalent of Go's skaDecimalPartsNoTrailing.
 * Calls splitSkaAtoms and strips the trailingZeros field so callers never render dimmed zeros.
 *
 * @param {string} atomStr
 * @param {boolean} [useCommas=false]
 * @param {number} [boldPlaces=2]
 * @returns {{ intPart: string, bold: string, rest: string, trailingZeros: string }}
 */
export function splitSkaAtomsNoTrailing(atomStr, useCommas = false, boldPlaces = 2) {
  const parts = splitSkaAtoms(atomStr, useCommas, boldPlaces)
  return { ...parts, trailingZeros: '' }
}
