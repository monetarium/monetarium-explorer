import { register } from '../registry'
import { xColumn, intComma, ATOMS_TO_VAR } from '../format'

export const privacyParticipation = {
  name: 'privacy-participation',
  label: 'Privacy Participation',
  controls: {
    bin: true,
    scale: false,
    mode: false,
    zoom: true,
    visibility: null,
    interval: false,
    windowUnits: false,
    hybrid: true
  },
  axes: [{ label: 'Mix Rate (VAR)', scale: 'y' }],
  series: [{ label: 'Mix Rate', scale: 'y', kind: 'area', colorIndex: 0 }],
  toColumns: (raw) => {
    const ys = raw.anonymitySet.map((v) => v * ATOMS_TO_VAR)
    return [xColumn(raw, ys.length), ys]
  },
  // [start, end] in the same x-units the chart plots, marking the first point
  // with a non-zero mix value through the last point — used to zoom-to-start.
  limits: (raw) => {
    const set = raw.anonymitySet
    let start = -1
    let end = 0
    if (raw.axis === 'height') {
      for (let i = 0; i < set.length; i++) {
        if (start === -1 && set[i] > 0) start = raw.bin === 'block' ? i + 1 : raw.h[i]
        end = raw.bin === 'block' ? i + 1 : raw.h[i]
      }
    } else {
      for (let i = 0; i < set.length; i++) {
        if (start === -1 && set[i] > 0) start = raw.t[i] * 1000
        end = raw.t[i] * 1000
      }
    }
    return [start, end]
  },
  formatValue: (seriesIdx, datum) => {
    return datum.value > 0 ? intComma(datum.value) : '0 VAR'
  }
}

register(privacyParticipation)
