### Section 1 — Overview
This document traces the data flow for time-grouped block listings used on `/days`, `/weeks`,
`/months`, and `/years`. Each page aggregates all `blocks` rows into calendar periods via
Postgres `DATE_TRUNC`, paginates the result, and renders through a shared Go template.

### Section 2 — End-to-End Data Flow
```
Postgres (blocks table, DATE_TRUNC aggregation)
  → db/dcrpg (retrieveTimeBasedBlockListing / Count)
  → ChainDB (TimeBasedIntervals / TimeBasedIntervalsCount)
  → explorerroutes.go timeBasedBlocksListing handler
      - parse offset/rows from URL
      - normalizeExplorerRows (default 100, cap 400)
      - totalGroupings count → maxOffset
      - fetch data, derive lastOffset, YTD mutation for /years
  → timelisting.tmpl (pagination header, rows table, page switcher)
```

### Section 3 — Per-Layer Breakdown

#### Database layer — `db/dcrpg/internal/blockstmts.go`
**Location:** `blockstmts.go:151–165` (`SelectBlocksTimeListingByLimit`);
`blockstmts.go:172` (`SelectBlocksTimeListingCount`)

**SQL structure:**
```sql
-- listing
SELECT DATE_TRUNC($1, time at time zone 'utc') AS index_value,
       MAX(height) AS max_height,
       SUM(num_rtx) AS txs,
       SUM(fresh_stake) AS tickets,
       SUM(voters) AS votes,
       SUM(revocations) AS revocations,
       SUM(size) AS size,
       COUNT(*) AS blocks_count,
       MIN(time) AS start_time,
       MAX(time) AS end_time,
       JSONB_AGG(coin_tx_stats) AS coin_tx_stats
FROM blocks
GROUP BY DATE_TRUNC($1, time at time zone 'utc')
ORDER BY index_value DESC
LIMIT $2 OFFSET $3;

-- count (paired — DATE_TRUNC expression MUST stay identical)
SELECT COUNT(DISTINCT DATE_TRUNC($1, time at time zone 'utc')) FROM blocks;
```

The `$1` bind parameter carries the interval string (`"day"`/`"week"`/`"month"`/`"year"`), derived
from `timeGrouping.String()`. The `time at time zone 'utc'` cast appears in **both** the
`SELECT` projection and the `GROUP BY`; they must stay byte-identical.

#### Query layer — `db/dcrpg/queries.go`
**Location:**
- `retrieveTimeBasedBlockListingCount` (line 914) — `SELECT COUNT(…)` → `uint64`
- `retrieveTimeBasedBlockListing` (line 925) — listing query → `[]*dbtypes.BlocksGroupedInfo`

**Scan (positional, 11 destinations, line 941–942):**
```go
rows.Scan(&indexVal, &endBlock, &txs, &tickets, &votes,
    &revocations, &blockSizes, &blocksCount, &startTime, &endTime, &coinTxStats)
```
After scan, `txs = parseCoinTxStats(coinTxStats, txs)` (line 947) overwrites the raw
`SUM(num_rtx)` with the sum across all `coin_tx_stats` JSONB entries — the multi-coin
correct tx count. The `BlocksGroupedInfo` is then populated (lines 949–963):
`Transactions = txs` (corrected), `TxCount = txs + tickets + revocations + votes`.

#### ChainDB wrapper — `db/dcrpg/pgblockchain.go`
**Location:**
- `TimeBasedIntervals` (line 1857) — validates grouping (rejects `>= NumIntervals`, line 1859),
  applies `context.WithTimeout` (line 1862), calls `retrieveTimeBasedBlockListing`
- `TimeBasedIntervalsCount` (line 1872) — same guard (line 1873), calls
  `retrieveTimeBasedBlockListingCount`

#### Handler — `cmd/dcrdata/internal/explorer/explorerroutes.go`
**Entry points (lines 500–515):** four thin wrappers (`DayBlocksListing`, `WeekBlocksListing`,
`MonthBlocksListing`, `YearBlocksListing`) each call `timeBasedBlocksListing(val, w, r)` with
a fixed literal string.

**`timeBasedBlocksListing` (line 520):**
1. Parse `?offset=` (uint64, lines 523–531) and `?rows=` (uint64, lines 532–540) from URL.
2. `grouping := dbtypes.TimeGroupingFromStr(val)` (line 541) — maps string to
   `TimeBasedGrouping` enum.
3. Validate via `TimeBasedGroupingToInterval(grouping)` (line 545); `UnknownGrouping` errors →
   reassign `grouping = dbtypes.YearGrouping` (line 553); second failure → `ExpStatusError`.
