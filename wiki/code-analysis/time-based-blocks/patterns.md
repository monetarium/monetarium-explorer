# Time-Based Blocks Domain Patterns

## SQL `date_trunc` time aggregation with UTC pinning

**Appears in:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Description:**
The `/days`, `/weeks`, `/months`, `/years` listings are produced entirely in Postgres, not in Go. `SelectBlocksTimeListingByLimit` ([db/dcrpg/internal/blockstmts.go:142-156](../../../db/dcrpg/internal/blockstmts.go)) groups the `blocks` table by `DATE_TRUNC($1, time at time zone 'utc')` where `$1` is the bind-parameterised interval string (`"day"`/`"week"`/`"month"`/`"year"`, supplied by `timeGrouping.String()` in [db/dcrpg/pgblockchain.go:1824](../../../db/dcrpg/pgblockchain.go)). Aggregates (`SUM(num_rtx)`, `SUM(fresh_stake)`, `SUM(voters)`, `SUM(revocations)`, `SUM(size)`, `COUNT(*)`, `MIN(time)`/`MAX(time)`, `JSONB_AGG(coin_tx_stats)`) are computed in the same pass; the regular-tx total is then post-corrected from the aggregated `coin_tx_stats` JSON via `parseCoinTxStats` ([db/dcrpg/queries.go:983](../../../db/dcrpg/queries.go)). The `time at time zone 'utc'` cast appears in **both** the `SELECT` projection and the `GROUP BY` and must stay identical between them or the projected `index_value` will not match the grouping key.

**Constraints:**
- The interval string is bind-parameterised (`$1`), but it is a SQL-keyword-bearing argument to `DATE_TRUNC`; only the five strings from `TimeBasedGroupings` ([db/dbtypes/types.go:827-833](../../../db/dbtypes/types.go)) are valid. Do not let arbitrary user input reach `timeInterval` — the route handler always derives it from `TimeGroupingFromStr` on a fixed literal (`"Days"`/`"Weeks"`/...), never from the URL.
- Any new aggregate column added to the `SELECT` list MUST be added in the same order to the `rows.Scan` in `retrieveTimeBasedBlockListing` ([db/dcrpg/queries.go:977-978](../../../db/dcrpg/queries.go)); the scan is positional, not by name.
- Both the `SELECT` and `GROUP BY` `DATE_TRUNC` expressions must carry the identical `time at time zone 'utc'` cast. Changing one without the other is a silent grouping-drift bug (see impact.md).

---

## Two consumers of one shared `BlocksGroupedInfo` struct (asymmetric population)

**Appears in:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)
- [/wiki/code-analysis/windows/flow.full.md](../windows/flow.full.md)

**Description:**
`dbtypes.BlocksGroupedInfo` ([db/dbtypes/types.go:805-824](../../../db/dbtypes/types.go)) is shared by two unrelated pages: the time-based listings (this domain, via `retrieveTimeBasedBlockListing`, [db/dcrpg/queries.go:985-999](../../../db/dcrpg/queries.go)) and the ticket-price / stake-difficulty windows page (windows domain, via `retrieveWindowBlocks`, [db/dcrpg/queries.go:935-948](../../../db/dcrpg/queries.go)). The two producers populate **disjoint subsets** of the struct:

| Field | time-based listing | windows |
|---|---|---|
| `IndexVal`, `Difficulty`, `TicketPrice`, `StartTime`, `FormattedStartTime` | left zero (except `StartTime`/`FormattedStartTime`) | populated |
| `EndBlock`, `Voters`, `Transactions`, `FreshStake`, `Revocations`, `TxCount`, `BlocksCount`, `Size`, `FormattedSize`, `EndTime`, `FormattedEndTime` | populated | populated |

Each page's template ([cmd/dcrdata/views/timelisting.tmpl](../../../cmd/dcrdata/views/timelisting.tmpl) vs `windows.tmpl`) reads only the fields its producer fills.

**Constraints:**
- Adding a field consumed by `timelisting.tmpl` requires populating it in `retrieveTimeBasedBlockListing`; the windows producer will leave it zero and that is acceptable only if `windows.tmpl` does not read it.
- Renaming or removing any existing field is a cross-domain change: it breaks both `timelisting.tmpl` and `windows.tmpl` (Go html/template field access panics at execution time). Check the windows domain before mutating the struct.
- Do not "tidy" the unused-by-time-listing fields away — they are load-bearing for the windows page.

---

## Controller-layer "YTD" string mutation on the current-year row

**Appears in:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Description:**
The DB layer formats `FormattedStartTime` uniformly as `startTime.Format("2006-01-02")` ([db/dcrpg/queries.go:996](../../../db/dcrpg/queries.go)). The route handler then **overwrites** that string in place for one specific case: when the view is `"Years"`, the result set is non-empty, and the top row's `EndTime` falls in the current calendar year, `data[0].FormattedStartTime` is replaced with `fmt.Sprintf("%s YTD", time.Now().Format("2006"))` ([cmd/dcrdata/internal/explorer/explorerroutes.go:569-571](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)). This is a display-only post-processing step; no other view (`/days`/`/weeks`/`/months`) and no other row is touched.

