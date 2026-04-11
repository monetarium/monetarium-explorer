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
