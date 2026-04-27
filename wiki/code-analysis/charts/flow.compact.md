### One-line Flow
`db/dcrpg` (INT8) → `ChartData` Cache (uint64) → JSON API → `charts_controller.js` (Float mapped via atomsToDCR) → Chart Library.

### Key Architectural Patterns
- **Cumulative Cache Aggregation:** The DB queries for deltas (`NewAtoms`), and the API layer dynamically calculates the cumulative total (`circulation`).
- **Float Scaling at UI Boundary:** The backend serves exact atomic integers, delegating scaling math to the client before rendering.

### Critical Constraints
- **Chart Precision Limit:** JS charting libraries fundamentally require floats. Any attempt to chart 18-decimal SKA strings directly will fail, requiring a deliberate truncation step.
- **Go Memory Limits:** `ChartData` utilizes `[]uint64` which cannot hold SKA totals.

### Mutation Checklist
When adding multi-coin charts:
- [ ] Migrate or extend `ChartData` structs to support strings or `[]*big.Int` for SKA memory blocks.
- [ ] Prevent `sum(ska_value::numeric)` in PostgreSQL if querying over 100k+ historical blocks (design an indexed cache table instead).
- [ ] In `charts_controller.js`, explicitly cast SKA to float with `Number(BigInt(val) / BigInt(1e10))` or similar to prevent silent `NaN` or truncated trailing digits in tooltips.

See also:
- /wiki/var-ska-data/flow.compact.md (shares-pattern-with: JS Native Number Prohibition)
