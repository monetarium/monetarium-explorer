# Time-Based Blocks Domain – Mutation Impact

## Risk: UTC cast diverges between `SELECT` and `GROUP BY`

**Trigger:**
Editing the `DATE_TRUNC` expression in `SelectBlocksTimeListingByLimit` ([db/dcrpg/internal/blockstmts.go:142-156](../../../db/dcrpg/internal/blockstmts.go)) and changing the `time at time zone 'utc'` cast in only one of the two places it appears (the `SELECT … AS index_value` projection at line 142 vs the `GROUP BY` at line 154), or dropping the UTC cast to "use local time".

**Affected flows:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Failure mode:** silent.

**Description:**
Both `DATE_TRUNC` expressions must be byte-identical for Postgres to treat the projected `index_value` as the grouping key. If only one carries the UTC cast (or the server's session `TimeZone` changes), interval boundaries shift to the server's local zone: blocks near midnight migrate between buckets, the day/week/month/year totals change, and `index_value` may no longer align with the `MIN(time)`/`MAX(time)` pair scanned into `StartTime`/`EndTime`. No error is raised — the page renders plausible-but-wrong aggregates. Detection requires spot-checking a known day's tx count against an independent source.

---

## Risk: positional `rows.Scan` desync after SQL column change

**Trigger:**
Adding, removing, or reordering a column in the `SelectBlocksTimeListingByLimit` `SELECT` list ([db/dcrpg/internal/blockstmts.go:142-153](../../../db/dcrpg/internal/blockstmts.go)) without applying the identical change to the `rows.Scan` argument list in `retrieveTimeBasedBlockListing` ([db/dcrpg/queries.go:977-978](../../../db/dcrpg/queries.go)).

**Affected flows:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Failure mode:** loud if the column count or a type changes (`rows.Scan` returns an error, surfaced as `ExpStatusNotFound`); silent if two same-typed columns are swapped (values land in the wrong fields, page renders wrong numbers).

**Description:**
The scan is positional across 11 destinations (`indexVal, endBlock, txs, tickets, votes, revocations, blockSizes, blocksCount, startTime, endTime, coinTxStats`). A count/type mismatch makes `rows.Scan` error and the handler renders `"The specified block intervals could be not found"` ([cmd/dcrdata/internal/explorer/explorerroutes.go:550-556](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)). The dangerous case is reordering two `uint64` columns (e.g. `votes`/`revocations`): no error, the wrong totals show in `timelisting.tmpl` columns. Note `txs` is additionally post-mutated by `parseCoinTxStats(coinTxStats, txs)` ([queries.go:983](../../../db/dcrpg/queries.go)) and feeds `TxCount = txs + tickets + revocations + votes` ([queries.go:991](../../../db/dcrpg/queries.go)) — a `coin_tx_stats` shape change there silently corrupts both `Transactions` and the derived `TxCount`.

---

## Risk: `BlocksGroupedInfo` field change breaks the windows page

**Trigger:**
Renaming, removing, or retyping any field of `dbtypes.BlocksGroupedInfo` ([db/dbtypes/types.go:805-824](../../../db/dbtypes/types.go)) to satisfy a time-based-listing requirement, without checking the windows domain.

**Affected flows:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)
- [/wiki/code-analysis/windows/flow.full.md](../windows/flow.full.md)

**Failure mode:** loud (Go `html/template` panics at execution when a referenced field is missing) — but only on the page whose template references the changed field, which may be the *other* domain you didn't test.

**Description:**
The struct has two producers — `retrieveTimeBasedBlockListing` (this domain) and `retrieveWindowBlocks` (windows, [db/dcrpg/queries.go:935-948](../../../db/dcrpg/queries.go)) — and two templates. They populate disjoint field subsets: `IndexVal`/`Difficulty`/`TicketPrice` are filled by the windows producer and left zero here; the aggregate fields are filled by both. A field removed because `timelisting.tmpl` doesn't use it can still be read by `windows.tmpl`, panicking `/ticketpricewindows` while `/years` looks fine. Always grep both templates and both producers before mutating this struct; it is the explicit cross-domain coupling for this domain.

---

## Risk: YTD label attached to the wrong row or skewed at year boundary

**Trigger:**
(a) Changing the `ORDER BY index_value DESC` in `SelectBlocksTimeListingByLimit`; or (b) routing `/years` through a path that does not pass the literal `"Years"` to `timeBasedBlocksListing`; or (c) relying on the year comparison being timezone-consistent across the New Year boundary.

**Affected flows:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Failure mode:** silent (wrong or missing "YTD" label; numbers are correct, the label is misleading).

