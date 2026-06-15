import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'
import ws from '../services/messagesocket_service'

function isCorrectVal(value) {
  return /^\d+$/.test(value) && value > 0
}

export default class extends Controller {
  static get targets() {
    return ['age', 'blocktime', 'header']
  }

  connect() {
    this.startAgeRefresh()
    this.processBlock = this._processBlock.bind(this)
    this.targetBlockTime = parseInt(document.getElementById('navBar').dataset.blocktime)
    if (this.hasBlocktimeTarget) {
      globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
      // The footer's last-block Age (this is the only `time` instance with a
      // blocktime target) is seeded once at page load and otherwise only moved
      // by the live new-block push. After a reconnect — e.g. the tab was
      // backgrounded long enough to drop the socket — the server pushes future
      // blocks only, never the current tip, so the stamp would stay frozen and
      // setAges would render an ever-growing stale (red) age. Resync from the
      // authoritative latest blocks on reconnect, reading the tip out of the
      // shared "getlatestblocks" response.
      this.refreshBlocktime = this._refreshBlocktime.bind(this)
      this.latestBlocksUnsub = ws.registerEvtHandler('getlatestblocksResp', this.refreshBlocktime)
      // Only request the latest blocks ourselves on pages whose live block
      // table won't already do it. The home and latest-/blocks tables request
      // getlatestblocks on reconnect with their own page size and share the one
      // getlatestblocksResp broadcast (forward() delivers every response to
      // every handler), so there we just resync from their response. Issuing
      // our own empty-span request there would hand blocks_controller a
      // home-span (8-row) reply, which it rebuilds its (up to 100-row) listing
      // from and shrinks. A historical /blocks page (is-latest=false) does not
      // refresh, so there we still self-request.
      const liveBlockTable = document.querySelector(
        '[data-controller~="home-latest-blocks"], [data-blocks-is-latest-value="true"]'
      )
      if (!liveBlockTable) {
        this.reconnectUnsub = ws.registerEvtHandler('reconnect', () =>
          ws.send('getlatestblocks', '')
        )
      }
    }
    if (this.hasHeaderTarget) {
      this.headerTargets.forEach((h) => {
        h.textContent = h.dataset.jstitle
      })
    }
  }

  disconnect() {
    this.stopAgeRefresh()
    if (this.hasBlocktimeTarget) {
      globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
      if (this.latestBlocksUnsub) this.latestBlocksUnsub()
      if (this.reconnectUnsub) this.reconnectUnsub()
    }
  }

  _processBlock(blockData) {
    const block = blockData.block
    this.blocktimeTarget.dataset.stamp = block.unixStamp
    this.blocktimeTarget.classList.remove('text-danger')
    this.blocktimeTarget.textContent = humanize.timeSince(block.unixStamp)
  }

  // _refreshBlocktime resyncs the footer's last-block Age from a
  // "getlatestblocks" response (a JSON array of BlockBasic objects, newest
  // first). Only the newest block matters here. The list carries RFC3339
  // `time`, so derive the unix stamp the same way live_block_table.js does for
  // the block tables. A stale response (a live block already advanced the tip
  // after this list was requested) must not move the Age backwards.
  _refreshBlocktime(evt) {
    let blocks
    try {
      blocks = JSON.parse(evt)
    } catch {
      return // server sends a non-JSON "Error: ..." string when the refresh fails
    }
    if (!Array.isArray(blocks) || blocks.length === 0) return
    const tip = blocks[0]
    if (!tip || !tip.time) return
    const stamp = new Date(tip.time).getTime() / 1000
    if (!(stamp > 0)) return
    if (stamp < Number(this.blocktimeTarget.dataset.stamp)) return
    this.blocktimeTarget.dataset.stamp = stamp
    // Render the text and (re)evaluate the staleness red from the new stamp in
    // one place. Unlike the live new-block path, a reconnect can resync onto a
    // tip that is itself genuinely overdue (a stalled chain), so don't just
    // clear the red — let setAges toggle it.
    this.setAges()
  }

  startAgeRefresh() {
    setTimeout(() => {
      this.setAges()
    })
    this.ageRefreshTimer = setInterval(() => {
      this.setAges()
    }, 10 * 1000)
  }

  stopAgeRefresh() {
    if (this.ageRefreshTimer) {
      clearInterval(this.ageRefreshTimer)
    }
  }

  setAges() {
    if (this.hasBlocktimeTarget) {
      const lbt = this.blocktimeTarget.dataset.stamp
      this.blocktimeTarget.textContent = humanize.timeSince(lbt)
      // 8*blocktime (e.g. 40 min for 5-min blocks) overdue -> flag stale in red.
      // Toggle (not one-way add) so the red clears once the Age is fresh again,
      // e.g. after a reconnect resync (_refreshBlocktime) with no new live block.
      const stale = new Date().getTime() / 1000 - lbt > 8 * this.targetBlockTime
      this.blocktimeTarget.classList.toggle('text-danger', stale)
    }
    if (!this.hasAgeTarget) return
    this.ageTargets.forEach((el) => {
      if (isCorrectVal(el.dataset.age)) {
        el.textContent = humanize.timeSince(el.dataset.age)
      } else if (el.dataset.age !== '') {
        el.textContent = humanize.timeSince(Date.parse(el.dataset.age) / 1000)
      }
    })
  }
}
