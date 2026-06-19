// Shared display + column-shaping helpers for chart definitions. Lifted from the
// pre-uPlot charts_controller.js so formatting stays byte-identical.

import { splitSkaAtomsNoTrailing } from '../helpers/ska_helper'

export const ATOMS_TO_VAR = 1e-8
export const CHAINWORK_UNITS = ['H', 'kH', 'MH', 'GH', 'TH', 'PH', 'EH', 'ZH', 'YH']
export const HASHRATE_UNITS = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s']

export function intComma(amount) {
  if (!amount) return ''
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function unitPrefix(value) {
  if (value <= 0) return ''
  const i = Math.max(0, Math.min(Math.floor(Math.log10(value) / 3), 8))
  return ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'][i]
}

export function withBigUnits(v, units) {
  const i = v === 0 ? 0 : Math.max(0, Math.min(Math.floor(Math.log10(v) / 3), units.length - 1))
  return `${(v / Math.pow(1000, i)).toFixed(3)} ${units[i]}`
}

// Exact SKA display string (18 decimals) — BigInt path, never Number().
export function formatSkaAtomsExact(atomStr) {
  const p = splitSkaAtomsNoTrailing(atomStr, true, 0)
  return p.rest ? `${p.intPart}.${p.rest}` : p.intPart
}

// X column for a chart payload, mirroring legacy zip2D x-axis semantics EXACTLY:
//  - block bin   → 1-based index (zip2D calls zipIvY WITHOUT forwarding offset,
//                  so offset is ignored; the genesis-height-0 quirk = always 1).
//  - other height bin → offset + h[i] (zipHvY; offset defaults to 1; the only
//                  caller passing a non-1 offset is hashrate = HashrateAvgLength).
//  - time axis   → raw.t seconds.
// n = number of points.
export function xColumn(raw, n, offset = 1) {
  if (raw.axis === 'height') {
    if (raw.bin === 'block') {
      return Array.from({ length: n }, (_, i) => i + 1)
    }
    return Array.from({ length: n }, (_, i) => offset + raw.h[i])
  }
  return raw.t.slice(0, n)
}
