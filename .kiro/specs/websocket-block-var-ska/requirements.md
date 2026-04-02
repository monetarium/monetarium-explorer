# Requirements Document

## Introduction

When a new block arrives over the WebSocket, `blocklist_controller.js` must update the home page block table with correct VAR and SKA column values. Currently the six VAR/SKA column types (`var-tx`, `var-amount`, `var-size`, `ska-tx`, `ska-amount`, `ska-size`) fall through to the default branch of the switch statement, leaving those cells blank. This feature extends the controller to populate VAR cells from the block payload, compute mock SKA data from the block height, render SKA cells with interactive accordion buttons when SKA data is present, and insert per-token SKA sub-rows immediately after each new main row — matching the server-rendered output produced by the Go template.

## Glossary

- **blocklist_controller**: The Stimulus controller at `cmd/dcrdata/public/js/controllers/blocklist_controller.js` that handles `BLOCK_RECEIVED` events and updates the home page block table.
- **BLOCK_RECEIVED**: The event published on `globalEventBus` when a new block arrives over the WebSocket, carrying a `blockData` object with a `block` sub-object.
- **block payload**: The `block` object inside `blockData`, containing fields `height`, `tx`, `total`, `size`, `unixStamp`, etc., as published by `index.js`.
- **VAR cell**: A `<td>` element whose `data-type` attribute is one of `var-tx`, `var-amount`, or `var-size`.
- **SKA cell**: A `<td>` element whose `data-type` attribute is one of `ska-tx`, `ska-amount`, or `ska-size`.
- **mockSKAData**: A JavaScript function that mirrors `home_mock.go:mockSKAData`, computing mock SKA aggregate values and per-token sub-rows from a block height integer.
- **SKASubRow**: An object with fields `tokenType`, `txCount`, `amount`, and `size` representing one token type's data for a block.
- **ska-sub-row**: A `<tr class="ska-sub-row">` element inserted into the table immediately after a main block row to show per-token SKA breakdown.
- **hasSKAData**: A boolean derived from `mockSKAData(block.height).subRows.length > 0`; true when the block has SKA activity.
- **ska-clickable**: A CSS class applied to SKA `<td>` elements when `hasSKAData` is true, enabling accordion toggle interaction.
- **humanize**: The shared JS helper module at `public/js/helpers/humanize_helper.js`, providing `threeSigFigs`, `bytes`, `timeSince`, and `date` formatting functions.

## Requirements

### Requirement 1: Populate VAR Cells from Block Payload

**User Story:** As a site visitor, I want the VAR columns in the block table to update with correct values when a new block arrives, so that I can see up-to-date VAR transaction counts, amounts, and sizes without a page reload.

#### Acceptance Criteria

1. WHEN a `BLOCK_RECEIVED` event is processed, THE blocklist_controller SHALL set the `var-tx` cell text content to `String(block.tx)`.
2. WHEN a `BLOCK_RECEIVED` event is processed, THE blocklist_controller SHALL set the `var-amount` cell text content to `humanize.threeSigFigs(block.total)`.
3. WHEN a `BLOCK_RECEIVED` event is processed, THE blocklist_controller SHALL set the `var-size` cell text content to `humanize.bytes(block.size)`.

---

### Requirement 2: Implement mockSKAData Function

**User Story:** As a developer, I want a JavaScript `mockSKAData` function that mirrors the Go `home_mock.go:mockSKAData` implementation, so that WebSocket-rendered rows are visually identical to server-rendered rows while the real SKA backend is unavailable.

#### Acceptance Criteria

1. WHEN `mockSKAData` is called with a height where `height % 9 === 0`, THE mockSKAData function SHALL return `{ skaTx: '0', skaAmt: '0', skaSz: '0', subRows: [] }`.
2. WHEN `mockSKAData` is called with a height where `height % 9 !== 0`, THE mockSKAData function SHALL return a `subRows` array containing exactly 3 entries, one for each mock token (SKA-1, SKA-2, SKA-3).
3. WHEN `mockSKAData` is called with any height, THE mockSKAData function SHALL return a `subRows` value that is always an array and never null or undefined.
4. WHEN `mockSKAData` is called with any height where `height % 9 !== 0`, THE mockSKAData function SHALL return a `skaTx` string whose integer value equals the sum of the integer values of `txCount` across all entries in `subRows`.
5. WHEN `mockSKAData` is called with any height, THE mockSKAData function SHALL compute per-token values using `offset = height % 10`, where each token's tx equals `tok.txs + offset`, amount equals `tok.amount * (1 + offset / 100)`, and size equals `tok.size + offset * 10`.
6. WHEN `mockSKAData` is called with any height where `height % 9 !== 0`, THE mockSKAData function SHALL format aggregate `skaAmt` and `skaSz` and all per-token `amount` and `size` fields using `humanize.threeSigFigs`.

