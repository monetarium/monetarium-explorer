/**
 * renderCoinType returns the display label for a coin_type value.
 *
 * Accepts a number or a numeric string (e.g. from JSON object keys or
 * WebSocket payloads). Non-numeric strings, floats, null, undefined, and
 * out-of-range values all return the safe fallback "-".
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
  const n = typeof coinType === 'string' ? parseInt(coinType, 10) : coinType
  if (!Number.isInteger(n)) return '-'
  if (n === 0) return 'VAR'
  if (n >= 1 && n <= 255) return `SKA${n}`
  return '-'
}

/**
 * splitSkaValue splits an SKA decimal string into display parts.
 * Matches the SSR skaSplitParts logic: strips trailing zeros, takes first 2
 * significant decimal digits as "bold", the rest as "rest".
 *
 * @param {string} s - e.g. "0.00158359431255151000"
 * @returns {{ intPart: string, bold: string, rest: string, trailingZeros: string }}
 */
export function splitSkaValue(s) {
  const dot = s.indexOf('.')
  const intPart = dot >= 0 ? s.slice(0, dot) : s
  const frac = dot >= 0 ? s.slice(dot + 1) : ''
  const trimmed = frac.replace(/0+$/, '')
  const trailingZeros = frac.slice(trimmed.length)
  const bold = trimmed.slice(0, 2)
  const rest = trimmed.slice(2)
  return { intPart, bold, rest, trailingZeros }
}

/**
 * splitSkaAtoms converts a raw SKA atom string (integer, 18 decimal places)
 * into display parts, using BigInt to avoid float64 precision loss.
 * Output shape matches splitSkaValue.
 *
 * @param {string} atomStr - e.g. "1583594312551510000"
 * @param {number} [boldPlaces=2] - number of leading decimal digits to bold
 * @returns {{ intPart: string, bold: string, rest: string, trailingZeros: string }}
 */
export function splitSkaAtoms(atomStr, boldPlaces = 2) {
  if (!atomStr || atomStr === '0') return { intPart: '0', bold: '', rest: '', trailingZeros: '' }
  let atoms
  try {
    atoms = BigInt(atomStr)
  } catch {
    return { intPart: atomStr, bold: '', rest: '', trailingZeros: '' }
  }
  const divisor = BigInt('1000000000000000000') // 10^18
  const intPart = (atoms / divisor).toString()
  const fracBig = atoms % divisor
  // Zero-pad to 18 digits
  const frac = fracBig.toString().padStart(18, '0')
  const trimmed = frac.replace(/0+$/, '')
  const trailingZeros = frac.slice(trimmed.length)
  const bold = trimmed.slice(0, boldPlaces)
  const rest = trimmed.slice(boldPlaces)
  return { intPart, bold, rest, trailingZeros }
}
