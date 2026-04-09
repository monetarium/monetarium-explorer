# Design Document — Mempool Real-time Visual Indicators

> Visual states, color logic, and CSS class names are specified in [`graphical-design.md`](./graphical-design.md).

## Overview

This document describes the implementation decisions for the mempool real-time visual indicators feature. The feature adds per-coin fill bars and a total-mempool bar to the home page, updated in real time via the existing WebSocket connection. The design is constrained by the existing Stimulus/Turbolinks/SCSS stack and the requirement that all DOM mutations from a single WebSocket event land in one animation frame.

The central architectural decision is that all ratio computations happen server-side. The Go server computes GQ_Fill_Ratio, Extra_Fill_Ratio, Overflow_Fill_Ratio, GQ_Position_Ratio, Total_Fill_Ratio, and Active_SKA_Count before the data leaves the process — both for the initial page render and for every WebSocket push. The JavaScript controller receives ready-to-use ratios and performs only DOM writes, never arithmetic.

---

## Architecture

The feature spans four layers that interact in a strict sequence:

1. The Go explorer package computes CoinFills from the live mempool's CoinStats map and attaches the result to both the page view model and the WebSocket message.
2. The Go HTML template renders the initial Indicator_List from the view model, embedding Active_SKA_Count as a data attribute on the controller element.
3. The Mempool_Controller receives `mempool` WebSocket events, reads the pre-computed CoinFills from the payload, and schedules a single requestAnimationFrame callback that performs all DOM writes.
4. SCSS defines all visual states — segment colours, the cross-hatch pattern, transition properties, and ARIA-adjacent layout — with no inline styles anywhere in the HTML or JavaScript.

The WebSocket message envelope is unchanged: `{ "event": "mempool", "message": "<JSON string of MempoolShort>" }`. CoinFills, Total_Fill_Ratio, and Active_SKA_Count are added as new top-level fields on MempoolShort, so they travel inside the existing `message` string without any envelope change.

---

## Components and Interfaces

### Indicator_List

The Indicator_List is a `<div>` with a Stimulus target attribute (`data-mempool-target="indicatorList"`) and a descriptive `aria-label`. It is placed inside the existing mempool card in `home.tmpl`, immediately after the four `.tx-gauge` elements and before the transaction table. It carries no `jsonly` class, so it is visible in the no-JavaScript case with the server-rendered fill state intact.

The Indicator_List holds, in order: the Total_Bar element, then one Fill_Bar element per CoinFills entry. The Total_Bar is always first and is never reordered. Fill_Bars follow in the same order as the CoinFills list.

### Fill_Bar

Each Fill_Bar is a `<div>` with `role="meter"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` set to the rounded GQ_Fill_Ratio percentage, and `aria-label` set to a string that includes the coin symbol and the human-readable status (e.g. "VAR — ok"). It carries a `data-coin` attribute holding the coin symbol, which is the key used by the controller to locate the element during updates.

Internally a Fill_Bar has this child structure, in DOM order:

- A label `<span>` containing the coin symbol as visible text.
- A percentage `<span>` containing the numeric utilisation value (GQ_Fill_Ratio × 100, rounded to one decimal place, suffixed with "%").
- A track `<div>` that is the full-width container for all segments and the marker. This is the element whose width defines 100% for all child ratios.
  - A GQ_Segment `<div>` whose visual width is driven by a CSS custom property `--gq-fill` set to the GQ_Fill_Ratio value. The segment's rendered width is `calc(var(--gq-fill) * var(--gq-pos) * 100%)` — that is, GQ_Fill_Ratio scaled to the quota's share of the bar. A `min-width: 2px` rule is applied in SCSS so that even at extreme Active_SKA_Count values (up to 255, where each SKA quota is ~0.35% of TC) the segment remains visible when non-zero.
  - An Extra_Segment `<div>` whose visual width is driven by `--extra-fill` set to Extra_Fill_Ratio. Its rendered width is `calc(var(--extra-fill) * 100%)` relative to the track. It is hidden (zero width, `aria-hidden="true"`) when status is not `borrowing`. A `min-width: 2px` rule is applied so a borrowing state is never invisible at high token counts.
  - An Overflow_Segment `<div>` whose visual width is driven by `--overflow-fill` set to Overflow_Fill_Ratio. Its rendered width is `calc(var(--overflow-fill) * 100%)` relative to the track. It is hidden when status is not `full`. It carries an additional `aria-label="overflow"` to identify the full condition independently of the cross-hatch pattern. A `min-width: 2px` rule is applied so the red overflow state is always visible regardless of how small the ratio is.
  - A GQ_Marker `<div>` that is absolutely positioned within the track. Its `left` property is set to `calc(var(--gq-pos) * 100%)` where `--gq-pos` is the GQ_Position_Ratio. The marker does not animate; it is repositioned immediately when Active_SKA_Count changes.

