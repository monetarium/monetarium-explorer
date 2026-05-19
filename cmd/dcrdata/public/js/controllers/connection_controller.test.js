import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

// Fake the singleton ws service: capture handlers and let tests fire them.
const fakeWs = {
  handlers: {},
  currentState: 'closed',
  registerEvtHandler: function (id, fn) {
    ;(this.handlers[id] = this.handlers[id] || []).push(fn)
  },
  deregisterEvtHandlers: function (id) {
    this.handlers[id] = []
  },
  fire: function (id, msg) {
    ;(this.handlers[id] || []).forEach((fn) => fn(msg))
  },
  reset: function () {
    this.handlers = {}
    this.currentState = 'closed'
  }
}

vi.mock('../services/messagesocket_service', () => ({ default: fakeWs }))

const { default: ConnectionController } = await import('./connection_controller.js')

function makeController() {
  const indicator = {}
  indicator.classList = {
    set: new Set(),
    add: function (c) {
      this.set.add(c)
    },
    remove: function (c) {
      this.set.delete(c)
    },
    contains: function (c) {
      return this.set.has(c)
    }
  }
  const status = { textContent: '' }
  const ctrl = new ConnectionController(document.createElement('div'))
  ctrl.indicatorTarget = indicator
  ctrl.statusTarget = status
  ctrl.hasIndicatorTarget = true
  ctrl.hasStatusTarget = true
  return { ctrl, indicator, status }
}

describe('connection_controller liveness indicator', () => {
  beforeEach(() => fakeWs.reset())

  it('shows connected (green) on a connected connstate', () => {
    const { ctrl, indicator } = makeController()
    ctrl.connect()
    fakeWs.fire('connstate', 'connected')
    expect(indicator.classList.contains('connected')).toBe(true)
    expect(indicator.classList.contains('disconnected')).toBe(false)
  })

  it('shows non-green while reconnecting', () => {
    const { ctrl, indicator, status } = makeController()
    ctrl.connect()
    fakeWs.fire('connstate', 'connected')
    fakeWs.fire('connstate', 'reconnecting')
    expect(indicator.classList.contains('connected')).toBe(false)
    expect(indicator.classList.contains('disconnected')).toBe(true)
    expect(status.textContent.toLowerCase()).toContain('reconnect')
  })

  it('shows disconnected on a closed connstate', () => {
    const { ctrl, indicator } = makeController()
    ctrl.connect()
    fakeWs.fire('connstate', 'closed')
    expect(indicator.classList.contains('disconnected')).toBe(true)
  })

  it('initializes the indicator from the current ws state', () => {
    fakeWs.currentState = 'connected'
    const { ctrl, indicator } = makeController()
    ctrl.connect()
    expect(indicator.classList.contains('connected')).toBe(true)
  })

  it('deregisters its handlers on Stimulus disconnect', () => {
    const { ctrl } = makeController()
    ctrl.connect()
    expect(fakeWs.handlers.connstate.length).toBeGreaterThan(0)
    ctrl.disconnect()
    expect(fakeWs.handlers.connstate).toEqual([])
  })
})