4. `totalGroupings, err := exp.dataSource.TimeBasedIntervalsCount(ctx, grouping)` (line 556);
   `timeoutErrorPage` guard (line 557).
5. `maxOffset = int64(totalGroupings) - 1`, clamped to 0 on empty chain (lines 571–573);
   `offset` clamped to `maxOffset` (line 574–576).
6. **`rows = normalizeExplorerRows(rows)` (line 578)** — applies default 100 when `rows == 0`,
   caps at 400 (see constants in `explorer.go:50–51`).
7. `data, err := exp.dataSource.TimeBasedIntervals(ctx, grouping, rows, offset)` (line 580);
   `timeoutErrorPage` guard (line 581).
8. `lastOffset` derivation (lines 592–599): `lastOffsetRows := uint64(maxOffset) % rows`;
   two branches cover aligned vs unaligned final page.
9. YTD mutation (lines 603–604): if `val == "Years"`, data non-empty, and top row's `EndTime`
   is in current year → overwrite `data[0].FormattedStartTime` with `"<year> YTD"`.
10. Build `linkTemplate` (line 607), exec `"timelisting"` template (line 609) with:
    `Offset`, `Limit` (= rows), `BestGrouping` (= maxOffset), `LastOffset`, `Pages`.

**`normalizeExplorerRows` (line 645–653):**
```go
func normalizeExplorerRows[T int64 | uint64](rows T) T {
    switch {
    case rows == 0:
        return defaultExplorerRows   // 100
    case rows > maxExplorerRows:
        return maxExplorerRows       // 400
    }
    return rows
}
```
Generic to avoid `uint64` overflow that a naive `int64` cast of a URL-supplied value would
introduce. Also called by `StakeDiffWindows` (line 451) and `Blocks` (line 692).

**Constants (`cmd/dcrdata/internal/explorer/explorer.go:50–51`):**
```go
maxExplorerRows     = 400
defaultExplorerRows = 100
```

#### Template — `cmd/dcrdata/views/timelisting.tmpl`
Consumes `Data []*dbtypes.BlocksGroupedInfo`, `Offset`, `Limit`, `BestGrouping`, `LastOffset`,
`Pages`. Key computed variables:
- `$oldest = (add .Offset $count)` (line 14)
- `$lastGrouping = (add .BestGrouping 1)` (line 15) — the total row count for "N of M" display

Pagination links use `?offset=…&rows={{.Limit}}`. Per-page selector offers 10/20/30/50/100;
the currently-active size is highlighted via `{{if eq .Limit N}}selected{{end}}`.

