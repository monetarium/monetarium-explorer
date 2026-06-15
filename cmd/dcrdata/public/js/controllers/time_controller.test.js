import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import humanize from '../helpers/humanize_helper'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../services/event_bus_service', () => ({
  default: { on: vi.fn(), off: vi.fn() }
}))

const registered = {}
const send = vi.fn()

vi.mock('../services/messagesocket_service', () => ({
  default: {
    registerEvtHandler: vi.fn((event, handler) => {
      const unsub = vi.fn()
      ;(registered[event] = registered[event] || []).push({ handler, unsub })
      return unsub
    }),
    deregisterEvtHandler: vi.fn(),
    deregisterEvtHandlers: vi.fn(),
    send: send
  }
}))

const { default: TimeController } = await import('./time_controller.js')

const NOW = new Date('2021-06-01T01:00:00Z')
const NOW_SEC = Math.floor(NOW.getTime() / 1000)
const BLOCKTIME = 300 // seconds; stale threshold is 8 * 300 = 2400s

// makeFooterController builds the standalone footer `time` instance: the only
// one carrying a `blocktime` target. element === blocktimeTarget for the footer
// span (extras.tmpl), so they share the same DOM node here too.
function makeFooterController(stamp) {
  const span = document.createElement('span')
  span.dataset.stamp = String(stamp)
  const c = new TimeController()
  c.element = span
  c.hasBlocktimeTarget = true
  c.blocktimeTarget = span
  c.hasAgeTarget = false
  c.hasHeaderTarget = false
  return c
}

// makeTableController builds a non-footer `time` instance: age targets, no
// blocktime target (e.g. the home/blocks table container).
function makeTableController() {
  const c = new TimeController()
  c.element = document.createElement('div')
  c.hasBlocktimeTarget = false
  c.hasAgeTarget = false
  c.hasHeaderTarget = false
  return c
}

