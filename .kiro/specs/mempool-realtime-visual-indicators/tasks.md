# Implementation Plan: Mempool Real-time Visual Indicators

## Overview

Implement per-coin fill bars and a total-mempool bar on the home page, updated in real time via the existing WebSocket connection. All ratio computations happen server-side in Go; the JavaScript controller performs only DOM writes. The implementation proceeds in five phases: Go data model, SCSS styles, Go template, JavaScript controller, and tests.

## Tasks

- [x] 1. Extend Go data model — CoinFillData and MempoolShort
  - [x] 1.1 Replace `FillPct` with the five new ratio fields on `CoinFillData` in `explorer/types/explorertypes.go`
    - Remove `FillPct float64` field
    - Add `GQFillRatio float64 \`json:"gq_fill_ratio"\``
    - Add `ExtraFillRatio float64 \`json:"extra_fill_ratio"\``
    - Add `OverflowFillRatio float64 \`json:"overflow_fill_ratio"\``
    - Add `GQPositionRatio float64 \`json:"gq_position_ratio"\``
    - Keep `Symbol string` and `Status string` unchanged
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2 Add `TotalFillRatio float64` and `ActiveSKACount int` to `MempoolShort` in `explorer/types/explorertypes.go`
    - Add `TotalFillRatio float64 \`json:"total_fill_ratio"\``
    - Add `ActiveSKACount int \`json:"active_ska_count"\``
    - Propagate `CoinFills []CoinFillData` (already present on `MempoolInfo`) to `MempoolShort` so it is broadcast in the WebSocket message
    - Update `MempoolShort.DeepCopy()` to copy the new fields
    - _Requirements: 3.2, 4.6, 5.1_

  - [x] 1.3 Add `TotalFillRatio` and `ActiveSKACount` to `TrimmedMempoolInfo` in `explorer/types/explorertypes.go`
    - Add `TotalFillRatio float64` field
    - Add `ActiveSKACount int` field
    - Update `MempoolInfo.Trim()` to populate both fields from `MempoolShort`
    - _Requirements: 4.1, 4.3, 4.6_

- [-] 2. Rewrite `computeCoinFills` in Go
  - [x] 2.1 Rewrite `computeCoinFills` in `cmd/dcrdata/internal/explorer/explorer.go`
    - Define `tcBytes = 393216.0` as a named constant
    - Compute `varQuota = tcBytes * 0.10`, `skaPool = tcBytes * 0.90`
    - Compute `perSKAQuota = skaPool / numSKA` (guard against zero)
    - For each coin compute `GQFillRatio = min(size/quota, 1.0)`
    - For each coin compute `GQPositionRatio`: VAR always `0.10`; each SKA `0.90 / numSKA`
    - Compute `ExtraFillRatio = (size - quota) / tcBytes` clamped to [0,1] when status is "borrowing", else 0
    - Compute `OverflowFillRatio = (size - quota) / tcBytes` clamped to [0,1] when status is "full", else 0
    - Return VAR first, then SKA types sorted by ascending uint8 coin-type key
    - Return single VAR entry with all ratios 0.0 and status "ok" when CoinStats is empty
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.2_

  - [x] 2.2 Compute and attach `TotalFillRatio` and `ActiveSKACount` at the call sites
    - In the home page view model builder: set `TrimmedMempoolInfo.TotalFillRatio = totalUsed / tcBytes` and `ActiveSKACount = numSKA`
    - In the mempool monitor update path: set the same fields on `MempoolShort` before the WebSocket broadcast
    - Remove any remaining references to the old `FillPct` field across the codebase
    - _Requirements: 3.2, 4.6, 5.1_

  - [ ]\* 2.3 Write Go unit tests for `computeCoinFills` in `cmd/dcrdata/internal/explorer/explorer_test.go` (or a new `mempool_test.go` alongside `mempool.go`)
    - VAR-only mempool: verify `GQFillRatio`, `GQPositionRatio = 0.10`, and status transitions at quota and TC boundaries
    - Mixed VAR + multiple SKA types: verify `perSKAQuota`, `GQPositionRatio = 0.9/numSKA`, and correct status for each coin
    - Empty CoinStats: verify single VAR fallback with all ratios 0.0 and status "ok"
    - `TotalFillRatio` computation: verify unclamped value for under-capacity and over-capacity mempools
    - `ActiveSKACount`: verify it equals the count of non-zero keys in CoinStats
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.2_

- [x] 3. Checkpoint — Go data layer
  - Ensure all Go tests pass (`go test ./...` from repo root). Fix any compilation errors caused by the `FillPct` removal. Ask the user if questions arise.

