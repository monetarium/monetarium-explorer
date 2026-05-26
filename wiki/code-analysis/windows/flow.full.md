### Section 1 — Overview

End-to-end trace for the **`/ticketpricewindows`** page (the Windows / Ticket Price
Windows listing). The page is a paginated table whose rows are stake-difficulty
windows — fixed-size groups of mainchain blocks (`chaincfg.Params.StakeDiffWindowSize`,
default 144). For each window the table shows the index, end block, per-window
sums of regular txs / votes / fresh tickets / revocations, total size, and the
window's difficulty and `MAX(sbits)` ticket price. The page is fully
server-rendered Go HTML (`windows.tmpl`); no REST or WebSocket consumes this
flow. Refreshed at `HEAD=3cdba1e7`.

### Section 2 — End-to-End Data Flow

```text
monetarium-node JSON-RPC (block ingest, separate flow)
    → PostgreSQL  blocks  table          (num_rtx, voters, fresh_stake, revocations, size, sbits, difficulty, coin_tx_stats, is_mainchain)
        → SelectWindowsByLimit            (db/dcrpg/internal/blockstmts.go:131)
        → retrieveWindowBlocks            (db/dcrpg/queries.go:905) — Scan → parseCoinTxStats → BlocksGroupedInfo build
            → (*ChainDB).PosIntervals     (db/dcrpg/pgblockchain.go:1807) — adds queryTimeout + replaceCancelError
                → dataSource interface    (cmd/dcrdata/internal/explorer/explorer.go:100)
                    → (*explorerUI).StakeDiffWindows handler (cmd/dcrdata/internal/explorer/explorerroutes.go:386)
                        → exp.templates.exec("windows", ...) (explorerroutes.go:433)
                            → views/windows.tmpl rendering   → HTTP HTML response
```

Inputs: `?offset=<windows>&rows=<page size>` query string. Output: HTML
(`text/html`). There is no JSON API and no WebSocket update for this page; the
only client-side behavior is the `data-controller="pagenavigation"` pager and a
`data-controller="time"` age-relative widget.

### Section 3 — Per-Layer Breakdown

**3.1 PostgreSQL `blocks` table (source of truth)**

- **Location:** `db/dcrpg/internal/blockstmts.go:131` (`SelectWindowsByLimit`).
- **Data structures (DB columns read):** `height`, `num_rtx`, `fresh_stake`,
  `voters`, `revocations`, `size`, `sbits` (ticket price atoms), `difficulty`,
  `time`, `is_mainchain`, and the JSONB column `coin_tx_stats`
  (`map[uint8]CoinTxStats`).
- **Transformations (entirely in SQL):**
  - Buckets via integer-division `GROUP BY (height/$1)*$1 AS window_start` —
    every block in `[k*size, (k+1)*size−1]` collapses to one row.
  - Per-window: `MAX(difficulty)`, `MAX(sbits)`, `MIN(time)`, `COUNT(*)`,
    `SUM(num_rtx)`, `SUM(fresh_stake)`, `SUM(voters)`, `SUM(revocations)`,
    `SUM(size)`, plus `JSONB_AGG(coin_tx_stats)`.
  - `WHERE height BETWEEN $2 AND $3 AND is_mainchain` — sidechain/orphan rows
    excluded from every aggregate.
  - Ordered `BY window_start DESC` (newest first), expected to feed the table's
    top row.

**3.2 Go aggregation / row assembly**

- **Location:** `db/dcrpg/queries.go:905` (`retrieveWindowBlocks`),
  `db/dcrpg/queries.go:877` (`parseCoinTxStats`),
  `db/dcrpg/pgblockchain.go:1807` (`(*ChainDB).PosIntervals`).
- **Data structures:** `dbtypes.BlocksGroupedInfo` (`db/dbtypes/types.go:806`),
  `dbtypes.CoinTxStats` (`db/dbtypes/types.go:2215`).
