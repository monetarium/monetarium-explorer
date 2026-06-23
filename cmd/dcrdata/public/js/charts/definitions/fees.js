import { register } from '../registry'
import { xColumn, formatSkaAtomsExact, ATOMS_TO_VAR } from '../format'
import { renderCoinType } from '../../helpers/ska_helper'

const SKA_ATOMS_TO_COIN = 1e-18

export function feesDef(coinType) {
  const isSKA = coinType > 0
  const coinLabel = renderCoinType(coinType)
  return {
    name: isSKA ? `fees/${coinType}` : 'fees',
    label: `Fees (${coinLabel})`,
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
    axes: [{ label: `Total Fee (${coinLabel})`, scale: 'y' }],
    series: [{ label: 'Total Fee', scale: 'y', kind: 'line', colorIndex: 0 }],
    toColumns: (raw) => {
      const ys = isSKA
        ? raw.fees.map((s) => Number(s) * SKA_ATOMS_TO_COIN) // lossy — geometry only
        : raw.fees.map((s) => s * ATOMS_TO_VAR)
      return [xColumn(raw, ys.length), ys]
    },
    formatValue: (seriesIdx, datum) => {
      if (isSKA) {
        return `${formatSkaAtomsExact(datum.payload.fees[datum.idx])} ${coinLabel}`
      }
      // Fees are atoms scaled to VAR (1e-8). intComma would round sub-1 VAR fees
      // to 0 — keep full precision with maximumFractionDigits:20, matching the
      // pow-difficulty tooltip fix (commit 523242ec).
      if (!Number.isFinite(datum.value)) return ''
      return `${datum.value.toLocaleString('en-US', { maximumFractionDigits: 20 })} VAR`
    }
  }
}

register(feesDef(0))