- [x] 4. Strip legacy mempool UI elements and extract mempool section into a partial template
  - [x] 4.1 Extract the mempool card from `cmd/dcrdata/views/home.tmpl` into a new partial `cmd/dcrdata/views/home_mempool.tmpl`
    - Move the entire mempool card `<div>` (from the opening `<!-- end mempool card -->` comment boundary) into `home_mempool.tmpl` as a named template definition, e.g. `{{define "mempoolCard"}}...{{end}}`
    - Replace the extracted block in `home.tmpl` with `{{template "mempoolCard" .}}`
    - Ensure `home_mempool.tmpl` is loaded alongside `home.tmpl` in the template set (check `templates.go` for the glob pattern or explicit file list and add the new file if needed)
    - _Requirements: maintainability_

  - [x] 4.2 Remove legacy mempool UI elements from `home_mempool.tmpl`
    - Remove the VAR total value span and its label (`data-homepage-target="mempool"`, tooltip, `threeSigFigs` value, "VAR" label) — the entire `align-right me-3` div in the title row
    - Remove the regular/ticket counts row (the `d-flex justify-content-between` block containing `mpRegCount`, `mpRegTotal`, `mpTicketCount`, `mpTicketTotal`)
    - Remove the tx-gauge animation bars row (the `mx-2 jsonly text-nowrap d-flex` block containing `mpRegBar`, `mpTicketBar`, `mpRevBar`, `mpVoteBar`)
    - Remove the revokes/votes row (the `d-flex justify-content-between` block containing `mpRevCount`, `mpRevTotal`, `mpVoteCount`, `mpVoteTotal`)
    - Keep: section title ("Mempool" heading), legend, indicator fill bars placeholder, hashes table
    - _Requirements: UI cleanup_

  - [x] 4.3 Update `home_template_test.go` to remove assertions that reference the removed elements and add a check that `home_mempool.tmpl` is included in the template set
    - Run `go test ./internal/explorer/...` to verify all template tests pass

- [x] 5. Add SCSS styles for the indicator components
  - [x] 5.1 Add mempool status colour variables to `cmd/dcrdata/public/scss/_variables.scss`
    - Add `$mempool-ok`, `$mempool-borrowing`, `$mempool-full`, `$mempool-neutral` colour variables following the existing naming convention
    - Add `--status-success`, `--status-warning`, `--status-danger`, `--status-danger-hatched` CSS custom properties mapped to the SCSS variables, with light/dark mode variants
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 5.2 Create `cmd/dcrdata/public/scss/_indicator-fill.scss` with the `.indicator-fill` component
    - Define `.indicator-fill` container styles (layout, gap between bars)
    - Define `.fill-bar` with `role="meter"` layout: label span, percentage span, track div
    - Define `.fill-bar__track` as the full-width container with `position: relative`
    - Define `.gq-segment`, `.extra-segment`, `.overflow-segment` as absolutely-positioned children of the track
      - Width driven by CSS custom properties: `calc(var(--gq-fill) * var(--gq-pos) * 100%)`, `calc(var(--extra-fill) * 100%)`, `calc(var(--overflow-fill) * 100%)` respectively
      - Apply `min-width: 2px` to all three segments
      - Apply `transform`-based transitions (not `width`) to satisfy the no-layout-reflow requirement (Requirements 2.10, 3.6, 7.2)
    - Define `.gq-marker` as absolutely positioned at `left: calc(var(--gq-pos) * 100%)`; no transition
    - Apply `[data-status="ok"]` selector: `var(--status-success)` colour on `.gq-segment`
    - Apply `[data-status="borrowing"]` selector: `var(--status-warning)` colour on `.gq-segment` and `.extra-segment`
    - Apply `[data-status="full"]` selector: `var(--status-danger)` colour on `.gq-segment` and `.overflow-segment`
    - Apply cross-hatch pattern (`repeating-linear-gradient` at 45°, class `.overflow-hatch`) to `[data-status="full"] .overflow-segment` (Requirements 1.4, 8.7; graphical-design.md §4.2)
    - Apply neutral colour fallback for empty/unknown `data-status` (Requirement 1.5)
    - Define `.total-bar` and its inner track/fill; `[data-overflow="true"]` selector for overflow appearance
    - _Requirements: 1.1–1.6, 2.8–2.10, 3.4–3.6, 7.2_

  - [x] 5.3 Import `_indicator-fill.scss` in `cmd/dcrdata/public/scss/application.scss`
    - Add `@use` or `@forward` import following the existing pattern in `application.scss`
    - _Requirements: 1.1_

- [x] 6. Checkpoint — Template and styles
  - Ensure the Go template compiles and the home page renders without errors. Run `npm run lint:css` to verify SCSS. Ask the user if questions arise.

