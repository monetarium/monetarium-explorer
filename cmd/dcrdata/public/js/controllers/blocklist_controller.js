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

  for (const cr of coinRows) {
    if (cr.coin_type === 0) {
      varTxCount = cr.tx_count
      varAmount = humanize.formatCoinAtoms(cr.amount, cr.coin_type)
      varSize = `${cr.size} B`
    } else {
      subRows.push({
        tokenType: cr.symbol,
        txCount: String(cr.tx_count),
        amount: humanize.formatCoinAtoms(cr.amount, cr.coin_type),
        size: `${cr.size} B`
      })
    }
  }

  let skaAmount = ''
  if (subRows.length === 1) {
    skaAmount = subRows[0].amount
  } else if (subRows.length > 1) {
    skaAmount = `${subRows.length} SKA types`
  }

  return { varTxCount, varAmount, varSize, skaAmount, subRows }
}

function makeTd(className, text) {
  const td = document.createElement('td')
  td.className = className
  if (text !== undefined) td.textContent = text
  return td
}

// Insert a VAR sub-row immediately after newRow (9-column layout).
function insertVARSubRow(tbody, newRow, varTxCount, varAmount, varSize) {
  const tr = document.createElement('tr')
  tr.className = 'ska-sub-row'
  tr.dataset.skaAccordionTarget = 'subRow'
  tr.dataset.blockId = newRow.dataset.blockId

  const labelTd = makeTd('text-start ps-1')
  const labelSpan = document.createElement('span')
  labelSpan.className = 'sub-row-label'
  labelSpan.textContent = 'VAR'
  labelTd.appendChild(labelSpan)
  tr.appendChild(labelTd)
  tr.appendChild(makeTd('text-end num', String(varTxCount)))
  tr.appendChild(makeTd('text-end num', varAmount))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell', varSize))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end d-none d-sm-table-cell d-md-none d-lg-table-cell', '—'))
  tr.appendChild(makeTd('text-end', '—'))

  tbody.insertBefore(tr, newRow.nextSibling)
  return tr
}

// Insert SKA sub-rows after insertRef (9-column layout).
function insertSKASubRows(tbody, insertRef, subRows, blockHeight) {
  const ref = insertRef.nextSibling
  for (const sub of subRows) {
    const tr = document.createElement('tr')
    tr.className = 'ska-sub-row'
    tr.dataset.skaAccordionTarget = 'subRow'
    tr.dataset.blockId = String(blockHeight)

    const labelTd = makeTd('text-start ps-1')
    const badge = document.createElement('span')
    badge.className = 'sub-row-label'
    badge.textContent = sub.tokenType
    labelTd.appendChild(badge)
    tr.appendChild(labelTd)
    tr.appendChild(makeTd('text-end num', sub.txCount))
    tr.appendChild(makeTd('text-end', '—'))
    tr.appendChild(makeTd('text-end num', sub.amount))
    tr.appendChild(
      makeTd('text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell', sub.size)
    )
    tr.appendChild(makeTd('text-end', '—'))
    tr.appendChild(makeTd('text-end', '—'))
    tr.appendChild(makeTd('text-end d-none d-sm-table-cell d-md-none d-lg-table-cell', '—'))
    tr.appendChild(makeTd('text-end', '—'))

    tbody.insertBefore(tr, ref)
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

    const { varTxCount, varAmount, varSize, skaAmount, subRows } = coinRowsToSKAData(block)

    // Re-query after removals — firstBlockRow may have been detached.
    const currentFirstBlockRow = this.tableTarget.querySelector(
      'tr[data-ska-accordion-target="blockRow"]'
    )

    const newRow = document.createElement('tr')
    newRow.dataset.height = block.height
    newRow.dataset.linkClass = firstBlockRow.dataset.linkClass
    newRow.dataset.skaAccordionTarget = 'blockRow'
    newRow.dataset.blockId = String(block.height)
    newRow.classList.add('block-row-expandable')
    newRow.dataset.action = 'click->ska-accordion#toggle'

    firstBlockRow.querySelectorAll('td').forEach((td) => {
      const newTd = document.createElement('td')
      newTd.className = td.className
      const dataType = td.dataset.type
      newTd.dataset.type = dataType
      switch (dataType) {
        case 'age':
          newTd.dataset.age = block.unixStamp
          newTd.dataset.timeTarget = 'age'
          newTd.textContent = humanize.timeSince(block.unixStamp)
          break
        case 'height': {
          const link = document.createElement('a')
          link.href = `/block/${block.height}`
          link.textContent = block.height
          link.classList.add(firstBlockRow.dataset.linkClass)
          newTd.appendChild(link)
          break
        }
        case 'tx':
          newTd.textContent = String(block.tx)
          break
        case 'var-amount':
          newTd.textContent = varAmount
          break
        case 'ska-amount':
          newTd.textContent = skaAmount
          break
        case 'size':
          newTd.textContent = humanize.bytes(block.size)
          break
        case 'votes':
          newTd.textContent = block.votes
          break
        case 'tickets':
          newTd.textContent = block.tickets
          break
        case 'revocations':
          newTd.textContent = block.revocations
          break
        default:
          newTd.textContent = block[dataType]
      }
      newRow.appendChild(newTd)
    })

    // Insert the new block row before the current first block row (re-queried
    // after removals since the original firstBlockRow may have been detached).
    this.tableTarget.insertBefore(newRow, currentFirstBlockRow)
    const varSubRow = insertVARSubRow(this.tableTarget, newRow, varTxCount, varAmount, varSize)
    insertSKASubRows(this.tableTarget, varSubRow, subRows, block.height)
  }
}
