### Section 1 — Overview
Data flow trace for the Ticket Price Windows page (`/ticketpricewindows`), which aggregates block statistics over stake difficulty intervals.

### Section 2 — End-to-End Data Flow
```text
RPC (getblock) → blocks Table (PostgreSQL) → SelectWindowsByLimit Query → dbtypes.BlocksGroupedInfo → StakeDiffWindows Handler → windows.tmpl Template → Frontend
```

### Section 3 — Per-Layer Breakdown
- **Location:** Node RPC / Syncer
- **Data Structures:** Raw Block
- **Transformations:** The explorer node parses blocks and extracts block header and transaction data (e.g. `sbits`, `voters`, `fresh_stake`, `revocations`).

- **Location:** `db/dcrpg/internal/blockstmts.go` & `db/dcrpg/queries.go`
- **Data Structures:** `blocks` table, `dbtypes.BlocksGroupedInfo`
- **Transformations:** `SelectWindowsByLimit` uses `GROUP BY (height/$1)*$1` to aggregate blocks into window sizes (default 144). It computes `SUM` for txs, tickets, votes, size, and extracts `MAX(sbits)` for the ticket price.

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go` (`StakeDiffWindows`)
- **Data Structures:** `[]*dbtypes.BlocksGroupedInfo`
- **Transformations:** Wraps the queried data with pagination logic and UI states, passing it as `Data` to the template.

- **Location:** `cmd/dcrdata/views/windows.tmpl`
- **Data Structures:** HTML template context
- **Transformations:** Iterates `.Data` and formats numerical representations via `intComma` and template functions like `float64AsDecimalParts` and `toFloat64Amount`.

### Section 4 — Cross-Layer Dependencies
- The Postgres aggregation query strictly depends on the node's `chaincfg.Params.StakeDiffWindowSize` matching the denominator used in `(height/$1)*$1`.
- The frontend template tightly couples to the struct fields of `dbtypes.BlocksGroupedInfo` (e.g., `FreshStake`, `Voters`, `TicketPrice`).

### Section 5 — Critical Constraints
- **Window Size Grouping:** The aggregation relies on integer division truncation in PostgreSQL `(height/windowSize)*windowSize` to form accurate window boundaries.
- **Mainchain Only:** The aggregation explicitly filters `is_mainchain = true`, meaning orphaned/sidechain blocks do not affect ticket price or window counts.
- **Pagination Rules:** The calculation of `bestWindow` and `offsetWindow` assumes continuous block heights.

### Section 6 — Mutation Impact
When modifying **ticket price windows or block aggregation**, check:
- **Direct dependencies:** `dbtypes.BlocksGroupedInfo`, `retrieveWindowBlocks`.
- **Indirect dependencies:** Any changes to `blocks` table insertions for `fresh_stake`, `voters`, or `revocations` will immediately alter window aggregations.
- **Serialization boundaries:** The Postgres `blocks` table is the sole source of truth for this page's data.
- **Rendering layers:** `windows.tmpl` expects `TicketPrice` as `int64` representing atoms (converted via `toFloat64Amount`).

Failures:
- **Silent failure:** Changing `chaincfg.Params.StakeDiffWindowSize` without updating the database query variables could result in malformed or misaligned windows.
- **Hard failure:** Removing or renaming fields in `dbtypes.BlocksGroupedInfo` will panic the Go HTML template parser during execution.

### Section 7 — Common Pitfalls
- Modifying the ticket price data type (e.g., from `int64` atoms to `float64`) in the aggregation struct without updating the `toFloat64Amount` wrapper in `windows.tmpl`.
- Changing the `blocks` table schema without updating the complex `SelectWindowsByLimit` SQL query.

### Section 8 — Evidence
- **Query:** `db/dcrpg/internal/blockstmts.go:125` (`SelectWindowsByLimit`)
- **Aggregation:** `db/dcrpg/queries.go:856` (`retrieveWindowBlocks`)
- **Routing:** `cmd/dcrdata/internal/explorer/explorerroutes.go:377` (`StakeDiffWindows`)
- **UI:** `cmd/dcrdata/views/windows.tmpl`
