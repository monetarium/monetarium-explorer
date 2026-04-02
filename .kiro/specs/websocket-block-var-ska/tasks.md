# Implementation Plan: websocket-block-var-ska

## Overview

Extend `blocklist_controller.js` to populate VAR/SKA cells when a `BLOCK_RECEIVED`
event fires. All changes are confined to one file; tests live in a new
`blocklist_controller.test.js` sibling file using Vitest + fast-check.

## Tasks

- [x] 1. Add `mockSKAData` function to `blocklist_controller.js`
  - Port `home_mock.go:mockSKAData` exactly: same token table, same offset
    arithmetic (`offset = height % 10`), same zero-activity guard (`height % 9 === 0`)
  - Use `humanize.threeSigFigs` for amount/size formatting; `String()` for tx counts
  - Place the function as a module-level helper above the Stimulus controller class
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]\* 1.1 Write property test — Property 2: mockSKAData zero-activity invariant
    - **Property 2: mockSKAData zero-activity invariant**
    - For any `h` where `h % 9 === 0`, result has `subRows: []` and all aggregates `'0'`
    - Use `fc.integer()` filtered to multiples of 9
    - **Validates: Requirements 2.1, 2.3**

  - [ ]\* 1.2 Write property test — Property 3: mockSKAData non-zero sub-row count
    - **Property 3: mockSKAData non-zero sub-row count**
    - For any `h` where `h % 9 !== 0`, `subRows.length === 3` and `parseInt(skaTx)` equals sum of `parseInt(sub.txCount)`
    - Use `fc.integer()` filtered to non-multiples of 9
    - **Validates: Requirements 2.2, 2.4**

- [x] 2. Add `buildSKACell` and `insertSKASubRows` helpers to `blocklist_controller.js`
  - `buildSKACell(newTd, value, hasSKAData)`: adds `ska-clickable` class,
    `data-action`, and a `<button type="button" class="link-button">` when
    `hasSKAData` is true; otherwise sets plain `textContent`
  - `insertSKASubRows(tbody, newRow, subRows, blockHeight)`: iterates `subRows`,
    creates `<tr class="ska-sub-row">` with 7 spacer `<td>`s, a
    `<td colspan="3" class="text-end fs13 fw-medium">` label, then tx/amount/size
    cells; inserts each after the previous using `insertBefore`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]\* 2.1 Write property test — Property 4: SKA cells with data render as buttons
    - **Property 4: SKA cells with data render as buttons**
    - For any truthy `hasSKAData`, `newTd` has one `<button class="link-button">` child,
      carries `ska-clickable` class, and has `data-action="click->ska-accordion#toggle"`
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]\* 2.2 Write property test — Property 5: SKA cells without data render as plain text
    - **Property 5: SKA cells without data render as plain text**
    - For `hasSKAData === false`, `newTd` has no child elements, no `ska-clickable`
      class, and no `data-action` attribute
    - **Validates: Requirements 3.4, 3.5**

  - [ ]\* 2.3 Write property test — Property 6: Sub-row count matches mockSKAData output
    - **Property 6: Sub-row count matches mockSKAData output**
    - For any block height, the number of `<tr class="ska-sub-row">` elements inserted
      equals `mockSKAData(height).subRows.length`
    - **Validates: Requirements 4.1, 4.2**

  - [ ]\* 2.4 Write property test — Property 7: Sub-rows inserted in token order after main row
    - **Property 7: Sub-rows are inserted in token order immediately after the main row**
    - Sub-rows appear as immediate next siblings of `newRow` in SKA-1/SKA-2/SKA-3 order;
      each carries `data-ska-accordion-target="subRow"` and `data-block-id=String(height)`
    - **Validates: Requirements 4.3, 4.4**

- [x] 3. Extend the `switch` in `_processBlock` with the six new cases
  - Add `case 'var-tx'`: `newTd.textContent = String(block.tx)`
  - Add `case 'var-amount'`: `newTd.textContent = humanize.threeSigFigs(block.total)`
  - Add `case 'var-size'`: `newTd.textContent = humanize.bytes(block.size)`
  - Add `case 'ska-tx'`, `'ska-amount'`, `'ska-size'`: delegate to `buildSKACell`
  - Compute `mockSKAData(block.height)` and `hasSKAData` once before the `forEach` loop
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]\* 3.1 Write property test — Property 1: VAR cells are populated from block payload
    - **Property 1: VAR cells are populated from block payload**
    - For any block with numeric `tx`, `total`, `size`, the rendered `var-tx` text equals
      `String(block.tx)`, `var-amount` equals `humanize.threeSigFigs(block.total)`,
      `var-size` equals `humanize.bytes(block.size)`
    - Use `fc.record({ tx: fc.integer(), total: fc.float(), size: fc.integer() })`
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 4. Set Stimulus data attributes on the new main row in `_processBlock`
  - After `newRow` is created, set `newRow.dataset.skaAccordionTarget = 'blockRow'`
  - Set `newRow.dataset.blockId = String(block.height)`
  - Call `insertSKASubRows(this.tableTarget, newRow, subRows, block.height)` after
    `insertBefore(newRow, ...)`
  - _Requirements: 5.1, 5.2, 4.1, 4.2, 4.3, 4.4_

- [x] 5. Checkpoint — ensure all tests pass and lint is clean
  - Run `npm run lint` in `cmd/dcrdata`; fix any ESLint errors
  - Run `npm test` in `cmd/dcrdata`; all Vitest tests must pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Test file location: `cmd/dcrdata/public/js/controllers/blocklist_controller.test.js`
- Run tests with `npm test` (Vitest, jsdom environment, fast-check for property tests)
- Run lint with `npm run lint` (ESLint standard config)
- Property tests reference design document properties by number for traceability