The status is reflected on the Fill_Bar's track element via a `data-status` attribute. SCSS uses `[data-status="ok"]`, `[data-status="borrowing"]`, and `[data-status="full"]` selectors to apply the appropriate background colours to GQ_Segment and the active variable segment. The cross-hatch pattern on the Overflow_Segment is applied via a separate SCSS rule scoped to `[data-status="full"] .overflow-segment`.

### Total_Bar

The Total_Bar is a `<div>` with `role="meter"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` set to `min(Total_Fill_Ratio, 1.0) × 100` rounded, and `aria-label` set to a string describing the total mempool load (e.g. "Total mempool: 42% of block capacity"). It carries `data-mempool-target="totalBar"`.

Internally it has:

- A label `<span>` with the human-readable size string (e.g. "128 kB / 384 kB").
- A track `<div>` that is the full-width container.
  - A fill `<div>` whose visual width is driven by `--total-fill` set to `min(Total_Fill_Ratio, 1.0)`. Its rendered width is `calc(var(--total-fill) * 100%)`.
  - The track carries `data-overflow="true"` when Total_Fill_Ratio exceeds 1.0, which SCSS uses to apply a distinct overflow appearance to the fill element.

### Reusable `<template>` for Dynamic Injection

A single `<template>` element with `id="fill-bar-template"` is placed inside the Indicator_List (or immediately adjacent to it, outside the visible flow). It contains the complete Fill_Bar DOM structure described above, with all CSS custom properties set to `0` and `data-coin` set to an empty string. The template element is inert — it is never rendered by the browser and carries no Stimulus target attributes.

When the controller needs to create a new Fill_Bar for a previously unseen SKA token, it clones the template's content with `document.importNode`, sets `data-coin` to the new symbol, populates all CSS custom properties and the `data-status` attribute from the CoinFills entry, sets the ARIA attributes, and inserts the clone into the Indicator_List at the correct position using `insertBefore` logic. The insertion point is determined by scanning existing Fill_Bar elements in the list and finding the first one whose `data-coin` value sorts after the new symbol in the canonical order (VAR first, then SKA types by ascending numeric index). If no such element exists, the new bar is appended at the end. This bisect-style insertion ensures that a late-arriving SKA-1 is always placed before SKA-2, SKA-5, etc., regardless of the order in which tokens first appear in the mempool.

The template approach is chosen over JavaScript string construction because it keeps the HTML structure as a single source of truth in the template file, avoids innerHTML sanitisation concerns, and is compatible with the existing DOMPurify usage pattern in the controller.

---

## Data Models

### Extended CoinFillData (Go)

The existing `CoinFillData` struct in `explorer/types/explorertypes.go` is extended with four new fields and the legacy `FillPct` field is removed:

- `Symbol string` — coin identifier ("VAR" or "SKA-n")
- `GQFillRatio float64` — fraction of the coin's Guaranteed Quota consumed, in [0.0, 1.0]
- `ExtraFillRatio float64` — fraction of TC consumed beyond quota, in [0.0, 1.0]; zero when status is not `borrowing`
- `OverflowFillRatio float64` — fraction of TC that cannot fit in the block, in [0.0, 1.0]; zero when status is not `full`
- `GQPositionRatio float64` — position of the quota boundary as a fraction of TC, in (0.0, 1.0]
- `Status string` — one of "ok", "borrowing", "full"

