import { register } from '../registry'
import { ATOMS_TO_VAR } from '../format'

export const ticketPrice = {
  name: 'ticket-price',
  label: 'Ticket Price',
  controls: {
    bin: false,
    scale: false,
    mode: true,
    zoom: true,
    visibility: ['Price', 'Tickets Bought'],
    interval: false,
    windowUnits: true,
    hybrid: false
  },
  axes: [
    { label: 'Price (VAR)', scale: 'y' },
    { label: 'Tickets Bought', scale: 'y2' }
  ],
  series: [
    { label: 'Price', scale: 'y', kind: 'line', colorIndex: 0 },
    { label: 'Tickets Bought', scale: 'y2', kind: 'bars', colorIndex: 1 }
  ],
  toColumns: (raw) => {
    if (raw.t) {
      return [raw.t.slice(), raw.price.map((p) => p * ATOMS_TO_VAR), raw.count.slice()]
    }
    const xs = raw.price.map((_, i) => i * raw.window)
    return [xs, raw.price.map((p) => p * ATOMS_TO_VAR), raw.count.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    if (seriesIdx === 0) return `${datum.value.toFixed(8)} VAR`
    return Math.round(datum.value).toString()
  }
}

register(ticketPrice)
