# Design Document: Home Block Table Simplified

## Overview

This feature replaces the 13-column grouped layout of the Latest Blocks table (`home_latest_blocks.tmpl`) with a flat 9-column layout. The new layout removes the two-row grouped header (Overview / VAR / SKA) and presents all columns in a single header row.

**What changes:**

- `cmd/dcrdata/views/home_latest_blocks.tmpl` — rewritten to the flat 9-column layout
- `cmd/dcrdata/public/js/controllers/blocklist_controller.js` — updated to match the new column structure and insert VAR/SKA sub-rows on live block events

**What stays the same (already implemented):**

- `home_viewmodel.go` — `HomeBlockRow`, `SKASubRow`, `buildHomeBlockRows()`
- `home_mock.go` — `mockSKAData()` with 3 mock SKA tokens
- `explorerroutes.go` — `Home()` handler passes `Blocks []HomeBlockRow` to the template
- `templates.go` — `threeSigFigs()` used by the view model
- `ska_accordion_controller.js` — Stimulus controller with `toggle()`, `blockRow`/`subRow` targets
- `home.scss` — `.ska-sub-row`, `.ska-sub-row--visible`, `.ska-clickable`, `.sticky-col`, etc.

---

## Architecture

Data flows from the database through the handler to the template without modification:

```
DB / mock
  └─► buildHomeBlockRows([]*BlockBasic) []HomeBlockRow
        └─► Home() handler  →  HomeInfo{Blocks: []HomeBlockRow}
              └─► home_latest_blocks.tmpl  →  HTML table
                    └─► ska_accordion_controller.js  (expand/collapse)

WebSocket (live updates)
  └─► BLOCK_RECEIVED event  →  blocklist_controller.js._processBlock()
        ├─► mockSKAData(height)  →  SKA values (mirrors Go mock)
        ├─► builds new <tr> with 9 cells matching data-type attributes
        ├─► insertVARSubRow()  →  inserts VAR sub-row after block row
        ├─► insertSKASubRows()  →  inserts SKA-n sub-rows after VAR row
        └─► removes oldest block row + its sub-rows
```

All numeric formatting happens in `buildHomeBlockRows` (via `threeSigFigs`) and `mockSKAData`. The template performs no arithmetic — it only renders pre-formatted strings.

The Stimulus controller (`data-controller="ska-accordion"` on `<tbody>`) handles expand/collapse by matching `data-block-id` attributes between block rows and sub-rows.

---

## Components and Interfaces

### Template: `home_latest_blocks.tmpl` (primary remaining work)

The template is rewritten to produce a flat 9-column table. Key structural rules:

- Single `<thead>` row — no group header row
- Column order: Height | Txn | VAR | SKA | Size | Vote | Tkt | Rev | Age
- `<tbody data-controller="ska-accordion" data-blocklist-target="table">`
- Each block renders one `<tr data-ska-accordion-target="blockRow" data-block-id="{{.Height}}">`
- When `HasSKAData` is true, the SKA cell gets `data-action="click->ska-accordion#toggle"` and `.ska-clickable`
- After each block row: one VAR sub-row + N SKA sub-rows, all with `class="ska-sub-row"` and `data-ska-accordion-target="subRow" data-block-id="{{.Height}}"`

Sub-row column mapping (empty cells render a placeholder `—`):

| Column | VAR sub-row field | SKA-n sub-row field |
| ------ | ----------------- | ------------------- |
| Height | empty             | empty               |
| Txn    | `.VARTxCount`     | `.TxCount`          |
| VAR    | `.VARAmount`      | empty               |
| SKA    | empty             | `.Amount`           |
| Size   | `.VARSize`        | `.Size`             |
| Vote   | empty             | empty               |
| Tkt    | empty             | empty               |
| Rev    | empty             | empty               |
| Age    | empty             | empty               |

### JS Controller: `ska_accordion_controller.js` (already implemented)

