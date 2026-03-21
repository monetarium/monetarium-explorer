# Design Document: home-block-table-redesign

## Overview

This feature replaces the home page "Latest Blocks" table with a 13-column layout grouped
into three sections — Overview (7 cols), VAR (3 cols), SKA (3 cols) — adds a Stimulus-driven
accordion for per-SKA-type sub-rows, and enforces Rule-of-Three formatting on all monetary
amounts. SKA data is fully mocked with hardcoded values until the backend is available.

The change is purely additive on the data side (a new view-model struct wraps the existing
`BlockBasic`) and surgical on the template side (only the block table section of `home.tmpl`
is replaced). No existing API endpoints or WebSocket messages are affected.

### Key constraints from the tech stack

- **Big-number arithmetic**: SKA token amounts require up to 15 integer + 18 decimal digits,
  which exceeds float64 precision. All SKA amount calculations must use a specialized
  big-number type (e.g. `shopspring/decimal` or equivalent). The mock values in this phase
  are pre-formatted strings, so no big-number arithmetic is performed at render time, but
  the struct fields that will eventually hold real SKA amounts must be typed accordingly.
- **Stimulus 3 + Turbolinks 5.2**: Controllers are auto-discovered via
  `definitionsFromContext` in `index.js`; no manual registration is needed. The file naming
  convention `*_controller.js` maps to the `data-controller="*"` attribute.
- **SCSS**: `home.scss` already exists and is imported by `application.scss`. New rules go
  there.

---

## Architecture

The data flow is: Home handler fetches blocks, converts each `BlockBasic` into a
`HomeBlockRow` (attaching mock SKA data), passes the slice to the template, and the template
renders the 13-column table. A Stimulus controller handles accordion toggling client-side.

```
explorerroutes.go  Home()
  GetExplorerBlocks() -> []*BlockBasic
  buildHomeBlockRows() -> []HomeBlockRow        (defined in home_viewmodel.go)
    for each block: copy fields + call mockSKAData(height)
  pass Blocks: []HomeBlockRow to "home" template

home.tmpl (block table section)
  <div class="table-responsive">
    <table>
      <thead> (2 rows: group labels + column labels)
      <tbody data-controller="ska-accordion">   ← controller lives here
        range .Blocks
          Block_Row <tr> (13 tds)
          range .SKASubRows
            Sub_Row <tr class="ska-sub-row">
          end
        end
    </table>
  </div>

  The block table is extracted into a partial template:
    views/home_latest_blocks.tmpl
  and included in home.tmpl via:
    {{template "home_latest_blocks" .}}

ska_accordion_controller.js (Stimulus 3)
  toggle(event) -- show/hide sub-rows for a block
```

### File distribution within `internal/explorer`

The new backend logic is split across three focused files, all in `package explorer`:

```
cmd/dcrdata/internal/explorer/
  home_viewmodel.go   HomeBlockRow and SKASubRow types + buildHomeBlockRows converter
  home_mock.go        mockSKAData — isolated mock generator, easy to swap for real DB calls
  explorerroutes.go   Home() handler — calls buildHomeBlockRows, unchanged otherwise
  templates.go        threeSigFigs — already present, no move required
```

This layout means that replacing mocks with real database calls in the future is a
single-file change: swap `home_mock.go` for a real data-access implementation without
touching the routing logic or the view-model types.

---

## Components and Interfaces

### 1. Go: HomeBlockRow and SKASubRow structs

**File**: `cmd/dcrdata/internal/explorer/home_viewmodel.go`  
**Package**: `package explorer`

Keeping these types inside `package explorer` (rather than `explorer/types`) gives
`buildHomeBlockRows` and `mockSKAData` direct access without an extra import, and keeps
the view-model private to the explorer package — it is not part of the public API surface.
Monetary string fields are pre-formatted by `threeSigFigs` (defined in `templates.go` in
the same package) before the struct is passed to the template, keeping the template
logic-free. The `HasSKAData` flag is computed once during conversion so the template never
evaluates a condition on numeric fields.

