import { Controller } from '@hotwired/stimulus'
import { each } from 'lodash-es'
import { fadeIn } from '../helpers/animation_helper'
import humanize from '../helpers/humanize_helper'
import {
  applyFillBar,
  applyTotalBar,
  injectFillBar,
  repositionSKAMarkers,
  zeroFillEntry
} from '../helpers/indicator_fill'
import Mempool from '../helpers/mempool_helper'
import { renderCoinType } from '../helpers/ska_helper'
import globalEventBus from '../services/event_bus_service'
import { keyNav } from '../services/keyboard_navigation_service'
import ws from '../services/messagesocket_service'

function incrementValue(element) {
  if (element) {
    element.textContent = parseInt(element.textContent) + 1
  }
}

function mempoolTableRow(tx) {
  const link = `/tx/${tx.txid}`

  // Determine coin label and formatted amount
  let coin, amount
  if (tx.ska_totals && Object.keys(tx.ska_totals).length > 0) {
    const [id, atomStr] = Object.entries(tx.ska_totals)[0]
    coin = renderCoinType(id)
    amount = humanize.formatCoinAtoms(atomStr, parseInt(id))
  } else {
    coin = renderCoinType(0)
    amount = humanize.threeSigFigs(tx.total || 0)
  }

  const tmpl = document.getElementById('home-mempool-tx-row-template')
  if (!tmpl) return null

  const clone = document.importNode(tmpl.content, true)
  const hashTd = clone.querySelector('.tx-hash')
  if (hashTd) {
    hashTd.innerHTML = humanize.hashElide(tx.txid, link)
  }
  const typeTd = clone.querySelector('.tx-type')
  if (typeTd) {
    typeTd.textContent = tx.Type
  }
  const coinTd = clone.querySelector('.tx-coin')
  if (coinTd) {
    coinTd.textContent = coin
  }
  const amountTd = clone.querySelector('.tx-amount')
  if (amountTd) {
    amountTd.textContent = amount
  }
  const sizeTd = clone.querySelector('.tx-size')
  if (sizeTd) {
    sizeTd.textContent = `${tx.size} B`
  }
  const ageTd = clone.querySelector('.tx-age')
  if (ageTd) {
    ageTd.dataset.timeTarget = 'age'
    ageTd.dataset.age = tx.time
    ageTd.textContent = humanize.timeSince(tx.time)
  }
  return clone.querySelector('tr')
}

export default class extends Controller {
  static get targets() {
    return ['transactions', 'mempool', 'voteTally', 'indicatorList', 'totalBar', 'coinFillBars']
  }