Targets: `blockRow`, `subRow`. The `toggle()` method finds all sub-rows sharing the clicked row's `data-block-id` and toggles `.ska-sub-row--visible`.

### SCSS: `home.scss` (already implemented)

`.ska-sub-row` hides sub-rows by default (`display: none`). `.ska-sub-row--visible` shows them (`display: table-row`). `.ska-clickable` sets `cursor: pointer`. `.sticky-col` pins the Height column.

---

### JS Controller: `blocklist_controller.js` (needs update)

**File**: `cmd/dcrdata/public/js/controllers/blocklist_controller.js`

The controller listens for `BLOCK_RECEIVED` events and prepends a new block row to the table. It must be updated to match the new 9-column flat layout.

The current implementation already has `mockSKAData()`, `buildSKACell()`, and `insertSKASubRows()` helpers — but they target the old 13-column structure. The update requires:

#### WebSocket payload shape

`index.js` parses the raw JSON and publishes `blockData` with this shape:

```javascript
blockData = {
  block: {
    height: 123456, // int64
    hash: "...",
    tx: 5, // int    → var-tx
    size: 12345, // int32  → var-size, size
    total: 1234.5, // float64 → var-amount
    votes: 5, // → votes
    tickets: 3, // → tickets
    revocations: 0, // → revocations
    unixStamp: 1704067200, // added by index.js → age
  },
};
```

Key mapping from Go JSON tags to JS property names:

| Go field (`BlockBasic`) | JSON tag        | JS access           | `data-type`        |
| ----------------------- | --------------- | ------------------- | ------------------ |
| `Transactions`          | `"tx"`          | `block.tx`          | `var-tx`           |
| `Total`                 | `"total"`       | `block.total`       | `var-amount`       |
| `Size`                  | `"size"`        | `block.size`        | `var-size`, `size` |
| `Voters`                | `"votes"`       | `block.votes`       | `votes`            |
| `FreshStake`            | `"tickets"`     | `block.tickets`     | `tickets`          |
| `Revocations`           | `"revocations"` | `block.revocations` | `revocations`      |
| `Height`                | `"height"`      | `block.height`      | SKA mock input     |

#### Updated `_processBlock()` switch statement

The new 9-column layout uses these `data-type` values:

| `data-type`   | Cell value                                |
| ------------- | ----------------------------------------- |
| `height`      | `<a href="/block/{h}">{h}</a>`            |
| `tx`          | `String(block.tx)` (total transactions)   |
| `var-amount`  | `humanize.threeSigFigs(block.total)`      |
| `ska-amount`  | `buildSKACell(newTd, skaAmt, hasSKAData)` |
| `size`        | `humanize.bytes(block.size)`              |
| `votes`       | `block.votes`                             |
| `tickets`     | `block.tickets`                           |
| `revocations` | `block.revocations`                       |
| `age`         | `humanize.timeSince(block.unixStamp)`     |

Note: the new flat layout has no `var-tx`, `var-size`, `ska-tx`, or `ska-size` columns in the main block row — those only appear in sub-rows. The main row SKA column uses `data-type="ska-amount"` only.

#### New `insertVARSubRow(tbody, newRow, block)`

Inserts a single VAR sub-row immediately after the block row. The sub-row has 9 cells matching the flat column order:

| Col | `data-type`  | Content                              | CSS classes   |
| --- | ------------ | ------------------------------------ | ------------- |
| 1   | `height`     | empty                                | `sticky-col`  |
| 2   | `tx`         | `String(block.tx)`                   | `text-center` |
| 3   | `var-amount` | `humanize.threeSigFigs(block.total)` | `text-end`    |
| 4   | `ska-amount` | empty (`—`)                          | `text-end`    |
| 5   | `size`       | `humanize.bytes(block.size)`         | `text-end`    |
| 6–9 | —            | empty                                | —             |

