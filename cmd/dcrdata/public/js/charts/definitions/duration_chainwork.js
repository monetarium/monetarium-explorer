import { register } from '../registry'
import { xColumn, withBigUnits, CHAINWORK_UNITS } from '../format'

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
    if (datum.value == null || !isFinite(datum.value)) return 'n/a'
    return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}

export const chainwork = {
  name: 'chainwork',
  label: 'Total Work',
  controls: { ...baseControls },
  // Base unit only: the ticks carry the magnitude suffix themselves, in SI (a work
  // total is counted in hashes, so 1e12 H is "1T" under "(H)" — see hashrate).
  axes: [{ label: 'Cumulative Chainwork (H)', scale: 'y', siTicks: true }],
  series: [{ label: 'Cumulative Chainwork', scale: 'y', kind: 'area', colorIndex: 0 }],
  toColumns: (raw) => {
    return [xColumn(raw, raw.work.length), raw.work.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    if (datum.value == null || !isFinite(datum.value)) return 'n/a'
    return withBigUnits(datum.value, CHAINWORK_UNITS)
  }
}

register(durationBtwBlocks)
register(chainwork)
