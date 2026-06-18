### One-line Flow
**VAR (`coin-supply` / `coin-supply/0`)**: PG `vins.value_in` deltas → `ChartData.Blocks.NewAtoms []uint64` → `coinSupplyChart` + `accumulate()` (cached JSON) → `circulationFunc` (`*1e-8`) → Dygraphs.

**SKA (`coin-supply/{N}`, 1≤N≤255)**: PG per-block `sum(ska_value::numeric)` → `LoadSKASupplyForCoin` accumulates via `*big.Int` → `ChartData.SKASupply[coinType]{Heights, Timestamps, Values []string}` → `skaSupplyChart` (no JSON cache) → `{h, [t,] supply: []string}` → `plotGraph case 'coin-supply' isSKA` (`Number(s)*1e-18` for line; `splitSkaAtomsNoTrailing` for legend) → Dygraphs.

### Key Architectural Patterns
- **Two coin-supply pipelines side-by-side.** Legacy VAR uses pre-loaded delta cache + `accumulate()`; SKA uses lazy per-coin load that stores cumulative `*big.Int`-derived strings. They share the chart ID namespace (`coin-supply/{N}`) but no code.
- **String precision through the SKA pipeline.** SQL `::text`, Go `[]string` + `*big.Int.Add`, JSON `"supply": []string`, JS `BigInt`-safe legend formatter. The Dygraphs Y is float (acceptable per spec §5); the legend is exact (spec §4).
- **`h` field is contractual** for time-axis SKA responses. Day-bin aggregator (`aggregateSKASupply`) carries heights through alongside timestamps.
- **Cache-write asymmetry.** `chartMakers` results go through `cacheChart`; `skaSupplyChart` does not — every SKA request re-marshals JSON.
- **Cross-page navigation from the chart selector.** `hashrate-shares` is the only `<select>` option that triggers `Turbolinks.visit('/hashrate-shares')` in `selectChart()` (controller line 855–857) and returns without loading data. The charts controller tears down cleanly (`disconnect()` destroys the Dygraphs instance); no state leaks across the page swap.
- **`chart-hashrate` CSS class gate for y2label color.** `selectChart()` adds `chart-hashrate` to `chartsViewTarget` when `hashrate` is selected (removes otherwise). The SCSS rule `.chartview.chart-hashrate .dygraph-y2label { color: #c60 }` (charts.scss:260) then colors the Active Miners y2 label to match the series line in light mode. Dark mode inherits the generic `.chartview .dygraph-y2label { color: #2970ff }` rule.
- **TurboQuery + `Zoom.validate` / `Zoom.project`** drive all URL state, same as the address controller, but charts additionally projects zoom across data-range changes.

### Critical Constraints
- **Never apply `accumulate()` to `SKASupply.Values`** — already cumulative.
- **Never cast `data.supply` strings to `Number` for the legend** — only for the line. Use `formatSkaAtomsExact` / `splitSkaAtomsNoTrailing` for the legend.
- **`uint64` overflows for SKA atoms** — do not reuse `ChartUints` for SKA series.
- **`coin-supply/0` and bare `coin-supply` resolve to the same VAR data** through different code paths; the bare form is on the deprecation path.
- **Latent bug:** `LoadSKASupplyForCoin` `Scan(&h, &t, &v)` would fail against `SelectVARCoinSupplyPerBlock` (2 columns); only safe because `ChartTypeData` short-circuits `coinType == 0` before calling the loader. Don't remove that guard.
- **`SKASupply` read/write uses mismatched mutexes (latent fatal-error path).** The loader writes under `charts.SKASupplyMtx.Lock()` and the gate (`SKASupplyExists`/`SKASupplyHeight`) reads under `SKASupplyMtx.RLock()`, but the chart reader `skaSupplyChart` reads under `charts.mtx.RLock()` — a different mutex. With the new stale-height reload gate (`currHeight-cachedHeight > skaSupplyStaleHeightThreshold`, =10), a reload can run concurrently with a render → `concurrent map read and map write`. Real defect — unify on `SKASupplyMtx`. See impact.md.

### Mutation Checklist
When extending coin-supply charts:
- [ ] If touching VAR: update `coinSupplyChart` and check that `accumulate()` is still called on `Blocks.NewAtoms` / `Days.NewAtoms`.
- [ ] If touching SKA: update `LoadSKASupplyForCoin` (cumulation lives there, not in `skaSupplyChart`); preserve `Heights`, `Timestamps`, `Values []string` shape.
- [ ] If changing JSON shape: mirror the VAR (`uint64`) vs SKA (`string`) split; keep `h` on every SKA response that has timestamps.
- [ ] If adding a chart ID: register in `chartMakers` (cached path) or extend the `IsSKASupplyChart` family. Don't overload `coin-supply` with new bare variants — use the prefixed namespace.
- [ ] In `charts_controller.js`: route through `isCoinSupplyChart(name)` switch normalization; use `renderCoinType(coinType)` for labels (no inline `'SKA'+n`); keep raw atom strings reachable for the legend.
- [ ] If adding a new cross-page option to the `<select>`: add the early-return guard in `selectChart()` (pattern: `if (selection === '<value>') { Turbolinks.visit('/<path>'); return }`) and add the corresponding `<option>` to `charts.tmpl`.
- [ ] If renaming the `chart-hashrate` CSS class (charts.scss:260): also update the `selectChart()` toggle in `charts_controller.js:880–883`. Mismatch reverts the y2label to the generic color (silent cosmetic regression).
- [ ] If the loader signature changes: update `cmd/dcrdata/internal/api/noop_ds_test.go:127` mock and any other `DataSource` implementers.
- [ ] If `ActiveSKATypes` projection in `explorerroutes.go:Charts` changes: verify `charts.tmpl` dropdown still renders coin-typed options correctly.

See also:
- /wiki/core/constraints.md#C1 (string-only SKA precision; `BigInt`-safe legend formatter)
- /wiki/code-analysis/address/flow.compact.md (shares-pattern-with: TurboQuery + `Zoom` validation; charts additionally projects zoom across data-range changes)
