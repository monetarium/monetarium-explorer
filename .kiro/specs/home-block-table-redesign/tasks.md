# Implementation Plan: home-block-table-redesign

## Overview

Replace the home page "Latest Blocks" table with a 13-column layout (Overview / VAR / SKA),
add a Stimulus accordion for per-SKA-type sub-rows, and enforce Rule-of-Three formatting on
all monetary amounts. SKA data is fully mocked. Implementation follows a strict bottom-up
order: Go types → mock helper → handler wiring → template registration → templates → JS
controller → SCSS → tests.

All new Go files live in `package explorer` (`cmd/dcrdata/internal/explorer/`), giving them
direct access to `threeSigFigs` in `templates.go` without any additional imports.

## Tasks

- [x] 1. Create home_viewmodel.go — types and conversion helper
  - Create `cmd/dcrdata/internal/explorer/home_viewmodel.go` in `package explorer`.
  - Define `HomeBlockRow` struct with all 17 fields (Height, Hash, Transactions, Voters,
    FreshStake, Revocations, FormattedBytes, BlockTime, VARTxCount, VARAmount, VARSize,
    SKATxCount, SKAAmount, SKASize, HasSKAData, SKASubRows) and `SKASubRow` struct
    (TokenType, TxCount, Amount, Size).
  - Add a comment on the SKA string fields noting future migration to a big-number type.
  - Implement `buildHomeBlockRows(blocks []*types.BlockBasic) []HomeBlockRow`:
    - Skip nil entries with a `continue` guard.
    - Call `mockSKAData(b.Height)` (defined in `home_mock.go`, same package).
    - Map all fields per the design's field-mapping table; set `HasSKAData = len(subRows) > 0`.
    - Call `threeSigFigs` directly (same package, no import needed).
  - _Requirements: 1.1, 1.2, 1.4, 4.2, 4.3_

- [x] 2. Create home_mock.go — isolated mock SKA data generator
  - Create `cmd/dcrdata/internal/explorer/home_mock.go` in `package explorer`.
  - Declare `mockSKATokens` with the three tokens (SKA-1 / SKA-2 / SKA-3) and their raw
    tx, amount, and size values as specified in the design.
  - Implement `mockSKAData(height int64) (txCount, amount, size string, subRows []SKASubRow)`:
    - Return `"0", "0", "0", nil` when `height % 9 == 0`.
    - Otherwise compute per-token values with `offset = float64(height % 10)`, call
      `threeSigFigs` on each, accumulate aggregates, and return.
  - Use `SKASubRow` directly (defined in `home_viewmodel.go`, same package — no import).
  - _Requirements: 1.2, 1.3, 2.4, 5.6_

- [x] 3. Wire buildHomeBlockRows into the Home handler
  - In `cmd/dcrdata/internal/explorer/explorerroutes.go`, update the `Home` handler:
    - Change the template data struct field from `Blocks []*types.BlockBasic` to
      `Blocks []HomeBlockRow`.
    - Replace the existing block slice assignment with a call to `buildHomeBlockRows(blocks)`.
  - No other changes to `explorerroutes.go` are needed; `buildHomeBlockRows` and
    `mockSKAData` are implementation details of the other files.
  - _Requirements: 1.1, 1.3, 4.1, 4.4_

- [x] 4. Register the partial template in explorer.go
  - In `cmd/dcrdata/internal/explorer/explorer.go`, add `"home_latest_blocks.tmpl"` to the
    `tmpls` slice (or equivalent registration call) so the partial is parsed alongside the
    other templates.
  - _Requirements: 4.1_

