import { register } from '../registry'
import { xColumn, unitPrefix, withBigUnits, CHAINWORK_UNITS } from '../format'

const baseControls = {
  bin: true,
  scale: true,
  mode: false,
  zoom: true,
  visibility: null,
  interval: false,
  windowUnits: false,
  hybrid: false
}

export const durationBtwBlocks = {
  name: 'duration-btw-blocks',
  label: 'Duration Between Blocks',
  controls: { ...baseControls },
  axes: [{ label: 'Duration Between Blocks (seconds)', scale: 'y' }],
  series: [{ label: 'Duration Between Blocks', scale: 'y', kind: 'line', colorIndex: 0 }],
  yMin: 0, // durations are non-negative; floor the Y axis at 0, top unbounded
  toColumns: (raw) => {
    return [xColumn(raw, raw.duration.length, 1), raw.duration.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}

export const chainwork = {
  name: 'chainwork',
  label: 'Total Work',
  controls: { ...baseControls },
  axes: [{ label: 'Cumulative Chainwork (H)', scale: 'y' }],
  series: [{ label: 'Cumulative Chainwork', scale: 'y', kind: 'line', colorIndex: 0 }],
  toColumns: (raw) => {
    return [xColumn(raw, raw.work.length), raw.work.slice()]
  },
  // Axis label scales to the data's max magnitude (matches legacy unitPrefix).
  axisLabel: (raw) => {
    const max = raw.work.length ? raw.work.reduce((a, b) => Math.max(a, b), 0) : 0
    const p = unitPrefix(max)
    return p ? `Cumulative Chainwork (${p}H)` : 'Cumulative Chainwork (H)'
  },
  formatValue: (seriesIdx, datum) => {
    return withBigUnits(datum.value, CHAINWORK_UNITS)
  }
}

register(durationBtwBlocks)
register(chainwork)
