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

vi.mock('../services/event_bus_service', () => ({
  default: { on: vi.fn(), off: vi.fn() }
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

const { default: HomepageController } = await import('./homepage_controller.js')

function makeController() {
  const c = new HomepageController()
  c.mempoolTarget = { dataset: { id: '0' } }
  c.voteTallyTargets = []
  return c
}

beforeEach(() => {
  for (const key of Object.keys(registered)) delete registered[key]
  send.mockClear()
  deregisterEvtHandlers.mockClear()
})

describe('homepage reconnect resync', () => {
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
