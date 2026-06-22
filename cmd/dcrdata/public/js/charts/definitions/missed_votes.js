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
    // A 0-missed window is unplottable on a log axis (log10(0) = -Inf, which on a
    // bar series renders as a stub pinned to the scale floor). Emit null so the bar
    // is simply omitted — visually identical to a 0-height bar on linear — and uPlot
    // skips it when autoscaling the log range. The real count is recovered for the
    // tooltip from the untouched payload in formatValue.
    const ys = raw.missed.map((v) => (v > 0 ? v : null))
    if (raw.t) return [raw.t.slice(), ys]
    // missedVotesChart never emits an explicit height array: missed votes have no
    // live-tip source (ChartTip carries no MissedVotes), so every point is a
    // completed window and its height is derived from the window index. Unlike
    // ticket-price/pow-difficulty, there is no appended live point to honor here.
    const base = raw.offset * raw.window
    const xs = raw.missed.map((_, i) => i * raw.window + base)
    return [xs, ys]
  },
  formatValue: (seriesIdx, datum) => {
    // Read the raw count from the payload, never the plotted value (nulled for zeros
    // above so intComma(datum.value) would blank them). intComma renders a real 0 as '0'.
    return intComma(datum.payload.missed[datum.idx])
  }
}

register(missedVotes)
