// Address-page chart definitions (Balance / Tx Type / Sent-Received) for the uPlot
// adapter. Unlike /charts definitions these are NOT registered globally — the address
// controller imports the factories directly. SKA precision firewall: formatValue reads
// the raw atom STRING from the payload, never the lossy plotted number.

import { formatSkaAtomsExact } from '../format'
import { renderCoinType } from '../../helpers/ska_helper'

const SKA_ATOMS_TO_COIN = 1e-18

// RFC3339 strings (TimeDef.MarshalJSON) -> integer UNIX seconds for the uPlot x-axis.
export function secondsFromTimes(times) {
  return times.map((t) => Math.floor(Date.parse(t) / 1000))
}

// VAR float -> display; SKA exact string from the atom payload.
function varOrSkaValue(coinType, value, atomStr, coinLabel) {
  if (coinType === 0) return `${value} ${coinLabel}`
  return `${formatSkaAtomsExact(atomStr)} ${coinLabel}`
}

export function balanceDef(coinType) {
  const isSKA = coinType > 0
  const coinLabel = renderCoinType(coinType)
  return {
    name: 'balance',
    label: `Balance (${coinLabel})`,
    stacked: false,
    axes: [{ label: `Balance (${coinLabel})`, scale: 'y' }],
    series: [{ label: 'Balance', scale: 'y', kind: 'stepped', colorIndex: 0 }],
    toColumns: (raw) => {
      const xs = secondsFromTimes(raw.time)
      const ys = isSKA
        ? (raw.balance_atoms || []).map((s) => Number(s) * SKA_ATOMS_TO_COIN) // lossy — geometry only
        : (raw.balance || []).slice()
      return [xs, ys]
    },
    formatValue: (seriesIdx, datum) =>
      varOrSkaValue(
        coinType,
        datum.value,
        isSKA ? datum.payload.balance_atoms[datum.idx] : null,
        coinLabel
      )
  }
}
