import { register } from '../registry'
import { xColumn } from '../format'
import humanize from '../../helpers/humanize_helper'

const baseControls = {
  bin: true,
  scale: true,
  mode: false,
  zoom: true,
  visibility: null,
  interval: false,
  windowUnits: false,
  hybrid: false
}

function plain(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export const blockSize = {
  name: 'block-size',
  label: 'Block Size',
  controls: { ...baseControls },
  // SI ticks: the tooltip is humanize.bytes (kB/MB/GB, base 1000), so a short-scale
  // tick would draw "5B" — read as 5 bytes — next to a tooltip saying "5.0 GB".
  axes: [{ label: 'Block Size (bytes)', scale: 'y', siTicks: true }],
  series: [{ label: 'Block Size', scale: 'y', kind: 'line', colorIndex: 0 }],
  toColumns: (raw) => {
    return [xColumn(raw, raw.size.length), raw.size.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    return humanize.bytes(datum.value)
  }
}

export const blockchainSize = {
  name: 'blockchain-size',
  label: 'Blockchain Size',
  controls: { ...baseControls },
  axes: [{ label: 'Blockchain Size (bytes)', scale: 'y', siTicks: true }],
  series: [{ label: 'Blockchain Size', scale: 'y', kind: 'area', colorIndex: 0 }],
  toColumns: (raw) => {
    return [xColumn(raw, raw.size.length), raw.size.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    return humanize.bytes(datum.value)
  }
}

export const txCount = {
  name: 'tx-count',
  label: 'Transaction Count',
  controls: { ...baseControls },
  axes: [{ label: '# of Transactions', scale: 'y' }],
  series: [{ label: 'Number of Transactions', scale: 'y', kind: 'line', colorIndex: 0 }],
  toColumns: (raw) => {
    return [xColumn(raw, raw.count.length), raw.count.slice()]
  },
  formatValue: (seriesIdx, datum) => {
    return plain(datum.value)
  }
}

register(blockSize)
register(blockchainSize)
register(txCount)
