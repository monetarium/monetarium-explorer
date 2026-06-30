import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const mockOn = vi.fn()
const mockOff = vi.fn()
vi.mock('../services/event_bus_service', () => ({
  default: { on: mockOn, off: mockOff }
}))

afterEach(() => {
  mockOn.mockReset()
  mockOff.mockReset()
})

let NewBlockController
beforeAll(async () => {
  NewBlockController = (await import('./newblock_controller.js')).default
})

function makeCtrl() {
  const ctrl = new NewBlockController(document.createElement('div'))
  ctrl.confirmationsTargets = []
  return ctrl
}

describe('newblock_controller subscription lifecycle', () => {
  it('registers BLOCK_RECEIVED in connect()', () => {
    const ctrl = makeCtrl()
    ctrl.connect()
    expect(mockOn).toHaveBeenCalledTimes(1)
    expect(mockOn).toHaveBeenCalledWith('BLOCK_RECEIVED', expect.any(Function))
  })

  it('unregisters the same callback in disconnect()', () => {
    const ctrl = makeCtrl()
    ctrl.connect()
    const registered = mockOn.mock.calls[0][1]
    ctrl.disconnect()
    expect(mockOff).toHaveBeenCalledTimes(1)
    expect(mockOff).toHaveBeenCalledWith('BLOCK_RECEIVED', registered)
  })

  it('creates a fresh callback reference on each connect so disconnect() can unregister it precisely', () => {
    const ctrl = makeCtrl()
    ctrl.connect()
    const firstCb = ctrl._blockReceived
    expect(firstCb).toBeInstanceOf(Function)
    ctrl.disconnect()
    ctrl.connect()
    const secondCb = ctrl._blockReceived
    expect(firstCb).not.toBe(secondCb)
  })
})

describe('newblock_controller refreshConfirmations', () => {
  it('increments confirmation text for confirmed blocks', () => {
    const ctrl = makeCtrl()
    const el = document.createElement('td')
    el.dataset.confirmations = '0'
    el.dataset.confirmationBlockHeight = '100'
    el.dataset.yes = '# confirmation@'
    el.dataset.no = '(unconfirmed)'
    ctrl.confirmationsTargets = [el]

    ctrl.refreshConfirmations(105)

    expect(el.textContent).toBe('6 confirmations')
    expect(el.dataset.confirmations).toBe('6')
    expect(el.classList.contains('confirmed')).toBe(true)
  })

  it('sets singular text when confirmations is 1', () => {
    const ctrl = makeCtrl()
    const el = document.createElement('td')
    el.dataset.confirmations = '0'
    el.dataset.confirmationBlockHeight = '105'
    el.dataset.yes = '# confirmation@'
    el.dataset.no = '(unconfirmed)'
    ctrl.confirmationsTargets = [el]

    ctrl.refreshConfirmations(105)

    expect(el.textContent).toBe('1 confirmation')
  })

  it('skips rows marked as unconfirmed (confirmationBlockHeight === -1)', () => {
    const ctrl = makeCtrl()
    const el = document.createElement('td')
    el.dataset.confirmations = '0'
    el.dataset.confirmationBlockHeight = '-1'
    el.dataset.yes = '# confirmation@'
    el.dataset.no = '(unconfirmed)'
    el.textContent = '(unconfirmed)' // pre-set by connect() in real flow
    ctrl.confirmationsTargets = [el]

    ctrl.refreshConfirmations(105)

    // Unchanged
    expect(el.textContent).toBe('(unconfirmed)')
  })

  it('skips rows with missing confirmations data', () => {
    const ctrl = makeCtrl()
    const el = document.createElement('td')
    el.dataset.confirmationBlockHeight = '100'
    el.dataset.yes = '# confirmation@'
    el.dataset.no = '(unconfirmed)'
    ctrl.confirmationsTargets = [el]

    // Should not throw despite missing el.dataset.confirmations
    ctrl.refreshConfirmations(105)
  })
})
