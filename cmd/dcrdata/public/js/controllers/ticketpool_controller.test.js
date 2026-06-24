import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestJSON } from '../helpers/http'
import { ticketpoolPurchases } from '../charts/definitions/ticketpool_purchases'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../helpers/http', () => ({
  requestJSON: vi.fn(() => Promise.resolve({}))
}))

vi.mock('../helpers/uplot_adapter', () => ({
  createChart: vi.fn(() =>
    Promise.resolve({
      setData: vi.fn(),
      setXRange: vi.fn(),
      setMode: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]] }
    })
  ),
  resolveSeriesColor: vi.fn(() => '#000')
}))

vi.mock('../helpers/uplot_ranger', () => ({
  createRanger: vi.fn(() =>
    Promise.resolve({
      setData: vi.fn(),
      setSelection: vi.fn(),
      setDark: vi.fn(),
      setWidth: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]], setSelect: vi.fn() }
    })
  )
}))

vi.mock('../services/theme_service', () => ({
  darkEnabled: vi.fn(() => false)
}))

vi.mock('../charts/definitions/ticketpool_purchases', () => ({
  ticketpoolPurchases: {
    name: 'ticketpool-purchases',
    axes: [],
    series: [
      { label: 'Mempool Tickets', scale: 'y', kind: 'bars', colorIndex: 0 },
      { label: 'Immature Tickets', scale: 'y', kind: 'bars', colorIndex: 1 },
      { label: 'Live Tickets', scale: 'y', kind: 'bars', colorIndex: 2 },
      { label: 'Ticket Value', scale: 'y2', kind: 'line', colorIndex: 3, width: 2 }
    ],
    toColumns: vi.fn(() => [[], [], [], [], []]),
    formatValue: vi.fn(() => '0')
  }
}))

vi.mock('../charts/definitions/ticketpool_price', () => ({
  ticketpoolPrice: {
    name: 'ticketpool-price',
    axes: [],
    series: [
      { label: 'Mempool Tickets', scale: 'y', kind: 'bars', colorIndex: 0 },
      { label: 'Immature Tickets', scale: 'y', kind: 'bars', colorIndex: 1 },
      { label: 'Live Tickets', scale: 'y', kind: 'bars', colorIndex: 2 }
    ],
    toColumns: vi.fn(() => [[], [], [], []]),
    formatValue: vi.fn(() => '0')
  }
}))

// Each registerEvtHandler call gets its own distinct unsubscribe spy, recorded
// per event, so tests can assert the *specific* handler was torn down with the
// per-handler API rather than a shared bulk clear.
const registered = {}
const send = vi.fn()
const deregisterEvtHandlers = vi.fn()

vi.mock('../services/messagesocket_service', () => ({
  default: {
    registerEvtHandler: vi.fn((event, handler) => {
      const unsub = vi.fn()
      ;(registered[event] = registered[event] || []).push({ handler, unsub })
      return unsub
    }),
    deregisterEvtHandler: vi.fn(),
    deregisterEvtHandlers: deregisterEvtHandlers,
    send: send
  }
}))

const { default: TicketpoolController } = await import('./ticketpool_controller.js')

function makeController({ handlesLoaded = true } = {}) {
  const c = new TicketpoolController()
  c.bars = 'wk'
  c.wrapperTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.purchasesRangerTarget = { clientWidth: 800 }
  c.priceRangerTarget = { clientWidth: 800 }
  c.zoomTargets = []
  c.barsTargets = []
  if (handlesLoaded) {
    c.purchasesHandle = {
      setData: vi.fn(),
      setXRange: vi.fn(),
      destroy: vi.fn(),
      uplot: {
        data: [[1780963200, 1781568000, 1782172800]],
        scales: { x: { min: 1780963200, max: 1782172800 } }
      }
    }
    c.priceHandle = {
      setData: vi.fn(),
      setXRange: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]], scales: { x: { min: 0, max: 0 } } }
    }
    c.purchasesRanger = {
      setData: vi.fn(),
      setSelection: vi.fn(),
      setWidth: vi.fn(),
      setDark: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]], setSelect: vi.fn() }
    }
    c.priceRanger = {
      setData: vi.fn(),
      setSelection: vi.fn(),
      setWidth: vi.fn(),
      setDark: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]], setSelect: vi.fn() }
    }
  } else {
    c.purchasesHandle = null
    c.priceHandle = null
    c.purchasesRanger = null
    c.priceRanger = null
  }
  return c
}

