import { register } from '../registry'
import { intComma } from '../format'

export const missedVotes = {
  name: 'missed-votes',
  label: 'Missed Votes',
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
  axes: [{ label: 'Missed Votes per Window', scale: 'y' }],
  series: [{ label: 'Missed Votes', scale: 'y', kind: 'bars', colorIndex: 0 }],
  toColumns: (raw) => {
    if (raw.t) return [raw.t.slice(), raw.missed.slice()]
    const base = raw.offset * raw.window
    const xs = raw.missed.map((_, i) => i * raw.window + base)
    return [xs, raw.missed.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    return intComma(datum.value)
  }
}

register(missedVotes)