```go
package explorer

// HomeBlockRow is the view model for one row in the home page block table.
type HomeBlockRow struct {
    // Overview group (cols 1-7) -- sourced from BlockBasic
    Height         int64
    Hash           string
    Transactions   int
    Voters         uint16
    FreshStake     uint8
    Revocations    uint32
    FormattedBytes string
    BlockTime      TimeDef

    // VAR group (cols 8-10) -- real data, pre-formatted
    VARTxCount int    // same as Transactions for now
    VARAmount  string // threeSigFigs(Total)
    VARSize    string // FormattedBytes (reuse)

    // SKA group (cols 11-13) -- mocked, pre-formatted
    // Future: replace string fields with decimal.Decimal for precision.
    SKATxCount string // threeSigFigs of mock aggregate
    SKAAmount  string // threeSigFigs of mock aggregate
    SKASize    string // threeSigFigs of mock aggregate

    // Accordion control
    HasSKAData bool        // true when at least one sub-row exists
    SKASubRows []SKASubRow
}

// SKASubRow is one accordion detail row for a specific SKA token type.
type SKASubRow struct {
    TokenType string // e.g. "SKA-1", "SKA-2", "SKA-3"
    TxCount   string // pre-formatted
    Amount    string // pre-formatted
    Size      string // pre-formatted
}

// buildHomeBlockRows converts a slice of BlockBasic pointers into HomeBlockRow
// view models, attaching mock SKA data. Nil entries are skipped.
func buildHomeBlockRows(blocks []*types.BlockBasic) []HomeBlockRow {
    rows := make([]HomeBlockRow, 0, len(blocks))
    for _, b := range blocks {
        if b == nil {
            continue
        }
        skaTx, skaAmt, skaSz, subRows := mockSKAData(b.Height)
        rows = append(rows, HomeBlockRow{
            Height:         b.Height,
            Hash:           b.Hash,
            Transactions:   b.Transactions,
            Voters:         b.Voters,
            FreshStake:     b.FreshStake,
            Revocations:    b.Revocations,
            FormattedBytes: b.FormattedBytes,
            BlockTime:      b.BlockTime,
            VARTxCount:     b.Transactions,
            VARAmount:      threeSigFigs(b.Total),
            VARSize:        b.FormattedBytes,
            SKATxCount:     skaTx,
            SKAAmount:      skaAmt,
            SKASize:        skaSz,
            HasSKAData:     len(subRows) > 0,
            SKASubRows:     subRows,
        })
    }
    return rows
}
```

`threeSigFigs` is called directly because it lives in `templates.go` within the same
`package explorer` — no import needed.

### 2. Go: mock SKA data helper

**File**: `cmd/dcrdata/internal/explorer/home_mock.go`  
**Package**: `package explorer`

Isolated in its own file so that the entire mock can be replaced by a real database call
by editing only this file. The routing logic in `explorerroutes.go` and the view-model in
`home_viewmodel.go` remain untouched.

Values are chosen to exercise `threeSigFigs` across k, M, and B ranges. The height modulo
varies values slightly so the UI looks realistic across the 9 displayed blocks.

Crucially, the mock must produce **both** states to allow visual testing of the
accordion-enabled and accordion-disabled appearances side by side:

- Blocks where `height % 9 == 0` return an empty sub-row slice (`HasSKAData = false`),
  exercising the non-interactive SKA cell state.
- All other blocks return at least 2 sub-rows (`HasSKAData = true`).

With 9 blocks displayed on the home page (heights N down to N-8), exactly one block per
page load will have zero SKA data.

```go
package explorer

var mockSKATokens = []struct {
    name   string
    txs    float64
    amount float64
    size   float64
}{
    {"SKA-1", 42, 1_250_000, 8_400},
    {"SKA-2", 17, 450_000, 3_200},
    {"SKA-3", 5, 2_100_000_000, 1_100},
}

// mockSKAData returns pre-formatted SKA aggregate values and sub-rows.
// When height % 9 == 0, it returns an empty sub-row slice to simulate a block
// with no SKA activity, exercising the accordion-disabled state.
func mockSKAData(height int64) (txCount, amount, size string, subRows []SKASubRow) {
    if height%9 == 0 {
        return "0", "0", "0", nil
    }
    offset := float64(height % 10)
    var aggTx, aggAmt, aggSz float64
    subRows = make([]SKASubRow, 0, len(mockSKATokens))
    for _, tok := range mockSKATokens {
        tx := tok.txs + offset
        amt := tok.amount * (1 + offset/100)
        sz := tok.size + offset*10
        aggTx += tx
        aggAmt += amt
        aggSz += sz
        subRows = append(subRows, SKASubRow{
            TokenType: tok.name,
            TxCount:   threeSigFigs(tx),
            Amount:    threeSigFigs(amt),
            Size:      threeSigFigs(sz),
        })
    }
    return threeSigFigs(aggTx), threeSigFigs(aggAmt), threeSigFigs(aggSz), subRows
}
```