**Constraints:**
- The YTD branch keys off the literal `val == "Years"` (the handler's own argument), not off the `grouping` enum. Routing `/years` through anything other than `YearBlocksListing` -> `timeBasedBlocksListing("Years", …)` would silently disable the YTD label.
- It mutates `data[0]` (the first row) and depends on the SQL `ORDER BY index_value DESC` putting the newest interval first. Changing the sort order in `SelectBlocksTimeListingByLimit` silently mislabels the wrong row as "YTD".
- It compares `data[0].EndTime.T.Year()` to `time.Now().Year()`. `EndTime` comes from `MAX(time)` (UTC, see the aggregation pattern). The `.Year()` here uses the server's local zone via `time.Now()`, while `EndTime` is UTC — a year-boundary skew window exists; see impact.md.
- Changing the DB-layer date format string is safe for non-year views but the year view's top row is always replaced, so DB-layer format changes are invisible there.

---

## Genesis-anchored pagination with partial-interval +1 buffer

**Appears in:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Description:**
Pagination is not row-count driven; it is **time driven**. `maxOffset = (time.Now().Unix() - oldestBlockTime) / int64(i)` where `oldestBlockTime` is the genesis block header timestamp (`exp.ChainParams.GenesisBlock.Header.Timestamp`) and `i` is the interval length in seconds from `TimeBasedGroupingToInterval` ([cmd/dcrdata/internal/explorer/explorerroutes.go:521-523](../../../cmd/dcrdata/internal/explorer/explorerroutes.go); [db/dbtypes/conversion.go:110-133](../../../db/dbtypes/conversion.go)). A `+1` buffer is added to `maxOffset` for unaligned partial year/month intervals when "now" has not yet reached the genesis month/day boundary ([explorerroutes.go:534-538](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)). The requested `offset` is clamped to `maxOffset` ([:524-526](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)), and `lastOffset` (the final page's offset) is derived from `maxOffset % rows` ([:558-565](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)). `maxOffset` is exported to the template as `BestGrouping` and consumed by `calcPages` and `timelisting.tmpl` ([:590-592](../../../cmd/dcrdata/internal/explorer/explorerroutes.go); [cmd/dcrdata/views/timelisting.tmpl:15,74](../../../cmd/dcrdata/views/timelisting.tmpl)).

**Constraints:**
- `TimeBasedGroupingToInterval` returns `float64` seconds; `MonthGrouping`/`YearGrouping` use the approximation `daysPerMonth = 30.41666…` (365/12). The page-count math is intentionally approximate — do not "fix" it to exact calendar months without re-deriving the `+1` buffer logic, which compensates for the approximation against the genesis boundary.
- `oldestBlockTime` is the chain genesis timestamp from `ChainParams`, not the oldest row in the DB. On a freshly-synced or pruned DB the two can differ; the math assumes genesis.
- `BestGrouping` (the template name for `maxOffset`) drives both `calcPages` and the "last page" link (`{{add .BestGrouping 1}}`, `LastOffset`). Changing the offset formula requires re-checking both the clamp at `:524-526` and the `lastOffset` derivation at `:558-565`, and the template's `$lastGrouping` math.

---

## Handler-level grouping fallback (not in `TimeGroupingFromStr`)

**Appears in:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Description:**
`dbtypes.TimeGroupingFromStr` ([db/dbtypes/types.go:841-856](../../../db/dbtypes/types.go)) maps grouping strings (`"day"`/`"days"`, `"wk"`/`"week"`/`"weeks"`, etc.) to a `TimeBasedGrouping`. Its `default` case returns the explicit sentinel `UnknownGrouping` ([types.go:762,854](../../../db/dbtypes/types.go)) — it does **not** silently coerce to `YearGrouping`. The year fallback lives one layer up in the handler: `timeBasedBlocksListing` calls `TimeBasedGroupingToInterval(grouping)`; for `UnknownGrouping` that returns an error ([db/dbtypes/conversion.go:130-132](../../../db/dbtypes/conversion.go)), and the handler catches it and reassigns `grouping = dbtypes.YearGrouping`, then re-resolves the interval ([cmd/dcrdata/internal/explorer/explorerroutes.go:507-519](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)). A second failure of `TimeBasedGroupingToInterval(YearGrouping)` renders an `ExpStatusError` page. `ChainDB.TimeBasedIntervals` independently rejects any `timeGrouping >= dbtypes.NumIntervals` (which `UnknownGrouping == 5` would be) with a hard error ([db/dcrpg/pgblockchain.go:1819-1821](../../../db/dcrpg/pgblockchain.go)), so the handler must complete the fallback before the DB call.

> Note: `TimeGroupingFromStr` ([db/dbtypes/types.go:841](../../../db/dbtypes/types.go#L841)) returns the sentinel `UnknownGrouping` for unhandled names — it does **not** itself default to `YearGrouping`. The year fallback is implemented one layer up in the `timeBasedBlocksListing` route handler. (flow.full.md §5 / flow.compact.md were reconciled to this in the same maintenance pass.) Behavior for the four real routes is unaffected because they pass fixed literals (`"Days"`/`"Weeks"`/`"Months"`/`"Years"`) that always resolve.

**Constraints:**
- All four real entry points pass hard-coded valid strings ([explorerroutes.go:464-482](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)); the `UnknownGrouping` path is only reachable if a new route or caller passes an unrecognised string. New callers must not rely on `TimeGroupingFromStr` returning a usable default — it returns `UnknownGrouping`.
- The handler's fallback resolves `UnknownGrouping` -> `YearGrouping` *before* calling `dataSource.TimeBasedIntervals`, which itself hard-rejects out-of-range groupings. Removing the handler-level fallback would turn a graceful year fallback into a DB-layer error page.

See also:
- /wiki/code-analysis/windows/flow.full.md (shares-pattern-with: `dbtypes.BlocksGroupedInfo` shared struct; same `retrieveWindowBlocks`/`retrieveTimeBasedBlockListing` producers in db/dcrpg/queries.go)
- /wiki/code-analysis/time-based-blocks/impact.md (derived-from: this domain's flow; risk surface for the patterns above)
- /wiki/core/constraints.md (depends-on: multi-coin `coin_tx_stats` JSON aggregation feeds the regular-tx total via parseCoinTxStats)
