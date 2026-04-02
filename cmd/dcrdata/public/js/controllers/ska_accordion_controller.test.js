import * as fc from 'fast-check'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Minimal Stimulus-free harness
// We instantiate the controller class directly, binding it to a real jsdom
// element so we can test toggle() without the full Stimulus runtime.
// ---------------------------------------------------------------------------

// Stub the @hotwired/stimulus import so the controller module loads in jsdom.
vi.mock('@hotwired/stimulus', () => ({
  Controller: class {
    constructor(element) {
      this.element = element
    }
  }
}))

const { default: SkaAccordionController } = await import('./ska_accordion_controller.js')

/**
 * Build a minimal DOM fragment for one block and attach a controller instance.
 *
 * @param {string|number} blockId
 * @param {number} subRowCount  number of sub-rows to create (0 = no SKA data)
 * @returns {{ tbody, blockRow, subRows, ctrl }}
 */
function buildDOM(blockId, subRowCount) {
  const tbody = document.createElement('tbody')

  // Block row — the whole row is the click target (data-action on the tr).
  const blockRow = document.createElement('tr')
  blockRow.dataset.blockId = String(blockId)
  blockRow.dataset.skaAccordionTarget = 'blockRow'
  tbody.appendChild(blockRow)

  // Sub-rows
  const subRows = []
  for (let i = 0; i < subRowCount; i++) {
    const tr = document.createElement('tr')
    tr.className = 'ska-sub-row'
    tr.dataset.blockId = String(blockId)
    tr.dataset.skaAccordionTarget = 'subRow'
    tbody.appendChild(tr)
    subRows.push(tr)
  }

  // Wire up controller with target resolution
  const ctrl = new SkaAccordionController(tbody)
  ctrl.blockRowTargets = Array.from(
    tbody.querySelectorAll('[data-ska-accordion-target="blockRow"]')
  )
  ctrl.subRowTargets = Array.from(tbody.querySelectorAll('[data-ska-accordion-target="subRow"]'))

  return { tbody, blockRow, subRows, ctrl }
}

/**
 * Simulate a row-level click as toggle() expects — currentTarget is the tr itself.
 */
function clickRow(blockRow, ctrl) {
  // toggle() calls event.currentTarget.closest('tr').
  // Patch closest on the row element so it works on detached jsdom nodes.
  blockRow.closest = (sel) => (sel === 'tr' ? blockRow : null)
  const event = { currentTarget: blockRow, target: blockRow }
  ctrl.toggle(event)
}

// ---------------------------------------------------------------------------
// Unit tests — Task 11.1
// ---------------------------------------------------------------------------

describe('ska_accordion_controller — unit tests', () => {
  describe('toggle() with no sub-rows (HasSKAData = false)', () => {
    it('does not add is-expanded to the block row', () => {
      const { blockRow, ctrl } = buildDOM(42, 0)
      clickRow(blockRow, ctrl)
      expect(blockRow.classList.contains('is-expanded')).toBe(false)
    })

    it('does not mutate any element in the tbody', () => {
      const { tbody, blockRow, ctrl } = buildDOM(42, 0)
      const before = tbody.innerHTML
      clickRow(blockRow, ctrl)
      expect(tbody.innerHTML).toBe(before)
    })
  })

  describe('toggle() with sub-rows — expand / collapse', () => {
    let blockRow, subRows, ctrl

    beforeEach(() => {
      ;({ blockRow, subRows, ctrl } = buildDOM(7, 2))
    })

    it('adds ska-sub-row--visible to all sub-rows on first click', () => {
      clickRow(blockRow, ctrl)
      subRows.forEach((r) => expect(r.classList.contains('ska-sub-row--visible')).toBe(true))
    })

    it('adds is-expanded to the block row on first click', () => {
      clickRow(blockRow, ctrl)
      expect(blockRow.classList.contains('is-expanded')).toBe(true)
    })

    it('removes ska-sub-row--visible on second click (collapse)', () => {
      clickRow(blockRow, ctrl)
      clickRow(blockRow, ctrl)
      subRows.forEach((r) => expect(r.classList.contains('ska-sub-row--visible')).toBe(false))
    })

    it('removes is-expanded on second click (collapse)', () => {
      clickRow(blockRow, ctrl)
      clickRow(blockRow, ctrl)
      expect(blockRow.classList.contains('is-expanded')).toBe(false)
    })
  })

  describe('toggle() with multiple blocks — isolation', () => {
    it('only toggles sub-rows belonging to the clicked block', () => {
      // Build two blocks sharing the same controller / tbody
      const tbody = document.createElement('tbody')

      function addBlock(id, subRowCount) {
        const blockRow = document.createElement('tr')
        blockRow.dataset.blockId = String(id)
        blockRow.dataset.skaAccordionTarget = 'blockRow'
        tbody.appendChild(blockRow)

        const subs = []
        for (let i = 0; i < subRowCount; i++) {
          const tr = document.createElement('tr')
          tr.className = 'ska-sub-row'
          tr.dataset.blockId = String(id)
          tr.dataset.skaAccordionTarget = 'subRow'
          tbody.appendChild(tr)
          subs.push(tr)
        }
        return { blockRow, subs }
      }

      const { blockRow: row1, subs: subs1 } = addBlock(100, 2)
      const { blockRow: row2, subs: subs2 } = addBlock(200, 3)

      const ctrl = new SkaAccordionController(tbody)
      ctrl.blockRowTargets = Array.from(
        tbody.querySelectorAll('[data-ska-accordion-target="blockRow"]')
      )
      ctrl.subRowTargets = Array.from(
        tbody.querySelectorAll('[data-ska-accordion-target="subRow"]')
      )

      // Click block 100
      clickRow(row1, ctrl)

      // Block 100 sub-rows expanded
      subs1.forEach((r) => expect(r.classList.contains('ska-sub-row--visible')).toBe(true))
      expect(row1.classList.contains('is-expanded')).toBe(true)

      // Block 200 sub-rows untouched
      subs2.forEach((r) => expect(r.classList.contains('ska-sub-row--visible')).toBe(false))
      expect(row2.classList.contains('is-expanded')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Property-based tests — Task 11.2 (optional)
// Feature: home-block-table-redesign, Property 8: Accordion toggle is a round-trip
// ---------------------------------------------------------------------------

describe('ska_accordion_controller — property tests', () => {
  it('Property 8: toggle twice restores original state for any blockId', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), (blockId) => {
        const { blockRow, subRows, ctrl } = buildDOM(blockId, 2)

        // Capture initial state
        const initialSubRowClasses = subRows.map((r) => r.className)
        const initialBlockRowClass = blockRow.className

        // Expand then collapse
        clickRow(blockRow, ctrl)
        clickRow(blockRow, ctrl)

        // All classes must be restored
        subRows.forEach((r, i) => expect(r.className).toBe(initialSubRowClasses[i]))
        expect(blockRow.className).toBe(initialBlockRowClass)
      })
    )
  })

  // Feature: home-block-table-redesign, Property 7: Accordion-Disabled state when no SKA data
  it('Property 7: no DOM mutation for any blockId when HasSKAData is false', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), (blockId) => {
        const { tbody, blockRow, ctrl } = buildDOM(blockId, 0)
        const before = tbody.innerHTML
        clickRow(blockRow, ctrl)
        expect(tbody.innerHTML).toBe(before)
        expect(blockRow.classList.contains('is-expanded')).toBe(false)
      })
    )
  })
})
