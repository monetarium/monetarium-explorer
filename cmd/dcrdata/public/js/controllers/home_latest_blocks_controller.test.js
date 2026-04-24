import * as fc from 'fast-check'
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

const { default: BlocklistController } = await import('./home_latest_blocks_controller.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 9-column layout matching home_latest_blocks.tmpl
const DATA_TYPES = [
  'height',
  'tx',
  'var-amount',
  'ska-amount',
  'size',
  'votes',
  'tickets',
  'revocations',
  'age'
]

// Build one server-rendered block row (9 cells) + sub-rows and append to tbody.
function appendBlock(tbody, height, skaCoinRows = []) {
  const blockRow = document.createElement('tr')
  blockRow.dataset.skaAccordionTarget = 'blockRow'
  blockRow.dataset.blockId = String(height)
  blockRow.dataset.height = String(height)
  blockRow.dataset.linkClass = 'fs18'
  blockRow.classList.add('block-row-expandable')
  blockRow.dataset.action = 'click->ska-accordion#toggle'
  for (const dt of DATA_TYPES) {
    const td = document.createElement('td')
    td.dataset.type = dt
    if (dt === 'height') td.className = 'text-start ps-1'
    if (dt === 'size') {
      td.className = 'text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell'
    }
    if (dt === 'revocations') {
      td.className = 'text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell'
    }
    blockRow.appendChild(td)
  }
  tbody.appendChild(blockRow)

  // 1 VAR sub-row + N SKA sub-rows
  const subRowCount = 1 + skaCoinRows.length
  for (let i = 0; i < subRowCount; i++) {
    const tr = document.createElement('tr')
    tr.className = 'ska-sub-row'
    tr.dataset.skaAccordionTarget = 'subRow'
    tr.dataset.blockId = String(height)
    tbody.appendChild(tr)
  }
}

function buildTable(topHeight, blockCount = 1, skaCoinRows = []) {
  if (!document.getElementById('home-block-row-template')) {
    const div = document.createElement('div')
    div.innerHTML = `
<template id="home-block-row-template">
  <tr class="block-row-expandable" data-ska-accordion-target="blockRow" data-action="click->ska-accordion#toggle">
    <td class="text-start ps-1" data-type="height"><span class="chevron me-1"></span><a></a></td>
    <td class="text-end num" data-type="tx"></td>
    <td class="text-end num" data-type="var-amount"></td>
    <td class="text-end num" data-type="ska-amount"></td>
    <td class="text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell" data-type="size"></td>
    <td class="text-end num" data-type="votes"></td>
    <td class="text-end num" data-type="tickets"></td>
    <td class="text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell" data-type="revocations"></td>
    <td class="text-end num" data-type="age" data-time-target="age"></td>
  </tr>
</template>
<template id="home-var-sub-row-template">
  <tr class="ska-sub-row" data-ska-accordion-target="subRow">
    <td class="text-end ps-2 ps-sm-4" data-type="sub-label"><span class="coin-label coin-label--var">VAR</span></td>
    <td class="text-end num" data-type="tx"></td>
    <td class="text-end num" data-type="var-amount"></td>
    <td class="text-end">—</td>
    <td class="text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell" data-type="size"></td>
    <td class="text-end">—</td>
    <td class="text-end">—</td>
    <td class="text-end d-none d-sm-table-cell d-md-none d-lg-table-cell">—</td>
    <td class="text-end">—</td>
  </tr>
</template>
<template id="home-ska-sub-row-template">
  <tr class="ska-sub-row" data-ska-accordion-target="subRow">
    <td class="text-end ps-2 ps-sm-4" data-type="sub-label"><span class="coin-label coin-label--ska"></span></td>
    <td class="text-end num" data-type="tx"></td>
    <td class="text-end">—</td>
    <td class="text-end num" data-type="ska-amount"></td>
    <td class="text-end num d-none d-sm-table-cell d-md-none d-lg-table-cell" data-type="size"></td>
    <td class="text-end">—</td>
    <td class="text-end">—</td>
    <td class="text-end d-none d-sm-table-cell d-md-none d-lg-table-cell">—</td>
    <td class="text-end">—</td>
  </tr>
</template>
    `
    document.body.appendChild(div)
  }

  const tbody = document.createElement('tbody')
  for (let i = 0; i < blockCount; i++) appendBlock(tbody, topHeight - i, skaCoinRows)
  const ctrl = new BlocklistController(tbody)
  ctrl.tableTarget = tbody
  ctrl.hasTableTarget = true
  return { tbody, ctrl }
}

// Build a block payload with optional coin_rows.
// skaCoinRows is an array of { coin_type, symbol, tx_count, amount, size }.
function makeBlock(
  height,
  {
    tx = 5,
    total = 1234.5,
    size = 12345,
    votes = 5,
    tickets = 3,
    revocations = 0,
    skaCoinRows = []
  } = {}
) {
  const coinRows =
    skaCoinRows.length > 0
      ? [
          { coin_type: 0, symbol: 'VAR', tx_count: tx, amount: '1.23K VAR', size: size },
          ...skaCoinRows
        ]
      : []
  const hash = `hash${height}`
  const unixStamp = Math.floor(Date.now() / 1000) - 60
  return {
    block: {
      height: height,
      hash: hash,
      tx: tx,
      size: size,
      total: total,
      votes: votes,
      tickets: tickets,
      revocations: revocations,
      unixStamp: unixStamp,
      coin_rows: coinRows
    }
  }
}

const SKA_ROWS_3 = [
  { coin_type: 1, symbol: 'SKA1', tx_count: 42, amount: '1.25M SKA1', size: 8400 },
  { coin_type: 2, symbol: 'SKA2', tx_count: 17, amount: '450K SKA2', size: 3200 },
  { coin_type: 3, symbol: 'SKA3', tx_count: 5, amount: '2.1B SKA3', size: 1100 }
]

// ---------------------------------------------------------------------------
// Feature: home-block-table-simplified
// Property 8: WebSocket block prepend matches server-rendered output
// ---------------------------------------------------------------------------

describe('blocklist_controller — Property 8: WebSocket block prepend matches server-rendered output', () => {
  // ---- unit: Txn cell uses sum of coin_rows tx_counts --------------------

  describe('Txn cell (tx column)', () => {
    it('uses sum of all coin_rows tx_counts, not block.tx', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      // block.tx = 5 (regular-tree only), but coin_rows sum = 5 + 42 + 17 + 5 = 69
      ctrl._processBlock(makeBlock(1001, { tx: 5, skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const txCell = Array.from(row.querySelectorAll('td')).find((td) => td.dataset.type === 'tx')
      expect(txCell.textContent).toBe('61')
    })

    it('falls back to block.tx when no coin_rows', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001, { tx: 7 })) // no skaCoinRows → no coin_rows
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const txCell = Array.from(row.querySelectorAll('td')).find((td) => td.dataset.type === 'tx')
      expect(txCell.textContent).toBe('7')
    })
  })

  // ---- unit: block row structure ------------------------------------------

  describe('block row structure', () => {
    let tbody, ctrl
    beforeEach(() => {
      ;({ tbody, ctrl } = buildTable(1000, 2, SKA_ROWS_3))
    })

    it('new block row is prepended at the top', () => {
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const rows = tbody.querySelectorAll('tr[data-ska-accordion-target="blockRow"]')
      expect(rows[0].dataset.blockId).toBe('1001')
    })

    it('new block row has exactly 9 cells', () => {
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.querySelectorAll('td').length).toBe(9)
    })

    it('cell data-type order matches the 9-column spec', () => {
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(Array.from(row.querySelectorAll('td')).map((td) => td.dataset.type)).toEqual(
        DATA_TYPES
      )
    })

    it('new block group is entirely before the next block row', () => {
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const all = Array.from(tbody.children)
      const newIdx = all.findIndex(
        (r) => r.dataset.blockId === '1001' && r.dataset.skaAccordionTarget === 'blockRow'
      )
      const nextIdx = all.findIndex(
        (r) => r.dataset.blockId === '1000' && r.dataset.skaAccordionTarget === 'blockRow'
      )
      expect(newIdx).toBeLessThan(nextIdx)
      for (let i = newIdx + 1; i < nextIdx; i++) {
        expect(all[i].dataset.blockId).toBe('1001')
      }
    })
  })

  // ---- unit: row-level expandability --------------------------------------

  describe('row-level expandability', () => {
    it('all block rows have block-row-expandable class and data-action', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.classList.contains('block-row-expandable')).toBe(true)
      expect(row.dataset.action).toBe('click->ska-accordion#toggle')
    })

    it('block row with no SKA data is still expandable (has VAR sub-row)', () => {
      const { tbody, ctrl } = buildTable(1007, 1)
      ctrl._processBlock(makeBlock(1008)) // no coin_rows → VAR-only
      const row = tbody.querySelector(
        'tr[data-block-id="1008"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.classList.contains('block-row-expandable')).toBe(true)
      expect(row.dataset.action).toBe('click->ska-accordion#toggle')
      const subs = tbody.querySelectorAll(
        'tr[data-block-id="1008"][data-ska-accordion-target="subRow"]'
      )
      expect(subs.length).toBe(1)
    })

    it('SKA cell has no ska-clickable class or button (interactivity on row)', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const skaCell = Array.from(row.querySelectorAll('td')).find(
        (td) => td.dataset.type === 'ska-amount'
      )
      expect(skaCell.classList.contains('ska-clickable')).toBe(false)
      expect(skaCell.querySelector('button')).toBeNull()
    })
  })

  // ---- unit: VAR sub-row --------------------------------------------------

  describe('VAR sub-row', () => {
    it('is inserted immediately after the block row', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const varRow = row.nextElementSibling
      expect(varRow.classList.contains('ska-sub-row')).toBe(true)
      expect(varRow.dataset.blockId).toBe('1001')
    })

    it('has exactly 9 cells', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.nextElementSibling.querySelectorAll('td').length).toBe(9)
    })

    it('token-label cell contains "VAR"', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const labelCell = row.nextElementSibling.querySelector('td.text-end')
      expect(labelCell).not.toBeNull()
      expect(labelCell.textContent.trim()).toBe('VAR')
    })

    it('starts collapsed', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.nextElementSibling.classList.contains('ska-sub-row--visible')).toBe(false)
    })
  })

  // ---- unit: SKA sub-rows -------------------------------------------------

  describe('SKA sub-rows', () => {
    it('coin_rows with 3 SKA types → 1 VAR + 3 SKA = 4 total sub-rows', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      expect(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
          .length
      ).toBe(4)
    })

    it('no coin_rows → 1 VAR only = 1 total sub-row', () => {
      const { tbody, ctrl } = buildTable(1007, 1)
      ctrl._processBlock(makeBlock(1008)) // no coin_rows
      expect(
        tbody.querySelectorAll('tr[data-block-id="1008"][data-ska-accordion-target="subRow"]')
          .length
      ).toBe(1)
    })

    it('each SKA sub-row has 9 cells and a token label', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const subs = Array.from(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
      ).slice(1) // skip VAR row
      subs.forEach((r) => {
        expect(r.querySelectorAll('td').length).toBe(9)
        const label = r.querySelector('td.text-end')
        expect(label).not.toBeNull()
        expect(label.textContent.trim()).toMatch(/^SKA\d+$/)
      })
    })

    it('all sub-rows start collapsed', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      tbody
        .querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
        .forEach((r) => {
          expect(r.classList.contains('ska-sub-row--visible')).toBe(false)
        })
    })
  })

  // ---- property test ------------------------------------------------------

  it('Property 8: for any block, prepended DOM structure matches server-rendered layout', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 50 }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(1e10), noNaN: true }),
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 3 }
        ),
        (topHeight, blockCount, tx, total, size, votes, tickets, revocations, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, blockCount, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(
            makeBlock(height, { tx, total, size, votes, tickets, revocations, skaCoinRows })
          )

          const hasSKA = skaCoinRows.length > 0

          // 1. One block row at the top
          const newRows = tbody.querySelectorAll(
            `tr[data-block-id="${height}"][data-ska-accordion-target="blockRow"]`
          )
          expect(newRows.length).toBe(1)
          const newRow = newRows[0]
          expect(tbody.firstElementChild).toBe(newRow)

          // 2. 9 cells in correct order
          const cells = newRow.querySelectorAll('td')
          expect(cells.length).toBe(9)
          expect(Array.from(cells).map((td) => td.dataset.type)).toEqual(DATA_TYPES)

          // 3. Row is always expandable
          expect(newRow.classList.contains('block-row-expandable')).toBe(true)
          expect(newRow.dataset.action).toBe('click->ska-accordion#toggle')

          // 4. Sub-rows: 1 VAR + N SKA, all 9 cells, all collapsed
          const subs = tbody.querySelectorAll(
            `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
          )
          expect(subs.length).toBe(1 + (hasSKA ? skaCoinRows.length : 0))
          subs.forEach((r) => {
            expect(r.classList.contains('ska-sub-row')).toBe(true)
            expect(r.dataset.blockId).toBe(String(height))
            expect(r.classList.contains('ska-sub-row--visible')).toBe(false)
            expect(r.querySelectorAll('td').length).toBe(9)
          })

          // 5. New block group is contiguous before the next block row
          const all = Array.from(tbody.children)
          const newIdx = all.indexOf(newRow)
          const nextBlock = tbody.querySelector(
            `tr[data-block-id="${topHeight}"][data-ska-accordion-target="blockRow"]`
          )
          if (nextBlock) {
            const nextIdx = all.indexOf(nextBlock)
            expect(newIdx).toBeLessThan(nextIdx)
            for (let i = newIdx + 1; i < nextIdx; i++) {
              expect(all[i].dataset.blockId).toBe(String(height))
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Feature: home-block-table-hierarchy
// Task 7.1 — Unit tests for badge/anchor structural output
// ---------------------------------------------------------------------------

describe('blocklist_controller — home-block-table-hierarchy badge & anchor unit tests', () => {
  describe('VAR sub-row badge structure', () => {
    it('label cell has class text-end', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const blockRow = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const varRow = blockRow.nextElementSibling
      const labelCell = varRow.querySelector('td[data-type="sub-label"]')
      expect(labelCell).not.toBeNull()
      expect(labelCell.classList.contains('text-end')).toBe(true)
    })

    it('label cell contains a span with coin-label, coin-label--var classes', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const blockRow = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const varRow = blockRow.nextElementSibling
      const badge = varRow.querySelector(
        'td[data-type="sub-label"] span.coin-label.coin-label--var'
      )
      expect(badge).not.toBeNull()
      expect(badge.textContent).toBe('VAR')
    })

    it('VAR sub-row has exactly 9 td elements', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const blockRow = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(blockRow.nextElementSibling.querySelectorAll('td').length).toBe(9)
    })

    it('VAR sub-row col-5 and col-8 have responsive classes', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const blockRow = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const cells = Array.from(blockRow.nextElementSibling.querySelectorAll('td'))
      const responsiveClasses = ['d-none', 'd-sm-table-cell', 'd-md-none', 'd-lg-table-cell']
      responsiveClasses.forEach((cls) => {
        expect(cells[4].classList.contains(cls)).toBe(true) // col 5
        expect(cells[7].classList.contains(cls)).toBe(true) // col 8
      })
    })
  })

  describe('SKA sub-row badge structure', () => {
    it('each SKA label cell has class text-end', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const subs = Array.from(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
      ).slice(1) // skip VAR row
      subs.forEach((r) => {
        const labelCell = r.querySelector('td[data-type="sub-label"]')
        expect(labelCell).not.toBeNull()
        expect(labelCell.classList.contains('text-end')).toBe(true)
      })
    })

    it('each SKA label cell contains a span with coin-label and coin-label--ska classes', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const subs = Array.from(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
      ).slice(1)
      subs.forEach((r) => {
        const badge = r.querySelector('td[data-type="sub-label"] span.coin-label.coin-label--ska')
        expect(badge).not.toBeNull()
      })
    })

    it('each SKA sub-row has exactly 9 td elements', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const subs = Array.from(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
      ).slice(1)
      subs.forEach((r) => expect(r.querySelectorAll('td').length).toBe(9))
    })

    it('each SKA sub-row col-5 and col-8 have responsive classes', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const subs = Array.from(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
      ).slice(1)
      const responsiveClasses = ['d-none', 'd-sm-table-cell', 'd-md-none', 'd-lg-table-cell']
      subs.forEach((r) => {
        const cells = Array.from(r.querySelectorAll('td'))
        responsiveClasses.forEach((cls) => {
          expect(cells[4].classList.contains(cls)).toBe(true)
          expect(cells[7].classList.contains(cls)).toBe(true)
        })
      })
    })
  })

  describe('parent row chevron structure', () => {
    it('height cell contains a chevron span before the height link', () => {
      const { tbody, ctrl } = buildTable(1000, 1, SKA_ROWS_3)
      ctrl._processBlock(makeBlock(1001, { skaCoinRows: SKA_ROWS_3 }))
      const blockRow = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const heightCell = Array.from(blockRow.querySelectorAll('td')).find(
        (td) => td.dataset.type === 'height'
      )
      const chevron = heightCell.querySelector('span.chevron')
      expect(chevron).not.toBeNull()
      expect(chevron.nextElementSibling.tagName).toBe('A')
    })
  })
})

// ---------------------------------------------------------------------------
// Feature: home-block-table-hierarchy — Property-based tests
// ---------------------------------------------------------------------------

describe('blocklist_controller — home-block-table-hierarchy property tests', () => {
  // Feature: home-block-table-hierarchy, Property 4: Injected rows are structurally complete
  it('Property 4: injected rows are structurally complete', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA255'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA255'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const blockRow = tbody.querySelector(
            `tr[data-block-id="${height}"][data-ska-accordion-target="blockRow"]`
          )
          // chevron in parent row
          const heightCell = Array.from(blockRow.querySelectorAll('td')).find(
            (td) => td.dataset.type === 'height'
          )
          expect(heightCell.querySelector('span.chevron')).not.toBeNull()

          const varRow = blockRow.nextElementSibling
          expect(varRow.querySelector('span.coin-label.coin-label--var')).not.toBeNull()

          const allSubs = Array.from(
            tbody.querySelectorAll(
              `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
            )
          ).slice(1)
          allSubs.forEach((r) => {
            expect(r.querySelector('span.coin-label.coin-label--ska')).not.toBeNull()
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 7: Column count invariant
  it('Property 7: column count invariant — every injected row has exactly 9 td elements', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const allRows = tbody.querySelectorAll(`tr[data-block-id="${height}"]`)
          allRows.forEach((r) => {
            expect(r.querySelectorAll('td').length).toBe(9)
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 8: VAR sub-rows use badge-var
  it('Property 8: VAR sub-rows use badge-var', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const blockRow = tbody.querySelector(
            `tr[data-block-id="${height}"][data-ska-accordion-target="blockRow"]`
          )
          const varRow = blockRow.nextElementSibling
          expect(varRow.querySelector('span.coin-label.coin-label--var')).not.toBeNull()
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 9: All SKA sub-rows use badge-ska regardless of token index
  it('Property 9: all SKA sub-rows use badge-ska regardless of token index', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 255 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA255'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA255'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const allSubs = Array.from(
            tbody.querySelectorAll(
              `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
            )
          ).slice(1) // skip VAR
          expect(allSubs.length).toBe(skaCoinRows.length)
          allSubs.forEach((r) => {
            expect(r.querySelector('span.coin-label.coin-label--ska')).not.toBeNull()
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 1: Chevron presence in all parent rows
  it('Property 1: chevron presence in all injected parent rows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const blockRow = tbody.querySelector(
            `tr[data-block-id="${height}"][data-ska-accordion-target="blockRow"]`
          )
          const heightCell = Array.from(blockRow.querySelectorAll('td')).find(
            (td) => td.dataset.type === 'height'
          )
          expect(heightCell.querySelector('span.chevron')).not.toBeNull()
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 3: Chevron precedes height link in DOM
  it('Property 3: chevron precedes height link in DOM', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), (topHeight) => {
        const { tbody, ctrl } = buildTable(topHeight, 1)
        const height = topHeight + 1
        ctrl._processBlock(makeBlock(height))

        const blockRow = tbody.querySelector(
          `tr[data-block-id="${height}"][data-ska-accordion-target="blockRow"]`
        )
        const heightCell = Array.from(blockRow.querySelectorAll('td')).find(
          (td) => td.dataset.type === 'height'
        )
        const chevron = heightCell.querySelector('span.chevron')
        expect(chevron).not.toBeNull()
        expect(chevron.nextElementSibling.tagName).toBe('A')
      }),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 5: Sub-row first cell carries anchor class
  it('Property 5: sub-row first cell carries data-type="sub-label"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const allSubs = tbody.querySelectorAll(
            `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
          )
          allSubs.forEach((r) => {
            const firstCell = r.querySelector('td')
            expect(firstCell.dataset.type).toBe('sub-label')
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 6: Sub-row first cell is right-aligned
  it('Property 6: sub-row first cell is left-aligned (text-end)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const allSubs = tbody.querySelectorAll(
            `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
          )
          allSubs.forEach((r) => {
            const firstCell = r.querySelector('td')
            expect(firstCell.classList.contains('text-end')).toBe(true)
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 10: All sub-rows carry subordination class
  it('Property 10: all sub-rows carry ska-sub-row class', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const allSubs = tbody.querySelectorAll(
            `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
          )
          allSubs.forEach((r) => {
            expect(r.classList.contains('ska-sub-row')).toBe(true)
          })
        }
      ),
      { numRuns: 100 }
    )
  })

  // Feature: home-block-table-hierarchy, Property 11: Responsive classes preserved on size and rev cells
  it('Property 11: responsive classes preserved on col-5 and col-8 in all injected rows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.array(
          fc.record({
            coin_type: fc.integer({ min: 1, max: 10 }),
            symbol: fc.constantFrom('SKA1', 'SKA2', 'SKA3'),
            tx_count: fc.integer({ min: 0, max: 100 }),
            amount: fc.constantFrom('1M SKA1', '500K SKA2', '2B SKA3'),
            size: fc.integer({ min: 100, max: 10000 })
          }),
          { minLength: 0, maxLength: 5 }
        ),
        (topHeight, skaCoinRows) => {
          const { tbody, ctrl } = buildTable(topHeight, 1, skaCoinRows)
          const height = topHeight + 1
          ctrl._processBlock(makeBlock(height, { skaCoinRows }))

          const responsiveClasses = ['d-none', 'd-sm-table-cell', 'd-md-none', 'd-lg-table-cell']
          const allRows = tbody.querySelectorAll(`tr[data-block-id="${height}"]`)
          allRows.forEach((r) => {
            const cells = Array.from(r.querySelectorAll('td'))
            responsiveClasses.forEach((cls) => {
              expect(cells[4].classList.contains(cls)).toBe(true) // col 5 (size)
              expect(cells[7].classList.contains(cls)).toBe(true) // col 8 (rev)
            })
          })
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ---------------------------------------------------------------------------
// Feature: size-cell formatting — JS must match Go SSR (go-humanize output)
// ---------------------------------------------------------------------------

describe('blocklist_controller — size cell formatting', () => {
  // Helper: get the size cell text from a freshly injected row.
  function getSizeCell(row) {
    return Array.from(row.querySelectorAll('td')).find((td) => td.dataset.type === 'size')
      .textContent
  }

  // Helper: get the size cell from a sub-row by index (0 = VAR, 1+ = SKA).
  function getSubRowSizeCell(tbody, height, subRowIndex) {
    const subs = Array.from(
      tbody.querySelectorAll(`tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`)
    )
    return subs[subRowIndex].querySelector('td[data-type="size"]').textContent
  }

  // ---- parent block row: uses block.size via humanize.bytes ---------------

  it('parent row: 4000-byte block renders "4.0 kB" (trailing zero preserved)', () => {
    const { tbody, ctrl } = buildTable(1000, 1)
    ctrl._processBlock(makeBlock(1001, { size: 4000 }))
    const row = tbody.querySelector(
      'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
    )
    expect(getSizeCell(row)).toBe('4.0 kB')
  })

  it('parent row: 6570-byte block renders "6.6 kB"', () => {
    const { tbody, ctrl } = buildTable(1000, 1)
    ctrl._processBlock(makeBlock(1001, { size: 6570 }))
    const row = tbody.querySelector(
      'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
    )
    expect(getSizeCell(row)).toBe('6.6 kB')
  })

  it('parent row: 10000-byte block renders "10 kB" (no decimal when val >= 10)', () => {
    const { tbody, ctrl } = buildTable(1000, 1)
    ctrl._processBlock(makeBlock(1001, { size: 10000 }))
    const row = tbody.querySelector(
      'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
    )
    expect(getSizeCell(row)).toBe('10 kB')
  })

  it('parent row: 0-byte block renders "0 B"', () => {
    const { tbody, ctrl } = buildTable(1000, 1)
    ctrl._processBlock(makeBlock(1001, { size: 0 }))
    const row = tbody.querySelector(
      'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
    )
    expect(getSizeCell(row)).toBe('0 B')
  })

  // ---- VAR sub-row: uses cr.size from coin_rows[0] ------------------------

  it('VAR sub-row: 4000-byte cr.size renders "4.0 kB"', () => {
    const skaCoinRows = [
      { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 512 }
    ]
    const { tbody, ctrl } = buildTable(1000, 1, skaCoinRows)
    // Override VAR coin_row size by constructing the block manually
    const block = makeBlock(1001, { size: 9000, skaCoinRows: skaCoinRows })
    block.block.coin_rows[0].size = 4000
    ctrl._processBlock(block)
    expect(getSubRowSizeCell(tbody, 1001, 0)).toBe('4.0 kB')
  })

  it('VAR sub-row: 0-byte cr.size renders "0 B" (not dash)', () => {
    const skaCoinRows = [
      { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 512 }
    ]
    const { tbody, ctrl } = buildTable(1000, 1, skaCoinRows)
    const block = makeBlock(1001, { size: 9000, skaCoinRows: skaCoinRows })
    block.block.coin_rows[0].size = 0
    ctrl._processBlock(block)
    expect(getSubRowSizeCell(tbody, 1001, 0)).toBe('0 B')
  })

  // ---- SKA sub-rows: uses cr.size from each SKA coin_row ------------------

  it('SKA sub-row: 2930-byte cr.size renders "2.9 kB"', () => {
    const skaCoinRows = [
      { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 2930 }
    ]
    const { tbody, ctrl } = buildTable(1000, 1, skaCoinRows)
    ctrl._processBlock(makeBlock(1001, { size: 9000, skaCoinRows: skaCoinRows }))
    expect(getSubRowSizeCell(tbody, 1001, 1)).toBe('2.9 kB')
  })

  it('SKA sub-row: 0-byte cr.size renders "0 B" (not dash)', () => {
    const skaCoinRows = [
      { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 0 }
    ]
    const { tbody, ctrl } = buildTable(1000, 1, skaCoinRows)
    ctrl._processBlock(makeBlock(1001, { size: 9000, skaCoinRows: skaCoinRows }))
    expect(getSubRowSizeCell(tbody, 1001, 1)).toBe('0 B')
  })

  it('SKA sub-row: 4000-byte cr.size renders "4.0 kB" (trailing zero preserved)', () => {
    const skaCoinRows = [
      { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 4000 }
    ]
    const { tbody, ctrl } = buildTable(1000, 1, skaCoinRows)
    ctrl._processBlock(makeBlock(1001, { size: 9000, skaCoinRows: skaCoinRows }))
    expect(getSubRowSizeCell(tbody, 1001, 1)).toBe('4.0 kB')
  })

  it('multiple SKA sub-rows each render their own size independently', () => {
    const skaCoinRows = [
      { coin_type: 1, symbol: 'SKA1', tx_count: 2, amount: '1000000000000000000', size: 4000 },
      { coin_type: 2, symbol: 'SKA2', tx_count: 1, amount: '2000000000000000000', size: 10000 }
    ]
    const { tbody, ctrl } = buildTable(1000, 1, skaCoinRows)
    ctrl._processBlock(makeBlock(1001, { size: 9000, skaCoinRows: skaCoinRows }))
    expect(getSubRowSizeCell(tbody, 1001, 1)).toBe('4.0 kB')
    expect(getSubRowSizeCell(tbody, 1001, 2)).toBe('10 kB')
  })
})