Note: `SKASubRow` and `threeSigFigs` are both in `package explorer`, so no import is
required. The previous design referenced `types.SKASubRow` from an external types package;
keeping the type in `package explorer` removes that cross-package dependency.

### 3. Go: Home handler update

**File**: `cmd/dcrdata/internal/explorer/explorerroutes.go`  
**Package**: `package explorer`

The Home handler's template data struct field changes from `Blocks []*types.BlockBasic` to
`Blocks []HomeBlockRow`. The handler calls `buildHomeBlockRows` (defined in
`home_viewmodel.go`) — no mock logic leaks into the routing file.

```go
// Inside Home() in explorerroutes.go:
blocks := exp.dataSource.GetExplorerBlocks(pageNum*N, pageNum*N+N)
templateData.Blocks = buildHomeBlockRows(blocks)
```

The handler itself does not import or reference `mockSKAData` directly. The mock is an
implementation detail of `buildHomeBlockRows`, which delegates to `mockSKAData` in
`home_mock.go`. When the real backend is ready, only `home_mock.go` changes.

### 4. Go: formatting helper

**File**: `cmd/dcrdata/internal/explorer/templates.go` (no change)  
**Package**: `package explorer`

`threeSigFigs` already lives here and is package-internal. Both `home_viewmodel.go` and
`home_mock.go` call it directly without any import. No move is required.

### 5. Template: home.tmpl and home_latest_blocks.tmpl

The block table section is extracted into a dedicated partial template for maintainability:

**File**: `cmd/dcrdata/views/home_latest_blocks.tmpl`

This partial contains the full `<div class="table-responsive">` wrapper and the `<table>`
with its `<thead>` and `<tbody>`. It is included in `home.tmpl` via:

```html
{{template "home_latest_blocks" .}}
```

The partial must be registered in `explorer.go` alongside the other templates (in the
`tmpls` slice passed to `addTemplate`).

**Controller placement**: `data-controller="ska-accordion"` is placed on the `<tbody>` tag,
not the `<table>`. This scopes the Stimulus controller to the data rows only, keeping the
`<thead>` outside the controller's element boundary and avoiding unintended target lookups
in header cells.

Two-row `<thead>`: first row has three `<th>` elements with colspan 7/3/3 for group labels;
second row has 13 `<th>` elements for column labels.

Each Block_Row `<tr>` carries `data-ska-accordion-target="blockRow"` and
`data-block-id="{{.Height}}"`. SKA cells carry
`data-action="click->ska-accordion#toggle"` only when `HasSKAData` is true. Sub-rows carry
`data-ska-accordion-target="subRow"` and `data-block-id="{{.Height}}"`, and start with the
`ska-sub-row` CSS class (hidden by default).

Sub-row cell layout: 7 empty Overview cells, then one `<td colspan="3">` spanning the full
VAR group displaying `.TokenType` right-aligned, then 3 SKA cells populated from `.TxCount`,
`.Amount`, `.Size`. The colspan approach gives the token name the full VAR section width and
avoids any column-count mismatch.

The existing `data-blocklist-target="table"` is preserved on `<tbody>` so the WebSocket
block prepend in `blocklist_controller.js` continues to work. A follow-up task will update
that controller to handle the new column structure.

### 6. Stimulus controller: ska_accordion_controller.js

**File**: `cmd/dcrdata/public/js/controllers/ska_accordion_controller.js`

Auto-discovered by the webpack context loader — no change to `index.js` is required.

```js
import { Controller } from "@hotwired/stimulus";

export default class extends Controller {
  static get targets() {
    return ["blockRow", "subRow"];
  }

  toggle(event) {
    const blockId = event.currentTarget.closest("tr").dataset.blockId;
    const subRows = this.subRowTargets.filter(
      (r) => r.dataset.blockId === blockId,
    );
    if (subRows.length === 0) return;
    const isExpanded = subRows[0].classList.contains("ska-sub-row--visible");
    subRows.forEach((r) =>
      r.classList.toggle("ska-sub-row--visible", !isExpanded),
    );
    const row = this.blockRowTargets.find((r) => r.dataset.blockId === blockId);
    if (row) row.classList.toggle("is-expanded", !isExpanded);
  }
}
```

Turbolinks 5 compatibility: Stimulus 3 connects/disconnects controllers automatically on
`turbolinks:load` events via its built-in MutationObserver. No manual lifecycle wiring
is needed.

### 7. SCSS additions

**File**: `cmd/dcrdata/public/scss/home.scss` (append to existing file)

