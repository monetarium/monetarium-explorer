# Implementation Plan: Home Block Table Simplified

## Overview

Rewrite `home_latest_blocks.tmpl` to the flat 9-column layout and update `blocklist_controller.js` to match, then add unit and property-based tests for both Go and JS layers.

## Tasks

- [x] 1. Rewrite `home_latest_blocks.tmpl` to the flat 9-column layout
  - Remove the two-row grouped `<thead>` (Overview / VAR / SKA group headers)
  - Add a single `<thead>` row with 9 `<th>` elements in order: Height, Txn, VAR, SKA, Size, Vote, Tkt, Rev, Age
  - Each `<th>` carries the correct `title` attribute per requirements (e.g. `title="block height"`, `title="number of transactions"`, etc.)
  - Block row `<tr>` keeps `data-ska-accordion-target="blockRow"` and `data-block-id="{{.Height}}"`
  - Each block row cell carries the correct `data-type`: `height`, `tx`, `var-amount`, `ska-amount`, `size`, `votes`, `tickets`, `revocations`, `age`
  - SKA cell (`data-type="ska-amount"`) gets `data-action="click->ska-accordion#toggle"` and class `ska-clickable` only when `{{if .HasSKAData}}`; the clickable variant wraps the value in `<button type="button" class="link-button">`; the non-clickable variant renders plain text
  - After each block row: one VAR sub-row with `class="ska-sub-row"`, `data-ska-accordion-target="subRow"`, `data-block-id="{{.Height}}"` — 9 cells mapping Txn→`.VARTxCount`, VAR→`.VARAmount`, SKA→`—`, Size→`.VARSize`, others empty (`—`)
  - After the VAR sub-row: `{{range .SKASubRows}}` emits one SKA sub-row per token — same sub-row attributes, 9 cells mapping Txn→`.TxCount` (with token badge `<span>`), VAR→`—`, SKA→`.Amount`, Size→`.Size`, others empty
  - `<tbody>` retains `data-controller="ska-accordion"` and `data-blocklist-target="table"`
  - _Requirements: 1.1–1.11, 3.1–3.5, 4.1–4.3, 5.1–5.3, 6.1, 7.1, 8.1–8.2, 9.1, 10.1–10.2_