function latestBlocksPayload(unixSec, height = 1000) {
  const time = new Date(unixSec * 1000).toISOString()
  const hash = `hash${height}`
  return JSON.stringify([{ height, hash, time }])
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  document.body.innerHTML = `<div id="navBar" data-blocktime="${BLOCKTIME}"></div>`
  for (const key of Object.keys(registered)) delete registered[key]
  send.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('footer blocktime reconnect resync', () => {
  it("re-requests the latest blocks on 'reconnect'", () => {
    const c = makeFooterController(NOW_SEC)
    c.connect()

    expect(registered.reconnect).toHaveLength(1)
    registered.reconnect[0].handler()
    // Empty span — matches home_latest_blocks_controller, the other empty-span
    // requester — so a no-table page's footer reply has the home shape.
    expect(send).toHaveBeenCalledWith('getlatestblocks', '')
    c.disconnect()
  })

  it('updates the stamp, text, and clears red on a newer getlatestblocksResp', () => {
    const staleStamp = NOW_SEC - 5000 // older than the 2400s threshold -> red
    const c = makeFooterController(staleStamp)
    c.blocktimeTarget.classList.add('text-danger')
    c.connect()

    const freshSec = NOW_SEC - 60 // tip mined 1 min ago
    registered.getlatestblocksResp[0].handler(latestBlocksPayload(freshSec))

    expect(Number(c.blocktimeTarget.dataset.stamp)).toBe(freshSec)
    expect(c.blocktimeTarget.textContent).toBe(humanize.timeSince(freshSec))
    expect(c.blocktimeTarget.classList.contains('text-danger')).toBe(false)
    c.disconnect()
  })

  it('does not move the stamp backwards on a stale getlatestblocksResp', () => {
    const c = makeFooterController(NOW_SEC)
    c.connect()

    const olderSec = NOW_SEC - 100 // older than the current stamp
    registered.getlatestblocksResp[0].handler(latestBlocksPayload(olderSec))

    expect(Number(c.blocktimeTarget.dataset.stamp)).toBe(NOW_SEC)
    c.disconnect()
  })

  it('ignores a non-JSON or empty getlatestblocksResp', () => {
    const c = makeFooterController(NOW_SEC)
    c.connect()

    registered.getlatestblocksResp[0].handler('Error: boom')
    registered.getlatestblocksResp[0].handler('[]')

    expect(Number(c.blocktimeTarget.dataset.stamp)).toBe(NOW_SEC)
    c.disconnect()
  })

  it("removes its own 'reconnect' and 'getlatestblocksResp' handlers on disconnect", () => {
    const c = makeFooterController(NOW_SEC)
    c.connect()
    c.disconnect()

    expect(registered.reconnect[0].unsub).toHaveBeenCalledTimes(1)
    expect(registered.getlatestblocksResp[0].unsub).toHaveBeenCalledTimes(1)
  })
})

describe('footer blocktime red toggle is symmetric', () => {
  it('adds text-danger when the block is stale', () => {
    const c = makeFooterController(NOW_SEC - 3000) // > 2400s threshold
    c.targetBlockTime = BLOCKTIME

    c.setAges()

    expect(c.blocktimeTarget.classList.contains('text-danger')).toBe(true)
  })

  it('removes text-danger once the block is fresh again', () => {
    const c = makeFooterController(NOW_SEC - 60) // < 2400s threshold
    c.targetBlockTime = BLOCKTIME
    c.blocktimeTarget.classList.add('text-danger')

    c.setAges()

    expect(c.blocktimeTarget.classList.contains('text-danger')).toBe(false)
  })
})

describe('footer reconnect self-request is gated on the page block table', () => {
  // The home and latest-/blocks tables already request getlatestblocks on
  // reconnect and share the response, so the footer must not double-request
  // there: its empty-span (home-span) reply would be rebuilt by
  // blocks_controller and shrink the larger /blocks listing. The footer still
  // resyncs passively from whatever response the table fetches.
  function withMarker(markup) {
    document.body.innerHTML = `<div id="navBar" data-blocktime="${BLOCKTIME}"></div>${markup}`
  }

  it('skips its own reconnect request when a live /blocks table is present', () => {
    withMarker(
      '<div data-controller="time pagenavigation blocks" data-blocks-is-latest-value="true"></div>'
    )
    const c = makeFooterController(NOW_SEC - 5000)
    c.connect()

    expect(registered.reconnect).toBeUndefined()
    // Still resyncs from the table's shared getlatestblocksResp.
    expect(registered.getlatestblocksResp).toHaveLength(1)
    registered.getlatestblocksResp[0].handler(latestBlocksPayload(NOW_SEC - 60))
    expect(Number(c.blocktimeTarget.dataset.stamp)).toBe(NOW_SEC - 60)
    c.disconnect()
  })

  it('skips its own reconnect request when the home latest-blocks table is present', () => {
    withMarker('<div data-controller="time home-latest-blocks"></div>')
    const c = makeFooterController(NOW_SEC)
    c.connect()

    expect(registered.reconnect).toBeUndefined()
    expect(send).not.toHaveBeenCalled()
    c.disconnect()
  })

  it('still self-requests on a historical /blocks page (is-latest=false)', () => {
    withMarker(
      '<div data-controller="time pagenavigation blocks" data-blocks-is-latest-value="false"></div>'
    )
    const c = makeFooterController(NOW_SEC)
    c.connect()

    expect(registered.reconnect).toHaveLength(1)
    registered.reconnect[0].handler()
    expect(send).toHaveBeenCalledWith('getlatestblocks', '')
    c.disconnect()
  })
})

describe('non-footer time instance', () => {
  it('registers no reconnect/getlatestblocksResp handlers', () => {
    const c = makeTableController()
    c.connect()
    c.disconnect()

    expect(registered.reconnect).toBeUndefined()
    expect(registered.getlatestblocksResp).toBeUndefined()
  })
})
