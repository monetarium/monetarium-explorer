import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import { each, map } from 'lodash-es'
import humanize from '../helpers/humanize_helper'
import Mempool from '../helpers/mempool_helper'
import { renderCoinType, splitSkaAtomsNoTrailing } from '../helpers/ska_helper'
import { keyNav } from '../services/keyboard_navigation_service'
import ws from '../services/messagesocket_service'
import { alertArea, copyIcon } from './clipboard_controller'

const EMPTY_STATES = {
  regular: { text: 'No transactions in mempool.', colspan: 6 },
  tickets: { text: 'No tickets in mempool.', colspan: 5 },
  votes: { text: 'No votes in mempool.', colspan: 8 },
  revocations: { text: 'No revocations in mempool.', colspan: 4 },
  tadds: { text: 'No treasury adds in mempool.', colspan: 3 }
}

function incrementValue(el) {
  if (!el) return
  el.textContent = parseInt(el.textContent) + 1
}

function rowNode(rowText) {
  const tbody = document.createElement('tbody')
  tbody.innerHTML = rowText
  dompurify.sanitize(tbody, { IN_PLACE: true, FORBID_TAGS: ['svg', 'math'] })
  return tbody.firstElementChild
}

// skaAmountHTML renders a SKA atom string into the standard .decimal-parts
// HTML structure, matching the server-side decimalParts template output for
// skaDecimalParts. BigInt-based; no float coercion.
function skaAmountHTML(atomStr) {
  const { intPart, bold, rest, trailingZeros } = splitSkaAtomsNoTrailing(atomStr || '0', false)
  const intText = bold ? `${intPart}.${bold}` : intPart
  let html = `<div class="decimal-parts d-inline-block"><span class="int">${intText}</span>`
  if (bold && rest) html += `<span class="decimal">${rest}</span>`
  if (bold && trailingZeros) html += `<span class="decimal trailing-zeroes">${trailingZeros}</span>`
  html += '</div>'
  return html
}

// txAmountHTML returns the inner HTML for a tx's Amount cell. SKA txs render
// 18dp BigInt parts; VAR txs render 8dp float parts via humanize.decimalParts.
// Per the dual-precision invariant (CLAUDE.md), SKA never goes through
// float64.
function txAmountHTML(tx) {
  if (tx.ska_totals && Object.keys(tx.ska_totals).length > 0) {
    const [, atomStr] = Object.entries(tx.ska_totals)[0]
    return skaAmountHTML(atomStr)
  }
  return humanize.decimalParts(tx.total || 0, false, 8)
}

function txCoinSymbol(tx) {
  if (tx.ska_totals && Object.keys(tx.ska_totals).length > 0) {
    const [id] = Object.entries(tx.ska_totals)[0]
    return renderCoinType(id)
  }
  return renderCoinType(0)
}

function txFeeRateHTML(tx) {
  if (tx.ska_totals && Object.keys(tx.ska_totals).length > 0) {
    const [id] = Object.entries(tx.ska_totals)[0]
    const rateAtoms = tx.ska_fee_rates && tx.ska_fee_rates[id]
    if (!rateAtoms) return '&mdash;'
    return `${skaAmountHTML(rateAtoms)} ${renderCoinType(id)}/kB`
  }
  return `${tx.fee_rate} VAR/kB`
}