- **Transformations:**
  - `retrieveWindowBlocks` first derives the height range from `(limit, offset)`:
    `endWindow = currentHeight/windowSize − offset`,
    `startWindow = endWindow − limit + 1`,
    `startHeight = startWindow*windowSize`,
    `endHeight = (endWindow+1)*windowSize − 1`,
    and binds those as `$2`/`$3`. **The windowSize used here and in the SQL
    `$1` must be the same value** (`pgb.chainParams.StakeDiffWindowSize`).
  - 11-column positional `rows.Scan(&startBlock, &difficulty, &txs, &tickets,
    &votes, &revocations, &blockSizes, &sbits, &timestamp, &count,
    &coinTxStats)` (`queries.go:924`). Note column-order coupling — any SQL
    SELECT reorder silently swaps values.
  - `txs = parseCoinTxStats(coinTxStats, txs)` (`queries.go:930`):
    unmarshals `[]map[string]CoinTxStats`, sums every per-coin `TxCount`, and
    **overrides** the flat `SUM(num_rtx)` only when the per-coin total is
    larger. Empty / `\x00`-padded / unmarshal-error JSON silently falls back to
    flat `txs` (lenient by design for windows whose blocks predate
    `coin_tx_stats` population).
  - `endBlock = startBlock + windowSize − 1`;
    `index = CalculateWindowIndex(endBlock, windowSize)`
    (`db/dbtypes/conversion.go:144`) — adds 1 for heights not divisible by
    `windowSize`, so window-1 covers blocks 1..144.
  - `TxCount = txs + tickets + revocations + votes` (assembled in Go, **not** a
    DB column).
  - `FormattedSize = humanize.Bytes(blockSizes)`.
  - `(*ChainDB).PosIntervals` wraps the call in `context.WithTimeout(ctx,
    pgb.queryTimeout)` and runs the result through `pgb.replaceCancelError` —
    timeouts surface as a typed error the handler maps to a friendly page via
    `timeoutErrorPage`.

