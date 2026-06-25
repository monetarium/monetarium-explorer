import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requestJSON } from '../helpers/http'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../helpers/http', () => ({ requestJSON: vi.fn(() => Promise.resolve({})) }))

// One fake ChartPanel per createChartPanel call; tests read them off the controller.
let fakePanels = []
function makeFakePanel(opts) {
  const panel = {
    opts: opts,
    handle: null,
    ranger: null,
    currentDef: null,
    render: vi.fn((def) => {
      panel.currentDef = def
      if (!panel.handle) {
        panel.handle = { uplot: { data: [[]], scales: { x: { min: null, max: null } } } }
      }
      return Promise.resolve()
    }),
    setXRange: vi.fn(),
    destroy: vi.fn()
  }
  fakePanels.push(panel)
  return panel
}
vi.mock('../helpers/chart_panel', () => ({
  createChartPanel: vi.fn((el, opts) => makeFakePanel(opts))
}))

// The purchases def is a factory; the price def is a static object. Identity is what the
// controller relies on (memoized factory -> stable ref per barMode -> setData vs rebuild).
const purchasesDefs = {}
vi.mock('../charts/definitions/ticketpool_purchases', () => ({
  ticketpoolPurchases: vi.fn((barMode) => {
    purchasesDefs[barMode] = purchasesDefs[barMode] || {
      name: 'ticketpool-purchases',
      series: [{}, {}, { label: 'Live Tickets', colorIndex: 2 }, {}],
      toColumns: vi.fn(() => [[], [], [], [], []])
    }
    return purchasesDefs[barMode]
  })
}))
vi.mock('../charts/definitions/ticketpool_price', () => ({
  ticketpoolPrice: {
    name: 'ticketpool-price',
    series: [{}, {}, { label: 'Live Tickets', colorIndex: 2 }, {}],
    toColumns: vi.fn(() => [[], [], [], []])
  }
}))

vi.mock('../helpers/humanize_helper', () => ({ default: { date: vi.fn(() => 'D') } }))

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
    deregisterEvtHandlers: deregisterEvtHandlers,
    send: send
  }
}))

const { default: TicketpoolController } = await import('./ticketpool_controller.js')

function makeController() {
  const c = new TicketpoolController()
  c.initialize()
  c.bars = 'all'
  c.wrapperTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.purchasesRangerTarget = { clientWidth: 800 }
  c.priceRangerTarget = { clientWidth: 800 }
  c.zoomTargets = []
  c.barsTargets = []
  // Attach panels directly (connect() would do this via the mocked factory).
  c.purchasesPanel = makeFakePanel({})
  c.pricePanel = makeFakePanel({})
  return c
}

beforeEach(() => {
  fakePanels = []
  for (const k of Object.keys(registered)) delete registered[k]
  for (const k of Object.keys(purchasesDefs)) delete purchasesDefs[k]
  send.mockClear()
  deregisterEvtHandlers.mockClear()
  requestJSON.mockReset()
  requestJSON.mockResolvedValue({})
})

describe('ticketpool connect/disconnect wiring', () => {
  it('creates two panels and tears down ws handlers + panels on disconnect', () => {
    const c = makeController()
    // getElementById returns null in jsdom; the mocked factory ignores the element.
    c.connect()
    expect(fakePanels.length).toBeGreaterThanOrEqual(2)
    c.disconnect()
    expect(registered.newblock[0].unsub).toHaveBeenCalledTimes(1)
    expect(registered.reconnect[0].unsub).toHaveBeenCalledTimes(1)
    expect(deregisterEvtHandlers).not.toHaveBeenCalledWith('newblock')
    expect(c.purchasesPanel.destroy).toHaveBeenCalledTimes(1)
    expect(c.pricePanel.destroy).toHaveBeenCalledTimes(1)
  })

  it("re-requests data with the active bars on 'reconnect'", () => {
    const c = makeController()
    c.bars = 'wk'
    c.connect()
    registered.reconnect[0].handler()
    expect(send).toHaveBeenCalledWith('getticketpooldata', 'wk')
  })
})

