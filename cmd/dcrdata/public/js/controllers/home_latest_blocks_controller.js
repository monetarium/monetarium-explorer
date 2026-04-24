import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'

// coinRowsToSKAData extracts VAR and SKA display data from a block's coin_rows array.
// Returns { varTxCount, varAmount, varSize, skaAmount, subRows }.
function coinRowsToSKAData(block) {
  const coinRows = block.coin_rows
  if (!coinRows || coinRows.length === 0) {
    // VAR-only fallback
    return {
      totalTxCount: block.tx,
      varTxCount: block.tx,
      varAmount: humanize.threeSigFigs(block.total),
      varSize: humanize.bytes(block.size),
      skaAmount: '',
      subRows: []
    }
  }

  let varTxCount = block.tx
  let varAmount = humanize.threeSigFigs(block.total)
  let varSize = humanize.bytes(block.size)
  const subRows = []
  let totalTxCount = 0

  for (const cr of coinRows) {
    totalTxCount += cr.tx_count
    if (cr.coin_type === 0) {
      varTxCount =
        cr.tx_count - (block.votes || 0) - (block.tickets || 0) - (block.revocations || 0)
      if (varTxCount < 0) varTxCount = 0
      varAmount = humanize.formatCoinAtoms(cr.amount, cr.coin_type)
      varSize = humanize.bytes(cr.size)
    } else {
      subRows.push({
        tokenType: cr.symbol,
        txCount: String(cr.tx_count),
        amount: humanize.formatCoinAtoms(cr.amount, cr.coin_type),
        size: humanize.bytes(cr.size)
      })
    }
  }

  totalTxCount -= (block.votes || 0) + (block.tickets || 0) + (block.revocations || 0)
  if (totalTxCount < 0) totalTxCount = 0

  let skaAmount = ''
  if (subRows.length === 1) {
    skaAmount = subRows[0].amount
  } else if (subRows.length > 1) {
    skaAmount = `${subRows.length} SKA types`
  }

  return { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows }
}

// Insert a VAR sub-row immediately after newRow (9-column layout).
function insertVARSubRow(tbody, newRow, varTxCount, varAmount, varSize) {
  const tmpl = document.getElementById('home-var-sub-row-template')
  if (!tmpl) return null
  const clone = document.importNode(tmpl.content, true)
  const tr = clone.querySelector('tr')
  tr.dataset.blockId = newRow.dataset.blockId

  clone.querySelector('[data-type="tx"]').textContent = varTxCount > 0 ? String(varTxCount) : '—'
  clone.querySelector('[data-type="var-amount"]').textContent = varAmount
  clone.querySelector('[data-type="size"]').textContent = varSize

  tbody.insertBefore(clone, newRow.nextSibling)
  return tr
}

// Insert SKA sub-rows after insertRef (9-column layout).
function insertSKASubRows(tbody, insertRef, subRows, blockHeight) {
  const tmpl = document.getElementById('home-ska-sub-row-template')
  if (!tmpl || !insertRef) return
  const ref = insertRef.nextSibling
  for (const sub of subRows) {
    const clone = document.importNode(tmpl.content, true)
    const tr = clone.querySelector('tr')
    tr.dataset.blockId = String(blockHeight)

    clone.querySelector('.coin-label--ska').textContent = sub.tokenType
    clone.querySelector('[data-type="tx"]').textContent = sub.txCount
    clone.querySelector('[data-type="ska-amount"]').textContent = sub.amount
    clone.querySelector('[data-type="size"]').textContent = sub.size

    tbody.insertBefore(clone, ref)
  }
}

export default class extends Controller {
  static get targets() {
    return ['table']
  }

  connect() {
    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
    this.pageOffset = this.data.get('initialOffset')
  }

  disconnect() {
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
  }

  _processBlock(blockData) {
    if (!this.hasTableTarget) return
    const block = blockData.block

    const blockRows = this.tableTarget.querySelectorAll('tr[data-ska-accordion-target="blockRow"]')
    if (blockRows.length === 0) return
    const firstBlockRow = blockRows[0]
    const lastHeight = parseInt(firstBlockRow.dataset.height)

    if (block.height === lastHeight) {
      const toRemove = this.tableTarget.querySelectorAll(`tr[data-block-id="${lastHeight}"]`)
      toRemove.forEach((r) => this.tableTarget.removeChild(r))
    } else if (block.height === lastHeight + 1) {
      const lastBlockRow = blockRows[blockRows.length - 1]
      const oldHeight = lastBlockRow.dataset.blockId
      const toRemove = this.tableTarget.querySelectorAll(`tr[data-block-id="${oldHeight}"]`)
      toRemove.forEach((r) => this.tableTarget.removeChild(r))
    } else return

    const { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows } =
      coinRowsToSKAData(block)

    // Re-query after removals — firstBlockRow may have been detached.
    const currentFirstBlockRow = this.tableTarget.querySelector(
      'tr[data-ska-accordion-target="blockRow"]'
    )

    const tmpl = document.getElementById('home-block-row-template')
    if (!tmpl) return
    const clone = document.importNode(tmpl.content, true)
    const newRow = clone.querySelector('tr')

    newRow.dataset.height = block.height
    newRow.dataset.linkClass = firstBlockRow.dataset.linkClass
    newRow.dataset.blockId = String(block.height)
    newRow.dataset.skaAccordionTarget = 'blockRow'
    newRow.dataset.action = 'click->ska-accordion#toggle'

    const link = clone.querySelector('[data-type="height"] a')
    link.href = `/block/${block.height}`
    link.textContent = block.height
    link.classList.add(firstBlockRow.dataset.linkClass)

    clone.querySelector('[data-type="tx"]').textContent = String(totalTxCount)
    clone.querySelector('[data-type="var-amount"]').textContent = varAmount
    clone.querySelector('[data-type="ska-amount"]').textContent = skaAmount || '—'
    clone.querySelector('[data-type="size"]').textContent = humanize.bytes(block.size)
    clone.querySelector('[data-type="votes"]').textContent = block.votes
    clone.querySelector('[data-type="tickets"]').textContent = block.tickets
    clone.querySelector('[data-type="revocations"]').textContent = block.revocations

    const ageTd = clone.querySelector('[data-type="age"]')
    ageTd.dataset.age = block.unixStamp
    ageTd.textContent = humanize.timeSince(block.unixStamp)

    // Insert the new block row before the current first block row (re-queried
    // after removals since the original firstBlockRow may have been detached).
    this.tableTarget.insertBefore(newRow, currentFirstBlockRow)
    const varSubRow = insertVARSubRow(this.tableTarget, newRow, varTxCount, varAmount, varSize)
    insertSKASubRows(this.tableTarget, varSubRow, subRows, block.height)
  }
}
