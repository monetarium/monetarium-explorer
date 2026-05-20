# Windows Domain – Mutation Impact

When modifying ticket-price-window aggregation, the `SelectWindowsByLimit`
query, `retrieveWindowBlocks`, `PosIntervals`, the `StakeDiffWindows` handler,
or `dbtypes.BlocksGroupedInfo`, verify every risk below.

---

## Risk: StakeDiffWindowSize / SQL Denominator Desync

**Trigger:** Changing the consensus `chaincfg.Params.StakeDiffWindowSize`
(new chain params, testnet patch, network upgrade), or hardcoding a different
window size at any of the three sites that must agree.

**Failure mode:** silent.

**Affected flows:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
Three places must carry the same window size: the SQL bucket key
`(height/$1)*$1` (`db/dcrpg/internal/blockstmts.go:131`); the value
`pgb.chainParams.StakeDiffWindowSize` passed into `retrieveWindowBlocks`
(`db/dcrpg/pgblockchain.go:1810`, `db/dcrpg/queries.go:905`), which *also*
recomputes `startHeight/endHeight` window boundaries from it; and
`bestWindow := uint64(exp.Height() / exp.ChainParams.StakeDiffWindowSize)`
plus `WindowSize: exp.ChainParams.StakeDiffWindowSize` in the handler
(`cmd/dcrdata/internal/explorer/explorerroutes.go:409`,`:445`). Nothing
asserts these agree. If the SQL `$1` and the chain's actual window size
diverge, the page still renders: it produces misaligned buckets, wrong
`MAX(sbits)` per window, `IndexVal` from `CalculateWindowIndex`
(`db/dbtypes/conversion.go:144`) inconsistent with the `(n/size)*size`
bucket, and pagination (`bestWindow`, `calcPages`) off by whole windows — all
with no error and a plausible-looking table.

---

## Risk: `BlocksGroupedInfo` Field Removal / Rename (cross-domain)

**Trigger:** Removing or renaming a field on
`dbtypes.BlocksGroupedInfo` (`db/dbtypes/types.go:806`), or reordering the
`rows.Scan(...)` destination list in `retrieveWindowBlocks`.

**Failure mode:** loud (template) / silent (cross-flow).

**Affected flows:**
- /wiki/code-analysis/windows/flow.full.md
- /wiki/code-analysis/time-based-blocks/flow.full.md

**Description:**
`windows.tmpl` reads fields by name with no compile-time check:
`.IndexVal` / `.BlocksCount` (`:119`,`:120`), `.EndBlock` (`:123`),
`.Transactions` `.Voters` `.FreshStake` `.Revocations` (`:125`–`:128`),
`.TxCount` (`:129`), `.Difficulty` (`:131`), `.TicketPrice` (`:132`).
Removing a referenced field is a **hard failure** — Go `html/template`
errors at execution time (caught by the handler's `Template execute failure`
branch, surfacing an error page), not at `go build`. Because
`BlocksGroupedInfo` is shared verbatim with the time-based-blocks listing
(`retrieveTimeBasedBlockListing`, `db/dcrpg/queries.go:961`), a rename done
"for windows" simultaneously breaks the time-listing template, and adding a
field only one `Scan` populates leaves it zero-valued in the other flow with
no warning. Reordering `Scan` destinations against the SQL `SELECT` column
order silently swaps values (e.g. votes into the size column) with no error.

---

## Risk: `coin_tx_stats` JSONB Column / Scan Mismatch

**Trigger:** Adding, removing, or reordering columns in
`SelectWindowsByLimit`, or changing the `dbtypes.CoinTxStats` JSON shape /
tags, or altering `parseCoinTxStats`.

**Failure mode:** loud (column count) / silent (count regression).