All color values use project-standard SCSS variables from `_variables.scss` and
`themes.scss` so that dark mode is handled automatically without extra overrides.

```scss
// SKA accordion sub-rows
.ska-sub-row {
  display: none;

  &--visible {
    display: table-row;
    // $card-bg-secondary / $card-bg-secondary-dark are the project's standard
    // secondary card background variables (defined in _variables.scss).
    background-color: $card-bg-secondary;
  }
}

body.darkBG .ska-sub-row--visible {
  background-color: $card-bg-secondary-dark;
}

.ska-clickable {
  cursor: pointer;
}

.last-blocks-table td,
.last-blocks-table th {
  white-space: nowrap;
}

.group-header {
  border-bottom: 2px solid $progress-bg; // $progress-bg = #ddd (light), overridden in darkBG
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.group-var-col,
.group-var {
  border-left: 2px solid $progress-bg;
}

.group-ska-col,
.group-ska {
  border-left: 2px solid $progress-bg;
}
```

---

## Data Models

### HomeBlockRow field mapping

| Field          | Type        | Source                         | Notes                        |
| -------------- | ----------- | ------------------------------ | ---------------------------- |
| Height         | int64       | BlockBasic.Height              |                              |
| Hash           | string      | BlockBasic.Hash                | Used for block link          |
| Transactions   | int         | BlockBasic.Transactions        |                              |
| Voters         | uint16      | BlockBasic.Voters              |                              |
| FreshStake     | uint8       | BlockBasic.FreshStake          |                              |
| Revocations    | uint32      | BlockBasic.Revocations         |                              |
| FormattedBytes | string      | BlockBasic.FormattedBytes      |                              |
| BlockTime      | TimeDef     | BlockBasic.BlockTime           |                              |
| VARTxCount     | int         | BlockBasic.Transactions        | Same value, different column |
| VARAmount      | string      | threeSigFigs(BlockBasic.Total) | Pre-formatted                |
| VARSize        | string      | BlockBasic.FormattedBytes      | Reused                       |
| SKATxCount     | string      | mockSKAData()                  | Pre-formatted aggregate      |
| SKAAmount      | string      | mockSKAData()                  | Pre-formatted aggregate      |
| SKASize        | string      | mockSKAData()                  | Pre-formatted aggregate      |
| HasSKAData     | bool        | len(SKASubRows) > 0            | Controls interactivity       |
| SKASubRows     | []SKASubRow | mockSKAData()                  |                              |

### Mock data values

| Token | Raw txs | Raw amount    | Raw size | Example formatted amount |
| ----- | ------- | ------------- | -------- | ------------------------ |
| SKA-1 | 42      | 1,250,000     | 8,400    | 1.25M                    |
| SKA-2 | 17      | 450,000       | 3,200    | 450k                     |
| SKA-3 | 5       | 2,100,000,000 | 1,100    | 2.10B                    |

Values are varied by `height % 10` to look realistic across the 9 displayed blocks.

---

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions
of a system — essentially, a formal statement about what the system should do. Properties
serve as the bridge between human-readable specifications and machine-verifiable correctness
guarantees._

### Property 1: BlockBasic to HomeBlockRow field preservation

_For any_ non-nil `BlockBasic`, the `HomeBlockRow` produced by `buildHomeBlockRows` shall
have `Height`, `Hash`, `Transactions`, `Voters`, `FreshStake`, `Revocations`,
`FormattedBytes`, and `BlockTime` equal to the corresponding fields of the source struct.

**Validates: Requirements 1.1, 4.2**

### Property 2: Amount_Formatter produces 3 significant digits

_For any_ positive `float64` value `v`, `threeSigFigs(v)` shall return a string whose
numeric part has exactly 3 significant digits. For values in `[0, 1000)` the string shall
contain no `k`, `M`, or `B` suffix (edge case: sub-thousand values).

**Validates: Requirements 2.1, 2.2**

### Property 3: Monetary fields are pre-formatted by Amount_Formatter

_For any_ `BlockBasic` with `Total = v`, the resulting `HomeBlockRow.VARAmount` shall equal
`threeSigFigs(v)`. For any mock SKA aggregate amount `a`, the corresponding `SKAAmount`
field shall equal `threeSigFigs(a)`.

**Validates: Requirements 1.4, 2.3, 4.3, 4.4**

### Property 4: Mock data produces both states — at least 2 sub-rows OR exactly 0 sub-rows

`mockSKAData` must satisfy two sub-properties simultaneously:

