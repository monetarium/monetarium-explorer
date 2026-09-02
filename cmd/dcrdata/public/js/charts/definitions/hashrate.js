import { register } from '../registry'
import { xColumn, withBigUnits, HASHRATE_UNITS } from '../format'

export const hashrate = {
  name: 'hashrate',
  label: 'Hashrate',
  controls: {
    bin: true,
    scale: true,
    mode: true,
    zoom: true,
    visibility: ['Hashrate', 'Active Miners'],
    interval: true,
    windowUnits: false,
    hybrid: false
  },
  axes: [
    // Base unit only. The ticks already carry the magnitude (threeSigFigs -> "10.5B"),
    // so a prefixed label would scale twice and read "10.5B GH/s".
    { label: 'Network Hashrate (H/s)', scale: 'y' },
    { label: 'Active Miners', scale: 'y2', intTicks: true }
  ],
  series: [
    { label: 'Hashrate', scale: 'y', kind: 'line', colorKey: 'hashrate-rate' },
    { label: 'Active Miners', scale: 'y2', kind: 'line', colorKey: 'hashrate-miners' }
  ],
  toColumns: (raw) => {
    const offset = raw.offset
    const xs = xColumn(raw, raw.rate.length, offset)
    const cols = [xs, raw.rate.slice()]
    if (raw.active_miners && raw.active_miners.length) {
      cols.push(raw.active_miners.slice())
    }
    return cols
  },
  formatValue: (seriesIdx, datum) => {
    if (seriesIdx === 1) return Math.round(datum.value).toString()
    return withBigUnits(datum.value, HASHRATE_UNITS)
  }
}

register(hashrate)