- [x] 7. Update the Go HTML template
  - [x] 7.1 Replace the existing inline-styled CoinFills placeholder in `home_mempool.tmpl` with the proper Indicator_List structure
    - Add `data-active-ska-count="{{.Mempool.ActiveSKACount}}"` to the element carrying `data-controller="mempool"` (or the nearest appropriate controller element)
    - Add `data-mempool-target="indicatorList"` and `aria-label="Coin fill indicators"` to the Indicator_List `<div>`; do NOT add `jsonly` class (Requirement 4.5)
    - Render the Total_Bar first inside the Indicator_List: `role="meter"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` set to `min(TotalFillRatio, 1.0) × 100` rounded, `aria-label` describing total mempool load, `data-mempool-target="totalBar"`, inner track and fill driven by `--total-fill`
    - Render one Fill_Bar per CoinFills entry using a `{{range}}` loop: `role="meter"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` set to `GQFillRatio × 100` rounded, `aria-label` containing symbol and status, `data-coin="{{.Symbol}}"`, inner structure with label span, percentage span, track div containing GQ_Segment, Extra_Segment, Overflow_Segment, and GQ_Marker
    - Set CSS custom properties inline on the track: `--gq-fill`, `--extra-fill`, `--overflow-fill`, `--gq-pos`; set `data-status="{{.Status}}"` on the track
    - Add `<template id="fill-bar-template">` with the complete Fill_Bar DOM structure, all CSS custom properties set to `0`, `data-coin=""`, no Stimulus target attributes
    - _Requirements: 2.1–2.7, 3.1–3.3, 4.1, 4.4, 4.5, 4.6, 8.1–8.4, 8.7_

  - [x] 7.2 Extend the `home_viewmodel_test.go` and `home_template_test.go` tests to cover the new fields
    - Verify `TrimmedMempoolInfo.TotalFillRatio` and `ActiveSKACount` are populated correctly in the view model
    - Verify the rendered HTML contains `data-active-ska-count`, the Indicator_List, the Total_Bar, and at least one Fill_Bar
    - Verify the `<template id="fill-bar-template">` element is present in the rendered output
    - Verify the Indicator_List does NOT carry the `jsonly` class
    - _Requirements: 4.1, 4.3, 4.5, 4.6_

- [x] 8. Checkpoint — Template and styles (post-template update)
  - Ensure the Go template compiles and the home page renders without errors. Ask the user if questions arise.

- [x] 9. Update the JavaScript Mempool_Controller
  - [x] 9.1 Add `indicatorList` and `totalBar` Stimulus targets to `mempool_controller.js`
    - Add `'indicatorList'` and `'totalBar'` to the `static get targets()` array
    - _Requirements: 5.1_

  - [x] 9.2 Implement the `_rafPending` frame guard and `updateIndicators` method
    - Add `this._rafPending = false` and `this._pendingPayload = null` in `connect()`
    - Implement `updateIndicators(payload)`:
      - If `_rafPending` is true, overwrite `_pendingPayload` and return (Requirement 5.7)
      - Otherwise set `_pendingPayload = payload`, `_rafPending = true`, and call `requestAnimationFrame(() => { this._flushIndicators(); })`
    - Implement `_flushIndicators()`:
      - Read `this._pendingPayload`, set `_rafPending = false`
      - Parse `coin_fills`, `total_fill_ratio`, `active_ska_count` from payload; skip gracefully if fields are absent or malformed
      - Batch all DOM writes for Fill_Bars and Total_Bar in this single rAF callback (Requirements 5.6, 7.1, 7.3)
      - For each entry in `coin_fills`: find existing Fill_Bar by `data-coin`; if found call `_applyFillBar(el, entry)`; if not found call `injectFillBar(entry)`
      - Update Total_Bar: set `--total-fill` to `Math.min(total_fill_ratio, 1.0)`, update `aria-valuenow`, set `data-overflow` attribute when ratio > 1.0
      - Handle unknown status by setting `data-status=""` (design error handling)
    - _Requirements: 5.2, 5.3, 5.5, 5.6, 5.7, 7.1, 7.3_

  - [x] 9.3 Implement `_applyFillBar(el, entry)` helper
    - Set CSS custom properties on the track element: `--gq-fill`, `--extra-fill`, `--overflow-fill`, `--gq-pos`
    - Set `data-status` on the track element
    - Update `aria-valuenow` to `Math.round(entry.gq_fill_ratio * 100)`
    - Update `aria-label` to include symbol and human-readable status
    - Update the percentage span text to `(entry.gq_fill_ratio * 100).toFixed(1) + '%'`
    - _Requirements: 5.2, 8.5_

  - [x] 9.4 Implement `injectFillBar(entry)` method
    - Locate `<template id="fill-bar-template">`; if absent, return silently (design error handling)
    - Clone the template content with `document.importNode`
    - Set `data-coin`, all CSS custom properties, `data-status`, ARIA attributes, label text, and percentage span on the clone
    - Determine insertion point using bisect logic: VAR first, then SKA types by ascending numeric index; scan existing `[data-coin]` elements in `indicatorListTarget` to find the first one that sorts after the new symbol
    - Insert the clone at the correct position using `insertBefore` (or `appendChild` if no later element exists)
    - _Requirements: 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 9.5 Wire `updateIndicators` into the `'mempool'` WebSocket event handler
    - In the existing `ws.registerEvtHandler('mempool', ...)` callback, after the existing `this.mempool.replace(m)` and `this.setMempoolFigures()` calls, add `this.updateIndicators(m)`
    - _Requirements: 5.1, 5.5_