The sub-row carries `class="ska-sub-row"`, `data-ska-accordion-target="subRow"`, and `data-block-id=String(block.height)`.

#### Updated `insertSKASubRows(tbody, insertRef, subRows, blockHeight)`

Inserts SKA-n sub-rows after the VAR sub-row. Each sub-row has 9 cells:

| Col | `data-type`  | Content       | CSS classes   |
| --- | ------------ | ------------- | ------------- |
| 1   | `height`     | empty         | `sticky-col`  |
| 2   | `tx`         | `sub.txCount` | `text-center` |
| 3   | `var-amount` | empty (`—`)   | `text-end`    |
| 4   | `ska-amount` | `sub.amount`  | `text-end`    |
| 5   | `size`       | `sub.size`    | `text-end`    |
| 6–9 | —            | empty         | —             |

The token label (`sub.tokenType`, e.g. `"SKA-1"`) is rendered as a badge `<span>` prepended to the Txn cell content, matching the template's badge pattern. Each sub-row carries `class="ska-sub-row"`, `data-ska-accordion-target="subRow"`, and `data-block-id=String(blockHeight)`.

#### Oldest row removal

When prepending a new block, the controller must remove the last Block_Row **and all its associated sub-rows** (all `<tr>` elements with matching `data-block-id`). The current implementation only removes the last `<tr>`, which leaves orphaned sub-rows.

#### `mockSKAData()` parity

The `mockSKAData()` function in the JS controller must remain logically identical to the Go `mockSKAData()` in `home_mock.go` — same token list, same `height % 9 === 0` zero-case, same `height % 10` offset formula, same `humanize.threeSigFigs` formatting for amounts and sizes.

---

## Data Models

### `HomeBlockRow` — block row fields used by the template

| Field            | Type            | Template column | Notes                                            |
| ---------------- | --------------- | --------------- | ------------------------------------------------ |
| `Height`         | `int64`         | Height          | Also used as `data-block-id`                     |
| `Hash`           | `string`        | (href)          | Used in `/block/{{.Hash}}` link                  |
| `Transactions`   | `int`           | Txn             | Total tx count                                   |
| `Voters`         | `uint16`        | Vote            |                                                  |
| `FreshStake`     | `uint8`         | Tkt             |                                                  |
| `Revocations`    | `uint32`        | Rev             |                                                  |
| `FormattedBytes` | `string`        | Size            |                                                  |
| `BlockTime`      | `types.TimeDef` | Age             | `.UNIX` for JS, `.DatetimeWithoutTZ` for display |
| `VARTxCount`     | `int`           | Txn (VAR row)   | Equals `Transactions`                            |
| `VARAmount`      | `string`        | VAR             | `threeSigFigs(b.Total)`                          |
| `VARSize`        | `string`        | Size (VAR row)  | Equals `FormattedBytes`                          |
| `SKATxCount`     | `string`        | Txn (SKA col)   | Pre-formatted aggregate                          |
| `SKAAmount`      | `string`        | SKA             | Pre-formatted aggregate                          |
| `SKASize`        | `string`        | Size (SKA col)  | Pre-formatted aggregate (unused in new layout)   |
| `HasSKAData`     | `bool`          | (conditional)   | Controls clickable SKA cells                     |
| `SKASubRows`     | `[]SKASubRow`   | (sub-rows)      | One entry per SKA-n variant                      |

### `SKASubRow` — per-SKA-token sub-row fields

| Field       | Type     | Template column       |
| ----------- | -------- | --------------------- |
| `TokenType` | `string` | (label, e.g. "SKA-1") |
| `TxCount`   | `string` | Txn                   |
| `Amount`    | `string` | SKA                   |
| `Size`      | `string` | Size                  |

---

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Block row field preservation (existing)

_For any_ `BlockBasic`, `buildHomeBlockRows` must copy all overview fields (Height, Hash, Transactions, Voters, FreshStake, Revocations, FormattedBytes, BlockTime) into the resulting `HomeBlockRow` without modification.