**Description:**
The handler overwrites `data[0].FormattedStartTime` with `"<year> YTD"` only when `val == "Years"`, `len(data) > 0`, and `data[0].EndTime.T.Year() == time.Now().Year()` ([cmd/dcrdata/internal/explorer/explorerroutes.go:569-571](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)). It assumes `data[0]` is the newest interval (depends on `ORDER BY … DESC`). It compares `EndTime` (derived from `MAX(time)` cast to UTC by the aggregation query) against `time.Now()` (server local zone). Around 1 January, a UTC-vs-local zone offset can make the comparison true/false incorrectly for a few hours, labelling last year's row "YTD" or omitting the label on this year's row. Reordering the SQL silently moves the label onto a non-current row. Switching `/years` to a different handler argument silently disables the label entirely (it keys off `val`, not the `grouping` enum).

---

## Risk: removing the handler-level year fallback turns graceful default into error page

**Trigger:**
Refactoring `TimeGroupingFromStr` ([db/dbtypes/types.go:841-856](../../../db/dbtypes/types.go)) or the fallback block in `timeBasedBlocksListing` ([cmd/dcrdata/internal/explorer/explorerroutes.go:507-519](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)) — e.g. "simplify" the fallback assuming `TimeGroupingFromStr` returns a usable default, or remove the `grouping = dbtypes.YearGrouping` reassignment.

**Affected flows:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Failure mode:** loud for unrecognised grouping strings (error status page instead of a year listing); no effect on the four real routes.

**Description:**
`TimeGroupingFromStr`'s `default` returns `UnknownGrouping` (= 5 = `NumIntervals`), **not** `YearGrouping`. The graceful "default to year" behavior is entirely in the handler: `TimeBasedGroupingToInterval(UnknownGrouping)` errors ([db/dbtypes/conversion.go:130-132](../../../db/dbtypes/conversion.go)), the handler catches it, sets `grouping = YearGrouping`, and re-resolves. Independently, `ChainDB.TimeBasedIntervals` hard-rejects any `timeGrouping >= dbtypes.NumIntervals` ([db/dcrpg/pgblockchain.go:1819-1821](../../../db/dcrpg/pgblockchain.go)). So if the handler fallback is removed, an unrecognised grouping no longer falls back to year — it reaches the DB wrapper as `UnknownGrouping` and errors. The four production routes pass fixed literals (`"Days"`/`"Weeks"`/`"Months"`/`"Years"`, [explorerroutes.go:464-482](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)) and never exercise this path; the risk is only realised by a new route or external caller.

> Note: `TimeGroupingFromStr` returns `UnknownGrouping` for unhandled names; the year fallback lives in the `timeBasedBlocksListing` handler, not in `TimeGroupingFromStr`. flow.full.md §5 / flow.compact.md were reconciled to this in the same maintenance pass. The user-visible outcome for valid routes is unchanged.

---

## Risk: hard DB timeout blanks the whole listing

**Trigger:**
Any query slowdown on the `blocks`-table `GROUP BY DATE_TRUNC` aggregation exceeding `pgb.queryTimeout` — e.g. a large blocks table without an index supporting the time aggregation, or a `rows`/`offset` change that widens the scan.

**Affected flows:**
- [/wiki/code-analysis/time-based-blocks/flow.full.md](flow.full.md)

**Failure mode:** loud (full-page replacement with `ExpStatusDBTimeout`).

**Description:**
`ChainDB.TimeBasedIntervals` wraps the query in `context.WithTimeout(ctx, pgb.queryTimeout)` ([db/dcrpg/pgblockchain.go:1822-1825](../../../db/dcrpg/pgblockchain.go)). On timeout the handler's `exp.timeoutErrorPage(w, err, "TimeBasedIntervals")` returns `true` and renders the `ExpStatusDBTimeout` page ([cmd/dcrdata/internal/explorer/explorerroutes.go:546-549](../../../cmd/dcrdata/internal/explorer/explorerroutes.go); status mapping at `:2115`). There is no partial render or cache fallback for this domain — the entire `/days`/`/weeks`/`/months`/`/years` page is replaced. The aggregation has no `LIMIT`-before-`GROUP BY` (the `LIMIT $2 OFFSET $3` applies to the grouped result), so cost scales with total block count regardless of the page requested. Adding/removing aggregate columns or changing the grouping expression directly affects this timeout exposure.

See also:
- /wiki/code-analysis/windows/flow.full.md (shares-pattern-with: `dbtypes.BlocksGroupedInfo` shared struct — windows page panics if this struct's fields change)
- /wiki/code-analysis/time-based-blocks/patterns.md (derived-from: the patterns whose constraints these risks enforce)
- /wiki/core/constraints.md (depends-on: multi-coin `coin_tx_stats` JSON feeds `parseCoinTxStats` -> `Transactions`/`TxCount`)
