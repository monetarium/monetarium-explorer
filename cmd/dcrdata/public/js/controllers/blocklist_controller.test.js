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

const { default: BlocklistController } = await import('./blocklist_controller.js')

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
// All block rows are expandable (always have VAR sub-row).
function appendBlock(tbody, height) {
  const hasSKA = height % 9 !== 0
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
    blockRow.appendChild(td)
  }
  tbody.appendChild(blockRow)

  // 1 VAR sub-row + (hasSKA ? 3 : 0) SKA sub-rows
  for (let i = 0; i < (hasSKA ? 4 : 1); i++) {
    const tr = document.createElement('tr')
    tr.className = 'ska-sub-row'
    tr.dataset.skaAccordionTarget = 'subRow'
    tr.dataset.blockId = String(height)
    tbody.appendChild(tr)
  }
}

function buildTable(topHeight, blockCount = 1) {
  const tbody = document.createElement('tbody')
  for (let i = 0; i < blockCount; i++) appendBlock(tbody, topHeight - i)
  const ctrl = new BlocklistController(tbody)
  ctrl.tableTarget = tbody
  ctrl.hasTableTarget = true
  return { tbody, ctrl }
}

function makeBlock(
  height,
  tx = 5,
  total = 1234.5,
  size = 12345,
  votes = 5,
  tickets = 3,
  revocations = 0
) {
  const hash = `hash${height}`
  const unixStamp = Math.floor(Date.now() / 1000) - 60
  return {
    block: {
      height,
      hash,
      tx,
      size,
      total,
      votes,
      tickets,
      revocations,
      unixStamp
    }
  }
}

// ---------------------------------------------------------------------------
// Feature: home-block-table-simplified
// Property 8: WebSocket block prepend matches server-rendered output
// Validates: Requirements 12.1–12.7
// ---------------------------------------------------------------------------

describe('blocklist_controller — Property 8: WebSocket block prepend matches server-rendered output', () => {
  // ---- unit: block row structure ------------------------------------------

  describe('block row structure', () => {
    let tbody, ctrl
    beforeEach(() => {
      ;({ tbody, ctrl } = buildTable(1000, 2))
    })

    it('new block row is prepended at the top', () => {
      ctrl._processBlock(makeBlock(1001))
      const rows = tbody.querySelectorAll('tr[data-ska-accordion-target="blockRow"]')
      expect(rows[0].dataset.blockId).toBe('1001')
    })

    it('new block row has exactly 9 cells', () => {
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.querySelectorAll('td').length).toBe(9)
    })

    it('cell data-type order matches the 9-column spec', () => {
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(Array.from(row.querySelectorAll('td')).map((td) => td.dataset.type)).toEqual(
        DATA_TYPES
      )
    })

    it('new block group is entirely before the next block row', () => {
      ctrl._processBlock(makeBlock(1001))
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
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.classList.contains('block-row-expandable')).toBe(true)
      expect(row.dataset.action).toBe('click->ska-accordion#toggle')
    })

    it('block row with no SKA data is still expandable (has VAR sub-row)', () => {
      const { tbody, ctrl } = buildTable(1007, 1)
      ctrl._processBlock(makeBlock(1008)) // 1008 % 9 = 0 — no SKA
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
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
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
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const varRow = row.nextElementSibling
      expect(varRow.classList.contains('ska-sub-row')).toBe(true)
      expect(varRow.dataset.blockId).toBe('1001')
    })

    it('has exactly 9 cells', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.nextElementSibling.querySelectorAll('td').length).toBe(9)
    })

    it('token-label cell contains "VAR"', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      const labelCell = row.nextElementSibling.querySelector('td.text-start')
      expect(labelCell).not.toBeNull()
      expect(labelCell.textContent.trim()).toBe('VAR')
    })

    it('starts collapsed', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      const row = tbody.querySelector(
        'tr[data-block-id="1001"][data-ska-accordion-target="blockRow"]'
      )
      expect(row.nextElementSibling.classList.contains('ska-sub-row--visible')).toBe(false)
    })
  })

  // ---- unit: SKA sub-rows -------------------------------------------------

  describe('SKA sub-rows', () => {
    it('height % 9 !== 0 → 1 VAR + 3 SKA = 4 total sub-rows', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      expect(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
          .length
      ).toBe(4)
    })

    it('height % 9 === 0 → 1 VAR only = 1 total sub-row', () => {
      const { tbody, ctrl } = buildTable(1007, 1)
      ctrl._processBlock(makeBlock(1008))
      expect(
        tbody.querySelectorAll('tr[data-block-id="1008"][data-ska-accordion-target="subRow"]')
          .length
      ).toBe(1)
    })

    it('each SKA sub-row has 10 cells and a token label', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      const subs = Array.from(
        tbody.querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
      ).slice(1) // skip VAR row
      subs.forEach((r) => {
        expect(r.querySelectorAll('td').length).toBe(9)
        const label = r.querySelector('td.text-start')
        expect(label).not.toBeNull()
        expect(label.textContent.trim()).toMatch(/^SKA-\d+$/)
      })
    })

    it('all sub-rows start collapsed', () => {
      const { tbody, ctrl } = buildTable(1000, 1)
      ctrl._processBlock(makeBlock(1001))
      tbody
        .querySelectorAll('tr[data-block-id="1001"][data-ska-accordion-target="subRow"]')
        .forEach((r) => {
          expect(r.classList.contains('ska-sub-row--visible')).toBe(false)
        })
    })
  })

  // ---- property test ------------------------------------------------------

  // Feature: home-block-table-simplified, Property 8: WebSocket block prepend matches server-rendered output
  it('Property 8: for any block height, prepended DOM structure matches server-rendered layout', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 50 }),
        fc.float({
          min: Math.fround(0.01),
          max: Math.fround(1e10),
          noNaN: true
        }),
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        (topHeight, blockCount, tx, total, size, votes, tickets, revocations) => {
          const { tbody, ctrl } = buildTable(topHeight, blockCount)
          const height = topHeight + 1
          const hash = `hash${height}`
          const unixStamp = Math.floor(Date.now() / 1000) - 60
          ctrl._processBlock({
            block: {
              height,
              hash,
              tx,
              size,
              total,
              votes,
              tickets,
              revocations,
              unixStamp
            }
          })

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

          // 3. All rows are expandable (always have at least a VAR sub-row)
          const hasSKA = height % 9 !== 0
          expect(newRow.classList.contains('block-row-expandable')).toBe(true)
          expect(newRow.dataset.action).toBe('click->ska-accordion#toggle')

          // 4. Sub-rows: correct count, 9 cells, collapsed
          const subs = tbody.querySelectorAll(
            `tr[data-block-id="${height}"][data-ska-accordion-target="subRow"]`
          )
          expect(subs.length).toBe(hasSKA ? 4 : 1)
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
