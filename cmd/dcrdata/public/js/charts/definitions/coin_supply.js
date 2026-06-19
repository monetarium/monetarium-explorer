import { register } from '../registry'
import { xColumn, intComma, ATOMS_TO_VAR, formatSkaAtomsExact } from '../format'
import { renderCoinType } from '../../helpers/ska_helper'

const SKA_ATOMS_TO_COIN = 1e-18

export function coinSupplyDef(coinType) {
  const isSKA = coinType > 0
  const coinLabel = renderCoinType(coinType) // 'VAR' or 'SKA{n}'
  return {
    name: `coin-supply/${coinType}`,
    label: `Circulation (${coinLabel})`,
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
    axes: [{ label: `Coin Supply (${coinLabel})`, scale: 'y' }],
    series: [{ label: 'Coin Supply', scale: 'y', kind: 'line', colorIndex: 0 }],
    toColumns: (raw) => {
      const ys = isSKA
        ? raw.supply.map((s) => Number(s) * SKA_ATOMS_TO_COIN) // lossy — geometry only
        : raw.supply.map((s) => s * ATOMS_TO_VAR)
      return [xColumn(raw, ys.length), ys]
    },
    formatValue: (seriesIdx, datum) => {
      if (isSKA) {
        // Exact string from the untouched atom payload — never the plot number.
        return `${formatSkaAtomsExact(datum.payload.supply[datum.idx])} ${coinLabel}`
      }
      return `${intComma(datum.value)} VAR`
    }
  }
}

register(coinSupplyDef(0))
