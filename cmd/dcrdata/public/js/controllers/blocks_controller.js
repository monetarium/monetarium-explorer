import { Controller } from '@hotwired/stimulus'
import { coinRowsToSKAData, insertSKASubRows, insertVARSubRow } from '../helpers/coin_rows_helper'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'

export default class extends Controller {
  static get targets() {
    return ['table']
  }

  connect() {
    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
  }

  disconnect() {
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
  }

  _processBlock(blockData) {
    if (!this.hasTableTarget) return
    const block = blockData.block

    const blockRows = this.tableTarget.querySelectorAll('tr[data-coin-accordion-target="blockRow"]')
    if (blockRows.length === 0) return
    const firstBlockRow = blockRows[0]
    const lastHeight = parseInt(firstBlockRow.dataset.height)

    if (block.height === lastHeight) {
      // Re-broadcast of the current top block — replace all its rows.
      const toRemove = this.tableTarget.querySelectorAll(`tr[data-block-id="${lastHeight}"]`)
      toRemove.forEach((r) => this.tableTarget.removeChild(r))
    } else if (block.height === lastHeight + 1) {
      // New block — drop the last block's rows to keep the page length stable.
      const lastBlockRow = blockRows[blockRows.length - 1]
      const oldHeight = lastBlockRow.dataset.blockId
      const toRemove = this.tableTarget.querySelectorAll(`tr[data-block-id="${oldHeight}"]`)
      toRemove.forEach((r) => this.tableTarget.removeChild(r))
    } else return

    const { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows } =
      coinRowsToSKAData(block)

    // Re-query after removals — firstBlockRow may have been detached.
    const currentFirstBlockRow = this.tableTarget.querySelector(
      'tr[data-coin-accordion-target="blockRow"]'
    )

    const tmpl = document.getElementById('blocks-block-row-template')
    if (!tmpl) return
    const clone = document.importNode(tmpl.content, true)
    const newRow = clone.querySelector('tr')

    newRow.dataset.height = block.height
    newRow.dataset.blockId = String(block.height)
    newRow.dataset.coinAccordionTarget = 'blockRow'
    newRow.dataset.action = 'click->coin-accordion#toggle'

    const link = clone.querySelector('[data-type="height"] a')
    link.href = `/block/${block.height}`
    link.textContent = block.height

    clone.querySelector('[data-type="tx"]').textContent = String(totalTxCount)
    clone.querySelector('[data-type="var-amount"]').textContent = varAmount
    clone.querySelector('[data-type="ska-amount"]').textContent = skaAmount || '—'
    clone.querySelector('[data-type="size"]').textContent = humanize.bytes(block.size)
    clone.querySelector('[data-type="votes"]').textContent = block.votes
    clone.querySelector('[data-type="tickets"]').textContent = block.tickets
    clone.querySelector('[data-type="revocations"]').textContent = block.revocations
    clone.querySelector('[data-type="version"]').textContent = block.version || '—'

    const ageTd = clone.querySelector('[data-type="age"]')
    ageTd.dataset.age = block.unixStamp
    ageTd.textContent = humanize.timeSince(block.unixStamp)

    clone.querySelector('[data-type="time"]').textContent = humanize.date(block.time, false)

    this.tableTarget.insertBefore(newRow, currentFirstBlockRow)
    const varSubRow = insertVARSubRow(
      this.tableTarget,
      newRow,
      varTxCount,
      varAmount,
      varSize,
      'blocks-var-sub-row-template'
    )
    insertSKASubRows(
      this.tableTarget,
      varSubRow,
      subRows,
      block.height,
      'blocks-ska-sub-row-template'
    )
  }
}
