### Flow
`Postgres (date_trunc limits) → pgblockchain → timeBasedBlocksListing (explorerroutes) → timelisting.tmpl`

### Key Architectural Patterns
- **Database Time Aggregation:** Metrics (`num_rtx`, `fresh_stake`, `voters`, `revocations`, `size`) are explicitly grouped in SQL using `date_trunc(..., time at time zone 'utc')`.
- **Shared Grouping Struct:** The database uses the versatile `dbtypes.BlocksGroupedInfo` struct, which is heavily shared with the ticket price windows subsystem.
- **Controller-Level Date Mutation:** "Year-to-date" display logic is dynamically appended in the Go router layer, not the database.

### Critical Constraints
- **UTC Time Requirement:** Time groupings must always enforce `utc` at the SQL level, or aggregation logic silently drifts.
- **Genesis Block Offsets:** Maximum valid pagination offsets are tightly bound by calculations utilizing the `oldestBlockTime` (Genesis Block).
- **Silent Defaults:** `TimeGroupingFromStr` returns `UnknownGrouping` (not `YearGrouping`) for unhandled names; the `timeBasedBlocksListing` handler catches that error and falls back to `dbtypes.YearGrouping`. Production routes pass fixed literals, so this path is unreached in practice.

### Mutation Checklist
- [ ] If changing `dbtypes.BlocksGroupedInfo`, did I verify the `StakeDiffWindows` pipeline isn't broken?
- [ ] If altering pagination offset logic, does `LastOffset` and `BestGrouping` math still accurately track back to the genesis block?
- [ ] If tweaking time intervals in `retrieveTimeBasedBlockListing`, does the UI still properly render the " YTD" string mutation in `timeBasedBlocksListing`?
