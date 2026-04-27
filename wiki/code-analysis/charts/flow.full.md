### 1. Overview
Tracing the flow of the `coin-supply` chart data to identify constraints before implementing SKA{n} multi-coin historical charts.

### 2. End-to-End Data Flow
`db/dcrpg/internal/vinoutstmts.go` (SQL) → `db/dcrpg/queries.go` (Fetch & Decode) → `db/cache/charts.go` (Cache, Accumulate & JSON Serialize) → `/api/charts` → `charts_controller.js` (Parse & Float Mapping) → JS Chart Library (Y-Axis).

### 3. Per-Layer Breakdown
- **Location:** `db/dcrpg/internal/vinoutstmts.go` & `db/dcrpg/queries.go`
  - **Data Structures Involved:** `INT8` (PostgreSQL), `uint64` (Go)
  - **Transformations Applied:** Aggregates newly minted VAR atoms (`value_in`) per block via `SelectCoinSupply`.
- **Location:** `db/cache/charts.go`
  - **Data Structures Involved:** `ChartData.Blocks.NewAtoms` (`ChartUints` / `[]uint64`), JSON Array
  - **Transformations Applied:** The raw delta values are transformed into a running cumulative total using `accumulate()`.
- **Location:** `cmd/dcrdata/public/js/controllers/charts_controller.js`
  - **Data Structures Involved:** JS `Number` (Float)
  - **Transformations Applied:** Transforms atomic integers to standard coins via JS float multiplication (`v * atomsToDCR`).

### 4. Cross-Layer Dependencies
- **Chart Axis Requirement:** The JS charting library inherently expects coordinates as native JS `Number` types, creating a hard ceiling on available precision for the Y-axis.

### 5. Critical Constraints
- **SKA Precision vs JS Float Limit:** SKA payloads have 18-decimal precision. If cast to `Number` or mapped with standard floats, any value exceeding `Number.MAX_SAFE_INTEGER` boundaries will silently lose precision.
- **Postgres SUM Performance:** Using `sum(ska_value::numeric)` over historical blocks for charting may degrade database performance compared to native integer sums.

### 6. Mutation Impact
When modifying [historical chart data for SKA], check:
- **Direct dependencies:** `ChartData` structs natively assume `uint64` values and will overflow if passed SKA numbers.
- **Indirect dependencies:** `charts_controller.js` and the charting library component.
- **Serialization boundaries:** API JSON encoding formats.
- **Silent failures:** Silently truncating precision beyond 15 digits in the chart UI if SKA is parsed as a Float.
- **Hard failures:** `uint64` overflow in Go if attempting to reuse `appendCoinSupply` for SKA values.

### 7. Common Pitfalls
- Assuming SKA tokens can use the same `[]uint64` memory cache blocks as VAR without struct modifications.
- Attempting to pass raw strings or `BigInt` directly into the Y-axis datasets of legacy charting libraries.

### 8. Evidence
- **Query:** `db/dcrpg/internal/vinoutstmts.go` (Line 132: `SelectCoinSupply = ... sum(vins.value_in)`)
- **Cache:** `db/cache/charts.go` (Line 1208: `coinSupplyChart` uses `accumulate(charts.Blocks.NewAtoms)`)
- **Controller:** `cmd/dcrdata/public/js/controllers/charts_controller.js` (Line 265: `rawCoinSupply = data.circulation.map((v) => v * atomsToDCR)`)

See also:
- /wiki/var-ska-data/flow.full.md (depends-on: absolute precision safety boundary)
