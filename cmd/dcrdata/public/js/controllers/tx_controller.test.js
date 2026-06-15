import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../helpers/block_helper', () => ({
  default: vi.fn()
}))

vi.mock('../helpers/humanize_helper', () => ({
  default: {
    timeSince: vi.fn(() => '2 minutes'),
    date: vi.fn(() => '2024-01-15 12:00:00')
  }
}))

vi.mock('../services/event_bus_service', () => ({
  default: { on: vi.fn(), off: vi.fn() }
}))

vi.mock('../helpers/meters.js', () => ({
  MiniMeter: class {
    constructor() {}
  }
}))

vi.mock('../services/theme_service', () => ({
  darkEnabled: vi.fn().mockReturnValue(false)
}))

const { default: TxController } = await import('./tx_controller.js')
const txInBlock = (await import('../helpers/block_helper')).default

function makeController() {
  const c = new TxController(document.createElement('div'))
  c.data = { get: vi.fn().mockReturnValue('test-txid') }

  const confirmationsEl = document.createElement('span')
  confirmationsEl.dataset.yes = '# confirmation@'
  confirmationsEl.dataset.no = 'unconfirmed'
  confirmationsEl.dataset.confirmations = '0'
  confirmationsEl.dataset.confirmationBlockHeight = '-1'
  c.confirmationsTarget = confirmationsEl

  const unconfirmedEl = document.createElement('div')
  unconfirmedEl.dataset.txid = 'test-txid'
  const msgEl = document.createElement('span')
  msgEl.className = 'mp-unconfirmed-msg'
  const linkEl = document.createElement('a')
  linkEl.className = 'mp-unconfirmed-link'
  unconfirmedEl.appendChild(msgEl)
  unconfirmedEl.appendChild(linkEl)
  const timeEl = document.createElement('span')
  timeEl.className = 'mp-unconfirmed-time'
  timeEl.dataset.age = ''
  unconfirmedEl.appendChild(timeEl)
  c.unconfirmedTarget = unconfirmedEl

  const ageEl = document.createElement('span')
  ageEl.dataset.age = ''
  c.ageTarget = ageEl

  const formattedAgeEl = document.createElement('span')
  c.formattedAgeTarget = formattedAgeEl

  const tbody = document.createElement('tbody')
  tbody.id = 'navBar'
  tbody.dataset.blocktime = '600'
  document.body.appendChild(tbody)

  c.hasUnconfirmedTarget = true

  return c
}

describe('TxController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('_processBlock', () => {
    it('sets confirmationBlockHeight when mempool tx is found in block', () => {
      const c = makeController()
      txInBlock.mockReturnValue(true)

      c._processBlock({
        block: { height: 100000, hash: 'abc', time: 1705315200, unixStamp: 1705315200 },
        extra: {}
      })

      expect(c.confirmationsTarget.dataset.confirmationBlockHeight).toBe('100000')
      expect(c.confirmationsTarget.textContent).toBe('1 confirmation')
      expect(c.confirmationsTarget.classList.contains('confirmed')).toBe(true)
    })

    it('does not set confirmationBlockHeight if tx not in block', () => {
      const c = makeController()
      txInBlock.mockReturnValue(false)

      c._processBlock({
        block: { height: 100000, hash: 'abc', time: 1705315200, unixStamp: 1705315200 },
        extra: {}
      })

      expect(c.confirmationsTarget.dataset.confirmationBlockHeight).toBe('-1')
    })

    it('updates the block link for the newly confirmed tx', () => {
      const c = makeController()
      txInBlock.mockReturnValue(true)

      c._processBlock({
        block: { height: 100005, hash: 'def456', time: 1705315200, unixStamp: 1705315200 },
        extra: {}
      })

      const link = c.unconfirmedTarget.querySelector('.mp-unconfirmed-link')
      expect(link.href).toContain('/block/def456')
      expect(link.textContent).toBe('100005')
    })

    it('does nothing when no unconfirmed target exists', () => {
      const c = makeController()
      c.hasUnconfirmedTarget = false
      txInBlock.mockReturnValue(true)

      expect(() => {
        c._processBlock({
          block: { height: 100000, hash: 'abc', time: 1705315200, unixStamp: 1705315200 },
          extra: {}
        })
      }).not.toThrow()
    })
  })
})