JSON field names use snake_case to match the existing convention: `gq_fill_ratio`, `extra_fill_ratio`, `overflow_fill_ratio`, `gq_position_ratio`, `status`.

### Extended MempoolShort (Go)

Two new fields are added to `MempoolShort` in `explorer/types/explorertypes.go`:

- `CoinFills []CoinFillData` — ordered list of per-coin fill data; JSON key `coin_fills`
- `TotalFillRatio float64` — ratio of total mempool bytes to TC, unclamped; JSON key `total_fill_ratio`
- `ActiveSKACount int` — count of distinct SKA types in the current CoinFills list; JSON key `active_ska_count`

`CoinFills` is also retained on `MempoolInfo` (which embeds `MempoolShort`) and on `TrimmedMempoolInfo` for the initial page render path.

### CoinStats_Payload (JavaScript)

The JavaScript controller receives the `MempoolShort` JSON object as the parsed payload of the `mempool` WebSocket event. The relevant fields the controller reads are:

- `coin_fills` — array of objects, each with `symbol`, `gq_fill_ratio`, `extra_fill_ratio`, `overflow_fill_ratio`, `gq_position_ratio`, `status`
- `total_fill_ratio` — number
- `active_ska_count` — integer

No client-side ratio computation is performed. The controller treats these fields as opaque display values.

### Server-Side Computation (Go)

The `computeCoinFills` function in `cmd/dcrdata/internal/explorer/explorer.go` is rewritten to produce the extended `CoinFillData` fields. The computation logic is:

- TC is 393 216 bytes (defined as a named constant).
- VAR's Guaranteed Quota is 10% of TC (39 321.6 bytes).
- Each active SKA type's Guaranteed Quota is 90% of TC divided by Active_SKA_Count.
- GQ_Position_Ratio for VAR is always 0.10 (its quota boundary is always at 10% of TC).
- GQ_Position_Ratio for each SKA type is `0.90 / Active_SKA_Count` (its quota boundary within the bar, expressed as a fraction of TC).
- GQ_Fill_Ratio for a coin is `min(coinSize / coinQuota, 1.0)`.
- Status is determined as before: "ok" if coinSize ≤ coinQuota, "borrowing" if coinSize > coinQuota but totalUsed ≤ TC, "full" if totalUsed > TC.
- Extra_Fill_Ratio is `(coinSize - coinQuota) / TC` when status is "borrowing", clamped to [0.0, 1.0]; zero otherwise.
- Overflow_Fill_Ratio is `(coinSize - coinQuota) / TC` when status is "full", clamped to [0.0, 1.0]; zero otherwise. (The overflow is the amount beyond quota that cannot fit, expressed as a fraction of TC.)
- Total_Fill_Ratio is `totalUsed / TC`, unclamped (the display layer clamps it to 1.0 for the bar width but the raw value is preserved for the overflow indicator).
- Active_SKA_Count is the count of entries in the CoinStats map with key ≠ 0.

The function returns the fills slice with VAR always first, followed by SKA types in ascending token-type order (sorted by the uint8 coin-type key). This deterministic ordering ensures the DOM order is stable across updates.

The function is called in two places: when building the home page view model for the initial render, and when the mempool monitor updates `MempoolShort` (which is then broadcast via the WebSocket hub). Both call sites pass the same `maxBlockSize` value derived from the node's chain parameters.

### Initial Page Render Embedding

The home page view model (`TrimmedMempoolInfo`) carries `CoinFills`, `TotalFillRatio`, and `ActiveSKACount`. The template renders these directly. `ActiveSKACount` is embedded as `data-active-ska-count="{{.Mempool.ActiveSKACount}}"` on the element that carries `data-controller="mempool"`, so the controller can read it from `this.element.dataset.activeSkaCount` during `connect()` without any DOM traversal.

---

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: CoinFills length equals Fill_Bar count

