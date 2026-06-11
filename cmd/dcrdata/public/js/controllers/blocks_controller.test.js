import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

vi.mock('../services/event_bus_service', () => ({
  default: { on: vi.fn(), off: vi.fn() }
}))

vi.mock('../services/messagesocket_service', () => ({
  default: {
    send: vi.fn(),
    registerEvtHandler: vi.fn(() => () => {}),
    deregisterEvtHandler: vi.fn(),
    deregisterEvtHandlers: vi.fn()
  }
}))

const { default: BlocksController } = await import('./blocks_controller.js')
const { default: ws } = await import('../services/messagesocket_service')

// 11-column layout matching blocks.tmpl
const DATA_TYPES = [
  'height',
  'tx',
  'var-amount',
  'ska-amount',
  'size',
  'votes',
  'tickets',
  'revocations',
  'version',
  'age',
  'time'
]

function appendBlock(tbody, height, skaCoinRows = []) {
  const blockRow = document.createElement('tr')
  blockRow.dataset.coinAccordionTarget = 'blockRow'
  blockRow.dataset.blockId = String(height)
  blockRow.dataset.height = String(height)
  blockRow.classList.add('block-row-expandable')
  blockRow.dataset.action = 'click->coin-accordion#toggle'
  for (const dt of DATA_TYPES) {
    const td = document.createElement('td')
    td.dataset.type = dt
    blockRow.appendChild(td)
  }
  tbody.appendChild(blockRow)
  const subRowCount = 1 + skaCoinRows.length
  for (let i = 0; i < subRowCount; i++) {
    const tr = document.createElement('tr')
    tr.className = 'coin-sub-row'
    tr.dataset.coinAccordionTarget = 'subRow'
    tr.dataset.blockId = String(height)
    tbody.appendChild(tr)
  }
}

function ensureTemplates() {
  if (document.getElementById('blocks-block-row-template')) return
  const div = document.createElement('div')
  div.innerHTML = `
<template id="blocks-block-row-template">
  <tr class="block-row-expandable" data-coin-accordion-target="blockRow" data-block-id="" data-action="click->coin-accordion#toggle">
    <td data-type="height" class="text-start ps-0"><span class="chevron me-1"></span><a></a></td>
    <td class="text-center" data-type="tx"></td>
    <td class="text-center" data-type="var-amount"></td>
    <td class="text-center" data-type="ska-amount"></td>
    <td class="text-center d-none d-sm-table-cell" data-type="size"></td>
    <td class="text-center d-none d-sm-table-cell" data-type="votes"></td>
    <td class="text-center d-none d-sm-table-cell" data-type="tickets"></td>
    <td class="text-center d-none d-sm-table-cell" data-type="revocations"></td>
    <td class="text-center d-none d-sm-table-cell" data-type="version"></td>
    <td class="text-end px-0" data-type="age" data-time-target="age"></td>
    <td class="text-end px-0" data-type="time"></td>
  </tr>
</template>
<template id="blocks-var-sub-row-template">
  <tr class="coin-sub-row" data-coin-accordion-target="subRow" data-block-id="">
    <td class="text-end ps-2 ps-sm-4" data-type="sub-label"><span class="coin-label coin-label--var">VAR</span></td>
    <td class="text-center" data-type="tx"></td>
    <td class="text-center" data-type="var-amount"></td>
    <td class="text-center">—</td>
    <td class="text-center d-none d-sm-table-cell" data-type="size"></td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-end px-0">—</td>
    <td class="text-end px-0">—</td>
  </tr>
</template>
<template id="blocks-ska-sub-row-template">
  <tr class="coin-sub-row" data-coin-accordion-target="subRow" data-block-id="">
    <td class="text-end ps-2 ps-sm-4" data-type="sub-label"><span class="coin-label coin-label--ska"></span></td>
    <td class="text-center" data-type="tx"></td>
    <td class="text-center">—</td>
    <td class="text-center" data-type="ska-amount"></td>
    <td class="text-center d-none d-sm-table-cell" data-type="size"></td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-center d-none d-sm-table-cell">—</td>
    <td class="text-end px-0">—</td>
    <td class="text-end px-0">—</td>
  </tr>
</template>`
  document.body.appendChild(div)
}

