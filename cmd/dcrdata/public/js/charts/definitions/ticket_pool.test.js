import { describe, it, expect } from 'vitest'
import { ticketPoolSize, ticketPoolValue } from './ticket_pool'

describe('ticketPoolSize.toColumns', () => {
  it('time axis: [t, count, networkTarget endpoints]', () => {
    const raw = { axis: 'time', t: [1000, 2000, 3000], count: [10, 20, 30] }
    const cols = ticketPoolSize.toColumns(raw, { tps: 99 })
    expect(cols[0]).toEqual([1000, 2000, 3000])
    expect(cols[1]).toEqual([10, 20, 30])
    // Network Target series: flat line at tps, only the endpoints set, middle null.
    expect(cols[2]).toEqual([99, null, 99])
  })
})

describe('ticketPoolSize.series', () => {
  it('draws the Network Target as a bolder dashed line', () => {
    const target = ticketPoolSize.series.find((s) => s.label === 'Network Target')
    expect(target.dash).toEqual([5, 3])
    expect(target.width).toBe(2)
    expect(target.spanGaps).toBe(true)
  })
})

describe('ticketPoolValue.toColumns', () => {
  it('height/block axis: [i, poolval*1e-8] (0-based)', () => {
    const raw = { axis: 'height', bin: 'block', poolval: [100000000, 200000000] }
    expect(ticketPoolValue.toColumns(raw, {})).toEqual([
      [0, 1],
      [1, 2]
    ])
  })
})

describe('formatValue', () => {
  it('pool size shows tickets + network target', () => {
    expect(ticketPoolSize.formatValue(0, { value: 1234 }, { tps: 5000 })).toBe(
      '1,234 tickets    (network target 5,000)'
    )
  })
  it('pool value shows VAR integer', () => {
    expect(ticketPoolValue.formatValue(0, { value: 1234 }, {})).toBe('1,234 VAR')
  })
})
