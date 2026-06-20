import { register } from '../registry'
import { xColumn, intComma, ATOMS_TO_VAR } from '../format'

export const stakeParticipation = {
  name: 'stake-participation',
  label: 'Stake Participation',
  controls: {
    bin: true,
    scale: true,
    mode: false,
    zoom: true,
    visibility: null,
    interval: false,
    windowUnits: false,
    hybrid: false
  },
  axes: [{ label: 'Stake Participation (%)', scale: 'y' }],
  series: [{ label: 'Stake Participation', scale: 'y', kind: 'line', colorIndex: 0 }],
  toColumns: (raw) => {
    const supply = raw.circulation.map((v) => v * ATOMS_TO_VAR)
    const pool = raw.poolval.map((v) => v * ATOMS_TO_VAR)
    // Early blocks (genesis) can have 0 supply; that division yields Infinity, which
    // poisons uPlot's auto-range and blanks the whole chart at wide zoom levels. Null
    // out non-positive-supply points so they render as gaps instead.
    const ys = pool.map((v, i) => (supply[i] > 0 ? (v / supply[i]) * 100 : null))
    return [xColumn(raw, ys.length), ys]
  },
  formatValue: (seriesIdx, datum) => {
    if (datum.value == null || !isFinite(datum.value)) return 'n/a'
    return `${datum.value.toFixed(4)}%`
  },
  legendExtra: (datum) => {
    const pool = datum.payload.poolval[datum.idx] * ATOMS_TO_VAR
    const supply = datum.payload.circulation[datum.idx] * ATOMS_TO_VAR
    return [`Ticket Pool Value: ${intComma(pool)} VAR`, `Coin Supply: ${intComma(supply)} VAR`]
  }
}

register(stakeParticipation)
