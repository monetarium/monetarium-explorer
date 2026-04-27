/* global requestAnimationFrame */
import { Controller } from '@hotwired/stimulus'
import { each } from 'lodash-es'
import { fadeIn } from '../helpers/animation_helper'
import humanize from '../helpers/humanize_helper'
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
  const link = `/tx/${tx.hash}`

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
    hashTd.innerHTML = humanize.hashElide(tx.hash, link)
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
  }

  disconnect() {
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

  // _flushIndicators performs all DOM writes in a single animation frame
  // (Requirements 5.6, 7.1, 7.3).
  _flushIndicators() {
    const payload = this._pendingPayload
    this._rafPending = false

    if (!payload) return

    const coinFills = payload.coin_fills
    const totalFillRatio = payload.total_fill_ratio
    const activeSKACount = payload.active_ska_count

    // Update Fill_Bars
    if (Array.isArray(coinFills)) {
      const activeSymbols = new Set(coinFills.map((e) => e && e.symbol).filter(Boolean))

      coinFills.forEach((entry) => {
        if (!entry || typeof entry.symbol !== 'string') return
        const el = this.hasIndicatorListTarget
          ? this.indicatorListTarget.querySelector(`[data-coin="${entry.symbol}"]`)
          : null
        if (el) {
          this._applyFillBar(el, entry)
        } else {
          this._injectFillBar(entry)
        }
      })

      // Zero out bars for coins no longer in the payload (never remove them)
      if (this.hasIndicatorListTarget) {
        this.indicatorListTarget.querySelectorAll('[data-coin]').forEach((bar) => {
          if (!activeSymbols.has(bar.dataset.coin)) {
            this._applyFillBar(bar, {
              symbol: bar.dataset.coin,
              gq_fill_ratio: 0,
              extra_fill_ratio: 0,
              overflow_fill_ratio: 0,
              gq_position_ratio: 0,
              status: ''
            })
          }
        })
      }
    }

    // Update Total_Bar
    if (this.hasTotalBarTarget && typeof totalFillRatio === 'number' && isFinite(totalFillRatio)) {
      const clamped = Math.min(totalFillRatio, 1.0)
      const fill = this.totalBarTarget.querySelector('.total-bar__fill')
      if (fill) fill.style.setProperty('--seg-w', `${(clamped * 100).toFixed(4)}%`)
      this.totalBarTarget.setAttribute('aria-valuenow', Math.round(clamped * 100))
      const pct = this.totalBarTarget.querySelector('.total-bar__pct')
      if (pct) pct.textContent = `${(clamped * 100).toFixed(1)}%`
      if (totalFillRatio > 1.0) {
        this.totalBarTarget.setAttribute('data-overflow', 'true')
      } else {
        this.totalBarTarget.removeAttribute('data-overflow')
      }
    }

    // Update SKA GQ_Marker positions when Active_SKA_Count changes (Requirement 5.3)
    if (typeof activeSKACount === 'number' && activeSKACount > 0 && this.hasIndicatorListTarget) {
      const newGQPos = 0.9 / activeSKACount
      const newGQPosStr = newGQPos.toFixed(6)
      this.indicatorListTarget.querySelectorAll('[data-coin]').forEach((bar) => {
        const coin = bar.dataset.coin
        if (!coin || coin === 'VAR') return
        const track = bar.querySelector('.fill-bar__track')
        if (track) track.style.setProperty('--gq-pos', newGQPosStr)
        const marker = bar.querySelector('.gq-marker')
        if (marker) marker.style.left = `${(newGQPos * 100).toFixed(4)}%`
      })
    }
  }

  // _applyFillBar updates all visual and ARIA properties of an existing Fill_Bar
  // (Requirements 5.2, 8.5).
  _applyFillBar(el, entry) {
    const track = el.querySelector('.fill-bar__track')
    if (!track) return

    const gqFill = typeof entry.gq_fill_ratio === 'number' ? entry.gq_fill_ratio : 0
    const extraFill = typeof entry.extra_fill_ratio === 'number' ? entry.extra_fill_ratio : 0
    const overflowFill =
      typeof entry.overflow_fill_ratio === 'number' ? entry.overflow_fill_ratio : 0
    const gqPos = typeof entry.gq_position_ratio === 'number' ? entry.gq_position_ratio : 0
    const status = typeof entry.status === 'string' ? entry.status : ''

    // Set transform: scaleX on each segment — no width changes, no layout reflow
    const gqSeg = track.querySelector('.gq-segment')
    const extraSeg = track.querySelector('.extra-segment')
    const overflowSeg = track.querySelector('.overflow-segment')
    const marker = track.querySelector('.gq-marker')

    if (gqSeg) {
      gqSeg.style.setProperty('--seg-w', `${(gqFill * gqPos * 100).toFixed(4)}%`)
      gqSeg.hidden = gqFill === 0
    }
    if (extraSeg) {
      extraSeg.style.setProperty('--seg-w', `${(extraFill * 100).toFixed(4)}%`)
      extraSeg.hidden = extraFill === 0
    }
    if (overflowSeg) {
      overflowSeg.style.setProperty('--seg-w', `${(overflowFill * 100).toFixed(4)}%`)
      overflowSeg.hidden = overflowFill === 0
    }
    if (marker) marker.style.left = `${(gqPos * 100).toFixed(4)}%`

    track.style.setProperty('--gq-pos', gqPos.toFixed(6))
    track.dataset.status = ['ok', 'borrowing', 'full'].includes(status) ? status : ''

    // ARIA (Requirements 8.2, 8.3, 8.5)
    // Percentage expressed as fraction of TC (= gqFill × gqPos), matching Total_Bar scale
    const pctOfTC = gqFill * gqPos * 100
    el.setAttribute('aria-valuenow', Math.round(pctOfTC))
    el.setAttribute('aria-label', `${entry.symbol} — ${status || 'unknown'}`)

    // Percentage label
    const pct = el.querySelector('.fill-bar__pct')
    if (pct) pct.textContent = `${pctOfTC.toFixed(1)}%`
  }

  // _injectFillBar clones the fill-bar-template and inserts it in canonical order
  // (Requirements 5.4, 6.1–6.5).
  _injectFillBar(entry) {
    if (!this.hasIndicatorListTarget) return
    const tmpl = document.getElementById('fill-bar-template')
    if (!tmpl) return

    const clone = document.importNode(tmpl.content, true)
    const bar = clone.querySelector('.fill-bar')
    if (!bar) return

    bar.dataset.coin = entry.symbol
    const labelEl = bar.querySelector('.fill-bar__label')
    if (labelEl) labelEl.textContent = entry.symbol

    this._applyFillBar(bar, entry)

    // Bisect insertion: VAR first, then SKA types by ascending numeric index
    const list = this.indicatorListTarget
    const existing = Array.from(list.querySelectorAll('[data-coin]'))
    const insertBefore = existing.find(
      (el) => _coinSortKey(el.dataset.coin) > _coinSortKey(entry.symbol)
    )
    if (insertBefore) {
      list.insertBefore(bar, insertBefore)
    } else {
      list.appendChild(bar)
    }
  }
}

// _coinSortKey returns a numeric sort key: VAR = 0, SKAn = n.
function _coinSortKey(symbol) {
  if (!symbol || symbol === 'VAR') return 0
  const m = symbol.match(/^SKA(\d+)$/)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}
