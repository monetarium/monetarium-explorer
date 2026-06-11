import { Controller } from '@hotwired/stimulus'
import { coinRowsToSKAData, insertSKASubRows, insertVARSubRow } from '../helpers/coin_rows_helper'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'
import ws from '../services/messagesocket_service'

export default class extends Controller {
  static get targets() {
    return ['table']
  }

  static get values() {
    // isLatest: this page tracks the chain tip (no height param / height == tip).
    // rows: the page size, sent to getlatestblocks so the refresh reproduces the
    // server-rendered window exactly.
    return { isLatest: Boolean, rows: Number }
  }

  connect() {
    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)

    // Only the latest page may live-update. Historical pages are a fixed window,
    // so don't wire the reconnect/refresh handlers there — a refresh would
    // replace a historical page with the latest blocks.
    if (this.isLatestValue) {
      this.refreshList = this._refreshList.bind(this)
      this.latestBlocksUnsub = ws.registerEvtHandler('getlatestblocksResp', this.refreshList)
      this.reconnectUnsub = ws.registerEvtHandler('reconnect', () =>
        ws.send('getlatestblocks', String(this.rowsValue))
      )
    }
  }

  disconnect() {
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
    if (this.latestBlocksUnsub) this.latestBlocksUnsub()
    if (this.reconnectUnsub) this.reconnectUnsub()
  }

  _processBlock(blockData) {
    // Never mutate a historical page: heights there don't track the tip, so a
    // new block must not be pushed onto it.
    if (!this.hasTableTarget || !this.isLatestValue) return
    const block = blockData.block

    const blockRows = this.tableTarget.querySelectorAll('tr[data-coin-accordion-target="blockRow"]')
    if (blockRows.length === 0) return
    const firstBlockRow = blockRows[0]
    const lastHeight = parseInt(firstBlockRow.dataset.height)

    let isGap = false
    if (block.height === lastHeight) {
      // Re-broadcast of the current top block — replace all its rows.
      const toRemove = this.tableTarget.querySelectorAll(`tr[data-block-id="${lastHeight}"]`)
      toRemove.forEach((r) => this.tableTarget.removeChild(r))
    } else if (block.height > lastHeight) {
      // Any newer block advances the tip. Using > (not === lastHeight + 1) keeps
      // the page live across height gaps (a block missed during a disconnect or
      // slow connect): the old === check froze the page permanently because the
      // DOM tip never advanced. Drop the oldest block's rows to keep the page
      // length stable.
      isGap = block.height > lastHeight + 1
      const lastBlockRow = blockRows[blockRows.length - 1]
      const oldHeight = lastBlockRow.dataset.blockId
      const toRemove = this.tableTarget.querySelectorAll(`tr[data-block-id="${oldHeight}"]`)
      toRemove.forEach((r) => this.tableTarget.removeChild(r))
    } else return

    // Re-query after removals — firstBlockRow may have been detached.
    const currentFirstBlockRow = this.tableTarget.querySelector(
      'tr[data-coin-accordion-target="blockRow"]'
    )
    this._insertBlockGroup(block, currentFirstBlockRow)

    // A gap means blocks were missed; the insert above kept the page live, now
    // pull the full window to fill the missing rows.
    if (isGap) ws.send('getlatestblocks', String(this.rowsValue))
  }

  // _refreshList rebuilds the table from the "getlatestblocks" response — an
  // array of server BlockBasic objects, newest first — recovering the exact
  // window (including blocks missed while disconnected).
  _refreshList(evt) {
    if (!this.hasTableTarget) return
    let blocks
    try {
      blocks = JSON.parse(evt)
    } catch {
      return
    }
    if (!Array.isArray(blocks) || blocks.length === 0) return

    this.tableTarget.innerHTML = ''
    for (const block of blocks) {
      if (block.unixStamp === undefined && block.time) {
        block.unixStamp = new Date(block.time).getTime() / 1000
      }
      // referenceNode null → append, preserving the server's newest-first order.
      this._insertBlockGroup(block, null)
    }
  }

  // _insertBlockGroup clones the row templates for one block (11-column blocks
  // layout), fills the cells, and inserts the block row (before referenceNode,
  // or appended when null) followed by its VAR and SKA sub-rows. Shared by the
  // live insert and the full-list rebuild.
  _insertBlockGroup(block, referenceNode) {
    const { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows } =
      coinRowsToSKAData(block)

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
    clone.querySelector('[data-type="ska-amount"]').textContent = skaAmount
    clone.querySelector('[data-type="size"]').textContent = humanize.bytes(block.size)
    clone.querySelector('[data-type="votes"]').textContent = block.votes
    clone.querySelector('[data-type="tickets"]').textContent = block.tickets
    clone.querySelector('[data-type="revocations"]').textContent = block.revocations
    clone.querySelector('[data-type="version"]').textContent = block.version || '—'

    const ageTd = clone.querySelector('[data-type="age"]')
    ageTd.dataset.age = block.unixStamp
    ageTd.textContent = humanize.timeSince(block.unixStamp)

    clone.querySelector('[data-type="time"]').textContent = humanize.date(block.time, false)

    this.tableTarget.insertBefore(newRow, referenceNode)
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