- [x] 5. Create the home_latest_blocks partial template
  - Create `cmd/dcrdata/views/home_latest_blocks.tmpl` defining template `"home_latest_blocks"`.
  - Wrap the table in `<div class="table-responsive">`.
  - Add `<table class="table last-blocks-table">`.
  - Two-row `<thead>`:
    - Row 1: three `<th>` with `colspan="7"` (Overview), `colspan="3"` (VAR, with
      `class="group-var"`), `colspan="3"` (SKA, with `class="group-ska"`).
    - Row 2: 13 `<th>` elements with column labels; VAR and SKA boundary columns carry
      `class="group-var-col"` / `class="group-ska-col"`.
  - `<tbody data-controller="ska-accordion" data-blocklist-target="table">`:
    - `{{range .Blocks}}` — emit one Block_Row `<tr>` with `data-ska-accordion-target="blockRow"`
      and `data-block-id="{{.Height}}"`, 13 `<td>` cells; SKA cells carry
      `data-action="click->ska-accordion#toggle"` and `class="ska-clickable"` only when
      `{{if .HasSKAData}}`.
    - `{{range .SKASubRows}}` — emit one Sub_Row `<tr class="ska-sub-row">`
      with `data-ska-accordion-target="subRow"` and `data-block-id` matching the parent;
      7 empty Overview `<td>` cells; one `<td colspan="3" class="text-end">{{.TokenType}}</td>`
      spanning the full VAR group; last 3 `<td>` cells populated from `.TxCount`, `.Amount`,
      `.Size`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.1, 8.2_

- [x] 6. Update home.tmpl to include the partial
  - In `cmd/dcrdata/views/home.tmpl`, replace the existing block table markup with
    `{{template "home_latest_blocks" .}}`.
  - _Requirements: 4.1_

- [x] 7. Implement the Stimulus accordion controller
  - Create `cmd/dcrdata/public/js/controllers/ska_accordion_controller.js`.
  - Export a class extending `Controller` with `static get targets()` returning
    `["blockRow", "subRow"]`.
  - Implement `toggle(event)`:
    - Read `blockId` from `event.currentTarget.closest("tr").dataset.blockId`.
    - Filter `this.subRowTargets` by matching `blockId`.
    - Return early if `subRows.length === 0`.
    - Toggle `ska-sub-row--visible` on each sub-row and `is-expanded` on the block row.
  - No changes to `index.js` are needed (auto-discovered via `definitionsFromContext`).
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. Add SCSS rules to home.scss
  - Append to `cmd/dcrdata/public/scss/home.scss`: - `.ska-sub-row` — `display: none`; `&--visible` — `display: table-row`,
    `background-color: $card-bg-secondary`. - `body.darkBG .ska-sub-row--visible` — `background-color: $card-bg-secondary-dark`. - `.ska-clickable` — `cursor: pointer`. - `.last-blocks-table` — `.last-blocks-table td,
.last-blocks-table th {
  white-space: nowrap;
}
`. - `.group-header` — border-bottom, font-size, text-transform, letter-spacing. - `.group-var-col`, `.group-var`, `.group-ska-col`, `.group-ska` — left border using
    `$progress-bg`.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.2, 8.3_

- [x] 9. Checkpoint — verify Go build and template rendering
  - Run `go build ./...` in `cmd/dcrdata` and confirm it passes.
  - Run `go test ./...` in `cmd/dcrdata` and confirm all existing tests still pass.
  - Ask the user if any questions arise before proceeding to tests.

- [x] 10. Write Go property-based and unit tests
  - Add `pgregory.net/rapid` as a test dependency in `cmd/dcrdata/go.mod`.
  - Create `cmd/dcrdata/internal/explorer/home_viewmodel_test.go` for view-model tests and
    `cmd/dcrdata/internal/explorer/home_mock_test.go` for mock tests, mirroring the
    file-per-concern split of the production code.

  - [x] 10.1 Write unit tests for buildHomeBlockRows
    - Test field preservation with a known `BlockBasic` input.
    - Test nil-entry skipping (pass a slice with a nil pointer, assert no panic and correct length).
    - Test `HasSKAData` flag is `true` when sub-rows are non-empty and `false` when empty.
    - _Requirements: 1.1, 1.2, 4.2_

  - [ ]\* 10.2 Write property test — Property 1: BlockBasic to HomeBlockRow field preservation
    - Tag: `// Feature: home-block-table-redesign, Property 1: BlockBasic to HomeBlockRow field preservation`
    - Use `rapid.Check` to generate arbitrary `BlockBasic` values; assert all 8 Overview
      fields are preserved exactly in the resulting `HomeBlockRow`.
    - **Validates: Requirements 1.1, 4.2**

  - [ ]\* 10.3 Write property test — Property 3: Monetary fields are pre-formatted
    - Tag: `// Feature: home-block-table-redesign, Property 3: Monetary fields are pre-formatted`
    - Generate arbitrary `BlockBasic.Total` values; assert `rows[0].VARAmount == threeSigFigs(total)`.
    - **Validates: Requirements 1.4, 2.3, 4.3, 4.4**

  - [ ]\* 10.4 Write property test — Property 4a: Non-zero heights produce >= 2 sub-rows
    - Tag: `// Feature: home-block-table-redesign, Property 4a: Non-zero heights produce >= 2 sub-rows`
    - Generate heights where `h % 9 != 0`; assert `len(subRows) >= 2`.
    - **Validates: Requirements 1.2, 1.3, 5.6**

  - [ ]\* 10.5 Write property test — Property 4b: Multiples of 9 produce 0 sub-rows
    - Tag: `// Feature: home-block-table-redesign, Property 4b: Multiples of 9 produce 0 sub-rows`
    - Generate heights where `h % 9 == 0`; assert `subRows` is empty.
    - **Validates: Requirements 1.2, 6.4, 7.3, 7.4**

  - [ ]\* 10.6 Write property test — Property 2: Amount_Formatter produces 3 significant digits
    - Tag: `// Feature: home-block-table-redesign, Property 2: Amount_Formatter produces 3 significant digits`
    - Generate positive `float64` values across the full range; assert `threeSigFigs(v)`
      returns a string with exactly 3 significant digits and the correct suffix.
    - **Validates: Requirements 2.1, 2.2**

