import { describe, it, expect } from 'vitest'
import uPlot from 'uplot'
import { buildOpts } from '../../helpers/uplot_adapter'
import { blockSize, blockchainSize, txCount } from './sizes'

describe('sizes toColumns', () => {
  const raw = { axis: 'time', t: [1000, 2000], size: [500, 1500], count: [3, 9] }
  it('block-size plots size', () => {
    expect(blockSize.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [500, 1500]
    ])
  })
  it('blockchain-size plots size', () => {
    expect(blockchainSize.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [500, 1500]
    ])
  })
  it('tx-count plots count', () => {
    expect(txCount.toColumns(raw, {})).toEqual([
      [1000, 2000],
      [3, 9]
    ])
  })
})

describe('sizes axis ticks', () => {
  it('ticks the byte axes in SI, so 5e9 bytes reads 5G and not 5B', () => {
    for (const def of [blockSize, blockchainSize]) {
      const y = buildOpts(uPlot, def, {}).axes[1]
      expect(y.values(null, [5e8, 5e9])).toEqual(['500M', '5G'])
    }
  })
  it('leaves the transaction count on the short scale (it counts things)', () => {
    const y = buildOpts(uPlot, txCount, {}).axes[1]
    expect(y.values(null, [1.5e9])).toEqual(['1.5B'])
  })
})

describe('sizes series kinds', () => {
  it('blockchain-size renders as a filled area (cumulative)', () => {
    expect(blockchainSize.series[0].kind).toBe('area')
  })
  it('block-size and tx-count stay line (per-bucket, not cumulative)', () => {
    expect(blockSize.series[0].kind).toBe('line')
    expect(txCount.series[0].kind).toBe('line')
  })
})

describe('sizes formatValue', () => {
  it('formats sizes with humanize.bytes and counts with separators', () => {
    // Same formatter the /blocks list uses for block.size, so a chart tooltip and the
    // table beside it agree.
    expect(blockSize.formatValue(0, { value: 12345 }, {})).toBe('12 kB')
    expect(blockchainSize.formatValue(0, { value: 166291227 }, {})).toBe('166 MB')
    expect(txCount.formatValue(0, { value: 9 }, {})).toBe('9')
  })
})
