import { describe, it, expect } from 'vitest'
import { ticketpoolPurchases } from './ticketpool_purchases'

// Date('2026-06-01T00:00:00Z').getTime()/1000
const JUN1 = Date.UTC(2026, 5, 1) / 1000
const data = { time: ['2026-06-01T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }

describe('ticketpoolPurchases factory', () => {
  it('returns a def named ticketpool-purchases with 4 series', () => {
    const def = ticketpoolPurchases('all')
    expect(def.name).toBe('ticketpool-purchases')
    expect(def.series).toHaveLength(4)
  })

  it("blocks mode ('all') does not append a period-end point", () => {
    const cols = ticketpoolPurchases('all').toColumns(data, {})
    expect(cols[0]).toEqual([JUN1])
    expect(cols).toHaveLength(5)
  })

  it.each([
    ['day', 86400],
    ['wk', 604800]
  ])(
    '%s mode appends a period-end point at +%d with null bars and carried line',
    (barMode, secs) => {
      const cols = ticketpoolPurchases(barMode).toColumns(data, {})
      expect(cols[0]).toEqual([JUN1, JUN1 + secs])
      expect(cols[1][1]).toBeNull()
      expect(cols[2][1]).toBeNull()
      expect(cols[3][1]).toBeNull()
      expect(cols[4][1]).toBe(cols[4][0]) // line value carried forward
    }
  )

  it('mo mode appends the first-of-next-month boundary (UTC)', () => {
    const cols = ticketpoolPurchases('mo').toColumns(data, {})
    expect(cols[0]).toEqual([JUN1, Date.UTC(2026, 6, 1) / 1000]) // July 1
  })

  it('does NOT treat an empty settings object as a mempool point', () => {
    const cols = ticketpoolPurchases('all').toColumns(data, {})
    expect(cols[0]).toHaveLength(1)
  })

  it('appends the mempool point in blocks mode when settings.mempool is set', () => {
    const cols = ticketpoolPurchases('all').toColumns(data, {
      mempool: { time: '2026-06-02T00:00:00Z', count: 5, price: 281 }
    })
    expect(cols[0]).toEqual([JUN1, Date.UTC(2026, 5, 2) / 1000])
    expect(cols[1][1]).toBe(5) // mempool count in the Mempool Tickets series
  })

  it('selects bucketed bar geometry for bar modes and capped geometry for blocks', () => {
    const calls = []
    const UPlot = {
      paths: {
        bars: (cfg) => {
          calls.push(cfg)
          return () => 'p'
        }
      }
    }
    const wk = ticketpoolPurchases('wk')
    wk.series[0].paths(UPlot, wk.series[0])({}, 1, 0, 1)
    expect(calls[calls.length - 1]).toEqual({ size: [1], align: 1 })
    const all = ticketpoolPurchases('all')
    all.series[0].paths(UPlot, all.series[0])({}, 1, 0, 1)
    expect(calls[calls.length - 1]).toEqual({ size: [0.6, 100], align: 0 })
  })
})