_For any_ CoinFills list of length N, after the Indicator_List is rendered or updated, the number of Fill_Bar elements in the Indicator_List must equal exactly N.

**Validates: Requirements 2.1, 4.1**

### Property 2: GQ_Segment width proportional to GQ_Fill_Ratio

_For any_ GQ_Fill_Ratio in [0.0, 1.0] and any GQ_Position_Ratio in (0.0, 1.0], the CSS custom property `--gq-fill` on the Fill_Bar's track element must equal GQ_Fill_Ratio, and the rendered GQ_Segment width must equal `GQ_Fill_Ratio × GQ_Position_Ratio × 100%` of the track width.

**Validates: Requirements 2.2**

### Property 3: Extra_Segment present and sized when borrowing

_For any_ CoinFillData with status "borrowing" and any Extra_Fill_Ratio in [0.0, 1.0], the Extra_Segment must be visible (non-zero width) and its CSS custom property `--extra-fill` must equal Extra_Fill_Ratio.

**Validates: Requirements 2.3**

### Property 4: Overflow_Segment present and sized when full

_For any_ CoinFillData with status "full" and any Overflow_Fill_Ratio in [0.0, 1.0], the Overflow_Segment must be visible (non-zero width) and its CSS custom property `--overflow-fill` must equal Overflow_Fill_Ratio.

**Validates: Requirements 2.4**

### Property 5: GQ_Marker position matches GQ_Position_Ratio

_For any_ GQ_Position_Ratio in (0.0, 1.0], the GQ_Marker element's `--gq-pos` CSS custom property must equal GQ_Position_Ratio, placing the marker at `GQ_Position_Ratio × 100%` of the track width.

**Validates: Requirements 2.5**

### Property 6: Coin symbol appears in label and ARIA name

_For any_ coin symbol string, the Fill_Bar's visible label span must contain that symbol as its text content, and the Fill_Bar's `aria-label` attribute must contain that symbol.

**Validates: Requirements 2.6, 8.1**

### Property 7: Numeric utilisation percentage matches GQ_Fill_Ratio

_For any_ GQ_Fill_Ratio in [0.0, 1.0], the percentage span's text content must equal `round(GQ_Fill_Ratio × 100, 1)` followed by "%".

**Validates: Requirements 2.7**

### Property 8: Total_Bar fill proportional to Total_Fill_Ratio

_For any_ Total_Fill_Ratio ≥ 0.0, the Total_Bar's `--total-fill` CSS custom property must equal `min(Total_Fill_Ratio, 1.0)`, and the fill element's rendered width must equal `min(Total_Fill_Ratio, 1.0) × 100%` of the track width.

**Validates: Requirements 3.2, 5.5**

### Property 9: Active_SKA_Count embedded in rendered page

_For any_ Active_SKA_Count value in [0, 255], the rendered home page HTML must contain a `data-active-ska-count` attribute on the controller element whose value, when parsed as an integer, equals Active_SKA_Count.

**Validates: Requirements 4.6**

### Property 10: CoinStats_Payload parsing round-trip

_For any_ valid CoinStats_Payload JSON object, parsing it in the controller must yield `coin_fills`, `total_fill_ratio`, and `active_ska_count` values that are structurally identical to the original payload fields — no fields dropped, no values coerced.

**Validates: Requirements 5.1**

### Property 11: All Fill_Bar fields updated on WebSocket event

_For any_ CoinFillData entry whose symbol matches an existing Fill_Bar, after the controller processes a WebSocket event containing that entry, the Fill_Bar's `--gq-fill`, `--extra-fill`, `--overflow-fill`, `--gq-pos`, `data-status`, `aria-valuenow`, `aria-label`, and percentage label must all reflect the new entry values.

**Validates: Requirements 5.2, 8.5**

### Property 12: GQ_Marker repositioned for all SKA bars on Active_SKA_Count change

_For any_ new Active_SKA_Count value in [1, 255], after the controller processes a WebSocket event with that count, every SKA Fill_Bar's `--gq-pos` CSS custom property must equal `0.9 / Active_SKA_Count`.

