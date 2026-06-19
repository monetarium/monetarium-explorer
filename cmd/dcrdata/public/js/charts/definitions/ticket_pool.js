import { register } from '../registry'
import { xColumn, intComma, ATOMS_TO_VAR } from '../format'

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

export const ticketPoolSize = {
  name: 'ticket-pool-size',
  label: 'Ticket Pool Size',
  controls: { ...baseControls },
  axes: [{ label: 'Ticket Pool Size', scale: 'y' }],
  series: [
    { label: 'Ticket Pool Size', scale: 'y', kind: 'line', colorIndex: 0 },
    { label: 'Network Target', scale: 'y', kind: 'line', colorIndex: 9 }
  ],
  toColumns: (raw, settings) => {
    const n = raw.count.length
    const xs = xColumn(raw, n)
    const counts = raw.count.slice()
    const target = new Array(n).fill(null)
    if (n) {
      target[0] = settings.tps
      target[n - 1] = settings.tps
    }
    return [xs, counts, target]
  },
  formatValue: (seriesIdx, datum, settings) => {
    return `${intComma(datum.value)} tickets    (network target ${intComma(settings.tps)})`
  }
}

export const ticketPoolValue = {
  name: 'ticket-pool-value',
  label: 'Ticket Pool Value',
  controls: { ...baseControls },
  axes: [{ label: 'Ticket Pool Value (VAR)', scale: 'y' }],
  series: [{ label: 'Ticket Pool Value', scale: 'y', kind: 'line', colorIndex: 0 }],
  toColumns: (raw) => {
    const ys = raw.poolval.map((v) => v * ATOMS_TO_VAR)
    return [xColumn(raw, ys.length), ys]
  },
  formatValue: (seriesIdx, datum) => {
    return `${intComma(datum.value)} VAR`
  }
}

register(ticketPoolSize)
register(ticketPoolValue)