  connect() {
    const mempoolData = this.mempoolTarget.dataset
    ws.send('getmempooltxs', mempoolData.id)
    this.mempool = new Mempool(mempoolData, this.voteTallyTargets)
    // rAF frame guard for indicator updates (Requirement 5.7)
    this._rafPending = false
    this._pendingPayload = null
    ws.registerEvtHandler('newtxs', (evt) => {
      const m = JSON.parse(evt)
      const txs = Array.isArray(m) ? m : m.txs || []
      this.mempool.mergeTxs(txs)
      this.setMempoolFigures()
      this.renderLatestTransactions(txs, true)
      if (!Array.isArray(m) && m.coin_fills) {
        this.updateIndicators(m)
      }
      keyNav(evt, false, true)
    })
    ws.registerEvtHandler('mempool', (evt) => {
      const m = JSON.parse(evt)
      this.renderLatestTransactions(m.latest, false)
      this.mempool.replace(m)
      this.setMempoolFigures()
      this.updateIndicators(m)
      keyNav(evt, false, true)
      ws.send('getmempooltxs', '')
    })
    ws.registerEvtHandler('getmempooltxsResp', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.setMempoolFigures()
      this.updateCoinFillBars(m.coin_fills)
      this.renderLatestTransactions(m.latest, false)
      this.updateIndicators(m)
      keyNav(evt, false, true)
    })
    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)

    // On reconnect, re-request the full mempool to refresh after downtime.
    this.reconnectUnsub = ws.registerEvtHandler('reconnect', () => {
      ws.send('getmempooltxs', '')
    })
  }

  disconnect() {
    this.reconnectUnsub()
    ws.deregisterEvtHandlers('newtxs')
    ws.deregisterEvtHandlers('mempool')
    ws.deregisterEvtHandlers('getmempooltxsResp')
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
  }

  setMempoolFigures() {
    const totals = this.mempool.totals()
    const counts = this.mempool.counts()

    if (this.hasMpRegTotalTarget) {
      this.mpRegTotalTarget.textContent = humanize.threeSigFigs(totals.regular)
    }
    if (this.hasMpRegCountTarget) {
      this.mpRegCountTarget.textContent = counts.regular
    }
    if (this.hasMpTicketTotalTarget) {
      this.mpTicketTotalTarget.textContent = humanize.threeSigFigs(totals.ticket)
    }
    if (this.hasMpTicketCountTarget) {
      this.mpTicketCountTarget.textContent = counts.ticket
    }
    if (this.hasMpVoteTotalTarget) {
      this.mpVoteTotalTarget.textContent = humanize.threeSigFigs(totals.vote)
    }

    if (this.hasMpVoteCountTarget) {
      const ct = this.mpVoteCountTarget
      while (ct.firstChild) ct.removeChild(ct.firstChild)
      this.mempool.voteSpans(counts.vote).forEach((span) => {
        ct.appendChild(span)
      })
    }

    if (this.hasMpRevTotalTarget) {
      this.mpRevTotalTarget.textContent = humanize.threeSigFigs(totals.rev)
    }
    if (this.hasMpRevCountTarget) {
      this.mpRevCountTarget.textContent = counts.rev
    }

    if (
      this.hasMpRegBarTarget &&
      this.hasMpVoteBarTarget &&
      this.hasMpTicketBarTarget &&
      this.hasMpRevBarTarget
    ) {
      this.mpRegBarTarget.style.width = `${(totals.regular / totals.total) * 100}%`
      this.mpVoteBarTarget.style.width = `${(totals.vote / totals.total) * 100}%`
      this.mpTicketBarTarget.style.width = `${(totals.ticket / totals.total) * 100}%`
      this.mpRevBarTarget.style.width = `${(totals.rev / totals.total) * 100}%`
    }
  }

  updateCoinFillBars(coinFills) {
    if (!this.hasCoinFillBarsTarget || !coinFills || !coinFills.length) return
    this.coinFillBarsTarget.innerHTML = coinFills
      .map(
        (f) =>
          `<div style="flex:1;background:#eee;height:8px;border-radius:3px;overflow:hidden" title="${f.symbol}">
        <div style="width:${(f.fill_pct * 100).toFixed(1)}%;height:100%" class="fill-${f.status}"></div>
      </div>`
      )
      .join('')
  }

  renderLatestTransactions(txs, incremental) {
    if (!this.hasTransactionsTarget) return
    // Process transactions in reverse order so that when each is inserted at the
    // top, the end result matches the original input order (newest at top).
    const txsToRender = [...txs].reverse()
    each(txsToRender, (tx) => {
      if (incremental) {
        const targetKey = `num${tx.Type}Target`
        incrementValue(this[targetKey])
      }
      const row = mempoolTableRow(tx)
      if (!row) return

      const rows = this.transactionsTarget.querySelectorAll('tr')
      if (rows.length > 0) {
        this.transactionsTarget.removeChild(rows[rows.length - 1])
      }

      row.style.opacity = 0.05
      this.transactionsTarget.insertBefore(row, this.transactionsTarget.firstChild)
      fadeIn(row)
    })
  }

  _processBlock(blockData) {
    this.dispatch('block', { detail: blockData })
  }

  // ─── Indicator update methods ───────────────────────────────────────────────

  // updateIndicators schedules a single rAF flush for the given payload.
  // If a frame is already pending, the payload is overwritten (Requirement 5.7).
  updateIndicators(payload) {
    if (this._rafPending) {
      this._pendingPayload = payload
      return
    }
    this._pendingPayload = payload
    this._rafPending = true
    requestAnimationFrame(() => {
      this._flushIndicators()
    })
  }

  // _flushIndicators performs all DOM writes in a single animation frame.
  // The actual DOM mutation lives in helpers/indicator_fill; this method just
  // dispatches the payload onto the right targets.
  _flushIndicators() {
    const payload = this._pendingPayload
    this._rafPending = false

    if (!payload) return

    const coinFills = payload.coin_fills
    const totalFillRatio = payload.total_fill_ratio
    const activeSKACount = payload.active_ska_count

    if (Array.isArray(coinFills) && this.hasIndicatorListTarget) {
      const list = this.indicatorListTarget
      const activeSymbols = new Set(coinFills.map((e) => e && e.symbol).filter(Boolean))

      coinFills.forEach((entry) => {
        if (!entry || typeof entry.symbol !== 'string') return
        const el = list.querySelector(`[data-coin="${entry.symbol}"]`)
        if (el) {
          applyFillBar(el, entry)
        } else {
          injectFillBar(list, entry)
        }
      })

      // Zero out bars for coins no longer in the payload (never remove them).
      list.querySelectorAll('[data-coin]').forEach((bar) => {
        if (!activeSymbols.has(bar.dataset.coin)) {
          applyFillBar(bar, zeroFillEntry(bar.dataset.coin))
        }
      })
    }

    if (this.hasTotalBarTarget) {
      applyTotalBar(this.totalBarTarget, totalFillRatio)
    }

    if (this.hasIndicatorListTarget) {
      repositionSKAMarkers(this.indicatorListTarget, activeSKACount)
    }
  }
}