---

### Requirement 3: Render SKA Cells with Conditional Accordion Controls

**User Story:** As a site visitor, I want SKA cells to display an interactive button when the block has SKA activity, so that I can click to expand the per-token breakdown accordion.

#### Acceptance Criteria

1. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is true, THE blocklist_controller SHALL add the CSS class `ska-clickable` to each SKA `<td>` element.
2. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is true, THE blocklist_controller SHALL set `data-action="click->ska-accordion#toggle"` on each SKA `<td>` element.
3. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is true, THE blocklist_controller SHALL append a `<button type="button" class="link-button">` child element inside each SKA `<td>`, with the button's text content set to the corresponding aggregate value (`skaTx`, `skaAmt`, or `skaSz`).
4. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is false, THE blocklist_controller SHALL set each SKA `<td>` text content to the corresponding aggregate value with no child elements.
5. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is false, THE blocklist_controller SHALL NOT add the `ska-clickable` class or `data-action` attribute to any SKA `<td>` element.

---

### Requirement 4: Insert SKA Sub-Rows After Main Row

**User Story:** As a site visitor, I want per-token SKA breakdown rows to appear below each new block row when SKA data is present, so that I can expand the accordion and see individual SKA token activity.

#### Acceptance Criteria

1. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is true, THE blocklist_controller SHALL insert exactly `subRows.length` `<tr class="ska-sub-row">` elements into the table immediately after the new main row.
2. WHEN a `BLOCK_RECEIVED` event is processed and `hasSKAData` is false, THE blocklist_controller SHALL insert zero `<tr class="ska-sub-row">` elements.
3. WHEN ska-sub-rows are inserted, THE blocklist_controller SHALL insert them in token order (SKA-1 first, SKA-2 second, SKA-3 third) with no other rows interleaved between them and the main row.
4. WHEN ska-sub-rows are inserted, THE blocklist_controller SHALL set `data-ska-accordion-target="subRow"` and `data-block-id` equal to `String(block.height)` on each sub-row `<tr>`.
5. WHEN ska-sub-rows are inserted, THE blocklist_controller SHALL construct each sub-row with 7 empty `<td>` spacer cells, followed by a `<td colspan="3" class="text-end fs13 fw-medium">` cell containing the token type name, followed by tx count, amount, and size cells matching the template column structure.

---

### Requirement 5: Maintain Correct Main Row Attributes

**User Story:** As a developer, I want the new main row inserted by the controller to carry the correct Stimulus data attributes, so that the ska-accordion controller can identify and manage it.

#### Acceptance Criteria

1. WHEN a `BLOCK_RECEIVED` event is processed, THE blocklist_controller SHALL set `data-ska-accordion-target="blockRow"` on the new main `<tr>` element.
2. WHEN a `BLOCK_RECEIVED` event is processed, THE blocklist_controller SHALL set `data-block-id` equal to `String(block.height)` on the new main `<tr>` element.

---

### Requirement 6: Preserve Existing Row Management Behaviour

**User Story:** As a site visitor, I want the block table to continue updating correctly when new blocks arrive, so that the table always shows the most recent blocks without duplicates or gaps.

#### Acceptance Criteria

1. WHEN a `BLOCK_RECEIVED` event is processed and `block.height` equals the height of the current top row, THE blocklist_controller SHALL remove the existing top row before inserting the new row.
2. WHEN a `BLOCK_RECEIVED` event is processed and `block.height` equals the height of the current top row plus one, THE blocklist_controller SHALL remove the last row in the table before inserting the new row.
3. WHEN a `BLOCK_RECEIVED` event is processed and `block.height` does not match either condition above, THE blocklist_controller SHALL leave the table unmodified.
4. IF the table contains no rows when a `BLOCK_RECEIVED` event is processed, THEN THE blocklist_controller SHALL leave the table unmodified.