**Validates: Requirements 5.3, 6.4**

### Property 13: New Fill_Bar created and fully initialised for unknown symbol

_For any_ coin symbol not currently present in the Indicator_List, after the controller processes a CoinFills entry with that symbol, exactly one new Fill_Bar must exist in the list with all CSS custom properties, `data-status`, ARIA attributes, and label text set to match the entry.

**Validates: Requirements 5.4, 6.2**

### Property 14: CoinFills order preserved in DOM

_For any_ CoinFills list and any sequence of dynamic injections, the DOM order of Fill_Bar elements in the Indicator_List (excluding the Total_Bar) must be: VAR first, then SKA types in ascending numeric index order — regardless of the order in which tokens first appeared in the mempool.

**Validates: Requirements 6.3**

### Property 15: No duplicate Fill_Bars per symbol

_For any_ coin symbol already present in the Indicator_List, after processing any number of CoinFills updates containing that symbol, the count of Fill_Bar elements with `data-coin` equal to that symbol must remain exactly 1.

**Validates: Requirements 6.5**

### Property 16: Fill_Bar ARIA attributes kept in sync with visual state

_For any_ CoinFillData update, after the controller applies it, the Fill_Bar's `aria-valuenow` must equal `round(GQ_Fill_Ratio × 100)` and the `aria-label` must contain the human-readable status string corresponding to the new status value.

**Validates: Requirements 8.2, 8.3, 8.5**

### Property 17: Total_Bar ARIA attribute kept in sync with Total_Fill_Ratio

_For any_ Total_Fill_Ratio update, after the controller applies it, the Total_Bar's `aria-valuenow` must equal `round(min(Total_Fill_Ratio, 1.0) × 100)`.

**Validates: Requirements 8.4, 8.6**

### Property 18: Status-to-class mapping is coin-type-independent

_For any_ coin symbol (VAR or any SKA-n) and any valid status value ("ok", "borrowing", "full"), the `data-status` attribute value set on the Fill_Bar's track element must be determined solely by the status value, not by the coin symbol.

**Validates: Requirements 1.6**

---

## Error Handling

### Missing or malformed CoinFills in WebSocket payload

If the `coin_fills` field is absent or not an array in the received payload, the controller skips the Fill_Bar update pass entirely and leaves the existing DOM state unchanged. It still processes `total_fill_ratio` and `active_ska_count` if those fields are present and valid.

### Missing Total_Fill_Ratio

If `total_fill_ratio` is absent or not a finite number, the Total_Bar update is skipped. The existing displayed value is preserved.

### Unknown status value

If a CoinFillData entry carries a status value other than "ok", "borrowing", or "full", the controller sets `data-status` to an empty string. SCSS provides a neutral-colour fallback for the empty-string case, satisfying the no-known-status requirement without throwing.

### Template element absent

If the `<template id="fill-bar-template">` element is not found in the DOM when the controller attempts to inject a new Fill_Bar, the injection is silently skipped. The existing Fill_Bars continue to update normally. This guards against partial HTML delivery during Turbolinks navigation.

### Rapid WebSocket events (frame guard)

The controller maintains a boolean `_rafPending` flag. When a WebSocket event arrives and `_rafPending` is false, the controller captures the latest payload, sets `_rafPending = true`, and schedules a requestAnimationFrame callback. If a subsequent event arrives before the frame fires, the controller overwrites the captured payload with the newer one but does not schedule a second frame. When the frame fires, it reads the latest captured payload, performs all DOM writes, and sets `_rafPending = false`. This ensures at most one pending frame at any time and that the most recent data is always what gets rendered.

### Server-side empty CoinStats

If the mempool's CoinStats map is empty (no transactions of any coin type), `computeCoinFills` returns a single-entry slice containing VAR with all ratios at 0.0 and status "ok". This guarantees the template always has at least one entry to render and the controller always has a VAR Fill_Bar to update.

---

## Testing Strategy

### Unit Tests (Go)