function txTableRow(tx) {
  return rowNode(`<tr class="flash">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}" title="${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="text-start text-nowrap">${txCoinSymbol(tx)}</td>
        <td class="mono fs15 text-end">${txAmountHTML(tx)}</td>
        <td class="mono fs15 text-end">${tx.size} B</td>
        <td class="mono fs15 text-end">${txFeeRateHTML(tx)}</td>
        <td class="mono fs15 text-end" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function ticketTableRow(tx) {
  return rowNode(`<tr class="flash">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}" title="${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15 text-end">${humanize.decimalParts(String(tx.total), false, 8)}</td>
        <td class="mono fs15 text-end">${tx.size} B</td>
        <td class="mono fs15 text-end">${tx.fee_rate} VAR/kB</td>
        <td class="mono fs15 text-end" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function revocationTableRow(tx) {
  return rowNode(`<tr class="flash">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}" title="${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15 text-end">${humanize.decimalParts(String(tx.total), false, 8)}</td>
        <td class="mono fs15 text-end">${tx.size} B</td>
        <td class="mono fs15 text-end" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function treasuryAddTableRow(tx) {
  return rowNode(`<tr class="flash">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}" title="${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15 text-end">${humanize.decimalParts(String(tx.total), false, 8)}</td>
        <td class="mono fs15 text-end" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function voteTxTableRow(tx) {
  return rowNode(`<tr class="flash" data-height="${tx.vote_info.block_validation.height}" data-blockhash="${tx.vote_info.block_validation.hash}">
        <td class="break-word clipboard">
          <a class="hash" href="/tx/${tx.hash}">${tx.hash}</a>
          ${copyIcon()}
          ${alertArea()}
        </td>
        <td class="mono fs15"><a href="/block/${tx.vote_info.block_validation.hash}">${tx.vote_info.block_validation.height}<span
          class="small">${tx.vote_info.last_block ? ' best' : ''}</span></a></td>
        <td class="mono fs15 text-end"><a href="/tx/${tx.vote_info.ticket_spent}">${tx.vote_info.mempool_ticket_index}<a/></td>
        <td class="mono fs15 text-end">${tx.vote_info.vote_version}</td>
        <td class="mono fs15 text-end d-none d-sm-table-cell">${humanize.decimalParts(String(tx.total), false, 8)}</td>
        <td class="mono fs15 text-end">${humanize.bytes(tx.size)}</td>
        <td class="mono fs15 text-end d-none d-sm-table-cell jsonly" data-time-target="age" data-age="${tx.time}">${humanize.timeSince(tx.time)}</td>
    </tr>`)
}

function buildTable(target, txType, txns, rowFn) {
  while (target.firstChild) target.removeChild(target.firstChild)
  if (txns && txns.length > 0) {
    map(txns, rowFn).forEach((tr) => {
      target.appendChild(tr)
    })
  } else {
    const { text, colspan } = EMPTY_STATES[txType]
    target.innerHTML = `<tr class="no-tx-tr"><td colspan="${colspan}">${text}</td></tr>`
  }
}

function addTxRow(tx, target, rowFn) {
  if (target.childElementCount === 1 && target.firstElementChild.classList.contains('no-tx-tr')) {
    target.removeChild(target.firstElementChild)
  }
  target.insertBefore(rowFn(tx), target.firstChild)
}

function emptyVarStats() {
  return {
    tx_count: 0,
    size: 0,
    amount: '0',
    regular_count: 0,
    regular_amount: '0',
    ticket_count: 0,
    ticket_amount: '0',
    vote_count: 0,
    vote_amount: '0',
    revoke_count: 0,
    revoke_amount: '0'
  }
}

// activeSkaIds returns SKA coin-type ids from a coin_stats payload that have at
// least one mempool tx, sorted ascending. Mirrors orderedMempoolCoinStats in
// templates.go for the SKA portion.
function activeSkaIds(coinStats) {
  if (!coinStats) return []
  const ids = []
  Object.entries(coinStats).forEach(([k, v]) => {
    const id = parseInt(k)
    if (id === 0 || !v || !v.tx_count || v.tx_count <= 0) return
    ids.push(id)
  })
  ids.sort((a, b) => a - b)
  return ids
}

function totalSentSkaCol(id, stats) {
  const col = document.createElement('div')
  col.className = 'col-12 col-md-6 col-lg-12 col-xl-6 text-center pb-3 pt-2 pt-md-0 pt-lg-2 pt-xl-0'
  col.setAttribute('data-coin-type', String(id))
  const inner = document.createElement('div')
  inner.className = 'd-inline-block text-center text-md-start text-lg-center text-xl-start'
  const label = document.createElement('span')
  label.className = 'text-secondary fs13'
  label.textContent = 'Total Sent'
  const amount = document.createElement('span')
  amount.className = 'h4'
  amount.textContent = humanize.formatCoinAtoms(stats.amount || '0', id)
  const sym = document.createElement('span')
  sym.className = 'text-secondary'
  sym.textContent = renderCoinType(id)
  inner.append(label, document.createElement('br'), amount, document.createTextNode(' '), sym)
  col.appendChild(inner)
  return col
}

function regularSkaCol(id, stats) {
  const col = document.createElement('div')
  col.className = 'col-12 col-md-6 col-lg-12 col-xl-6 pb-3'
  col.setAttribute('data-coin-type', String(id))
  const head = document.createElement('div')
  head.className = 'text-center text-secondary fs13'
  head.textContent = 'Regular'
  const count = document.createElement('div')
  count.className = 'text-center h4 mb-0'
  count.textContent = String(stats.regular_count || 0)
  const totalLine = document.createElement('div')
  totalLine.className = 'text-center fs13'
  const amount = document.createElement('span')
  amount.textContent = humanize.formatCoinAtoms(stats.regular_amount || '0', id)
  totalLine.append(amount, document.createTextNode(` ${renderCoinType(id)}`))
  col.append(head, count, totalLine)
  return col
}

// syncSkaColsIn rebuilds the SKA (CoinType > 0) child cols of a row to match
// coin_stats. VAR cols (data-coin-type="0") and any non-coin cols are left
// untouched. SKA cols are appended after VAR in ascending CoinType order, which
// matches the server-side render order for stable layout across reloads.
function syncSkaColsIn(row, coinStats, colFn) {
  Array.from(row.children).forEach((child) => {
    const raw = child.getAttribute('data-coin-type')
    if (raw === null) return
    const id = parseInt(raw, 10)
    if (id !== 0) child.remove()
  })
  activeSkaIds(coinStats).forEach((id) => {
    row.appendChild(colFn(id, coinStats[id]))
  })
}

export default class extends Controller {
  static get targets() {
    return [
      'bestBlock',
      'bestBlockTime',
      'taddTransactions',
      'voteTransactions',
      'ticketTransactions',
      'revocationTransactions',
      'regularTransactions',
      'mempool',
      'voteTally',
      'totalSent',
      'totalSentRow',
      'transactionsRow',
      'regTotal',
      'regCount',
      'ticketTotal',
      'ticketCount',
      'voteTotal',
      'voteCount',
      'revTotal',
      'revCount',
      'mempoolSize'
    ]
  }

  connect() {
    const mempoolData = this.mempoolTarget.dataset
    ws.send('getmempooltxs', mempoolData.id)
    this.mempool = new Mempool(mempoolData, this.voteTallyTargets)
    this.lastCoinStats = null
    this.txTargetMap = {
      Vote: this.voteTransactionsTarget,
      Ticket: this.ticketTransactionsTarget,
      Revocation: this.revocationTransactionsTarget,
      Regular: this.regularTransactionsTarget
    }
    if (this.hasTaddTransactionsTarget) {
      this.txTargetMap['Treasury Add'] = this.taddTransactionsTarget
    }
    ws.registerEvtHandler('newtxs', (evt) => {
      const m = JSON.parse(evt)
      const txs = Array.isArray(m) ? m : m.txs || []
      if (!Array.isArray(m) && m.coin_stats) this.lastCoinStats = m.coin_stats
      this.mempool.mergeTxs(txs)
      this.renderNewTxns(txs)
      this.setMempoolFigures()
      this.labelVotes()
      this.sortVotesTable()
      keyNav(evt, false, true)
    })
    ws.registerEvtHandler('mempool', (evt) => {
      const m = JSON.parse(evt)
      if (m.coin_stats) this.lastCoinStats = m.coin_stats
      this.mempool.replace(m)
      this.setMempoolFigures()
      this.updateBlock(m)
      ws.send('getmempooltxs', '')
    })
    ws.registerEvtHandler('getmempooltxsResp', (evt) => {
      const m = JSON.parse(evt)
      if (m.coin_stats) this.lastCoinStats = m.coin_stats
      this.mempool.replace(m)
      this.handleTxsResp(m)
      this.setMempoolFigures()
      this.labelVotes()
      this.sortVotesTable()
      keyNav(evt, false, true)
    })
  }

  disconnect() {
    ws.deregisterEvtHandlers('newtxs')
    ws.deregisterEvtHandlers('mempool')
    ws.deregisterEvtHandlers('getmempooltxsResp')
  }

  updateBlock(m) {
    this.bestBlockTarget.textContent = m.block_height
    this.bestBlockTarget.dataset.hash = m.block_hash
    this.bestBlockTarget.href = `/block/${m.block_hash}`
    this.bestBlockTimeTarget.dataset.age = m.block_time
  }

  setMempoolFigures() {
    this.applyCoinStats(this.lastCoinStats)
    // Vote tally HTML is driven by the local Mempool helper; vote totals are
    // already covered by applyCoinStats (CoinStats[0].vote_amount).
    const counts = this.mempool.counts()
    const ct = this.voteCountTarget
    while (ct.firstChild) ct.removeChild(ct.firstChild)
    this.mempool.voteSpans(counts.vote).forEach((span) => {
      ct.appendChild(span)
    })
    const totals = this.mempool.totals()
    this.mempoolSizeTarget.textContent = humanize.bytes(totals.size)
    this.labelVotes()
  }

  applyCoinStats(coinStats) {
    const v = (coinStats && coinStats[0]) || emptyVarStats()
    if (this.hasTotalSentTarget) {
      this.totalSentTarget.textContent = humanize.formatCoinAtoms(v.amount || '0', 0)
    }
    if (this.hasRegCountTarget) this.regCountTarget.textContent = v.regular_count || 0
    if (this.hasRegTotalTarget) {
      this.regTotalTarget.textContent = humanize.formatCoinAtoms(v.regular_amount || '0', 0)
    }
    if (this.hasTicketCountTarget) this.ticketCountTarget.textContent = v.ticket_count || 0
    if (this.hasTicketTotalTarget) {
      this.ticketTotalTarget.textContent = humanize.formatCoinAtoms(v.ticket_amount || '0', 0)
    }
    if (this.hasVoteTotalTarget) {
      this.voteTotalTarget.textContent = humanize.formatCoinAtoms(v.vote_amount || '0', 0)
    }
    if (this.hasRevCountTarget) this.revCountTarget.textContent = v.revoke_count || 0
    if (this.hasRevTotalTarget) {
      this.revTotalTarget.textContent = humanize.formatCoinAtoms(v.revoke_amount || '0', 0)
    }
    if (this.hasTotalSentRowTarget) {
      syncSkaColsIn(this.totalSentRowTarget, coinStats, totalSentSkaCol)
    }
    if (this.hasTransactionsRowTarget) {
      syncSkaColsIn(this.transactionsRowTarget, coinStats, regularSkaCol)
    }
  }

  handleTxsResp(m) {
    buildTable(this.regularTransactionsTarget, 'regular', m.tx, txTableRow)
    buildTable(this.revocationTransactionsTarget, 'revocations', m.revs, revocationTableRow)
    buildTable(this.voteTransactionsTarget, 'votes', m.votes, voteTxTableRow)
    buildTable(this.ticketTransactionsTarget, 'tickets', m.tickets, ticketTableRow)
    if (this.hasTaddTransactionsTarget) {
      buildTable(this.taddTransactionsTarget, 'tadds', m.tadds, treasuryAddTableRow)
    }
  }

  renderNewTxns(txs) {
    // Process transactions in reverse order so that when each is inserted at the
    // top, the end result matches the original input order (newest at top).
    const txsToRender = [...txs].reverse()
    each(txsToRender, (tx) => {
      incrementValue(this.countTargetMap ? this.countTargetMap[tx.Type] : null)
      let rowFn
      switch (tx.Type) {
        case 'Vote':
          rowFn = voteTxTableRow
          break
        case 'Ticket':
          rowFn = ticketTableRow
          break
        case 'Revocation':
          rowFn = revocationTableRow
          break
        case 'Treasury Add':
          if (!this.hasTaddTransactionsTarget) return
          rowFn = treasuryAddTableRow
          break
        case 'Treasury Spend':
          // Treasury Spends are not displayed on the mempool page.
          return
        default:
          rowFn = txTableRow
      }
      const target = this.txTargetMap[tx.Type]
      if (!target) return
      addTxRow(tx, target, rowFn)
    })
  }

  labelVotes() {
    const bestBlockHash = this.bestBlockTarget.dataset.hash
    const bestBlockHeight = parseInt(this.bestBlockTarget.textContent)
    this.voteTransactionsTarget.querySelectorAll('tr').forEach((tr) => {
      const voteValidationHash = tr.dataset.blockhash
      const voteBlockHeight = tr.dataset.height
      const best = tr.querySelector('.small')
      if (!best) return // Just the "No votes in mempool." td?
      best.textContent = ''
      if (voteBlockHeight > bestBlockHeight) {
        tr.classList.add('blue-row')
        tr.classList.remove('disabled-row')
      } else if (voteValidationHash !== bestBlockHash) {
        tr.classList.add('disabled-row')
        tr.classList.remove('blue-row')
        if (tr.classList.contains('last_block')) {
          tr.textContent = 'False'
        }
      } else {
        tr.classList.remove('disabled-row')
        tr.classList.remove('blue-row')
        best.textContent = ' (best)'
      }
    })
  }

  sortVotesTable() {
    const rows = Array.from(this.voteTransactionsTarget.querySelectorAll('tr'))
    rows.sort((a, b) => {
      if (a.dataset.height === b.dataset.height) {
        const indexA = parseInt(a.dataset.ticketIndex)
        const indexB = parseInt(b.dataset.ticketIndex)
        return indexA - indexB
      } else {
        return b.dataset.height - a.dataset.height
      }
    })
    this.voteTransactionsTarget.innerHTML = ''
    rows.forEach((row) => {
      this.voteTransactionsTarget.appendChild(row)
    })
  }
}