- [x] 2. Update `blocklist_controller.js` for the new 9-column layout
  - [x] 2.1 Update `_processBlock()` switch to handle new `data-type` values
    - Add cases: `tx` → `String(block.tx)`, `var-amount` → `humanize.threeSigFigs(block.total)`, `ska-amount` → `buildSKACell(newTd, skaAmt, hasSKAData)`, `votes` → `block.votes`, `tickets` → `block.tickets`, `revocations` → `block.revocations`
    - Remove old cases: `var-tx`, `var-size`, `ska-tx`, `ska-size` (no longer present in the main block row)
    - Set `data-ska-accordion-target="blockRow"` and `data-block-id=String(block.height)` on the new main row
    - _Requirements: 12.1–12.5_

  - [x] 2.2 Add `insertVARSubRow(tbody, newRow, block)` function
    - Creates a 9-cell `<tr>` with `class="ska-sub-row"`, `data-ska-accordion-target="subRow"`, `data-block-id=String(block.height)`
    - Cell mapping: col 1 (height) → empty, `sticky-col`; col 2 (tx) → `String(block.tx)`, `text-center`; col 3 (var-amount) → `humanize.threeSigFigs(block.total)`, `text-end`; col 4 (ska-amount) → `—`, `text-end`; col 5 (size) → `humanize.bytes(block.size)`, `text-end`; cols 6–9 → empty
    - Inserts the sub-row immediately after `newRow` using `tbody.insertBefore`
    - _Requirements: 12.6, 12.7_

  - [x] 2.3 Update `insertSKASubRows()` to produce 9-cell rows
    - Signature: `insertSKASubRows(tbody, insertRef, subRows, blockHeight)`
    - Each sub-row: `class="ska-sub-row"`, `data-ska-accordion-target="subRow"`, `data-block-id=String(blockHeight)`
    - Cell mapping: col 1 → empty, `sticky-col`; col 2 (tx) → token badge `<span>` + `sub.txCount`, `text-center`; col 3 (var-amount) → `—`, `text-end`; col 4 (ska-amount) → `sub.amount`, `text-end`; col 5 (size) → `sub.size`, `text-end`; cols 6–9 → empty
    - Remove the old 13-cell structure (7 spacers + colspan-3 label + 3 SKA cells)
    - _Requirements: 12.6, 12.7_

  - [x] 2.4 Fix oldest-row removal to also remove sub-rows
    - When removing the last block row, query all `<tr[data-block-id="<height>"]>` elements in the tbody and remove each one
    - Ensures no orphaned sub-rows remain after prepend
    - _Requirements: 12.8_

  - [x] 2.5 Write property test for WebSocket prepend matches server structure (Property 8)
    - **Property 8: WebSocket block prepend matches server-rendered output**
    - **Validates: Requirements 12.1–12.7**
    - Tag: `// Feature: home-block-table-simplified, Property 8: WebSocket block prepend matches server-rendered output`
    - File: `cmd/dcrdata/public/js/controllers/blocklist_controller.test.js`

  - [ ]\* 2.6 Write property test for oldest row removal leaves no orphaned sub-rows (Property 9)
    - **Property 9: Oldest row removal leaves no orphaned sub-rows**
    - **Validates: Requirement 12.8**
    - Tag: `// Feature: home-block-table-simplified, Property 9: Oldest row removal leaves no orphaned sub-rows`
    - File: `cmd/dcrdata/public/js/controllers/blocklist_controller.test.js`

  - [ ]\* 2.7 Write property test for VAR cells populated from block payload (Property 10)
    - **Property 10: VAR cells populated from block payload**
    - **Validates: Requirement 12.2**
    - Tag: `// Feature: home-block-table-simplified, Property 10: VAR cells populated from block payload`
    - File: `cmd/dcrdata/public/js/controllers/blocklist_controller.test.js`

  - [ ]\* 2.8 Write property test for SKA cell interactivity conditioned on hasSKAData (Property 11)
    - **Property 11: SKA cell interactivity conditioned on hasSKAData**
    - **Validates: Requirements 12.4, 12.5**
    - Tag: `// Feature: home-block-table-simplified, Property 11: SKA cell interactivity conditioned on hasSKAData`
    - File: `cmd/dcrdata/public/js/controllers/blocklist_controller.test.js`