**4a — Non-zero case**: _For any_ height `h` where `h % 9 != 0`, `mockSKAData(h)` shall
return a `[]SKASubRow` slice of length >= 2, and `HasSKAData` shall be `true` for the
resulting `HomeBlockRow`.

**4b — Zero case**: _For any_ height `h` where `h % 9 == 0`, `mockSKAData(h)` shall return
a nil or empty `[]SKASubRow` slice, and `HasSKAData` shall be `false` for the resulting
`HomeBlockRow`.

Together these guarantee that across any 9 consecutive block heights, the rendered page
always contains at least one accordion-enabled row and exactly one accordion-disabled row,
allowing both UI states to be tested visually on every page load.

**Validates: Requirements 1.2, 1.3, 5.6, 6.4, 7.3, 7.4**

### Property 5: Sub-row structure integrity

_For any_ `HomeBlockRow` with `HasSKAData = true`, the rendered HTML shall contain exactly
`len(SKASubRows)` sub-rows, each carrying the `ska-sub-row` CSS class (hidden by default).
Each sub-row shall have 7 empty Overview cells, one `<td colspan="3">` in the VAR group
position containing the non-empty token type name, and 3 SKA cells populated with non-empty
strings. The total effective column span shall equal 13.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 6: SKA cell interactivity conditioned on HasSKAData

_For any_ `HomeBlockRow`, the rendered SKA group cells shall carry
`data-action="click->ska-accordion#toggle"` if and only if `HasSKAData = true`. When
`HasSKAData = false`, no click action attribute shall appear on those cells.

**Validates: Requirements 4.5, 6.4, 7.3, 7.4**

### Property 7: Accordion-Disabled state when no SKA data

_For any_ `HomeBlockRow` with `HasSKAData = false` (zero sub-rows), the Stimulus controller
shall be in a permanently disabled state for that row: clicking the SKA group cells shall
produce no DOM mutation — no sub-rows become visible, no `is-expanded` class is added to
the block row, and no error is thrown.

This property must be tested with exactly 0 sub-rows (not just the guard in `toggle` for
`subRows.length === 0`), verifying that the absence of `data-action` on the cells means the
controller's `toggle` method is never invoked at all.

**Validates: Requirements 6.4, 7.3, 7.4**

### Property 8: Accordion toggle is a round-trip

_For any_ block row with `HasSKAData = true`, clicking an SKA cell twice (expand then
collapse) shall return all associated sub-rows and the block row itself to their original
state: sub-rows hidden, block row without the `is-expanded` class.

**Validates: Requirements 6.1, 6.2, 6.3**

---

## Error Handling

| Scenario                                       | Handling                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GetExplorerBlocks` returns nil                | `buildHomeBlockRows` receives empty slice; returns empty `[]HomeBlockRow`; template renders empty tbody |
| A `*BlockBasic` pointer in the slice is nil    | `buildHomeBlockRows` skips nil entries with a `continue` guard                                          |
| `threeSigFigs` called with `v = 0`             | Returns `"0"` (existing behavior)                                                                       |
| `threeSigFigs` called with negative `v`        | Returns a negative-formatted string; mock data never produces negatives                                 |
| JS controller connects with no sub-row targets | `toggle` returns early when `subRows.length === 0`                                                      |
| Block row not found in `blockRowTargets`       | `find` returns `undefined`; guarded by `if (row)` check                                                 |

---

## Testing Strategy

### Unit tests (Go)

- `buildHomeBlockRows` field preservation: construct a known `BlockBasic`, call the
  function, assert all Overview fields match exactly.
- `buildHomeBlockRows` with nil entries: pass a slice containing a nil pointer, assert the
  result omits it without panicking.
- `mockSKAData` sub-row count: call for several heights, assert `len(subRows) >= 2`.
- `mockSKAData` `HasSKAData` flag: assert `HasSKAData = true` for any non-empty sub-row
  slice.
- `threeSigFigs` edge cases: zero, sub-1, sub-10, sub-100, sub-1k, 1k, 1M, 1B.

Unit tests focus on specific examples and edge cases. Avoid duplicating coverage that
property tests already provide.

### Property-based tests (Go)

Use [`pgregory.net/rapid`](https://github.com/pgregory/rapid) (add as a test dependency in
`cmd/dcrdata/go.mod`). Each test runs a minimum of 100 iterations.

Tag format: `// Feature: home-block-table-redesign, Property N: <property text>`

