import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const deregisterEvtHandlers = vi.fn()

vi.mock('../services/messagesocket_service', () => ({
  default: {
    registerEvtHandler: vi.fn(),
    deregisterEvtHandler: vi.fn(),
    deregisterEvtHandlers: deregisterEvtHandlers,
    send: vi.fn()
  }
}))

const { default: ConnectionController } = await import('./connection_controller.js')

function makeController() {
  const c = new ConnectionController()
  c.indicatorTarget = { classList: { add: vi.fn(), remove: vi.fn() } }
  c.statusTarget = { textContent: '' }
  return c
}

beforeEach(() => {
  deregisterEvtHandlers.mockClear()
})

describe('connection_controller cleanup', () => {
  it('deregisters its connection-status handlers on disconnect', () => {
    const c = makeController()
    c.connect()
    c.disconnect()

    expect(deregisterEvtHandlers).toHaveBeenCalledWith('open')
    expect(deregisterEvtHandlers).toHaveBeenCalledWith('close')
    expect(deregisterEvtHandlers).toHaveBeenCalledWith('error')
    expect(deregisterEvtHandlers).toHaveBeenCalledWith('ping')
  })
})