- [x] 3. Checkpoint — verify template and controller changes are consistent
  - Confirm `data-type` values in the template match the switch cases in `_processBlock()`
  - Confirm sub-row cell counts (9) match between template and `insertVARSubRow` / `insertSKASubRows`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Write Go unit and property-based tests
  - [x] 4.1 Write unit tests in `home_viewmodel_test.go`
    - `TestBuildHomeBlockRows_FieldPreservation` — known `BlockBasic` input, assert all 8 overview fields copied exactly
    - `TestBuildHomeBlockRows_NilSkipping` — slice with nil entries, assert nil entries are skipped
    - `TestBuildHomeBlockRows_HasSKAData` — heights divisible by 9 produce `HasSKAData=false`; others produce `HasSKAData=true`
    - _Requirements: 1.1, 3.3, 10.1_

  - [ ]\* 4.2 Write property test for block row field preservation (Property 1)
    - **Property 1: Block row field preservation**
    - **Validates: Requirements 1.1, 4.1, 4.3**
    - Tag: `// Feature: home-block-table-simplified, Property 1: Block row field preservation`
    - File: `cmd/dcrdata/internal/explorer/home_viewmodel_test.go`
    - Use `pgregory.net/rapid`; minimum 100 iterations

  - [ ]\* 4.3 Write property test for VAR amount pre-formatting (Property 2)
    - **Property 2: VAR amount pre-formatting**
    - **Validates: Requirements 2.2, 4.2**
    - Tag: `// Feature: home-block-table-simplified, Property 2: VAR amount pre-formatting`
    - File: `cmd/dcrdata/internal/explorer/home_viewmodel_test.go`
    - Use `pgregory.net/rapid`; minimum 100 iterations

  - [ ]\* 4.4 Write property test for sub-row count invariant (Property 3)
    - **Property 3: Sub-row count invariant**
    - **Validates: Requirements 3.2, 3.3**
    - Tag: `// Feature: home-block-table-simplified, Property 3: Sub-row count invariant`
    - File: `cmd/dcrdata/internal/explorer/home_viewmodel_test.go`
    - Use `pgregory.net/rapid`; minimum 100 iterations

  - [x] 4.5 Write unit tests in `home_mock_test.go`
    - `TestMockSKAData_ZeroSubRowsForMultiplesOf9` — heights 0, 9, 18, 27 produce empty sub-rows
    - `TestMockSKAData_SubRowCount` — non-multiples of 9 produce exactly 3 sub-rows
    - `TestSKASubRow_TokenTypeNonEmpty` — all sub-row `TokenType` values are non-empty strings
    - _Requirements: 3.3, 5.1, 10.2_

  - [ ]\* 4.6 Write property test for no aggregate SKA sub-row (Property 4)
    - **Property 4: No aggregate SKA sub-row**
    - **Validates: Requirement 3.4**
    - Tag: `// Feature: home-block-table-simplified, Property 4: No aggregate SKA sub-row`
    - File: `cmd/dcrdata/internal/explorer/home_mock_test.go`
    - Use `pgregory.net/rapid`; minimum 100 iterations

  - [ ]\* 4.7 Write property test for SKA sub-rows in ascending token index order (Property 5)
    - **Property 5: SKA sub-rows in ascending token index order**
    - **Validates: Requirement 8.2**
    - Tag: `// Feature: home-block-table-simplified, Property 5: SKA sub-rows in ascending token index order`
    - File: `cmd/dcrdata/internal/explorer/home_mock_test.go`
    - Use `pgregory.net/rapid`; minimum 100 iterations

  - [ ]\* 4.8 Write property test for block row order preservation (Property 6)
    - **Property 6: Block row order preservation**
    - **Validates: Requirement 8.1**
    - Tag: `// Feature: home-block-table-simplified, Property 6: Block row order preservation`
    - File: `cmd/dcrdata/internal/explorer/home_viewmodel_test.go`
    - Use `pgregory.net/rapid`; minimum 100 iterations

- [x] 5. Write JS unit and property-based tests
  - [ ]\* 5.1 Write property test for expand/collapse round-trip (Property 7)
    - **Property 7: Expand/collapse round-trip**
    - **Validates: Requirements 6.2, 6.3**
    - Tag: `// Feature: home-block-table-simplified, Property 7: Expand/collapse round-trip`
    - File: `cmd/dcrdata/public/js/controllers/ska_accordion_controller.test.js`
    - Use `fast-check` with Vitest; minimum 100 runs
    - Generate a DOM fragment with N block rows and M sub-rows per block; call `toggle()` twice on a random block; assert all sub-rows for that block lack `.ska-sub-row--visible`

- [x] 6. Final checkpoint — lint and tests
  - Run `npm run lint` in `cmd/dcrdata` and fix any ESLint errors
  - Run `go test ./...` in `cmd/dcrdata` and fix any failing Go tests
  - Run `npx vitest --run` in `cmd/dcrdata` and fix any failing JS tests
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `pgregory.net/rapid` (Go) and `fast-check` + Vitest (JS)
- Each property test must include the tag comment: `// Feature: home-block-table-simplified, Property N: <text>`
- The 9-column `data-type` order is: `height`, `tx`, `var-amount`, `ska-amount`, `size`, `votes`, `tickets`, `revocations`, `age`
- Sub-rows always have 9 cells — no colspan tricks; empty cells render `—` as placeholder per Requirement 7.1
- `mockSKAData()` in JS must remain logically identical to the Go version in `home_mock.go`