**3.3 Explorer handler (HTTP boundary)**

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:386`
  (`(*explorerUI).StakeDiffWindows`), interface at
  `cmd/dcrdata/internal/explorer/explorer.go:100`
  (`dataSource.PosIntervals`), mock at
  `cmd/dcrdata/internal/explorer/explorer_test.go:100`.
- **Route:** `r.Get("/ticketpricewindows", explore.StakeDiffWindows)`
  (`cmd/dcrdata/main.go:767`).
- **Transformations:**
  - Parses `?offset=<uint>&rows=<uint>`, returns `400` on parse error.
  - Computes `bestWindow = Height() / StakeDiffWindowSize`; clamps
    `offsetWindow ≤ bestWindow`; clamps `rows` to
    `[minExplorerRows, maxExplorerRows]` (default `minExplorerRows`).
  - Calls `exp.dataSource.PosIntervals(ctx, rows, offsetWindow)` on the
    `dataSource` interface (production: `*dcrpg.ChainDB`). Timeout errors are
    handled separately from "not found" via `exp.timeoutErrorPage`; any other
    error renders `ExpStatusNotFound` (the message literally references "ticket
    price windows").
  - Builds the template context (anonymous struct) with `Data`, `WindowSize`,
    `BestWindow`, `OffsetWindow`, `Limit`, `TimeGrouping: "Windows"`, and
    `Pages: calcPages(int(bestWindow), int(rows), int(offsetWindow),
    linkTemplate)` where
    `linkTemplate = "/ticketpricewindows?offset=%d&rows=" + rows`.
  - Calls `exp.templates.exec("windows", ...)` and writes the rendered HTML.

**3.4 Template (presentation)**

- **Location:** `cmd/dcrdata/views/windows.tmpl` (165 lines).
- **Data structures:** the anonymous struct from §3.3 + `CommonPageData`.
- **Transformations / field reads (column ↔ struct mapping):**
  - `({{.BlocksCount}}/{{$.WindowSize}})` partial-window indicator (line 119).
  - `.IndexVal` (line 120), `.EndBlock` (line 123, also forms the `/blocks?height=` deep link).
  - Regular: `{{intComma .Transactions}}` (line 125, post-`parseCoinTxStats`).
  - `.Voters` (line 126), `.FreshStake` (line 127), `.Revocations` (line 128).
  - Mobile-only combined cell: `{{intComma .TxCount}}` (line 129).
  - `.FormattedSize` (line 130, pre-humanized in Go).
  - Difficulty:
    `{{template "decimalParts" (float64AsDecimalParts .Difficulty 0 true)}}`
    (line 131). `float64AsDecimalParts` is registered in
    `cmd/dcrdata/internal/explorer/templates.go:747`.
  - Ticket price:
    `{{printf "%.2f" (toFloat64Amount .TicketPrice)}}` (line 132).
    `toFloat64Amount(int64) float64` is `dcrutil.Amount(intAmount).ToCoin()`
    (`templates.go:752`) — the **legacy VAR-only** atom→coin conversion.
  - `.StartTime.UNIX` for the JS time controller (line 133),
    `.StartTime.DatetimeWithoutTZ` for the fallback static cell (line 134).
  - Pager rendered from `.Pages` plus prev/next anchors driven by
    `.OffsetWindow`, `.Limit`, `$oldest`, `$lastWindow`.

**3.5 Frontend (client-side)**

- **No bespoke Stimulus controller for this page.** Only generic
  `pagenavigation` (page-size dropdown / offset query rewrite) and the
  shared `time` controller (relative-age rendering off `data-age`).
- No WebSocket subscription: the table does not live-update; refresh on tip
  advance is via full page reload only.

### Section 4 — Cross-Layer Dependencies

- **SQL `$1` ↔ `pgb.chainParams.StakeDiffWindowSize` ↔ handler
  `exp.ChainParams.StakeDiffWindowSize`** must all be the same value. There is
  no DB-level check; they're wired by convention. Three callsites:
  `SelectWindowsByLimit` (`blockstmts.go:131`), `PosIntervals`
  (`pgblockchain.go:1810`), and handler (`explorerroutes.go:409` /
  `:445`).
- **Positional `rows.Scan` ↔ SQL SELECT list ordering.** 11 columns; reorder
  on either side silently swaps values into the wrong destination — see
  `queries.go:924` against `blockstmts.go:131`. A column count change is a
  loud `sql: expected N destination arguments`.
- **`BlocksGroupedInfo` is shared verbatim with the
  [time-based-blocks](/wiki/code-analysis/time-based-blocks/flow.full.md)
  domain.** `retrieveTimeBasedBlockListing` (`queries.go:961`) populates a
  different subset of the same struct (e.g. it sets `EndTime`; the windows
  path does not). A field rename for one flow breaks the other's template.
- **`coin_tx_stats` JSON contract.** The column type is JSONB; the Go shape is
  `map[uint8]dbtypes.CoinTxStats` with the `tx_count` tag
  (`db/dbtypes/types.go:2215`). `parseCoinTxStats` unmarshals the
  aggregate as `[]map[string]CoinTxStats` (the `[]` from `JSONB_AGG`, the
  string key because JSON object keys are strings).
- **Interface boundary at `dataSource.PosIntervals`** —
  `cmd/dcrdata/internal/explorer/explorer.go:100` and mock at
  `explorer_test.go:100` must move in lockstep with the prod
  `*ChainDB.PosIntervals` signature.

### Section 5 — Critical Constraints

- **C1 — Precision (VAR-only path).** `TicketPrice` is `int64` atoms (`sbits`,
  VAR scale 1e8). It is rendered by `toFloat64Amount` →
  `dcrutil.Amount.ToCoin() float64`. This is the **legacy VAR-only**
  numeric pipeline; do not route SKA-scale atoms through `toFloat64Amount`
  (would silently truncate at ~15 digits and/or hit scientific notation).
  See [/wiki/core/constraints.md](/wiki/core/constraints.md) §C1.
- **C7 — Multi-coin reconciliation.** Per-coin tx activity is read from the
  JSONB `coin_tx_stats` column and summed by `parseCoinTxStats`; the
  per-coin sum overrides flat `num_rtx` when larger. The page's "Regular"
  column therefore reflects multi-coin activity, not just VAR. See
  [/wiki/core/constraints.md](/wiki/core/constraints.md) §C7.
- **Mainchain-only.** Every aggregate filters `is_mainchain`. Sidechain rows
  contribute nothing to ticket price, block count, or any sum.
- **Pagination assumes continuous mainchain height.** A reorged gap is
  invisible to the integer-division bucket; the bucket key uses `height` not
  `block index in mainchain`.
- **Partial tip window is normal.** The most-recent row legitimately reports
  `BlocksCount < WindowSize` and the template flags it with
  `({{.BlocksCount}}/{{$.WindowSize}})`.

### Section 6 — Mutation Impact

For exhaustive risk descriptions see
[/wiki/code-analysis/windows/impact.md](/wiki/code-analysis/windows/impact.md).
Summary of what to check before editing this flow:

- **Direct dependencies:** `SelectWindowsByLimit`, `retrieveWindowBlocks` Scan
  list and `BlocksGroupedInfo` builder, `parseCoinTxStats`, `PosIntervals`
  timeout/replaceCancelError wrapping, `dataSource` interface + mock,
  `StakeDiffWindows` handler, `windows.tmpl` field reads,
  `CalculateWindowIndex`.
- **Indirect dependencies:** any code that writes
  `blocks.num_rtx / fresh_stake / voters / revocations / size / sbits /
  difficulty / coin_tx_stats / is_mainchain` (block ingest + reorg paths) —
  this is the **only** thing that determines what the page shows.
- **Cross-flow:** `BlocksGroupedInfo` is shared with the time-based-blocks
  flow; any rename/removal must be checked against `retrieveTimeBasedBlockListing`
  + its template too.
- **Serialization boundaries:** DB schema (positional Scan), JSONB
  `coin_tx_stats` tag/shape, Go template field-by-name reads.
- **Rendering layer:** `toFloat64Amount(int64)` and `float64AsDecimalParts`
  contracts in `templates.go`.

**Silent failures (no error, wrong table):**

- SQL `$1` denominator diverges from `StakeDiffWindowSize`: misaligned
  buckets, wrong `MAX(sbits)` per window, off-by-N pagination, mismatched
  `IndexVal`.
- `JSONB_AGG(coin_tx_stats)` column dropped or `tx_count` JSON tag renamed
  while `parseCoinTxStats` stays: every window silently regresses to flat
  `SUM(num_rtx)` (multi-coin activity dropped, violates C7).
- `TicketPrice` column or struct field changes scale (already-coin vs atoms)
  without updating `toFloat64Amount`: wrong-by-1e8 ticket price, no error.
- `rows.Scan` destination reordered against SQL SELECT: values silently
  swapped between columns (e.g. votes into size).
- Pagination math edited in handler without the matching
  `startHeight/endHeight` math in `retrieveWindowBlocks`: page shifts a whole
  window or returns near-tip duplicates.

**Hard failures (loud):**

- Removing/renaming a field referenced by `windows.tmpl`
  (`.IndexVal`, `.BlocksCount`, `.EndBlock`, `.Transactions`, `.Voters`,
  `.FreshStake`, `.Revocations`, `.TxCount`, `.FormattedSize`,
  `.Difficulty`, `.TicketPrice`, `.StartTime`) → Go `html/template` error at
  execute time, handler returns the `Template execute failure` branch.
- Adding/removing a column without matching `rows.Scan` arity → runtime
  `sql: expected N destination arguments`.
- Changing `dataSource.PosIntervals` signature without updating the mock in
  `explorer_test.go:100` → build break in the explorer test package.
- Changing `TicketPrice` type to something `toFloat64Amount(int64) float64`
  can't accept → template execute error.

### Section 7 — Common Pitfalls

- **Routing SKA atoms through `toFloat64Amount` "to reuse the existing
  helper".** `toFloat64Amount` is `dcrutil.Amount.ToCoin() float64` — it
  encodes the VAR 1e8 scale and the `float64` precision ceiling. SKA atoms
  exceed `float64`'s significand; reusing this helper for SKA at this page or
  any other silently truncates and/or hits scientific notation. SKA stays as
  decimal strings.
- **Editing `StakeDiffWindowSize` in chain params but not auditing all three
  callsites** (SQL `$1`, `retrieveWindowBlocks` arg, handler `bestWindow` /
  context `WindowSize`). The page renders a plausible-looking-but-wrong
  table — exactly the kind of failure neither `go build` nor `go test`
  catches.
- **Renaming a `BlocksGroupedInfo` field "for windows".** It also breaks the
  time-based-blocks listing — the struct has no per-flow boundary. Add new
  fields rather than rename shared ones, or rename and update both flows
  together.
- **Tightening `parseCoinTxStats` to error instead of fall back.** Older
  windows have empty/`\x00`-padded JSON; the lenient fallback is intentional.
  A hard error would 500 the page for any user paginating into old history.
- **Treating `.Transactions` as a pure DB sum.** It's the post-reconciliation
  multi-coin total (per-coin sum may override flat `num_rtx`); don't add a
  parallel "regular tx" widget elsewhere that pulls `SUM(num_rtx)` directly
  and call it the same name.
- **Assuming the page has WebSocket updates.** It does not; the only live
  bit is the `time` controller updating the age strings client-side.

### Section 8 — Evidence

Routing / handler:
- `cmd/dcrdata/main.go:767` — `r.Get("/ticketpricewindows", explore.StakeDiffWindows)`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:386` — `StakeDiffWindows`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:409` — `bestWindow := uint64(exp.Height() / exp.ChainParams.StakeDiffWindowSize)`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:419` — `exp.dataSource.PosIntervals(ctx, rows, offsetWindow)`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:433` — `exp.templates.exec("windows", ...)`.

Interface / mock:
- `cmd/dcrdata/internal/explorer/explorer.go:100` — `dataSource.PosIntervals` interface method.
- `cmd/dcrdata/internal/explorer/explorer_test.go:100` — `mockDataSource.PosIntervals`.

DB / queries:
- `db/dcrpg/pgblockchain.go:1807` — `(*ChainDB).PosIntervals` (queryTimeout + replaceCancelError).
- `db/dcrpg/queries.go:905` — `retrieveWindowBlocks` (height-range math + 11-col Scan + builder).
- `db/dcrpg/queries.go:877` — `parseCoinTxStats` (JSONB aggregate, lenient fallback).
- `db/dcrpg/internal/blockstmts.go:131` — `SelectWindowsByLimit` SQL.

Types / helpers:
- `db/dbtypes/types.go:806` — `BlocksGroupedInfo` struct.
- `db/dbtypes/types.go:2215` — `CoinTxStats` struct (`tx_count`, `size` JSON tags).
- `db/dbtypes/conversion.go:144` — `CalculateWindowIndex`.

Template / template helpers:
- `cmd/dcrdata/views/windows.tmpl:116–135` — `{{range .Data}}` row rendering.
- `cmd/dcrdata/views/windows.tmpl:132` — `{{printf "%.2f" (toFloat64Amount .TicketPrice)}}`.
- `cmd/dcrdata/views/windows.tmpl:131` — `float64AsDecimalParts .Difficulty 0 true`.
- `cmd/dcrdata/internal/explorer/templates.go:747` — `float64AsDecimalParts` registration.
- `cmd/dcrdata/internal/explorer/templates.go:752` — `toFloat64Amount` registration (`dcrutil.Amount.ToCoin()`).

---

See also:
- /wiki/code-analysis/windows/flow.compact.md (derived-from: this trace)
- /wiki/code-analysis/windows/patterns.md (depends-on: reusable patterns extracted from this flow)
- /wiki/code-analysis/windows/impact.md (depends-on: mutation blast radius for this flow)
- /wiki/code-analysis/time-based-blocks/flow.full.md (shares-pattern-with: `dbtypes.BlocksGroupedInfo` struct pass-through)
- /wiki/core/constraints.md#C1 (depends-on: numeric precision — VAR int64 atoms via `toFloat64Amount`)
- /wiki/core/constraints.md#C7 (depends-on: per-coin-type label/model — `coin_tx_stats` reconciliation)