```go
// Feature: home-block-table-redesign, Property 1: BlockBasic to HomeBlockRow field preservation
func TestProp_HomeBlockRowFieldPreservation(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        b := &types.BlockBasic{
            Height:       rapid.Int64().Draw(t, "height"),
            Transactions: rapid.IntRange(0, 10000).Draw(t, "txs"),
            // ... other fields
        }
        rows := buildHomeBlockRows([]*types.BlockBasic{b})
        require.Len(t, rows, 1)
        require.Equal(t, b.Height, rows[0].Height)
        require.Equal(t, b.Transactions, rows[0].Transactions)
        // ... assert all 8 preserved fields
    })
}

// Feature: home-block-table-redesign, Property 2: Amount_Formatter produces 3 significant digits
func TestProp_ThreeSigFigsDigitCount(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        v := rapid.Float64Range(0.00001, 1e12).Draw(t, "v")
        s := threeSigFigs(v)
        assertThreeSigFigs(t, s, v) // helper verifies 3 sig figs and correct suffix
    })
}

// Feature: home-block-table-redesign, Property 3: Monetary fields are pre-formatted
func TestProp_VARAmountPreFormatted(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        total := rapid.Float64Range(0, 1e9).Draw(t, "total")
        b := &types.BlockBasic{Total: total}
        rows := buildHomeBlockRows([]*types.BlockBasic{b})
        require.Equal(t, threeSigFigs(total), rows[0].VARAmount)
    })
}

// Feature: home-block-table-redesign, Property 4a: Non-zero heights produce >= 2 sub-rows
func TestProp_MockSKASubRowCount_NonZero(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        // Draw a height that is NOT a multiple of 9
        h := rapid.Int64Range(0, 1_000_000).Draw(t, "h")
        height := h*9 + rapid.Int64Range(1, 8).Draw(t, "offset") // guarantees h%9 != 0
        _, _, _, subRows := mockSKAData(height)
        require.GreaterOrEqual(t, len(subRows), 2)
    })
}

// Feature: home-block-table-redesign, Property 4b: Multiples of 9 produce 0 sub-rows
func TestProp_MockSKASubRowCount_Zero(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        n := rapid.Int64Range(0, 111_111).Draw(t, "n")
        height := n * 9 // guarantees height%9 == 0
        _, _, _, subRows := mockSKAData(height)
        require.Empty(t, subRows)
    })
}

// Feature: home-block-table-redesign, Property 4 (zero sub-rows): HasSKAData is false when no sub-rows
func TestProp_HasSKADataFalseWhenNoSubRows(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        b := &types.BlockBasic{
            Height: rapid.Int64Range(0, 1_000_000).Draw(t, "height"),
        }
        // Simulate a block with no SKA activity by passing an empty sub-row slice.
        row := buildHomeBlockRowWithSKA(b, nil)
        require.False(t, row.HasSKAData)
        require.Empty(t, row.SKASubRows)
    })
}
```

### Property-based tests (JavaScript)

Use [`fast-check`](https://fast-check.dev/) with Vitest for the Stimulus controller:

```js
// Feature: home-block-table-redesign, Property 8: Accordion toggle is a round-trip
it.prop([fc.integer({ min: 1, max: 999999 })])(
  "toggle twice restores state",
  (blockId) => {
    // Set up DOM with one block row + two sub-rows
    // Click SKA cell -> verify sub-rows have ska-sub-row--visible, row has is-expanded
    // Click again -> verify classes removed, original state restored
  },
);

// Feature: home-block-table-redesign, Property 7: Accordion-Disabled state when no SKA data
it.prop([fc.integer({ min: 1, max: 999999 })])(
  "no DOM mutation when HasSKAData is false",
  (blockId) => {
    // Set up DOM with one block row but NO sub-rows and NO data-action on SKA cells
    // Simulate a click on an SKA cell directly (bypassing Stimulus, since no action attr)
    // Verify: no ska-sub-row--visible class anywhere, no is-expanded on block row
    // Verify: controller toggle() is never called (spy/mock assertion)
  },
);
```

### Unit tests (JavaScript)

- `toggle` with no sub-rows: assert no DOM mutation occurs.
- `toggle` with multiple blocks: assert only the clicked block's sub-rows toggle.
- Controller connects and disconnects cleanly on simulated Turbolinks navigation.

### Integration / visual

- Render the home page with mock data and verify the table has 2 `<thead>` rows, 13 `<th>`
  elements in the second row, and colspan values of 7/3/3 in the first row.
- Verify the `table-responsive` wrapper is present.
- Verify sub-rows are not visible on initial render.
