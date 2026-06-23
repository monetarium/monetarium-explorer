### One-line Flow
**VAR (`coin-supply/0`)**: PG `vins.value_in` deltas → `ChartData.Blocks.NewAtoms []uint64` → `coinSupplyChart` + `accumulate()` (cached JSON) → `getDefinition('coin-supply/0')` → `coinSupplyDef(0).toColumns()` (`*ATOMS_TO_VAR`) → uPlot.

**SKA (`coin-supply/{N}`, 1≤N≤255)**: PG per-block `sum(ska_value::numeric)` → `LoadSKASupplyForCoin` accumulates via `*big.Int` → `ChartData.SKASupply[coinType]{Heights, Timestamps, Values []string}` → `skaSupplyChart` (no JSON cache) → `{h, [t,] supply: []string}` → `coinSupplyDef(N).toColumns()` (`Number(s)*1e-18` for line) → `formatValue` reads `datum.payload.supply[datum.idx]` for legend (exact atom string) → uPlot.

**Window charts (ticket-price, pow-difficulty)**: `SetTip()` receives RPC values from `explorer.Store()` on each block → `ticketPriceChart`/`powDifficultyChart` read `charts.Tip` under `tipMtx.RLock()` → override last window's data point (same window) or append a live partial-window point (new window) → `invalidateTipCharts()` clears the cached JSON so the next request re-runs the maker.

### Key Architectural Patterns
- **uPlot definition-registry.** Each chart is a `public/js/charts/definitions/*.js` module exporting `{ name, controls, axes, series, toColumns(), formatValue() }`, registered via `register()` / `registerCoinFactories()`. The controller calls `getDefinition(name)` and is chart-type-agnostic; all data-to-series transformation lives in `toColumns()`. Format helpers live in `public/js/charts/format.js`.
- **`ChartTip` live-tip override.** `explorer.Store()` pushes `ChartTip{Height, Time, TicketPrice, Difficulty, PoolValue, CoinSupply}` to `ChartData.SetTip()` on every new block. Window chart makers (ticket-price, pow-difficulty) read tip under `tipMtx.RLock()` and either override the last window point (same window) or append a partial-window point (new window). `stakedCoinsChart` overrides the last block/day point unconditionally when `tip.CoinSupply > 0`. `invalidateTipCharts()` ensures stale cached JSON is dropped on each new block.
- **`fetchGeneration` stale-fetch race guard.** A monotonic counter on the controller; `selectChart()` bumps it and bails after each `await` if superseded. Prevents a slow fetch from clobbering `this.payload` and prevents two overlapping `createChart()` calls from orphaning a uPlot instance in the DOM.
- **Two coin-supply pipelines side-by-side.** Legacy VAR uses pre-loaded delta cache + `accumulate()`; SKA uses lazy per-coin load that stores cumulative `*big.Int`-derived strings. They share the chart ID namespace (`coin-supply/{N}`) but no backend code. `coinSupplyDef(coinType)` factory produces the definition for both; `formatValue` branches on `isSKA`.
- **String precision through the SKA pipeline.** SQL `::text`, Go `[]string` + `*big.Int.Add`, JSON `"supply": []string`, JS `Number(s)*1e-18` for uPlot geometry only; `formatSkaAtomsExact(datum.payload.supply[datum.idx])` for the on-hover legend.
- **`h` field is contractual** for time-axis SKA responses. `aggregateSKASupply` carries heights through day-bucketing.
- **Cache-write asymmetry.** `chartMakers` results go through `cacheChart`; `skaSupplyChart` does not — every SKA request re-marshals JSON.
- **Window-aware `ReorgHandler`.** Snips only windows whose start height exceeds `commonAncestorHeight`; windows at or before the ancestor are kept. Block-bin is snipped to `commonAncestorHeight + 1`; days drop the last two.
- **`chart_theme.js` single color source.** `SERIES_COLORS` (named series like `tickets-bought`, `hashrate-miners`) and `PALETTE` (index-based) are shared by uPlot adapter and the hashrate-shares pie. Dark mode secondary (y2) series use `#4dabf7` instead of `#2970ff` for contrast.
- **Cross-page navigation from the chart selector.** `hashrate-shares` option triggers `Turbolinks.visit('/hashrate-shares')` in `selectChart()` and returns without loading data. All other options fetch `/api/chart/{type}` and stay on the page.

