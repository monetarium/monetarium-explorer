import { register } from '../registry'
import { xColumn, intComma, formatSkaAtomsExact, ATOMS_TO_VAR } from '../format'
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
      return `${intComma(datum.value)} VAR`
    }
  }
}

register(feesDef(0))