describe('ticketpool data rendering', () => {
  it('renders purchases with preserveRange and the memoized def for the active bars', async () => {
    const c = makeController()
    c.bars = 'wk'
    await c.renderOrUpdatePurchases({ time: [] }, false)
    expect(c.purchasesPanel.render).toHaveBeenCalledWith(
      c.purchasesDefFor('wk'),
      { time: [] },
      { mempool: false },
      { preserveRange: true }
    )
  })

  it('reuses the same purchases def object for the same bars (stable identity -> setData)', () => {
    const c = makeController()
    expect(c.purchasesDefFor('day')).toBe(c.purchasesDefFor('day'))
    expect(c.purchasesDefFor('day')).not.toBe(c.purchasesDefFor('wk'))
  })

  it('renders price with preserveRange', async () => {
    const c = makeController()
    await c.renderOrUpdatePrice({ price: [] }, false)
    expect(c.pricePanel.render).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ticketpool-price' }),
      { price: [] },
      { mempool: false },
      { preserveRange: true }
    )
  })

  it('omits the mempool point for purchases in bar modes', () => {
    const c = makeController()
    c.bars = 'wk'
    c.tipHeight = 100
    const spy = vi.spyOn(c, 'renderOrUpdatePurchases')
    c.processData({
      height: 100,
      mempool: { time: '2026-06-24T21:09:05Z', count: 5, price: 280 },
      time_chart: { time: ['2026-06-08T00:00:00Z'], price: [280], immature: [10], live: [100] }
    })
    expect(spy).toHaveBeenCalledWith(expect.any(Object), false)
  })
})

describe('ticketpool onBarsChange', () => {
  it('rebins and seeds the expand-only union range via render({ range })', async () => {
    const c = makeController()
    c.purchasesPanel.handle = {
      uplot: { data: [[]], scales: { x: { min: 1780963200, max: 1782172800 } } }
    }
    requestJSON.mockResolvedValueOnce({ time_chart: { time: ['2026-06-08T00:00:00Z'] } })
    await c.onBarsChange({
      currentTarget: { dataset: { option: 'mo' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    // month data's extent [1780963200, 1780963200] is within the viewport -> no expansion
    expect(c.purchasesPanel.render).toHaveBeenCalledWith(
      c.purchasesDefFor('mo'),
      { time: ['2026-06-08T00:00:00Z'] },
      {},
      { range: { min: 1780963200, max: 1782172800 } }
    )
  })

  it('expands the range right to include new blocks data past the viewport', async () => {
    const c = makeController()
    c.purchasesPanel.handle = {
      uplot: { data: [[]], scales: { x: { min: 1780963200, max: 1782172800 } } }
    }
    requestJSON.mockResolvedValueOnce({
      time_chart: { time: ['2026-06-08T00:00:00Z', '2026-06-24T00:00:00Z'] }
    })
    await c.onBarsChange({
      currentTarget: { dataset: { option: 'all' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    const lastRender = c.purchasesPanel.render.mock.calls.at(-1)
    expect(lastRender[3]).toEqual({ range: { min: 1780963200, max: 1782259200 } })
  })
})

describe('ticketpool onZoom', () => {
  it('zooms the existing chart via setXRange (no rebuild) to a day window', async () => {
    const c = makeController()
    c.bars = 'day'
    c.purchasesPanel.handle = { uplot: { data: [[1782000000, 1782172800]], scales: { x: {} } } }
    c.purchasesPanel.ranger = { uplot: { data: [[1782000000, 1782172800]] } }
    await c.onZoom({
      currentTarget: { dataset: { option: 'day' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    expect(c.purchasesPanel.setXRange).toHaveBeenCalled()
    const [lo, hi] = c.purchasesPanel.setXRange.mock.calls.at(-1)
    expect(hi - lo).toBeCloseTo(86400, 0)
  })

  it('auto-coarsens bars then seeds the zoom window via render({ range }) (no post-render setXRange)', async () => {
    const c = makeController()
    c.bars = 'mo'
    c.purchasesPanel.handle = { uplot: { data: [[]], scales: { x: { min: 0, max: 0 } } } }
    // anchor: the current ranger blocks extent, captured before the rebuild
    c.purchasesPanel.ranger = { uplot: { data: [[1780963200, 1782172800]] } }
    requestJSON.mockResolvedValueOnce({ time_chart: { time: ['2026-06-08T00:00:00Z'] } })
    await c.onZoom({
      currentTarget: { dataset: { option: 'wk' }, classList: { add: vi.fn(), remove: vi.fn() } }
    })
    // bars auto-switched to 'wk'; render seeded with a wk window anchored at the blocks far-right
    const lastRender = c.purchasesPanel.render.mock.calls.at(-1)
    expect(lastRender[0]).toBe(c.purchasesDefFor('wk'))
    expect(lastRender[3].range.max).toBe(1782172800)
    expect(lastRender[3].range.max - lastRender[3].range.min).toBe(604800)
    expect(c.purchasesPanel.setXRange).not.toHaveBeenCalled()
  })
})
