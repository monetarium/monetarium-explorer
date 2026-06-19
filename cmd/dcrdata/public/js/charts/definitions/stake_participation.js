import { register } from '../registry'
import { xColumn, intComma, ATOMS_TO_VAR } from '../format'

export const stakeParticipation = {
  name: 'stake-participation',
  label: 'Stake Participation',
  controls: {
    bin: true,
    scale: false,
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
    const ys = pool.map((v, i) => (v / supply[i]) * 100)
    return [xColumn(raw, ys.length), ys]
  },
  formatValue: (seriesIdx, datum) => {
    return `${datum.value.toFixed(4)}%`
  },
  legendExtra: (datum) => {
    const pool = datum.payload.poolval[datum.idx] * ATOMS_TO_VAR
    const supply = datum.payload.circulation[datum.idx] * ATOMS_TO_VAR
    return [`Ticket Pool Value: ${intComma(pool)} VAR`, `Coin Supply: ${intComma(supply)} VAR`]
  }
}

register(stakeParticipation)
