import { Controller } from '@hotwired/stimulus'
import { coinRowsToSKAData, insertSKASubRows, insertVARSubRow } from '../helpers/coin_rows_helper'
import humanize from '../helpers/humanize_helper'
import { applyLiveBlock, rebuildBlockTable } from '../helpers/live_block_table'
import globalEventBus from '../services/event_bus_service'
import ws from '../services/messagesocket_service'

const DEFAULT_LINK_CLASS = 'fs18'

export default class extends Controller {
  static get targets() {
    return ['table']
  }

  connect() {
    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
    this.pageOffset = this.data.get('initialOffset')

    // After a reconnect or a detected height gap, the live stream alone can't
    // recover the blocks missed while disconnected. Request the authoritative
    // latest list and rebuild the table from it. The instant insert in
    // _processBlock keeps the table live in the meantime.
    this.refreshList = this._refreshList.bind(this)
    this.latestBlocksUnsub = ws.registerEvtHandler('getlatestblocksResp', this.refreshList)
    this.reconnectUnsub = ws.registerEvtHandler('reconnect', () => ws.send('getlatestblocks', ''))
  }

  disconnect() {
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
    if (this.latestBlocksUnsub) this.latestBlocksUnsub()
    if (this.reconnectUnsub) this.reconnectUnsub()
  }

  _processBlock(blockData) {
    if (!this.hasTableTarget) return
    // Capture the current tip's link class before applyLiveBlock mutates the
    // table; the home rows carry it per-row (server-rendered) and the insert
    // needs it for the new row's height link.
    const firstRow = this.tableTarget.querySelector('tr[data-coin-accordion-target="blockRow"]')
    const linkClass = (firstRow && firstRow.dataset.linkClass) || DEFAULT_LINK_CLASS
    const isGap = applyLiveBlock(this.tableTarget, blockData.block, (block, ref) =>
      this._insertBlockGroup(block, linkClass, ref)
    )
    // A gap means blocks were missed (disconnect or slow connect). The insert
    // above kept the table live; pull the full list to fill the missing rows.
    if (isGap) ws.send('getlatestblocks', '')
  }

  // _refreshList rebuilds the entire table from the "getlatestblocks" response.
  // The link class is read from the existing tip row before the rebuild wipes
  // it, then threaded into each new row.
  _refreshList(evt) {
    if (!this.hasTableTarget) return
    const existing = this.tableTarget.querySelector('tr[data-coin-accordion-target="blockRow"]')
    const linkClass = (existing && existing.dataset.linkClass) || DEFAULT_LINK_CLASS
    rebuildBlockTable(
      this.tableTarget,
      evt,
      (block, ref) => this._insertBlockGroup(block, linkClass, ref),
      'latest blocks refresh'
    )
  }

  // _insertBlockGroup clones the row templates for one block, fills the cells,
  // and inserts the block row (before referenceNode, or appended when null)
  // followed by its VAR and SKA sub-rows. Shared by the live insert and the
  // full-list rebuild.
  _insertBlockGroup(block, linkClass, referenceNode) {
    const { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows } =
      coinRowsToSKAData(block)

    const tmpl = document.getElementById('home-block-row-template')
    if (!tmpl) return
    const clone = document.importNode(tmpl.content, true)
    const newRow = clone.querySelector('tr')

    newRow.dataset.height = block.height
    newRow.dataset.linkClass = linkClass
    newRow.dataset.blockId = String(block.height)
    newRow.dataset.coinAccordionTarget = 'blockRow'
    newRow.dataset.action = 'click->coin-accordion#toggle'

    const link = clone.querySelector('[data-type="height"] a')
    link.href = `/block/${block.height}`
    link.textContent = block.height
    link.classList.add(linkClass)

    clone.querySelector('[data-type="tx"]').textContent = String(totalTxCount)
    clone.querySelector('[data-type="var-amount"]').textContent = varAmount
    clone.querySelector('[data-type="ska-amount"]').textContent = skaAmount
    clone.querySelector('[data-type="size"]').textContent = humanize.bytes(block.size)
    clone.querySelector('[data-type="votes"]').textContent = block.votes
    clone.querySelector('[data-type="tickets"]').textContent = block.tickets
    clone.querySelector('[data-type="revocations"]').textContent = block.revocations

    const ageTd = clone.querySelector('[data-type="age"]')
    ageTd.dataset.age = block.unixStamp
    ageTd.textContent = humanize.timeSince(block.unixStamp)

    this.tableTarget.insertBefore(newRow, referenceNode)
    const varSubRow = insertVARSubRow(
      this.tableTarget,
      newRow,
      varTxCount,
      varAmount,
      varSize,
      'home-var-sub-row-template'
    )
    insertSKASubRows(
      this.tableTarget,
      varSubRow,
      subRows,
      block.height,
      'home-ska-sub-row-template'
    )
  }
}