**Affected flows:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
`SelectWindowsByLimit` returns 11 columns ending in
`JSONB_AGG(coin_tx_stats)`; `retrieveWindowBlocks` scans exactly 11 into
`&startBlock,&difficulty,&txs,&tickets,&votes,&revocations,&blockSizes,&sbits,
&timestamp,&count,&coinTxStats` (`db/dcrpg/queries.go:924`). Any column
add/remove without a matching `Scan` change is a **hard failure**
(`sql: expected N destination arguments`). More dangerous is the silent path:
`parseCoinTxStats` (`db/dcrpg/queries.go:877`) unmarshals
`[]map[string]dbtypes.CoinTxStats` (`db/dbtypes/types.go:2215`) and only
overrides the flat `SUM(num_rtx)` when the summed per-coin `TxCount` is
larger; on empty/`\x00`-padded/short/unmarshal-error JSON it silently returns
the flat `txs`. Renaming the `tx_count` JSON tag or breaking the
`map[string]CoinTxStats` shape makes every window silently regress to flat
single-value counts (multi-coin activity dropped) with no error — a violation
of the per-coin-type model ([/wiki/core/constraints.md#C7](/wiki/core/constraints.md#C7)).

---

## Risk: `TicketPrice` / `Difficulty` Type Change at Template Boundary

**Trigger:** Changing `BlocksGroupedInfo.TicketPrice` (currently `int64`
atoms) or `Difficulty` (`float64`) types, or changing what `MAX(sbits)` /
`MAX(difficulty)` yield.

**Failure mode:** silent (numeric) / loud (template func).

**Affected flows:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
`windows.tmpl` renders ticket price as
`{{printf "%.2f" (toFloat64Amount .TicketPrice)}}` (`:132`) and difficulty as
`{{template "decimalParts" (float64AsDecimalParts .Difficulty 0 true)}}`
(`:131`). `TicketPrice` flows as `sbits int64` (atoms) from `MAX(sbits)`;
`toFloat64Amount` divides by the atom scale. Changing the column to a
pre-scaled value, or the struct field to `float64`, without updating
`toFloat64Amount`'s expectation produces a wrong-by-1e8 price with **no
error**. Changing the field to an incompatible type for the template helper is
a **hard failure** at template execution. Note ticket price here is VAR-scale
`int64`; this path is the legacy float-safe VAR pipeline
([/wiki/core/constraints.md#C1](/wiki/core/constraints.md#C1)) — do not route
SKA-scale atoms through `toFloat64Amount`.

---

## Risk: Pagination / Window-Range Arithmetic Drift

**Trigger:** Changing `bestWindow`/`offsetWindow` math in the handler, the
`startWindow/endWindow/startHeight/endHeight` math in `retrieveWindowBlocks`,
or `CalculateWindowIndex`.

**Failure mode:** silent.

**Affected flows:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
The handler computes `bestWindow = Height()/StakeDiffWindowSize`, clamps
`offsetWindow`, clamps `rows` to `[minExplorerRows, maxExplorerRows]`, and
feeds `calcPages` (`explorerroutes.go:409`–`:450`). `retrieveWindowBlocks`
independently maps `(limit, offset)` to a height range:
`endWindow = currentHeight/windowSize - offset`,
`startWindow = endWindow - limit + 1`, then
`startHeight/endHeight` bound the SQL (`db/dcrpg/queries.go:906`–`:909`).
`IndexVal` comes from a *separate* `CalculateWindowIndex(endBlock, windowSize)`
(`db/dbtypes/conversion.go:144`) which adds 1 for non-divisible heights (first
window is blocks 1–144). These three computations assume continuous mainchain
heights and a fixed window size. A change to any one without the others
silently shifts which windows render, off-by-one `IndexVal` vs displayed
range, or empty/duplicated rows near the chain tip — never an error, only a
wrong table.

---

## Safe Change Checklist

Before committing changes in this domain:

- [ ] SQL `$1` denominator == `chainParams.StakeDiffWindowSize` everywhere
- [ ] `rows.Scan` arity/order matches `SelectWindowsByLimit` column list
- [ ] `windows.tmpl` field references match `BlocksGroupedInfo`
- [ ] time-based-blocks flow re-checked (shared `BlocksGroupedInfo`)
- [ ] `coin_tx_stats` JSON shape / `parseCoinTxStats` fallback preserved
- [ ] `TicketPrice` stays VAR-scale `int64` atoms for `toFloat64Amount`
- [ ] handler pagination ↔ `retrieveWindowBlocks` range math ↔ `CalculateWindowIndex` kept consistent

---

See also:
- /wiki/code-analysis/windows/flow.full.md (derived-from: windows data-flow trace)
- /wiki/code-analysis/windows/patterns.md (depends-on: windows reusable patterns)
- /wiki/code-analysis/time-based-blocks/flow.full.md (shares-pattern-with: dbtypes.BlocksGroupedInfo struct pass-through)
- /wiki/core/constraints.md#C1 (depends-on: C1 numeric precision — VAR int64 atoms via toFloat64Amount)
- /wiki/core/constraints.md#C7 (depends-on: C7 per-coin-type model — coin_tx_stats reconciliation)
