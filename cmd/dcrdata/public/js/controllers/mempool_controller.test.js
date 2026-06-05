import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../helpers/mempool_helper', () => ({
  default: class {
    constructor() {}
  }
}))

// keyboard_navigation_service binds to DOM elements at module load, which jsdom
// lacks; stub it so importing the controller doesn't crash.
vi.mock('../services/keyboard_navigation_service', () => ({ keyNav: vi.fn() }))

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

const { default: MempoolController } = await import('./mempool_controller.js')

function makeController() {
  const c = new MempoolController()
  c.mempoolTarget = { dataset: { id: '0' } }
  c.voteTallyTargets = []
  c.voteTransactionsTarget = {}
  c.ticketTransactionsTarget = {}
  c.revocationTransactionsTarget = {}
  c.regularTransactionsTarget = {}
  return c
}

beforeEach(() => {
  for (const key of Object.keys(registered)) delete registered[key]
  send.mockClear()
  deregisterEvtHandlers.mockClear()
})

describe('mempool reconnect resync', () => {
  it("re-requests the full mempool on 'reconnect'", () => {
    const c = makeController()
    c.connect()

    expect(registered.reconnect).toHaveLength(1)
    registered.reconnect[0].handler()

    expect(send).toHaveBeenCalledWith('getmempooltxs', '')
  })

  it("removes its own 'reconnect' handler on disconnect", () => {
    const c = makeController()
    c.connect()
    c.disconnect()

    expect(registered.reconnect[0].unsub).toHaveBeenCalledTimes(1)
  })
})

describe('mempool zero vote count', () => {
  it('renders "0" in voteCountTarget when no votes are tallied', () => {
    const c = makeController()

    // Mock targets
    const voteCountTarget = {
      firstChild: null,
      removeChild: vi.fn(),
      appendChild: vi.fn()
    }
    c.voteCountTarget = voteCountTarget
    c.mempoolSizeTarget = { textContent: '' }

    // Mock dependencies
    c.lastCoinStats = null
    c.applyCoinStats = vi.fn()
    c.labelVotes = vi.fn()

    // Mock Mempool instance
    c.mempool = {
      counts: vi.fn().mockReturnValue({ vote: {}, regular: 0, ticket: 0, rev: 0, total: 0 }),
      voteSpans: vi.fn().mockReturnValue([]),
      totals: vi
        .fn()
        .mockReturnValue({ size: 100, regular: 0, ticket: 0, vote: 0, rev: 0, total: 0 })
    }

    c.setMempoolFigures()

    expect(voteCountTarget.appendChild).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: '0',
        className: 'text-center position-relative d-inline-block'
      })
    )
  })
})
