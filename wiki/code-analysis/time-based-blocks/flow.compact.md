### Flow
`Postgres DATE_TRUNC aggregation → retrieveTimeBasedBlockListing/Count → ChainDB wrappers → timeBasedBlocksListing handler → normalizeExplorerRows → timelisting.tmpl`

### Key Architectural Patterns
- **SQL `date_trunc` UTC aggregation:** `blocks` table grouped by `DATE_TRUNC($1, time at time zone 'utc')` in both SELECT and GROUP BY; both expressions must stay identical or interval boundaries drift silently.
- **Shared `BlocksGroupedInfo` struct:** populated by two independent producers (`retrieveTimeBasedBlockListing` + `retrieveWindowBlocks`); the windows page reads fields the time-based producer leaves zero — editing the struct is a cross-domain change.
- **`normalizeExplorerRows` centralized page-size normalization:** generic helper (`explorer.go:50–51`, `explorerroutes.go:645–653`) default=100, cap=400; shared by time-based, windows, and blocks list handlers; prevents `uint64` overflow on URL parameters.
- **Controller-level YTD mutation:** `data[0].FormattedStartTime` overwritten to `"<year> YTD"` only when `val == "Years"` and top row's `EndTime.T.Year() == time.Now().Year()`; keys off the literal argument, not the grouping enum.
- **Row-count-driven pagination:** `TimeBasedIntervalsCount` returns the exact distinct grouping count; `maxOffset = totalGroupings - 1`; feeds `calcPages` and `lastOffset` derivation; replaced an earlier genesis-anchored time formula.

### Critical Constraints
- **UTC cast:** `time at time zone 'utc'` must appear in both `SELECT … AS index_value` and `GROUP BY`; divergence is a silent aggregation drift.
- **Positional Scan:** 11-column SELECT ↔ 11 Scan destinations (queries.go:941–942); same-type column swap is silent corruption.
- **`parseCoinTxStats` post-correction:** multi-coin JSONB corrects `txs` after Scan; removing it under-counts in multi-coin blocks.
- **`UnknownGrouping` sentinel:** `TimeGroupingFromStr` returns `UnknownGrouping` for unknown strings, not `YearGrouping`; year fallback is in the handler only.
- **`BlocksGroupedInfo` cross-domain:** struct field removal crashes the other domain's template at execution time, not compile time.

### Mutation Checklist
- [ ] Changing `BlocksGroupedInfo`? Grep both `timelisting.tmpl` and `windows.tmpl`; check both producers.
- [ ] Adding/removing a SQL column in `SelectBlocksTimeListingByLimit`? Update the Scan in the same order.
- [ ] Changing the `DATE_TRUNC` expression? Apply identically to `SelectBlocksTimeListingByLimit` SELECT clause, GROUP BY clause, and `SelectBlocksTimeListingCount`.
- [ ] Changing `defaultExplorerRows` or `maxExplorerRows` in `explorer.go`? Check the template's per-page dropdown — a new default outside 10/20/30/50/100 renders with no option pre-selected.
- [ ] Changing the YTD branch? It keys off `val == "Years"` (literal string), `ORDER BY index_value DESC` (top row = newest), and `EndTime.T.Year()` vs `time.Now().Year()` (UTC vs local zone).
