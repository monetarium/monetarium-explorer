import { describe, it, expect, vi, beforeEach } from 'vitest'

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
      destroy: vi.fn(),
      uplot: { data: [[]] }
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
  if (handlesLoaded) {
    c.purchasesHandle = {
      setData: vi.fn(),
      setXRange: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[1, 2, 3]] }
    }
    c.priceHandle = {
      setData: vi.fn(),
      setXRange: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]] }
    }
    c.purchasesRanger = {
      setData: vi.fn(),
      setSelection: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]] }
    }
    c.priceRanger = {
      setData: vi.fn(),
      setSelection: vi.fn(),
      destroy: vi.fn(),
      uplot: { data: [[]] }
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

  it('syncs the ranger selection when a zoom button is pressed', () => {
    const c = makeController()
    c.zoomTargets = []
    const target = { name: 'day', classList: { add: vi.fn(), remove: vi.fn() } }
    c.onZoom({ target })
    expect(c.purchasesRanger.setSelection).toHaveBeenCalled()
    const args = c.purchasesRanger.setSelection.mock.calls[0]
    expect(args[1] - args[0]).toBeCloseTo(86400, 0) // one day window in seconds
  })
})