// buildTable wires a controller over a tbody of blockCount rows topped at
// topHeight. isLatest/rows mimic the Stimulus values the server renders.
function buildTable(
  topHeight,
  blockCount = 3,
  { isLatest = true, rows = 20, skaCoinRows = [] } = {}
) {
  ensureTemplates()
  const tbody = document.createElement('tbody')
  for (let i = 0; i < blockCount; i++) appendBlock(tbody, topHeight - i, skaCoinRows)
  const ctrl = new BlocksController(tbody)
  ctrl.tableTarget = tbody
  ctrl.hasTableTarget = true
  ctrl.isLatestValue = isLatest
  ctrl.rowsValue = rows
  return { tbody, ctrl }
}

function makeBlock(height, { skaCoinRows = [] } = {}) {
  const coinRows =
    skaCoinRows.length > 0
      ? [
          { coin_type: 0, symbol: 'VAR', tx_count: 5, amount: '1.23K VAR', size: 12345 },
          ...skaCoinRows
        ]
      : []
  return {
    block: {
      height: height,
      hash: `hash${height}`,
      tx: 5,
      size: 12345,
      total: 1234.5,
      votes: 5,
      tickets: 3,
      revocations: 0,
      version: 9,
      time: '2026-06-10T20:00:00Z',
      unixStamp: Math.floor(Date.now() / 1000) - 60,
      coin_rows: coinRows
    }
  }
}

function serverBlock(height, skaCoinRows = []) {
  const coinRows =
    skaCoinRows.length > 0
      ? [
          { coin_type: 0, symbol: 'VAR', tx_count: 5, amount: '1.23K VAR', size: 12345 },
          ...skaCoinRows
        ]
      : []
  return {
    height: height,
    hash: `hash${height}`,
    tx: 5,
    size: 12345,
    total: 1234.5,
    votes: 5,
    tickets: 3,
    revocations: 0,
    version: 9,
    time: '2026-06-10T20:00:00Z',
    coin_rows: coinRows
  }
}

const SKA_ROWS_2 = [
  { coin_type: 1, symbol: 'SKA1', tx_count: 42, amount: '1.25M SKA1', size: 8400 },
  { coin_type: 2, symbol: 'SKA2', tx_count: 17, amount: '450K SKA2', size: 3200 }
]

const tipId = (tbody) =>
  tbody.querySelector('tr[data-coin-accordion-target="blockRow"]').dataset.blockId
const blockRowCount = (tbody) =>
  tbody.querySelectorAll('tr[data-coin-accordion-target="blockRow"]').length