#### Shared struct — `db/dbtypes/types.go:816–835`
`BlocksGroupedInfo` is shared with the windows pipeline (`retrieveWindowBlocks`). The two
producers populate disjoint field subsets (see patterns.md § "Two consumers of
BlocksGroupedInfo").

### Section 4 — Cross-Layer Dependencies
- **SQL ↔ Scan coupling:** `SelectBlocksTimeListingByLimit` (11 SELECT columns) and
  `rows.Scan` (11 destinations, queries.go:941–942) are positionally coupled. Any column
  change must be applied to both simultaneously.
- **Count ↔ Listing coupling:** `SelectBlocksTimeListingCount` and
  `SelectBlocksTimeListingByLimit` share the same `DATE_TRUNC($1, time at time zone 'utc')`
  expression. Divergence silently misaligns the displayed "N of M rows" header.
- **`normalizeExplorerRows` shared logic:** the default (100) and cap (400) are defined once
  in `explorer.go`. If those constants change, all three callers (blocks, windows, time-based)
  change together.
- **`BlocksGroupedInfo` cross-domain coupling:** any struct field change affects both
  `timelisting.tmpl` (this domain) and `windows.tmpl` (windows domain). Go `html/template`
  panics on a missing field at execution time, not at compile time.
- **YTD branch tight coupling:** the `val == "Years"` guard in the YTD mutation keys off the
  handler's fixed-literal argument, not the `grouping` enum. The check also compares
  `EndTime.T.Year()` (UTC) against `time.Now().Year()` (server local zone).

### Section 5 — Critical Constraints
- **UTC pinning (both clauses):** both `DATE_TRUNC` expressions (SELECT and GROUP BY in
  `SelectBlocksTimeListingByLimit`) must carry `time at time zone 'utc'`. Dropping from one
  silently shifts interval boundaries to the server's local zone.
- **Positional Scan invariant:** 11-column SELECT → 11 Scan destinations, in order. Same-type
  column swaps are silent corruption (wrong numbers, no error).
- **`parseCoinTxStats` post-correction:** the multi-coin `coin_tx_stats` JSONB post-corrects
  `txs` after the Scan; removing it restores the raw `SUM(num_rtx)` which under-counts in
  multi-coin blocks.
- **`normalizeExplorerRows` overflow safety (C-derived):** `rows` is `uint64` throughout the
  handler; the generic constraint `T int64 | uint64` avoids the `> maxExplorerRows`
  comparison producing wrong results via overflow on huge URL values.
- **`BlocksGroupedInfo` shared struct:** see Section 4. Relates to `core/constraints.md` C8
  (cross-layer coupling via shared types).
- **`ORDER BY index_value DESC`:** the YTD branch assumes `data[0]` is the newest period.
  Changing the sort order silently applies the YTD label to the wrong row.

### Section 6 — Mutation Impact
When modifying this flow:
- **`normalizeExplorerRows` or its constants** — changes `defaultExplorerRows`/`maxExplorerRows`
  in `explorer.go` affect all three callers (blocks, windows, time-based). The template's
  per-page dropdown (10/20/30/50/100) does not update automatically; a new default outside
  those options renders with no dropdown option pre-selected (cosmetic, not functional).
- **`BlocksGroupedInfo` fields** — check both `timelisting.tmpl` and `windows.tmpl` plus both
  producers (`retrieveTimeBasedBlockListing` and `retrieveWindowBlocks`). Silent omission in
  one producer, hard template panic in the other's template.
- **SQL column addition** — add to SELECT, and add Scan destination in the same position.
- **`DATE_TRUNC` expression** — change in both SELECT and GROUP BY, and in the COUNT query.
- **YTD branch (`val == "Years"`)** — routing change or argument rename silently disables it.

**Silent failures:** UTC drift, wrong-row YTD label, `parseCoinTxStats` removal, same-type Scan
swap, missing `defaultExplorerRows` dropdown option.

**Hard failures:** Scan column-count mismatch (DB error → `ExpStatusNotFound`), query timeout
(`ExpStatusDBTimeout`, no cache fallback), `BlocksGroupedInfo` field removal (template panic).

### Section 7 — Common Pitfalls
- Editing `BlocksGroupedInfo` for a time-based requirement and not checking `windows.tmpl` —
  the cross-domain struct sharing is non-obvious.
- Assuming `TimeGroupingFromStr` has a built-in `YearGrouping` default — it returns
  `UnknownGrouping`; the fallback is exclusively in the handler.
- Changing the `DATE_TRUNC` in only one of the two SQL queries (listing vs count), causing
  displayed "N of M" to disagree with actual rows.
- Removing `parseCoinTxStats` post-correction assuming `SUM(num_rtx)` is correct — in
  multi-coin blocks the JSONB-aggregated count is the authoritative per-coin sum.
- Editing `defaultExplorerRows` without updating the template's per-page dropdown if the new
  default is not one of the listed options.

### Section 8 — Evidence
- SQL queries: `db/dcrpg/internal/blockstmts.go:151–172`
- Scan + struct population: `db/dcrpg/queries.go:925–968`
- `parseCoinTxStats`: `db/dcrpg/queries.go:826–831`
- ChainDB wrappers: `db/dcrpg/pgblockchain.go:1857–1880`
- Handler function: `cmd/dcrdata/internal/explorer/explorerroutes.go:520–638`
- `normalizeExplorerRows` + constants: `cmd/dcrdata/internal/explorer/explorerroutes.go:645–653`
  + `cmd/dcrdata/internal/explorer/explorer.go:50–51`
- Shared entry points: `explorerroutes.go:500–515`
- Template: `cmd/dcrdata/views/timelisting.tmpl`
- Shared struct: `db/dbtypes/types.go:816–835`
- `TimeGroupingFromStr` / `UnknownGrouping` / `NumIntervals`:
  `db/dbtypes/types.go:764–865`

See also:
- /wiki/code-analysis/windows/flow.full.md (shares-pattern-with: `BlocksGroupedInfo` shared struct, `normalizeExplorerRows` shared normalization)
- /wiki/code-analysis/block/flow.full.md (shares-pattern-with: `normalizeExplorerRows` also used by `Blocks` handler)
- /wiki/code-analysis/time-based-blocks/patterns.md (derived-from: patterns extracted from this flow)
- /wiki/code-analysis/time-based-blocks/impact.md (derived-from: risks derived from this flow)
- /wiki/core/constraints.md (depends-on: multi-coin `coin_tx_stats` JSON feeds `parseCoinTxStats`)
