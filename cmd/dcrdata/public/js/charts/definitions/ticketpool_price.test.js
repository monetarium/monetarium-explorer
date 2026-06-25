import { describe, it, expect } from 'vitest'
import { ticketpoolPrice } from './ticketpool_price'

const base = { price: [100, 200, 300], immature: [1, 2, 3], live: [4, 5, 6] }

describe('ticketpoolPrice.toColumns', () => {
  it('returns [prices, mem, imm, live, live] with no mempool when settings is empty', () => {
    const cols = ticketpoolPrice.toColumns(base, {})
    expect(cols[0]).toEqual([100, 200, 300])
    expect(cols[1]).toEqual([0, 0, 0]) // mem all zero
    expect(cols[2]).toEqual([1, 2, 3])
    expect(cols[3]).toEqual([4, 5, 6])
    expect(cols[4]).toEqual([4, 5, 6])
  })

  it('does NOT treat an empty settings object as a mempool point (the render() guard)', () => {
    const cols = ticketpoolPrice.toColumns(base, {})
    expect(cols[0]).toHaveLength(3) // no extra point appended
  })

  it('adds the mempool count at a matching existing price', () => {
    const cols = ticketpoolPrice.toColumns(base, { mempool: { price: 200, count: 7 } })
    expect(cols[0]).toEqual([100, 200, 300])
    expect(cols[1]).toEqual([0, 7, 0])
  })

  it('inserts a new sorted price bucket for an unseen mempool price', () => {
    const cols = ticketpoolPrice.toColumns(base, { mempool: { price: 150, count: 9 } })
    expect(cols[0]).toEqual([100, 150, 200, 300])
    expect(cols[1]).toEqual([0, 9, 0, 0])
  })
})

describe('ticketpoolPrice overlay points series', () => {
  const overlay = ticketpoolPrice.series[4]

  it('is a line with visible points and zero-width stroke', () => {
    expect(overlay.kind).toBe('line')
    expect(overlay.points.show).toBe(true)
    expect(overlay.points.size).toBe(7)
    expect(overlay.spanGaps).toBe(true)
  })
})

describe('ticketpoolPrice.columns', () => {
  it('returns 6 columns (x, mem, imm, live, y2-axis, overlay)', () => {
    const cols = ticketpoolPrice.toColumns(base, {})
    expect(cols).toHaveLength(6)
  })

  it('overlay column is null everywhere when no mempool', () => {
    const cols = ticketpoolPrice.toColumns(base, {})
    expect(cols[5]).toEqual([null, null, null])
  })

  it('overlay column has the mempool count at matching price', () => {
    const cols = ticketpoolPrice.toColumns(base, { mempool: { price: 200, count: 7 } })
    expect(cols[5]).toEqual([null, 7, null])
  })

  it('overlay column has the mempool count at inserted price', () => {
    const cols = ticketpoolPrice.toColumns(base, { mempool: { price: 150, count: 9 } })
    expect(cols[5]).toEqual([null, 9, null, null])
  })
})