The `computeCoinFills` function is the primary unit-test target on the server side. Tests cover:

- VAR-only mempool: verifies GQ_Fill_Ratio, GQ_Position_Ratio (always 0.10), and status for a range of VAR sizes.
- Mixed VAR + multiple SKA types: verifies per-SKA GQ_Position_Ratio equals `0.9 / numSKA`, and that status transitions correctly at the quota and TC boundaries.
- Empty CoinStats: verifies the single-VAR fallback entry.
- Total_Fill_Ratio computation: verifies the unclamped ratio for both under-capacity and over-capacity mempools.
- Active_SKA_Count: verifies it equals the number of non-zero keys in CoinStats.

The existing `home_viewmodel_test.go` and `home_template_test.go` files are extended to cover the new fields in the view model and the rendered HTML structure of the Indicator_List.

### Property-Based Tests (JavaScript — Vitest + fast-check)

fast-check is the chosen PBT library. Each property test runs a minimum of 100 iterations.

Tests are placed in `cmd/dcrdata/public/js/controllers/mempool_controller.test.js` using the jsdom environment already configured for Vitest.

Each test is tagged with a comment in the format:
`// Feature: mempool-realtime-visual-indicators, Property N: <property text>`

The controller is tested by constructing a minimal DOM fixture (Indicator_List with a pre-rendered VAR Fill_Bar and the `<template>` element), instantiating the controller against it, and calling the internal update method directly with generated payloads. requestAnimationFrame is replaced with a synchronous stub in the test environment.

Properties tested:

- P1: Generate CoinFills arrays of random length [0, 20]; verify Fill_Bar count equals length after update.
- P2: Generate random GQ_Fill_Ratio and GQ_Position_Ratio pairs; verify `--gq-fill` equals GQ_Fill_Ratio.
- P3: Generate random Extra_Fill_Ratio with status "borrowing"; verify Extra_Segment `--extra-fill` equals Extra_Fill_Ratio.
- P4: Generate random Overflow_Fill_Ratio with status "full"; verify Overflow_Segment `--overflow-fill` equals Overflow_Fill_Ratio.
- P5: Generate random GQ_Position_Ratio; verify GQ_Marker `--gq-pos` equals GQ_Position_Ratio.
- P6: Generate random coin symbol strings; verify label text and aria-label contain the symbol.
- P7: Generate random GQ_Fill_Ratio; verify percentage span text equals the rounded value.
- P8: Generate random Total_Fill_Ratio including values > 1.0; verify `--total-fill` equals min(ratio, 1.0).
- P9: Covered by Go template tests (server-side rendering).
- P10: Generate random CoinStats_Payload objects; verify parsed fields match originals.
- P11: Generate random CoinFillData updates for an existing Fill_Bar; verify all six CSS properties and both ARIA attributes are updated.
- P12: Generate random Active_SKA_Count values; verify all SKA Fill_Bars have `--gq-pos` equal to `0.9 / count`.
- P13: Generate random new coin symbols; verify a new Fill_Bar is created with all fields set correctly.
- P14: Generate random CoinFills orderings; verify DOM order matches list order.
- P15: Generate repeated updates for the same symbol; verify Fill_Bar count for that symbol remains 1.
- P16: Generate random GQ_Fill_Ratio and status pairs; verify aria-valuenow and aria-label are correct.
- P17: Generate random Total_Fill_Ratio values; verify Total_Bar aria-valuenow is correct.
- P18: Generate random (symbol, status) pairs; verify data-status is determined only by status.

### Integration / Smoke Tests

- Verify the CSS transition property is set on GQ_Segment, Extra_Segment, Overflow_Segment, and the Total_Bar fill element, and that the animated property is `transform` (not `width`), confirming the no-layout-reflow constraint.
- Verify the `<template id="fill-bar-template">` element exists in the rendered home page HTML.
- Verify the Indicator_List appears after the `.tx-gauge` elements in the rendered DOM.
- Verify the Indicator_List does not carry the `jsonly` class.
- Verify the controller element carries `data-active-ska-count` in the rendered HTML.
