import { describe, it, expect } from 'vitest'
import { ticketpoolPurchases } from './ticketpool_purchases'

// Date('2026-06-01T00:00:00Z').getTime()/1000
const JUN1 = Date.UTC(2026, 5, 1) / 1000
const data = { time: ['2026-06-01T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }

describe('ticketpoolPurchases factory', () => {
  it('returns a def named ticketpool-purchases with 5 series (4 visible + overlay)', () => {
    const def = ticketpoolPurchases('all')
    expect(def.name).toBe('ticketpool-purchases')
    expect(def.series).toHaveLength(5)
  })

  it("blocks mode ('all') does not append a period-end point", () => {
    const cols = ticketpoolPurchases('all').toColumns(data, {})
    expect(cols[0]).toEqual([JUN1])
    expect(cols).toHaveLength(6)
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

  it('anchors the bucketed period-end to the last historical point, not an appended mempool point', () => {
    // Regression: extendToPeriodEnd reads the last x as its anchor, so it must run BEFORE the
    // live mempool point is appended — otherwise the boundary would be computed from the mempool
    // timestamp. The two modes never co-occur today (mempool only in 'all', not a bucketed mode),
    // but the ordering must not silently break if that ever changes.
    const mempoolTs = Date.UTC(2026, 5, 1, 18) / 1000 // same day, 18:00
    const cols = ticketpoolPurchases('day').toColumns(data, {
      mempool: { time: '2026-06-01T18:00:00Z', count: 5, price: 281 }
    })
    // Period-end is JUN1 + 1 day (anchored to the historical bucket)...
    expect(cols[0]).toContain(JUN1 + 86400)
    // ...NOT the mempool time + 1 day (the wrong, order-dependent boundary).
    expect(cols[0]).not.toContain(mempoolTs + 86400)
    // The live mempool point is still appended (after the boundary).
    expect(cols[0]).toContain(mempoolTs)
    expect(cols[1]).toContain(5)
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

describe('ticketpoolPurchases overlay points series', () => {
  const def = ticketpoolPurchases('all')
  const overlay = def.series[4]

  it('is a line with visible points and zero-width stroke', () => {
    expect(overlay.kind).toBe('line')
    expect(overlay.points.show).toBe(true)
    expect(overlay.points.size).toBe(7)
    expect(overlay.spanGaps).toBe(true)
  })
})

describe('ticketpoolPurchases.columns', () => {
  const def = ticketpoolPurchases('all')

  it('returns 6 columns (xs, mem, imm, live, price, overlay)', () => {
    const cols = def.toColumns(data, {})
    expect(cols).toHaveLength(6)
  })

  it('overlay column is null everywhere when no mempool', () => {
    const cols = def.toColumns(data, {})
    expect(cols[5]).toEqual([null])
  })

  it('overlay column has mempool count at appended point', () => {
    const cols = def.toColumns(data, {
      mempool: { time: '2026-06-02T00:00:00Z', count: 5, price: 281 }
    })
    expect(cols[5]).toEqual([null, 5])
  })
})