### Critical Constraints
- **Never apply `accumulate()` to `SKASupply.Values`** — already cumulative.
- **Never cast `data.supply` strings to `Number` for the legend** — only for the uPlot geometry (`toColumns`). Use `formatSkaAtomsExact(datum.payload.supply[datum.idx])` in `formatValue`.
- **`uint64` overflows for SKA atoms** — do not reuse `ChartUints` for SKA series.
- **`coin-supply/0` and bare `coin-supply` resolve to the same VAR data** through different code paths; the bare form is on the deprecation path.
- **`SKASupply` read/write uses mismatched mutexes (latent fatal-error path).** Loader writes under `SKASupplyMtx.Lock()`; `skaSupplyChart` reads under `charts.mtx.RLock()` — a different mutex. A stale-height reload can run concurrently with a render → latent `concurrent map read and map write`. See impact.md.
- **Lock ordering: `tipMtx` is held inside `SetTip()` when `cacheMtx` is acquired** (via `invalidateTipCharts`). Never acquire `cacheMtx` then `tipMtx` — deadlock.
- **`logFloor: 1` on SKA coin-supply series** in `coinSupplyDef` prevents log-axis collapse when supply is zero (leading zeros before SKA genesis). `formatValue` still uses the exact atom string.

### Mutation Checklist
When extending coin-supply charts:
- [ ] If touching VAR backend: update `coinSupplyChart` and check that `accumulate()` is still called on `Blocks.NewAtoms` / `Days.NewAtoms`.
- [ ] If touching SKA backend: update `LoadSKASupplyForCoin` (cumulation lives there); preserve `Heights`, `Timestamps`, `Values []string` shape.
- [ ] If changing JSON shape: mirror the VAR (`uint64`) vs SKA (`string`) split; keep `h` on every SKA response that has timestamps.
- [ ] If adding a chart ID: register in `chartMakers` (cached path) or extend `IsSKASupplyChart`; add a definition in `definitions/` and register it; don't overload `coin-supply` with new bare variants.
- [ ] In definitions: implement `toColumns()` using `xColumn(raw, n)` from `charts/format.js`; implement `formatValue()` with exact SKA legend path.
- [ ] If adding a new tip-reading chart maker: add its `cacheKey()` combos to `invalidateTipCharts()` so tip updates flush the cache.
- [ ] If renaming the `chart-hashrate` CSS class (charts.scss): also update the `selectChart()` toggle in `charts_controller.js`. Mismatch silently reverts the y2label to the generic color.
- [ ] If the `LoadSKASupplyForCoin` signature changes: update `cmd/dcrdata/internal/api/noop_ds_test.go` mock and any other `DataSource` implementers.
- [ ] If `ActiveSKATypes` projection in `explorerroutes.go:Charts` changes: verify `charts.tmpl` dropdown still renders coin-typed options correctly.
- [ ] If adding a new cross-page option to the `<select>`: add the early-return guard in `selectChart()` + the `<option>` in `charts.tmpl`.
- [ ] If adding a new named series color: add to `SERIES_COLORS` in `chart_theme.js` AND the matching `.vSelector .checkmark` color in `charts.scss` (they must stay in sync).

See also:
- /wiki/core/constraints.md#C1 (string-only SKA precision; exact-atom legend formatter)
- /wiki/code-analysis/address/flow.compact.md (shares-pattern-with: TurboQuery + `Zoom` validation; charts additionally calls `setXRange` / `setSelection` for range persistence via the ranger strip)