- [x] 10. Checkpoint — JavaScript controller
  - Ensure `npm run lint` passes on `mempool_controller.js`. Ask the user if questions arise.

- [ ] 11. Write JavaScript property-based tests
  - [ ]\* 11.1 Write property tests for P1, P15 (Fill_Bar count and no-duplicate invariants) in `cmd/dcrdata/public/js/controllers/mempool_controller.test.js`
    - **Property 1: CoinFills length equals Fill_Bar count**
    - **Property 15: No duplicate Fill_Bars per symbol**
    - **Validates: Requirements 2.1, 4.1, 6.5**

  - [ ]\* 11.2 Write property tests for P2, P5 (GQ_Segment and GQ_Marker CSS custom properties)
    - **Property 2: GQ_Segment width proportional to GQ_Fill_Ratio**
    - **Property 5: GQ_Marker position matches GQ_Position_Ratio**
    - **Validates: Requirements 2.2, 2.5**

  - [ ]\* 11.3 Write property tests for P3, P4 (Extra_Segment and Overflow_Segment)
    - **Property 3: Extra_Segment present and sized when borrowing**
    - **Property 4: Overflow_Segment present and sized when full**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]\* 11.4 Write property tests for P6, P7 (label text and percentage span)
    - **Property 6: Coin symbol appears in label and ARIA name**
    - **Property 7: Numeric utilisation percentage matches GQ_Fill_Ratio**
    - **Validates: Requirements 2.6, 2.7, 8.1**

  - [ ]\* 11.5 Write property tests for P8, P17 (Total_Bar fill and ARIA)
    - **Property 8: Total_Bar fill proportional to Total_Fill_Ratio**
    - **Property 17: Total_Bar ARIA attribute kept in sync with Total_Fill_Ratio**
    - **Validates: Requirements 3.2, 5.5, 8.4, 8.6**

  - [ ]\* 11.6 Write property tests for P10 (CoinStats_Payload parsing round-trip)
    - **Property 10: CoinStats_Payload parsing round-trip**
    - **Validates: Requirements 5.1**

  - [ ]\* 11.7 Write property tests for P11, P16 (full Fill_Bar update and ARIA sync)
    - **Property 11: All Fill_Bar fields updated on WebSocket event**
    - **Property 16: Fill_Bar ARIA attributes kept in sync with visual state**
    - **Validates: Requirements 5.2, 8.2, 8.3, 8.5**

  - [ ]\* 11.8 Write property tests for P12 (GQ_Marker repositioned for all SKA bars on Active_SKA_Count change)
    - **Property 12: GQ_Marker repositioned for all SKA bars on Active_SKA_Count change**
    - **Validates: Requirements 5.3, 6.4**

  - [ ]\* 11.9 Write property tests for P13, P14 (new Fill_Bar injection and DOM order)
    - **Property 13: New Fill_Bar created and fully initialised for unknown symbol**
    - **Property 14: CoinFills order preserved in DOM**
    - **Validates: Requirements 5.4, 6.2, 6.3**

  - [ ]\* 11.10 Write property test for P18 (status-to-class mapping is coin-type-independent)
    - **Property 18: Status-to-class mapping is coin-type-independent**
    - **Validates: Requirements 1.6**

- [x] 12. Final checkpoint — Ensure all tests pass
  - Run `go test ./...` from the repo root and `npm run test` from `cmd/dcrdata`. Ensure all tests pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The `FillPct` field removal in task 1.1 will cause compile errors in `explorer.go` and any test files that reference it — fix these as part of task 2.2
- CSS transitions MUST use `transform` (e.g. `scaleX`) rather than `width` to avoid layout reflow (Requirements 2.10, 3.6, 7.2)
- The `<template id="fill-bar-template">` element must NOT carry Stimulus target attributes, as it is inert and never rendered
- The Indicator_List must NOT carry the `jsonly` class so it remains visible without JavaScript (Requirement 4.5)
- Property tests P9 is covered by the Go template tests in task 7.2 and does not require a separate JS test
- Each property test file must tag tests with `// Feature: mempool-realtime-visual-indicators, Property N: <text>` as specified in the design
- The `.overflow-hatch` class uses `repeating-linear-gradient` at 45° per graphical-design.md §4.2 — apply only to the overflow segment, not the full bar
