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
    // SKA supply is 0 before its mint, then a huge plateau — on a log scale the leading
    // zeros (log10(0) = -Inf) blow out the axis. Floor the plotted value at 1 whole coin
    // on log (applied after the atoms->coins conversion in toColumns). A genuine sub-1-coin
    // supply is never a real cumulative state, and the exact value still shows in the
    // tooltip (formatValue reads the raw atom string). VAR supply is always > 0, so no
    // floor. Mirrors the Dygraphs clampLogFloor fix (#499/#507).
    series: [
      {
        label: 'Coin Supply',
        scale: 'y',
        kind: 'area',
        colorIndex: 0,
        ...(isSKA ? { logFloor: 1 } : {})
      }
    ],
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
