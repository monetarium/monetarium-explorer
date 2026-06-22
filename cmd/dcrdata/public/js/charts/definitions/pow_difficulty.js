import { register } from '../registry'
import { intComma } from '../format'

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
    return intComma(datum.value)
  }
}

register(powDifficulty)