- [x] 11. Write JavaScript property-based and unit tests
  - Install `fast-check` as a dev dependency if not already present.
  - Create `cmd/dcrdata/public/js/controllers/ska_accordion_controller.test.js` using Vitest.

  - [x] 11.1 Write unit tests for ska_accordion_controller
    - Test `toggle` with no sub-rows: assert no DOM mutation occurs.
    - Test `toggle` with multiple blocks: assert only the clicked block's sub-rows toggle.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]\* 11.2 Write property test — Property 8: Accordion toggle is a round-trip
    - Tag: `// Feature: home-block-table-redesign, Property 8: Accordion toggle is a round-trip`
    - Use `fast-check` with `fc.integer({ min: 1, max: 999999 })` as the block ID.
    - Set up DOM with one block row + two sub-rows; click SKA cell twice; assert all classes
      return to their original state.
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]\* 11.3 Write property test — Property 7: Accordion-Disabled state when no SKA data
    - Tag: `// Feature: home-block-table-redesign, Property 7: Accordion-Disabled state when no SKA data`
    - Set up DOM with a block row that has no sub-rows and no `data-action` on SKA cells.
    - Simulate a direct click on an SKA cell; assert no `ska-sub-row--visible` or
      `is-expanded` class appears anywhere and `toggle` is never invoked.
    - **Validates: Requirements 6.4, 7.3, 7.4**

- [x] 12. Final checkpoint — ensure all tests pass
  - Run `go test ./...` in `cmd/dcrdata` and confirm all Go tests pass.
  - Run `npm run lint` in `cmd/dcrdata` and confirm no ESLint errors.
  - Ask the user if any questions arise.

- [x] 13. Add SKA token name to sub-rows — update template and test
  - In `cmd/dcrdata/views/home_latest_blocks.tmpl`, update the `{{range .SKASubRows}}`
    block: replace the 10 individual empty `<td>` cells with 7 empty Overview `<td>` cells
    followed by `<td colspan="3" class="text-end">{{.TokenType}}</td>` spanning the VAR
    group. The last 3 SKA `<td>` cells remain unchanged.
  - In `cmd/dcrdata/internal/explorer/home_viewmodel_test.go`, add a unit test asserting
    that each `SKASubRow.TokenType` is non-empty for any block with `HasSKAData = true`.
  - _Requirements: 5.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints (tasks 9 and 12) ensure incremental validation.
- `home_viewmodel.go` and `home_mock.go` are both in `package explorer`, so they share
  access to `threeSigFigs` (in `templates.go`) and each other's types without any imports.
- Replacing mocks with real DB calls in the future is a single-file change: rewrite
  `home_mock.go` only — `home_viewmodel.go` and `explorerroutes.go` are untouched.
- Test files mirror the production split: `home_viewmodel_test.go` and `home_mock_test.go`.
- The `data-blocklist-target="table"` attribute on `<tbody>` must be preserved so the
  existing WebSocket block-prepend logic in `blocklist_controller.js` continues to work.
- SKA string fields are pre-formatted; a comment in the struct marks them for future
  migration to a big-number type when the real backend is available.