describe('blocks_controller — pagination-aware live updates', () => {
  beforeEach(() => {
    ws.send.mockClear()
    ws.registerEvtHandler.mockClear()
    ws.registerEvtHandler.mockImplementation(() => () => {})
  })

  // ---- gate: only the latest page live-updates ---------------------------

  it('does nothing on a historical (non-latest) page', () => {
    const { tbody, ctrl } = buildTable(1000, 3, { isLatest: false })
    ctrl._processBlock(makeBlock(1001))
    expect(tipId(tbody)).toBe('1000') // unchanged
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('connect wires refresh handlers only on the latest page', () => {
    const latest = buildTable(1000, 1, { isLatest: true })
    latest.ctrl.connect()
    let events = ws.registerEvtHandler.mock.calls.map((c) => c[0])
    expect(events).toContain('reconnect')
    expect(events).toContain('getlatestblocksResp')

    ws.registerEvtHandler.mockClear()
    const historical = buildTable(900, 1, { isLatest: false })
    historical.ctrl.connect()
    events = ws.registerEvtHandler.mock.calls.map((c) => c[0])
    expect(events).not.toContain('reconnect')
    expect(events).not.toContain('getlatestblocksResp')
  })

  // ---- gap resilience on the latest page ---------------------------------

  it('advances on a normal consecutive block', () => {
    const { tbody, ctrl } = buildTable(1000, 3)
    ctrl._processBlock(makeBlock(1001))
    expect(tipId(tbody)).toBe('1001')
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('advances across a height gap instead of wedging', () => {
    const { tbody, ctrl } = buildTable(1000, 3)
    ctrl._processBlock(makeBlock(1002)) // skips 1001
    expect(tipId(tbody)).toBe('1002')
  })

  it('keeps updating after a gap (does not wedge permanently)', () => {
    const { tbody, ctrl } = buildTable(1000, 3)
    ctrl._processBlock(makeBlock(1002))
    ctrl._processBlock(makeBlock(1003))
    expect(tipId(tbody)).toBe('1003')
  })

  it('requests a refresh with the page row count on a gap', () => {
    const { ctrl } = buildTable(1000, 3, { rows: 50 })
    ctrl._processBlock(makeBlock(1002))
    expect(ws.send).toHaveBeenCalledWith('getlatestblocks', '50')
  })

  // ---- refresh rebuild ----------------------------------------------------

  it('_refreshList rebuilds the table from the server list (11 cells/row)', () => {
    const { tbody, ctrl } = buildTable(1000, 3, { skaCoinRows: SKA_ROWS_2 })
    const serverBlocks = [1005, 1004, 1003].map((h) => serverBlock(h))
    ctrl._refreshList(JSON.stringify(serverBlocks))

    const rows = tbody.querySelectorAll('tr[data-coin-accordion-target="blockRow"]')
    expect(Array.from(rows).map((r) => r.dataset.blockId)).toEqual(['1005', '1004', '1003'])
    rows.forEach((r) => expect(r.querySelectorAll('td').length).toBe(11))
  })

  it('_refreshList rebuilds each block with its VAR + SKA sub-rows', () => {
    const { tbody, ctrl } = buildTable(1000, 3, { skaCoinRows: SKA_ROWS_2 })
    const serverBlocks = [1005, 1004, 1003].map((h) => serverBlock(h, SKA_ROWS_2))
    ctrl._refreshList(JSON.stringify(serverBlocks))

    const rows = tbody.querySelectorAll('tr[data-coin-accordion-target="blockRow"]')
    expect(Array.from(rows).map((r) => r.dataset.blockId)).toEqual(['1005', '1004', '1003'])
    // each rebuilt group carries 1 VAR + N SKA sub-rows (the VAR-only test above
    // never exercises SKA sub-row insertion on the rebuild path)
    expect(
      tbody.querySelectorAll('tr[data-block-id="1005"][data-coin-accordion-target="subRow"]').length
    ).toBe(1 + SKA_ROWS_2.length)
  })

  it('_refreshList does NOT regress the table when the refresh is older than the current tip', () => {
    // A live block already advanced the DOM tip to 1005; a getlatestblocks
    // response computed at an older server tip (1003) must be dropped.
    const { tbody, ctrl } = buildTable(1005, 3)
    const staleList = [1003, 1002, 1001].map((h) => serverBlock(h))
    ctrl._refreshList(JSON.stringify(staleList))
    expect(tipId(tbody)).toBe('1005') // unchanged
  })

  it('_refreshList skips zero-value placeholder blocks (no hash)', () => {
    const { tbody, ctrl } = buildTable(1000, 3)
    const list = [
      serverBlock(1005),
      { height: 0, time: '0001-01-01T00:00:00Z', coin_rows: [] }, // placeholder: no hash
      serverBlock(1003)
    ]
    ctrl._refreshList(JSON.stringify(list))
    const ids = Array.from(tbody.querySelectorAll('tr[data-coin-accordion-target="blockRow"]')).map(
      (r) => r.dataset.blockId
    )
    expect(ids).toEqual(['1005', '1003']) // placeholder dropped
  })

  it('_refreshList ignores empty or unparseable payloads', () => {
    const { tbody, ctrl } = buildTable(1000, 3)
    const before = blockRowCount(tbody)
    ctrl._refreshList('not json')
    ctrl._refreshList(JSON.stringify([]))
    expect(blockRowCount(tbody)).toBe(before)
  })

  it('disconnect tears down the refresh handlers wired on the latest page', () => {
    const unsub = vi.fn()
    ws.registerEvtHandler.mockReturnValue(unsub)
    const { ctrl } = buildTable(1000, 1, { isLatest: true })
    ctrl.connect()
    ctrl.disconnect()
    expect(unsub).toHaveBeenCalledTimes(2) // getlatestblocksResp + reconnect
  })
})