beforeEach(() => {
  for (const key of Object.keys(registered)) delete registered[key]
  send.mockClear()
  deregisterEvtHandlers.mockClear()
})

describe('ticketpool reconnect resync', () => {
  it("re-requests ticketpool data with the active bar range on 'reconnect'", () => {
    const c = makeController()
    c.connect()

    expect(registered.reconnect).toHaveLength(1)
    registered.reconnect[0].handler()

    expect(send).toHaveBeenCalledWith('getticketpooldata', 'wk')
  })

  it('tears down its own newblock + reconnect handlers without bulk-wiping the shared newblock event', () => {
    const c = makeController()
    c.connect()
    c.disconnect()

    // The per-handler unsubscribes for this controller's own handlers must run.
    expect(registered.newblock[0].unsub).toHaveBeenCalledTimes(1)
    expect(registered.reconnect[0].unsub).toHaveBeenCalledTimes(1)

    // Must NOT bulk-clear 'newblock': the global block producer in index.js
    // shares that event and is never re-registered under Turbolinks.
    expect(deregisterEvtHandlers).not.toHaveBeenCalledWith('newblock')
  })

  it('still runs websocket cleanup when disconnecting before the charts have loaded', () => {
    const c = makeController({ handlesLoaded: false })
    c.connect()

    expect(() => c.disconnect()).not.toThrow()
    expect(registered.newblock[0].unsub).toHaveBeenCalledTimes(1)
    expect(registered.reconnect[0].unsub).toHaveBeenCalledTimes(1)
  })

  it('destroys chart handles on disconnect', () => {
    const c = makeController()
    c.connect()
    c.disconnect()
    expect(c.purchasesHandle.destroy).toHaveBeenCalledTimes(1)
    expect(c.priceHandle.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not throw when disconnecting before handles are created', () => {
    const c = makeController({ handlesLoaded: false })
    c.connect()
    expect(() => c.disconnect()).not.toThrow()
  })

  it('destroys rangers on disconnect', () => {
    const c = makeController()
    c.connect()
    c.disconnect()
    expect(c.purchasesRanger.destroy).toHaveBeenCalledTimes(1)
    expect(c.priceRanger.destroy).toHaveBeenCalledTimes(1)
  })

  it('syncs the ranger selection when a zoom button is pressed', async () => {
    const c = makeController()
    c.bars = 'day'
    c.zoomTargets = []
    const currentTarget = {
      dataset: { option: 'day' },
      classList: { add: vi.fn(), remove: vi.fn() }
    }
    await c.onZoom({ currentTarget })
    expect(c.purchasesRanger.setSelection).toHaveBeenCalled()
    const args = c.purchasesRanger.setSelection.mock.calls[0]
    expect(args[1] - args[0]).toBeCloseTo(86400, 0) // one day window in seconds
  })

  it('extends bar-mode data to period end when auto-switching bars in onZoom', async () => {
    const c = makeController()
    c.bars = 'mo'
    c.zoomTargets = []

    // Week data that _extendToPeriodEnd should extend
    const weekTs = 1778371200
    const weekCols = [[weekTs], [0], [79], [5162], [282.1]]
    requestJSON.mockResolvedValueOnce({
      time_chart: { time: ['2026-05-09T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }
    })
    ticketpoolPurchases.toColumns.mockReturnValueOnce(weekCols)

    // Capture the cols passed to setData
    c.purchasesHandle.setData = vi.fn((cols) => {
      c.purchasesHandle.uplot.data = cols
    })

    await c.onZoom({
      currentTarget: { dataset: { option: 'wk' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    // Auto-switch extended the week data: synthetic point at +604800
    expect(c.purchasesHandle.uplot.data[0]).toEqual([weekTs, weekTs + 604800])
    expect(c.purchasesHandle.uplot.data[3][1]).toBeNull()
    expect(c.purchasesHandle.uplot.data[4][1]).toBe(282.1)
  })
})

describe('onBarsChange', () => {
  it('preserves the visible x-range after rebinning data', async () => {
    const c = makeController()

    // Month-binned API response: a single data point at June 8.
    const cols = [[1780963200], [0], [79], [5162], [282.1]]

    requestJSON.mockResolvedValueOnce({
      time_chart: { time: ['2026-06-08T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }
    })
    ticketpoolPurchases.toColumns.mockReturnValueOnce(cols)

    const currentTarget = {
      dataset: { option: 'mo' },
      classList: { add: vi.fn(), remove: vi.fn() }
    }
    await c.onBarsChange({ currentTarget })

    // The mock's initial x-range is { min: 1780963200, max: 1782172800 } from makeController.
    // The range is preserved: month data's original extent [1780963200, 1780963200]
    // (before _extendToPeriodEnd) is within the viewport, so no expansion needed.
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(1780963200, 1782172800)
    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1780963200, 1782172800)

    // Synthetic month-end point was added: July 1
    expect(cols[0]).toEqual([1780963200, 1782864000])
    expect(cols[1][1]).toBeNull()
    expect(cols[2][1]).toBeNull()
    expect(cols[3][1]).toBeNull()
    expect(cols[4][1]).toBe(cols[4][0])
  })

  it.each(['day', 'wk', 'mo'])(
    '_extendToPeriodEnd appends a period-end point for %s',
    async (barMode) => {
      const c = makeController()
      const periodSeconds = { day: 86400, wk: 604800 }[barMode]
      const startTs = 1780963200
      const cols = [[startTs], [0], [79], [5162], [282.1]]

      requestJSON.mockResolvedValueOnce({
        time_chart: { time: ['2026-06-01T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }
      })
      ticketpoolPurchases.toColumns.mockReturnValueOnce(cols)

      const currentTarget = {
        dataset: { option: barMode },
        classList: { add: vi.fn(), remove: vi.fn() }
      }
      await c.onBarsChange({ currentTarget })

      // Synthetic period-end point appended
      expect(cols[0].length).toBe(2)
      // Last point > first point
      expect(cols[0][1]).toBeGreaterThan(cols[0][0])
      // Bar series get null values
      expect(cols[1][1]).toBeNull()
      expect(cols[2][1]).toBeNull()
      expect(cols[3][1]).toBeNull()
      // Line series carries the last value forward (horizontal segment)
      expect(cols[4][1]).toBe(cols[4][0])

      // For fixed-width periods (day, wk), verify the exact delta
      if (periodSeconds) {
        expect(cols[0][1] - cols[0][0]).toBe(periodSeconds)
      }
    }
  )

  it('preserves the range across a month-to-blocks round-trip with expand-only union', async () => {
    const c = makeController()

    // Month data: single point at viewport min (first week bucket), extended to July 1
    const monthCols = [[1780963200], [0], [79], [5162], [282.1]]
    // Blocks data: two points, second extends past the viewport edge to demo expand-only
    const blocksCols = [
      [1780963200, 1782259200],
      [5, 8],
      [10, 15],
      [30, 40],
      [50, 60]
    ]

    requestJSON
      .mockResolvedValueOnce({
        time_chart: { time: ['2026-06-09T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }
      })
      .mockResolvedValueOnce({
        time_chart: {
          time: ['2026-06-09T00:00:00Z', '2026-06-24T00:00:00Z'],
          price: [50, 60],
          immature: [10, 15],
          live: [30, 40]
        }
      })
    ticketpoolPurchases.toColumns.mockReturnValueOnce(monthCols).mockReturnValueOnce(blocksCols)

    // Switch to month — month's original extent is within viewport, range preserved
    await c.onBarsChange({
      currentTarget: { dataset: { option: 'mo' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(1780963200, 1782172800)
    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1780963200, 1782172800)

    c.purchasesHandle.setXRange.mockClear()
    c.purchasesRanger.setSelection.mockClear()

    // Switch back to blocks — range expands right to include new data past viewport
    await c.onBarsChange({
      currentTarget: { dataset: { option: 'all' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(1780963200, 1782259200)
    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1780963200, 1782259200)
  })

  it('restores full blocks extent when switching from a truncated viewport, using real API timestamps', async () => {
    const c = makeController()

    // Simulate state after Zoom=all on day data: viewport at day boundaries
    // day: June 13 00:00 → June 24 00:00
    c.purchasesHandle.uplot.scales.x = { min: 1781308800, max: 1782259200 }

    // Blocks data from the real API: June 13 23:00:40 → June 24 21:09:05
    const blocksEpoch = [1781391640, 1782335345]
    const blocksCols = [blocksEpoch, [5, 8], [10, 15], [30, 40], [50, 60]]

    requestJSON.mockResolvedValueOnce({
      time_chart: {
        time: ['2026-06-13T23:00:40Z', '2026-06-24T21:09:05Z'],
        price: [50, 60],
        immature: [10, 15],
        live: [30, 40]
      }
    })
    ticketpoolPurchases.toColumns.mockReturnValueOnce(blocksCols)

    await c.onBarsChange({
      currentTarget: { dataset: { option: 'all' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    // Range must cover the full blocks extent — left clamped to first block,
    // right expanded to last block. No gap at either end.
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(1781391640, 1782335345)
    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1781391640, 1782335345)
  })

  it('Bars=month → Zoom=month preserves the range when data span < month', async () => {
    const c = makeController()

    // Initial viewport and blocks data span 14 days (data < month), June 8 → June 22
    // scales.x: { min: 1780963200, max: 1782172800 }, span = 1209600
    // Seed ranger with the same blocks data so onZoom reads dataMax from there
    c.purchasesRanger.uplot.data = [[1780963200, 1782172800]]

    // Switch to month
    const monthCols = [[1780963200], [0], [79], [5162], [282.1]]
    requestJSON.mockResolvedValueOnce({
      time_chart: { time: ['2026-06-08T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }
    })
    ticketpoolPurchases.toColumns.mockReturnValueOnce(monthCols)
    await c.onBarsChange({
      currentTarget: { dataset: { option: 'mo' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    // Clear mocks so we can see what onZoom calls fresh
    c.purchasesHandle.setXRange.mockClear()
    c.purchasesRanger.setSelection.mockClear()

    // Zoom=month — should be a no-op: blocks data span (14d) <= month (30.42d) → full data
    c.zoomTargets = []
    await c.onZoom({
      currentTarget: { dataset: { option: 'mo' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    // Range must stay exactly the same — month is wider than what we have
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(1780963200, 1782172800)
    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1780963200, 1782172800)
  })

  it('Bars=month → Zoom=month → Zoom=weeks: ranger right grip at data far right', async () => {
    const c = makeController()

    // Blocks data spanning > 7 days so week zoom window doesn't clamp below dataMin
    const DMIN = 1780963200 // June 8
    const DMAX = 1782172800 // June 22, span = 1209600 (14 days)
    c.purchasesHandle.uplot.data = [[DMIN, 1781568000, DMAX]]
    c.purchasesHandle.uplot.scales.x = { min: DMIN, max: DMAX }
    // Seed ranger with the same blocks extent — the zoom anchor reference
    c.purchasesRanger.uplot.data = [[DMIN, DMAX]]

    // Wire setXRange to update scales.x so subsequent onZoom reads the live range
    c.purchasesHandle.setXRange = vi.fn((min, max) => {
      c.purchasesHandle.uplot.scales.x = { min, max }
    })

    // Wire setData to update uplot.data so onZoom reads the active chart's data
    c.purchasesHandle.setData = vi.fn((cols) => {
      c.purchasesHandle.uplot.data = cols
    })

    // Month data: single point at DMIN, _extendToPeriodEnd pushes end-of-month
    const monthCols = [[DMIN], [0], [79], [5162], [282.1]]
    requestJSON.mockResolvedValueOnce({
      time_chart: { time: ['2026-06-08T00:00:00Z'], price: [282.1], immature: [79], live: [5162] }
    })
    ticketpoolPurchases.toColumns.mockReturnValueOnce(monthCols)
    await c.onBarsChange({
      currentTarget: { dataset: { option: 'mo' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    // After Bars=month: range restored via expand-only union
    // _origDataExtent.max = DMIN (< DMAX), so restoreMax = Math.max(DMAX, DMIN) = DMAX
    // Range stays at [DMIN, DMAX]
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(DMIN, DMAX)

    // Clear mocks for zoom sequence
    c.purchasesHandle.setXRange = vi.fn((min, max) => {
      c.purchasesHandle.uplot.scales.x = { min, max }
    })
    c.purchasesRanger.setSelection = vi.fn()

    // Zoom=month: ranger data span (14d) <= 30d → return full ranger extent
    c.zoomTargets = []
    await c.onZoom({
      currentTarget: { dataset: { option: 'mo' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(DMIN, DMAX)

    // Zoom=weeks: ranger data span (14d) > 7d → compute zoom anchored at DMAX
    // lo = DMAX - 604800 = 1781568000 (>= DMIN)
    // clampWindow returns [1781568000, DMAX]
    c.purchasesHandle.setXRange = vi.fn((min, max) => {
      c.purchasesHandle.uplot.scales.x = { min, max }
    })
    c.purchasesRanger.setSelection = vi.fn()
    await c.onZoom({
      currentTarget: { dataset: { option: 'wk' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1781568000, DMAX)
  })

  it('Zoom=All uses the active chart data extent, not the ranger blocks extent', async () => {
    const c = makeController()

    // Ranger (blocks data) spans June 8 → June 22
    const rangerData = [1780963200, 1782172800]
    c.purchasesRanger.uplot.data = [rangerData]

    // Chart data (week mode) spans June 15 → June 18 (narrower than ranger)
    c.purchasesHandle.uplot.data = [[1781568000, 1782086400]]
    c.purchasesHandle.uplot.scales.x = { min: 1781568000, max: 1782086400 }

    c.zoomTargets = []
    c.bars = 'wk'
    await c.onZoom({
      currentTarget: { dataset: { option: 'all' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })

    // Zoom=all must show the chart's data extent, not the ranger's wider extent
    expect(c.purchasesHandle.setXRange).toHaveBeenCalledWith(1781568000, 1782086400)
    expect(c.purchasesRanger.setSelection).toHaveBeenCalledWith(1781568000, 1782086400)
  })

  it('omits the mempool point in bar modes', () => {
    const c = makeController()
    c.bars = 'wk'
    c.tipHeight = 100

    const spy = vi.spyOn(c, 'renderOrUpdatePurchases')

    c.processData({
      height: 100,
      mempool: { time: '2026-06-24T21:09:05Z', count: 5, price: 280 },
      time_chart: {
        time: ['2026-06-08T00:00:00Z', '2026-06-15T00:00:00Z'],
        price: [280, 282],
        immature: [10, 15],
        live: [100, 120]
      }
    })

    // renderOrUpdatePurchases must be called with mempool=false in bar mode
    expect(spy).toHaveBeenCalledWith(expect.any(Object), false)
  })
})
