# Windows Domain Patterns

## 1. DB-Side Integer-Division Interval Grouping

**Appears in:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
Stake-difficulty (ticket-price) windows are not computed in Go memory. The
aggregation is pushed entirely into a single Postgres statement,
`SelectWindowsByLimit` (`db/dcrpg/internal/blockstmts.go:125`), which buckets
blocks with `SELECT (height/$1)*$1 AS window_start ... GROUP BY window_start`.
`$1` is the consensus window size (`chaincfg.Params.StakeDiffWindowSize`,
default 144) supplied by the caller. The bucket key relies on Postgres integer
division truncating the remainder, so every block in `[k*size, (k+1)*size-1]`
collapses to the same `window_start`. Per-window scalars are derived in SQL:
`MAX(difficulty)`, `MAX(sbits)` (ticket price), `MIN(time)`, `COUNT(*)`, and
`SUM(...)` over `num_rtx`, `fresh_stake`, `voters`, `revocations`, `size`. No
Go-side loop re-aggregates these.

**Constraints:**
- The SQL denominator `$1` and the value passed by
  `retrieveWindowBlocks(ctx, db, pgb.chainParams.StakeDiffWindowSize, ...)`
  (`db/dcrpg/queries.go:905`, called from `ChainDB.PosIntervals`
  `db/dcrpg/pgblockchain.go:1806`) must both be the *same* consensus window
  size. There is no DB-level check that `$1` equals the chain's actual window
  size — they are wired by convention only.
- Window boundaries are constrained twice: the `GROUP BY` truncation forms the
  bucket, and `retrieveWindowBlocks` separately computes
  `startHeight = startWindow*windowSize` /
  `endHeight = (endWindow+1)*windowSize-1` and binds them as `$2`/`$3` via
  `WHERE height BETWEEN $2 AND $3`. Both calculations use the same
  `windowSize`; they must stay in lockstep or pagination silently shears.

---

## 2. Mainchain-Only Aggregation Filter

**Appears in:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
`SelectWindowsByLimit` filters with a bare boolean predicate `AND is_mainchain`
(`db/dcrpg/internal/blockstmts.go:138`) inside the same `WHERE` as the height
range. Orphaned / sidechain rows in the `blocks` table are excluded from every
aggregate (`SUM`, `MAX(sbits)`, `COUNT(*)`), so a window's reported ticket
price, block count, and tx totals reflect mainchain consensus state only. A
window near the tip can legitimately report `BlocksCount < WindowSize`; the
template surfaces this as `({{.BlocksCount}}/{{$.WindowSize}})`
(`cmd/dcrdata/views/windows.tmpl:119`).

**Constraints:**
- Any new aggregate column added to this query must keep the
  `AND is_mainchain` predicate or it will silently double-count reorged
  blocks.
- Consumers must not assume `BlocksCount == WindowSize`; a partial trailing
  window is normal and is already special-cased in the template.

---

## 3. `BlocksGroupedInfo` Struct Pass-Through (shared shape)

**Appears in:**
- /wiki/code-analysis/windows/flow.full.md
- /wiki/code-analysis/time-based-blocks/flow.full.md

**Description:**
The handler does no transformation between DB and template. `StakeDiffWindows`
(`cmd/dcrdata/internal/explorer/explorerroutes.go:386`) calls
`exp.dataSource.PosIntervals` and passes the returned
`[]*dbtypes.BlocksGroupedInfo` straight into
`exp.templates.exec("windows", struct{ ... Data []*dbtypes.BlocksGroupedInfo
... })`. `windows.tmpl` ranges over `.Data` and reads struct fields directly
(`.IndexVal`, `.EndBlock`, `.Transactions`, `.Voters`, `.FreshStake`,
`.Revocations`, `.TxCount`, `.BlocksCount`, `.Difficulty`, `.TicketPrice`).
`dbtypes.BlocksGroupedInfo` (`db/dbtypes/types.go:805`) is the **same struct**
used by the time-based-blocks listing (`retrieveTimeBasedBlockListing`,
`db/dcrpg/queries.go:961`, via `ChainDB.TimeBasedIntervals`). The two flows
populate disjoint subsets of its fields from different SQL: the windows path
fills `IndexVal/EndBlock/StartTime` from height arithmetic; the time-based
path fills `IndexVal/EndBlock/StartTime/EndTime` from `DATE_TRUNC`.

**Constraints:**
- `BlocksGroupedInfo` is a cross-domain contract. A field rename/removal must
  be checked against **both** `retrieveWindowBlocks` and
  `retrieveTimeBasedBlockListing`, and against **both** `windows.tmpl` and the
  time-listing template — the struct has no per-flow type boundary.
- Adding a field used by only one flow leaves it zero-valued in the other;
  templates must not assume a field is populated unless its own `Scan` set it.

---

## 4. Multi-Coin Tx-Count Reconciliation via JSONB Aggregate

**Appears in:**
- /wiki/code-analysis/windows/flow.full.md

**Description:**
`SUM(num_rtx)` alone is not trusted as the window transaction count. The query
also emits `JSONB_AGG(coin_tx_stats) AS coin_tx_stats`
(`db/dcrpg/internal/blockstmts.go:135`). `retrieveWindowBlocks` scans this raw
JSON and passes it through `parseCoinTxStats(coinTxStats, txs)`
(`db/dcrpg/queries.go:877`): it unmarshals `[]map[string]dbtypes.CoinTxStats`
(`db/dbtypes/types.go:2214`), sums every per-coin `TxCount`, and **overrides**
the `SUM(num_rtx)` value when the per-coin total is larger. The displayed
`Transactions` / `TxCount` therefore folds in per-coin-type activity rather
than a single flat count — the multi-coin analogue of the legacy single-value
`num_rtx`.

**Constraints:**
- This is the multi-coin-aware path (see [/wiki/core/constraints.md#C7](/wiki/core/constraints.md#C7)
  for the per-coin-type model). Removing the `JSONB_AGG(coin_tx_stats)` column
  from the SQL while leaving the `Scan(... &coinTxStats)` in
  `retrieveWindowBlocks` is a column-count mismatch (hard failure); the inverse
  silently reverts to flat `num_rtx` counts.
- `parseCoinTxStats` is intentionally lenient: empty/short/`\x00`-padded JSON
  and unmarshal errors fall back to `txs` rather than erroring. Do not "fix"
  this into a hard error without auditing windows whose blocks predate
  `coin_tx_stats` population.

---

See also:
- /wiki/code-analysis/windows/flow.full.md (derived-from: windows data-flow trace)
- /wiki/code-analysis/windows/impact.md (depends-on: windows mutation risks)
- /wiki/code-analysis/time-based-blocks/flow.full.md (shares-pattern-with: dbtypes.BlocksGroupedInfo struct pass-through)
- /wiki/core/constraints.md#C7 (depends-on: per-coin-type model — coin_tx_stats reconciliation)
