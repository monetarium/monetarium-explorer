### Section 1 — Overview
This document tracks the data flow for time-grouped block listings (used on `/years`, `/months`, `/weeks`, and `/days` pages).

### Section 2 — End-to-End Data Flow
```
Postgres DB (blocks) → ChainDB (pgblockchain) → Explorer Handler (explorerroutes) → UI (timelisting.tmpl)
```

### Section 3 — Per-Layer Breakdown
- **Database (`blocks` table):**
  - Aggregates metrics (`num_rtx`, `fresh_stake`, `voters`, `revocations`, `size`) grouping by `date_trunc` as `index_value`.
  - Source: `db/dcrpg/internal/blockstmts.go` (`SelectBlocksTimeListingByLimit`).
- **ChainDB (`db/dcrpg/queries.go` & `pgblockchain.go`):**
  - Scans grouped rows into `*dbtypes.BlocksGroupedInfo`.
  - Transforms raw bytes/timestamps into `FormattedSize`, `FormattedStartTime`, and `FormattedEndTime`.
- **Explorer API (`cmd/dcrdata/internal/explorer/explorerroutes.go`):**
  - Routes time-based URLs to the generalized `timeBasedBlocksListing` function.
  - Calculates pagination offsets based on `oldestBlockTime` (genesis block).
  - Conditionally mutates `FormattedStartTime` to append " YTD" (Year-to-date) if querying `/years` and viewing the current year.
- **UI (`cmd/dcrdata/views/timelisting.tmpl`):**
  - Consumes the `Data []*dbtypes.BlocksGroupedInfo` list.
  - Dynamically builds links and pagination blocks based on `BestGrouping` and `LastOffset`.

### Section 4 — Cross-Layer Dependencies
- The `timeBasedBlocksListing` routing handler directly synchronizes pagination constraints (limits/offsets) based on Postgres `date_trunc` calculation boundaries.
- UI pagination (`pages`) strictly depends on `BestGrouping` and `LastOffset` fields explicitly injected by the route handler.

### Section 5 — Critical Constraints
- **Time Zones:** The Postgres aggregation query `SelectBlocksTimeListingByLimit` forces `time at time zone 'utc'`.
- **Offset Bounds:** The `maxOffset` math relies on the genesis block timestamp (`oldestBlockTime`). It uses a +1 buffer for unaligned partial months/days.
- **Silent Defaults:** `TimeGroupingFromStr` defaults to `YearGrouping` instead of returning errors for unhandled grouping intervals.

### Section 6 — Mutation Impact
When modifying time-based block groupings, check:
- **Direct dependencies:** `dbtypes.BlocksGroupedInfo` and `timelisting.tmpl`.
- **Indirect dependencies:** `StakeDiffWindows` endpoint (which shares `dbtypes.BlocksGroupedInfo` but not the identical time constraints).
- **Serialization boundaries:** Changes to the `SelectBlocksTimeListingByLimit` SQL selection require equivalent modifications to the `rows.Scan` implementation inside `retrieveTimeBasedBlockListing`.

**Failures Modes:**
- **Silent failures:** Modifying the `utc` assumption in the SQL query will cause grouped data to subtly drift from global time blocks without raising errors.
- **Hard failures:** A database timeout triggers `exp.timeoutErrorPage`, completely halting the view with an `ExpStatusDBTimeout` response.

### Section 7 — Common Pitfalls
- Editing `dbtypes.BlocksGroupedInfo` assuming it solely serves time-grouped blocks. It's heavily shared with the `/ticketpricewindows` data pipeline.
- Modifying date strings on the DB layer and breaking the YTD (Year-To-Date) string logic that's hardcoded at the controller layer (`timeBasedBlocksListing`).

### Section 8 — Evidence
- SQL logic: `db/dcrpg/internal/blockstmts.go` -> `SelectBlocksTimeListingByLimit`.
- Data transformation: `db/dcrpg/queries.go` -> `retrieveTimeBasedBlockListing()`.
- Routing handler: `cmd/dcrdata/internal/explorer/explorerroutes.go` -> `timeBasedBlocksListing()`.
- Presentation layer: `cmd/dcrdata/views/timelisting.tmpl`.
