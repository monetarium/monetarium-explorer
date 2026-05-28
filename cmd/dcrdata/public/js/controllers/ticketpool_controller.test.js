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

function makeController({ graphsLoaded = true } = {}) {
  const c = new TicketpoolController()
  c.bars = 'wk'
  c.wrapperTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  if (graphsLoaded) {
    c.purchasesGraph = { destroy: vi.fn(), updateOptions: vi.fn(), resetZoom: vi.fn() }
    c.priceGraph = { destroy: vi.fn(), updateOptions: vi.fn() }
  } else {
    // initialize() is async; before the dygraphs chunk resolves the graphs are
    // still null (their initial value in initialize()).
    c.purchasesGraph = null
    c.priceGraph = null
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
    const c = makeController({ graphsLoaded: false })
    c.connect()

    expect(() => c.disconnect()).not.toThrow()
    expect(registered.newblock[0].unsub).toHaveBeenCalledTimes(1)
    expect(registered.reconnect[0].unsub).toHaveBeenCalledTimes(1)
  })
})