**Validates: Requirements 1.1, 4.1, 4.3**

### Property 2: VAR amount pre-formatting (existing)

_For any_ `BlockBasic` with a `Total` value, `VARAmount` in the resulting row must equal `threeSigFigs(Total)`.

**Validates: Requirements 2.2, 4.2**

### Property 3: Sub-row count invariant

_For any_ block where `HasSKAData` is true, the number of rendered sub-rows must equal `len(SKASubRows)`. When `HasSKAData` is false, no sub-rows are rendered.

**Validates: Requirements 3.2, 3.3**

### Property 4: No aggregate SKA sub-row

_For any_ block, no entry in `SKASubRows` should have a `TokenType` that is a bare aggregate label (i.e. equal to `"SKA"` without an index suffix). Every sub-row must identify a specific SKA-n variant.

**Validates: Requirement 3.4**

### Property 5: SKA sub-rows in ascending token index order

_For any_ block with SKA data, the `SKASubRows` slice must be ordered by ascending SKA-n index (e.g. SKA-1 before SKA-2 before SKA-3).

**Validates: Requirement 8.2**

### Property 6: Block row order preservation

_For any_ input slice of `BlockBasic` values already sorted in descending height order, `buildHomeBlockRows` must produce output rows in the same order (no reordering).

**Validates: Requirement 8.1**

### Property 7: Expand/collapse round-trip (JS controller)

_For any_ rendered table with at least one block that has SKA data, toggling a block row twice (expand then collapse) must return all its sub-rows to the hidden state (no `.ska-sub-row--visible` class).

**Validates: Requirements 6.2, 6.3**

### Property 8: WebSocket block prepend matches server-rendered output

_For any_ block height `h`, the DOM structure produced by `blocklist_controller._processBlock()` must be structurally equivalent to the server-rendered HTML for the same height: same number of cells per row (9), same `data-type` attributes in the same column order, same `data-block-id` on block row and all sub-rows, same presence/absence of `ska-clickable` and `data-action` on the SKA cell, and same number of VAR + SKA sub-rows.

**Validates: Requirements 13.1–13.7**

### Property 9: Oldest row removal leaves no orphaned sub-rows

_For any_ table state with N block rows each having sub-rows, after `_processBlock()` prepends a new block, the table must contain exactly N block rows — no `<tr>` elements with the removed block's `data-block-id` must remain in the DOM.

**Validates: Requirement 13.8**

### Property 10: VAR cells populated from block payload

_For any_ block payload, the `var-amount` cell text in the new main row equals `humanize.threeSigFigs(block.total)`, and the VAR sub-row Txn cell equals `String(block.tx)`, VAR cell equals `humanize.threeSigFigs(block.total)`, Size cell equals `humanize.bytes(block.size)`.

**Validates: Requirements 13.2**

### Property 11: SKA cell interactivity conditioned on hasSKAData

_For any_ block height `h`, if `mockSKAData(h).subRows.length > 0` then the SKA cell in the main row carries `ska-clickable` class and `data-action="click->ska-accordion#toggle"` with a `<button>` child; otherwise the cell has plain text content with no class, no action, and no child elements.

**Validates: Requirements 13.4, 13.5**

---

## Error Handling

- **Nil blocks**: `buildHomeBlockRows` skips nil entries silently — already implemented.
- **Empty block list**: renders an empty `<tbody>` — the template's `range` loop produces no rows.
- **Missing SKA data** (`HasSKAData = false`): SKA cells render the pre-formatted aggregate strings without click handlers; no sub-rows are emitted.
- **Zero/empty formatted values**: Go template renders the string as-is; a `"0"` or `"0 B"` value is acceptable. A dedicated placeholder (`—`) should be rendered for truly absent optional fields using a template helper or conditional.

---

## Testing Strategy

