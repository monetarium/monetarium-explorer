import { register } from '../registry'

export const powDifficulty = {
  name: 'pow-difficulty',
  label: 'PoW Difficulty',
  controls: {
    bin: false,
    scale: true,
    mode: false,
    zoom: true,
    visibility: null,
    interval: false,
    windowUnits: true,
    hybrid: false
  },
  axes: [{ label: 'Difficulty', scale: 'y' }],
  series: [{ label: 'Difficulty', scale: 'y', kind: 'line', colorIndex: 0 }],
  toColumns: (raw) => {
    if (raw.t) return [raw.t.slice(), raw.diff.slice()]
    // An explicit per-point height array (e.g. the live-tip point appended at a
    // window start) takes precedence over deriving height from the window index.
    if (raw.h) return [raw.h.slice(), raw.diff.slice()]
    const xs = raw.diff.map((_, i) => i * raw.window)
    return [xs, raw.diff.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    // Difficulty is a float64 — keep its full precision in the tooltip. intComma's
    // maximumFractionDigits:0 would round it (e.g. 3.5 -> "4"), losing the decimals
    // the legacy Dygraphs default formatter preserved. maximumFractionDigits:20 groups
    // thousands but never rounds, and formats from the double's shortest round-trip
    // decimal so it introduces no float artifacts. Mirror intComma's non-finite guard
    // so a log-scale-nulled point still reads blank rather than "NaN".
    if (!Number.isFinite(datum.value)) return ''
    return datum.value.toLocaleString(undefined, { maximumFractionDigits: 20 })
  }
}

register(powDifficulty)
