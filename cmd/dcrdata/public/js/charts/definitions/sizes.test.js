import { describe, it, expect } from 'vitest'
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

describe('sizes formatValue', () => {
  it('formats with thousands separators', () => {
    expect(blockSize.formatValue(0, { value: 12345 }, {})).toBe('12,345')
    expect(txCount.formatValue(0, { value: 9 }, {})).toBe('9')
  })
})