### Unit tests (Go)

Focus on specific examples and edge cases in `home_viewmodel_test.go` and `home_mock_test.go`:

- `TestBuildHomeBlockRows_FieldPreservation` — known input, verify all fields copied exactly
- `TestBuildHomeBlockRows_NilSkipping` — nil entries are skipped
- `TestBuildHomeBlockRows_HasSKAData` — `HasSKAData` flag set correctly
- `TestSKASubRow_TokenTypeNonEmpty` — all sub-row token types are non-empty
- `TestMockSKAData_SubRowCount` — non-multiples of 9 produce ≥ 2 sub-rows
- `TestMockSKAData_ZeroSubRowsForMultiplesOf9` — multiples of 9 produce 0 sub-rows

Template rendering examples (in `templates_test.go` or a new `home_tmpl_test.go`):

- Single `<thead>` row with exactly 9 `<th>` elements in the correct order
- Height cell renders as `<a href="/block/N">N</a>`
- Sub-rows have `class="ska-sub-row"` and no `ska-sub-row--visible` on initial render
- `data-block-id` attribute present on both block rows and sub-rows

### Property-based tests (Go — `pgregory.net/rapid`)

Library: `pgregory.net/rapid` (already used in the codebase). Minimum 100 iterations per test.

Each test is tagged with a comment: `// Feature: home-block-table-simplified, Property N: <text>`

- **Property 1** (`TestProp_HomeBlockRowFieldPreservation`) — already exists
- **Property 2** (`TestProp_VARAmountPreFormatted`) — already exists
- **Property 3** (`TestProp_SubRowCountInvariant`) — generate random heights, verify sub-row count matches `len(SKASubRows)` and `HasSKAData` is consistent
- **Property 4** (`TestProp_NoAggregateTokenType`) — generate random heights, verify no `SKASubRow.TokenType` equals `"SKA"`
- **Property 5** (`TestProp_SKASubRowAscendingOrder`) — generate random heights with SKA data, verify token index order is ascending
- **Property 6** (`TestProp_BlockRowOrderPreservation`) — generate a random sorted-descending slice of `BlockBasic`, verify output order matches input order

### Property-based tests (JS — `fast-check` + Vitest)

Library: `fast-check` with Vitest. Minimum 100 runs per property.

Each test is tagged: `// Feature: home-block-table-simplified, Property N: <text>`

- **Property 7** (`test('expand/collapse round-trip')`) — generate a DOM fragment with N block rows and M sub-rows per block; call `toggle()` twice on a random block; assert all sub-rows for that block lack `.ska-sub-row--visible`
- **Property 8** (`test('WebSocket prepend matches server structure')`) — generate a random block height; call `_processBlock()` with a mock block payload; assert the prepended row has 9 cells with correct `data-type` attributes, correct `data-block-id`, and the SKA cell has/lacks `data-action` matching `hasSKAData`
- **Property 9** (`test('oldest row removal leaves no orphaned sub-rows')`) — set up a table with N blocks each having sub-rows; call `_processBlock()`; assert no `data-block-id` from the removed block remains in the DOM
- **Property 10** (`test('VAR cells populated from block payload')`) — generate random `block.tx`, `block.total`, `block.size`; assert VAR sub-row cells match `String(block.tx)`, `humanize.threeSigFigs(block.total)`, `humanize.bytes(block.size)`
- **Property 11** (`test('SKA cell interactivity conditioned on hasSKAData')`) — for heights where `h % 9 !== 0`, assert SKA cell has button + `ska-clickable`; for `h % 9 === 0`, assert plain text with no class/action

Test files:

- Go: `cmd/dcrdata/internal/explorer/home_viewmodel_test.go`, `home_mock_test.go`
- JS: `cmd/dcrdata/public/js/controllers/ska_accordion_controller.test.js`, `cmd/dcrdata/public/js/controllers/blocklist_controller.test.js`
