import { register } from '../registry'
import { xColumn, unitPrefix, withBigUnits, HASHRATE_UNITS } from '../format'

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
    { label: 'Network Hashrate (H/s)', scale: 'y' },
    { label: 'Active Miners', scale: 'y2' }
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
  axisLabel: (raw) => {
    const max = raw.rate.length ? raw.rate.reduce((a, b) => Math.max(a, b), 0) : 0
    const p = unitPrefix(max)
    return p ? `Network Hashrate (${p}H/s)` : 'Network Hashrate (H/s)'
  },
  formatValue: (seriesIdx, datum) => {
    if (seriesIdx === 1) return Math.round(datum.value).toString()
    return withBigUnits(datum.value, HASHRATE_UNITS)
  }
}

register(hashrate)
