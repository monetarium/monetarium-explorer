import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'

const mockSKATokens = [
  { name: 'SKA-1', txs: 42, amount: 1_250_000, size: 8_400 },
  { name: 'SKA-2', txs: 17, amount: 450_000, size: 3_200 },
  { name: 'SKA-3', txs: 5, amount: 2_100_000_000, size: 1_100 }
]

function mockSKAData(height) {
  if (height % 9 === 0) {
    return { skaTx: '0', skaAmt: '0', skaSz: '0', subRows: [] }
  }
  const offset = height % 10
  let aggTx = 0
  let aggAmt = 0
  let aggSz = 0
  const subRows = []
  for (const tok of mockSKATokens) {
    const tx = tok.txs + offset
    const amt = tok.amount * (1 + offset / 100)
    const sz = tok.size + offset * 10
    aggTx += tx
    aggAmt += amt
    aggSz += sz
    subRows.push({
      tokenType: tok.name,
      txCount: String(tx),
      amount: humanize.threeSigFigs(amt),
      size: humanize.threeSigFigs(sz)
    })
  }
  const skaTx = String(aggTx)
  const skaAmt = humanize.threeSigFigs(aggAmt)
  const skaSz = humanize.threeSigFigs(aggSz)
  return { skaTx, skaAmt, skaSz, subRows }
}

function makeTd(className, text) {
  const td = document.createElement('td')
  td.className = className
  if (text !== undefined) td.textContent = text
  return td
}

// Insert a VAR sub-row immediately after newRow (10-column layout).
function insertVARSubRow(tbody, newRow, block) {
  const tr = document.createElement('tr')
  tr.className = 'ska-sub-row'
  tr.dataset.skaAccordionTarget = 'subRow'
  tr.dataset.blockId = String(block.height)

  tr.appendChild(makeTd('sticky-col'))
  const labelTd = makeTd('token-label-col')
  const labelSpan = document.createElement('span')
  labelSpan.className = 'sub-row-label'
  labelSpan.textContent = 'VAR'
  labelTd.appendChild(labelSpan)
  tr.appendChild(labelTd)
  tr.appendChild(makeTd('text-end num', String(block.tx)))
  tr.appendChild(makeTd('text-end num', humanize.threeSigFigs(block.total)))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end num', humanize.bytes(block.size)))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end', '—'))
  tr.appendChild(makeTd('text-end', '—'))

  tbody.insertBefore(tr, newRow.nextSibling)
  return tr
}

// Insert SKA sub-rows after insertRef (10-column layout).
function insertSKASubRows(tbody, insertRef, subRows, blockHeight) {
  const ref = insertRef.nextSibling
  for (const sub of subRows) {
    const tr = document.createElement('tr')
    tr.className = 'ska-sub-row'
    tr.dataset.skaAccordionTarget = 'subRow'
    tr.dataset.blockId = String(blockHeight)

    tr.appendChild(makeTd('sticky-col'))
    const labelTd = makeTd('token-label-col')
    const badge = document.createElement('span')
    badge.className = 'sub-row-label'
    badge.textContent = sub.tokenType
    labelTd.appendChild(badge)
    tr.appendChild(labelTd)
    tr.appendChild(makeTd('text-end num', sub.txCount))
    tr.appendChild(makeTd('text-end', '—'))
    tr.appendChild(makeTd('text-end num', sub.amount))
    tr.appendChild(makeTd('text-end num', sub.size))
    tr.appendChild(makeTd('text-end', '—'))
    tr.appendChild(makeTd('text-end', '—'))
    tr.appendChild(makeTd('text-end', '—'))
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

    const { skaAmt, subRows } = mockSKAData(block.height)
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
        case 'token-label':
          break
        case 'tx':
          newTd.textContent = String(block.tx)
          break
        case 'var-amount':
          newTd.textContent = humanize.threeSigFigs(block.total)
          break
        case 'ska-amount':
          newTd.textContent = skaAmt
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

    this.tableTarget.insertBefore(newRow, this.tableTarget.firstChild)
    const varSubRow = insertVARSubRow(this.tableTarget, newRow, block)
    insertSKASubRows(this.tableTarget, varSubRow, subRows, block.height)
  }
}
