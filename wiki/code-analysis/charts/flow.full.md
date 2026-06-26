### 1. Overview

End-to-end trace of the `/charts` page after the uPlot migration and live-tip override rollout. Three major pipelines now coexist:

- **VAR `coin-supply/0` / legacy `coin-supply`** — pre-loaded delta cache (`ChartData.Blocks.NewAtoms`, `[]uint64`), accumulated on demand with `accumulate()`, cached JSON, served by `coinSupplyChart`. Frontend definition: `coinSupplyDef(0)` (`toColumns` converts `*1e-8`, `formatValue` uses `intComma`).
- **SKA `coin-supply/{N}` (1 ≤ N ≤ 255)** — lazy, per-request load via `LoadSKASupplyForCoin`; cumulative `*big.Int` strings stored in `ChartData.SKASupply[uint8]`. No JSON cache. Frontend definition: `coinSupplyDef(N)` (`toColumns` converts `Number(s)*1e-18` for geometry, `formatValue` reads `datum.payload.supply[datum.idx]` for exact 18-decimal legend). SKA series has `logFloor: 1` to prevent log-axis collapse on zero-prefix supply.
- **Window-edge live tip** — `explorer.Store()` pushes `ChartTip{Height, Time, TicketPrice, Difficulty, PoolValue, CoinSupply}` to `ChartData.SetTip()` on every new block. Chart makers for `ticketPriceChart`, `powDifficultyChart`, and `stakedCoinsChart` read `Tip` under `tipMtx.RLock()` to override or append a live data point at the series tail.

The entire frontend JavaScript layer was migrated from Dygraphs to uPlot with a definition-registry architecture. Per-chart logic that used to live inline in `charts_controller.js` now lives in per-chart definition modules under `public/js/charts/definitions/`. The controller is chart-type-agnostic.

### 2. End-to-End Data Flow

**Common API entry:**
chi `GET /api/chart/{charttype}` → `m.ChartTypeCtx` (or `m.CoinSupplyChartTypeCtx` for `/coin-supply/{n}`) → `appContext.ChartTypeData` → `(*ChartData).Chart(chartID, bin, axis)`.

**VAR path (`coin-supply` or `coin-supply/0`):**
PostgreSQL `vins.value_in` deltas → `pgb.coinSupply` fetcher populates `ChartData.Blocks.NewAtoms` (`ChartUints / []uint64`) → `chartMakers["coin-supply"] = coinSupplyChart` → `accumulate(NewAtoms)` + `encode(...)` JSON → cached in `cachedCharts` → `writeJSONBytes` → `charts_controller.js`: `getDefinition('coin-supply/0')` → `coinSupplyDef(0).toColumns(raw)` (`supply.map(s => s * ATOMS_TO_VAR)`, `xColumn(raw, n)`) → uPlot series data. Legend: `formatValue` returns `intComma(datum.value) + ' VAR'`.

**SKA path (`coin-supply/{N}`, N ≥ 1):**
`ChartTypeData` checks `IsSKASupplyChart(chartType)`; triggers `LoadSKASupplyForCoin(ctx, charts, coinType)` when `!SKASupplyExists(coinType)` or series is stale (`currHeight - cachedHeight > 10`) → SQL `SelectSKACoinSupplyPerBlock` (returns `block_height`, `block_time`, `total::text` per block) → Go `*big.Int` running accumulator → stored in `charts.SKASupply[coinType]` (`{Heights, Timestamps, Values []string}`) under `SKASupplyMtx.Lock()` → `(*ChartData).Chart` falls through to `skaSupplyChart` → emits `{bin, axis, h, [t,] supply: []string}` (no cache write) → `charts_controller.js`: `getDefinition('coin-supply/N')` → `coinSupplyDef(N).toColumns(raw)` (`supply.map(s => Number(s)*1e-18)`, `xColumn(raw, n)`) → uPlot series data. Legend: `formatValue` returns `formatSkaAtomsExact(datum.payload.supply[datum.idx]) + ' SKA{n}'`.

**Live-tip override (ticket-price, pow-difficulty, stake-participation):**
`explorer.Store()` ([cmd/dcrdata/internal/explorer/explorer.go:657](../../../cmd/dcrdata/internal/explorer/explorer.go)) calls `cd.SetTip(cache.ChartTip{...})` on every new block. `SetTip()` ([db/cache/charts.go:908](../../../db/cache/charts.go)) acquires `tipMtx.Lock()`, stores the struct, calls `invalidateTipCharts()` (acquires `cacheMtx.Lock()`), drops cached JSON for `TicketPrice`, `POWDifficulty`, and `PercentStaked` across all axis/bin combos. On next request, the maker runs fresh, reads `tip` under `tipMtx.RLock()`, and applies the override (same-window → mutate last point; newer window → append partial-window point with computed window-start height/time; block/day bin → unconditional last-point override when `tip.CoinSupply > 0`).

### 3. Per-Layer Breakdown

- **Location:** `db/dcrpg/internal/vinoutstmts.go:130-301`
  - **Data Structures:** PostgreSQL `vouts(value INT8, ska_value TEXT, coin_type)`, `transactions(block_height, block_time, is_mainchain, is_valid)`.
  - **Transformations:**
    - `SelectCoinSupply` (line 132) — sums `vins.value_in` per block (legacy VAR delta query).
    - `SelectSKACoinSupplyPerBlock` (line 262) — `sum(vouts.ska_value::numeric)::text` per `(block_height, block_time)` for `coin_type = $2`, mainchain & valid, ordered by height. Per-block values; cumulation in Go.
    - `SelectVARCoinSupplyPerBlock` (line 295) — 2-column query; only reaches `LoadSKASupplyForCoin` if caller bypasses the `coinType > 0` guard, in which case the 3-target `Scan` fails per-row (logged, continued) → empty result → HTTP 503.

- **Location:** `db/dcrpg/pgblockchain.go` (`LoadSKASupplyForCoin`, `coinSupply` fetcher)
  - **Data Structures:** `*sql.Rows` → `[]int64 blockHeights, []int64 timestamps, []string blockValues` → `*big.Int runningTotal` → `cache.SKASupplyChartData{Heights, Timestamps, Values}`.
  - **Transformations:** Streaming scan; `runningTotal.Add(blockValue)` per row; cumulative `runningTotal.String()` appended. Written to `charts.SKASupply[coinType]` under `charts.SKASupplyMtx.Lock()`. **Lock caveat:** `skaSupplyChart` reads under `charts.mtx.RLock()` — a different mutex → latent concurrent map race (see impact.md).

- **Location:** `db/cache/charts.go`
  - **Data Structures:**
    - VAR path: `ChartData.Blocks zoomSet` (`Height, Time, NewAtoms ChartUints`) + `Days zoomSet`. `ChartUints = []uint64`.
    - SKA path: `ChartData.SKASupply SKASupplyData = map[uint8]SKASupplyChartData{Heights []int64; Timestamps []int64; Values []string}`.
    - Live tip: `ChartData.Tip ChartTip` guarded by `tipMtx sync.RWMutex` (separate from `charts.mtx` and `SKASupplyMtx`).
  - **Transformations:**
    - `(*ChartData).Chart` (line 1093) — `chartMakers[chartID]` lookup; if absent and `IsSKASupplyChart`, dispatches to `skaSupplyChart` outside the cache. VAR is cached.
    - `coinSupplyChart` — VAR-only; `accumulate(Blocks.NewAtoms)` for BlockBin, `accumulate(Days.NewAtoms)` for DayBin.
    - `skaSupplyChart` (line 2228) — coinType-0 short-circuits to `coinSupplyChart`; otherwise reads `charts.SKASupply[coinType]` under `charts.mtx.RLock()` (mismatch — see §5). For BlockBin returns verbatim; for DayBin calls `aggregateSKASupply`.
    - `powDifficultyChart` (line 1831) / `ticketPriceChart` (line 1901) — read `charts.Tip` under `tipMtx.RLock()`; override last window point if `tip.Height` is in the same window as the last stored window, or append a live partial-window point (with window-start height and a time found by scanning `Blocks.Height` backwards, falling back to projection from last-window duration, falling back to `tip.Time`) if tip is in a newer window.
    - `stakedCoinsChart` (line 2162) — reads `charts.Tip` under `tipMtx.RLock()`; override guard is `tip.CoinSupply > 0` (not a window test, because block/day bins have no window concept); overrides last point of both `circulation` and `poolVal`.
    - `SetTip()` (line 908) — holds `tipMtx.Lock()` while calling `invalidateTipCharts()`, which acquires `cacheMtx.Lock()` to delete cached JSON. **Lock ordering:** `tipMtx` → `cacheMtx`; never reverse.
    - `invalidateTipCharts()` (line 919) — deletes cache keys for `TicketPrice` and `POWDifficulty` (both axes × WindowBin) and `PercentStaked` (both axes × BlockBin and DayBin).
    - `ReorgHandler` (line 748) — window-aware: scans `Windows.Height` and snips only windows whose start height exceeds `commonAncestorHeight`. Windows at or before the ancestor are kept (their data is unaffected by the reorg). Block-bin is snipped to `commonAncestorHeight + 1`; days drop the last two (keep ≥ 1).
    - `accumulate` — VAR-only `uint64` accumulator. MUST NOT be applied to SKA supply values (already cumulative; overflow).

- **Location:** `cmd/dcrdata/internal/api/apiroutes.go:1942-1975` (`ChartTypeData`)
  - Triggers `LoadSKASupplyForCoin` when `IsSKASupplyChart && coinType > 0` and (`!SKASupplyExists` or staleness > 10 blocks). Load failure → `Warnf` + continue → `Chart()` returns "no SKA supply data found" → HTTP 503.
  - `coinType == 0` guard ensures the VAR path is not routed through `LoadSKASupplyForCoin`.

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1911-1943` (`Charts` handler)
  - Reads `pageData.HomeInfo.SKACoinSupply` under `RLock`, projects `ActiveSKATypes []uint8`, hands to template. Only coins with non-zero supply appear.

- **Location:** `cmd/dcrdata/internal/explorer/explorer.go:648-665` (`Store` → `SetTip`)
  - Calls `cd.SetTip(cache.ChartTip{...})` on every new block, sourcing values from `blockData.Header`, `blockData.CurrentStakeDiff`, and `blockData.PoolInfo`. `PoolValue` is converted from float VAR to atoms (`uint64(poolValAtoms)`).

- **Location:** `cmd/dcrdata/views/charts.tmpl:33-41`
  - `<option value="coin-supply/0">` (VAR), `range .ActiveSKATypes` loop for SKA coins, `range .ActiveSKATypes` loop for `fees/N`, `<option value="hashrate-shares">` (cross-page navigation, no data load). Line 41: hashrate-shares → the only option triggering `Turbolinks.visit`.

- **Location:** `cmd/dcrdata/public/js/charts/registry.js`
  - `register(def)` stores static definitions by `def.name`.
  - `registerCoinFactories(supplyFactory, feesFactoryFn)` stores the coin-type factories.
  - `getDefinition(name)` resolves: `coin-supply/{N}` → `coinSupplyFactory(N)`, `fees/{N}` → `feesFactory(N)`, everything else → `staticDefs[name]`.
  - `coinTypeFromName(name)` parses `coin-supply/{N}` or `fees/{N}` → integer 1–255, else 0.

- **Location:** `cmd/dcrdata/public/js/charts/format.js`
  - `xColumn(raw, n, offset=1)` — canonical x-column builder: block-bin height → 0-based index (`Array.from({length:n}, (_,i) => i)`; genesis = height 0); other height-bin → `offset + raw.h[i]`; time → `raw.t.slice(0, n)`.
  - `formatSkaAtomsExact(atomStr)` → `splitSkaAtomsNoTrailing` for exact 18-decimal display.
  - `ATOMS_TO_VAR = 1e-8`, `intComma`, `withBigUnits`, `unitPrefix`.

- **Location:** `cmd/dcrdata/public/js/charts/definitions/coin_supply.js`
  - `coinSupplyDef(coinType)` factory: `isSKA = coinType > 0`. `toColumns(raw)` → `xColumn(raw, ys.length)` + supply converted to float (SKA: `Number(s)*1e-18`; VAR: `s * ATOMS_TO_VAR`). `formatValue(seriesIdx, datum)` → for SKA reads `datum.payload.supply[datum.idx]` (exact atom string); for VAR uses `intComma(datum.value)`. SKA series carries `logFloor: 1` to prevent log-axis collapse during zero-supply prefix.
  - `register(coinSupplyDef(0))` at module load registers the VAR definition as a static def. SKA definitions are produced dynamically from `coinSupplyFactory` registered in `definitions/index.js`.

- **Location:** `cmd/dcrdata/public/js/helpers/chart_theme.js`
  - `PALETTE` — 25-entry categorical palette. Index 0 is theme-aware (`PRIMARY`): light `#2970FF`, dark `#2DD8A3` (mint).
  - `SERIES_COLORS` — named overrides: `tickets-price`, `tickets-bought` (light `#006666`, dark `#4dabf7`), `hashrate-rate`, `hashrate-miners` (light `#cc6600`, dark `#4dabf7`). Dark secondary uses `#4dabf7` (~4.3:1) instead of `#2970ff` (~2.4:1) for contrast.
  - `colorForIndex(i, dark)`, `seriesColorByKey(key, dark)` — resolution functions used by `uplot_adapter.js`.

- **Location:** `cmd/dcrdata/public/js/helpers/uplot_adapter.js`
  - `createChart(el, def, opts)` — builds a uPlot opts object from a `ChartDefinition` + config and attaches a live instance to the DOM element. Returns a handle with `setData()`, `setXRange()`, `setMode()`, `setVisibility()`, `setDark()`, `destroy()`, `.uplot` direct access.
  - `buildOpts(def, opts)` — pure (no DOM), the unit under test. Translates `def.series[i].kind` (`line`, `area`, `bars`, `stepped`) and color resolution into uPlot series descriptors. Respects `logFloor` on individual series. When `def.stacked` is true, computes uPlot `bands` via `stack()` using `opts.visibility` for the initial hidden-series set.
  - `stack(columns, omit)` — exported pure function; accumulates each non-omitted series into a running per-row total, emits re-stacked `data` + uPlot `bands`. A visibility toggle on a stacked chart calls `rebuild()` (bands and accumulation must be recomputed at opts level; `setSeries` alone is insufficient).
  - `pathsFor(UPlot, s)` — now accepts the full series object `s`, not just `s.kind`. `s.paths` factory override lets per-series custom renderers bypass the `kind` switch. `s.barAlign` (0/1/-1) and `s.barSize` ([widthFactor, maxPx?]) configure per-series bar geometry.
  - Seeded visibility: `opts.visibility` is consumed by `buildOpts` for bands AND by `applyVisibility()` called immediately after the uPlot constructor, so a seeded-hidden series is hidden from the first paint. `setVisibility()` short-circuits when the map is unchanged (early-return) to avoid spurious rebuilds on stacked charts.
  - `resolveSeriesColor(s, i, dark)` — resolves in order: `s.color` (explicit), `seriesColorByKey(s.colorKey)` (named), `colorForIndex(s.colorIndex ?? i)` (palette).

- **Location:** `cmd/dcrdata/public/js/helpers/uplot_ranger.js`
  - `createRanger(el, def, opts)` — creates the overview/zoom-navigator strip below the main chart. Shows the full primary series; grip-drag and body-drag drive `opts.onSelect(min, max)` on the panel.
  - `RANGER_HEIGHT = 44` — strip height in CSS px, uniform across all chart routes (reduced from 80; value is embedded in the module so SCSS and the ranger stay aligned without a shared constant).
  - `setSelection(min, max)` — now clamps `min`/`max` to the data extent before pixel-converting, and enforces a minimum pixel width of `max(1, pxRatio)` so the handle is never invisible at range boundaries.

- **Location:** `cmd/dcrdata/public/js/controllers/charts_controller.js`
  - `this.fetchGeneration` — monotonic counter bumped by `selectChart()` on every chart selection. After each fetch `await`, if the counter has advanced, the stale result is discarded. Prevents a slow fetch from clobbering `this.payload`. (Chart-creation overlap guard is now owned by `panel.epoch` in `chart_panel.js`.)
  - `this.panel` — a `ChartPanel` instance created in `connect()`. Owns the handle + ranger + tooltip + resize + theme. `panel.handle` exposes the underlying `ChartHandle`; `panel.setXRange(min, max)` drives both chart and ranger in lockstep.
  - `selectChart()` — `hashrate-shares` early-return via `Turbolinks.visit`; all others: `getDefinition(name)` → fetch (if needed) → `renderChart(def)`.
  - `memoizedDef(def)` — returns the same object reference when the structural signature `name|xTime|seriesCount|axisLabel` is unchanged; a new reference forces `panel._ensureChart` to rebuild the uPlot instance. Axis type is included in the signature so an axis toggle triggers a rebuild.
  - `renderChart(def)` — calls `memoizedDef(def)` → `settingsForDef()` → `toColumns(payload, settings)` → `computeZoomTarget(cols[0])` → `panel.render(renderDef, payload, settings, {range})`.
  - `computeZoomTarget(xs)` — pure; returns `{min, max}` or `null`. Replaces `applyZoom()` which imperatively called `setMainXRange`; the target is now passed to `panel.render()` as `opts.range` so the initial zoom is seeded atomically, avoiding the deferred-ranger-seed race (spec A1).
  - `persistRange(min, max, snap)` — persists visible x-range to URL + ZOOM control; called from the `onRangeChange` panel callback. `snap=true` (source='chart') → preset snapping; `snap=false` (source='ranger') → custom base-36 range. Reads `panel.handle.uplot.data[0]` for xs.
  - `applyControlVisibility(def)` — reads `def.controls.{bin, scale, mode, zoom, interval, windowUnits, visibility}` to show/hide UI controls; also toggles `chart-hashrate` CSS class on `chartsViewTarget` for hashrate selection.

- **Location:** `cmd/dcrdata/public/js/helpers/chart_panel.js` (added; widened into this refresh)
  - `createChartPanel(chartEl, opts)` — factory; `opts` includes `{rangerEl, xTime, scaleType, mode, measureSize, formatX, onRangeChange, rangerData, rangerDef, rangerSeedOnce}`. Callable values are resolved live at build time.
  - `panel.render(def, payload, settings, opts)` — async main entry point. `_ensureChart(def, epoch)` rebuilds on a def-reference change; same reference → `setData` only. `opts.range` seeds the zoom; `opts.preserveRange` restores the existing window for same-def in-place updates. After the chart, `_ensureRanger(def, cols, epoch, target)` builds or updates the strip and defers the selection seed two microtasks (waiting for uPlot's async commit to settle before calling `valToPos`).
  - `panel.epoch` — monotonic counter bumped by every `render()` call; checked after each `await` in `_ensureChart` and `_ensureRanger` to abort work from a superseded render.
  - `panel._themeEpoch` — separate counter for theme changes; a dark/light toggle bumps this without bumping `epoch`, so it cannot abort an in-flight render.
  - `rangerSeedOnce` — when `true`, the strip data is seeded once on first build and never overwritten by subsequent `render()` calls (only the selection tracks the chart). Use when the chart shows aggregated/re-bucketed data but the ranger must show the full fine-grained history.
  - Owns: `NIGHT_MODE` globalEventBus listener, debounced `window.resize` listener, `installTooltip`, `renderLegend`, `positionTooltip`, `installTouchScrub` (three-state gesture + double-tap dblclick synthesis for iOS), `_setDark` (captures live x-range before rebuild, deferred ranger re-select via themeEpoch-guarded microtask). All moved verbatim from the charts controller.
  - `destroy()` — removes globalEventBus listener and window.resize listener; destroys handle and ranger. Must be called in Stimulus `disconnect()`.

### 4. Cross-Layer Dependencies

- **Definition registry is the new untyped boundary.** `getDefinition(name)` returns a plain object; the controller treats every definition identically. Mismatch between `def.series.length` and `toColumns(...)` column count silently renders the wrong series against wrong data (no error at runtime).
- **`chart_panel.js` is the new controller-to-renderer intermediary.** All `createChart`, `createRanger`, resize, theme, tooltip, and range callbacks are owned by `ChartPanel`. A controller that bypasses the panel and calls `createChart` / `createRanger` directly will silently diverge in resize guard, theme handling, and epoch-based overlap protection.
- **Two truth sources for "coin supply"**: `Blocks.NewAtoms`/`Days.NewAtoms` (VAR deltas) versus per-coin-type `SKASupply` (SKA cumulative). They share only the chart-ID namespace and the `coinSupplyDef` factory.
- **Cache symmetry break**: `chartMakers` hits → `cacheChart`; `skaSupplyChart` → no cache. SKA responses are recomputed (and re-marshaled) on every request. `invalidateTipCharts` only flushes `chartMakers`-cached charts (TicketPrice, POWDifficulty, PercentStaked).
- **`uint8` ↔ string coupling**: Go `IsSKASupplyChart`/`SkaCoinType` and JS `coinTypeFromName`/`isCoinSupplyName` in `registry.js` must agree on `coin-supply/` prefix and `1..255` range — no shared parser.
- **`chart_theme.js` ↔ `charts.scss` color sync.** `SERIES_COLORS` keys in `chart_theme.js` must stay in sync with the `.vSelector .checkmark` background-color rules in `charts.scss` (visibility toggle swatches). The dark-mode secondary color `#4dabf7` appears in both.
- **Tip override ↔ cache invalidation coupling.** `SetTip()` must invalidate every chart whose maker reads `Tip`. Adding a new tip-reading maker without updating `invalidateTipCharts()` silently serves stale cached data until the next window boundary.
- **Lock ordering: `tipMtx` → `cacheMtx`.** `SetTip` holds `tipMtx.Lock()` while calling `invalidateTipCharts()` which acquires `cacheMtx.Lock()`. The opposite order risks deadlock.

### 5. Critical Constraints

- **VAR uses `[]uint64`**, accumulated via `accumulate()`; this overflows for SKA atoms (18 decimals). Never reuse `accumulate` or `ChartUints` for SKA.
- **SKA atoms travel as strings end-to-end**: SQL `::text`, Go `[]string` + `*big.Int`, JSON `"supply": []string`, JS `Number(...)*1e-18` ONLY for chart geometry (uPlot `toColumns`), **never** for the legend. The legend MUST use `formatSkaAtomsExact(datum.payload.supply[datum.idx])` (or equivalent) in `formatValue`.
- **The `h` field is contractual** for time-axis SKA responses; `aggregateSKASupply` carries heights through day-bucketing. Any new SKA chart endpoint must include `h`.
- **`SKASupply` is guarded by two *different* mutexes** — loader writes under `SKASupplyMtx.Lock()`; chart reader `skaSupplyChart` reads under `charts.mtx.RLock()`. A stale-height reload can run concurrently with a render → latent `concurrent map read and map write` fatal error. Fix: unify all `SKASupply` access on `SKASupplyMtx`.
- **`logFloor: 1` on SKA coin-supply series** prevents log-axis collapse for zero-prefix supply data. The `uplot_adapter` must apply this floor before passing data to uPlot's log scale. Removing it re-introduces the axis collapse bug (fixed in #499/#507).
- **Lock ordering: `tipMtx` → `cacheMtx`** — never reverse. `SetTip()` already couples these; a refactor that moves cache invalidation into a path that first holds `cacheMtx` while calling `SetTip()` is a deadlock.
- **Cache absent for SKA**: the JSON byte cache (`cacheChart`) is bypassed for `skaSupplyChart`. A future optimization that adds SKA caching must invalidate per coin type when a new block arrives (the VAR cache is invalidated via `cacheID`; `invalidateTipCharts` targets named charts, not coin-typed ones).
- **VAR-circulation endpoint duality**: `/api/chart/coin-supply` and `/api/chart/coin-supply/0` resolve to the same data via two different code paths. Removing one without re-pointing the consumer produces an `UnknownChartErr` 404.

### 6. Mutation Impact

When modifying chart data structures or pipelines, check ALL of:

- **Direct dependencies:**
  - VAR: `db/cache/charts.go:zoomSet.NewAtoms`, `coinSupplyChart`, `accumulate`.
  - SKA: `db/cache/charts.go:SKASupplyChartData`, `SKASupplyData`, `skaSupplyChart`, `aggregateSKASupply`; `db/dcrpg/pgblockchain.go:LoadSKASupplyForCoin`; SQL `SelectSKACoinSupplyPerBlock`.
  - Live tip: `ChartTip`, `SetTip`, `invalidateTipCharts`, `tipMtx`. All three tip-reading chart makers: `powDifficultyChart`, `ticketPriceChart`, `stakedCoinsChart`.
  - API: `cmd/dcrdata/internal/api/apiroutes.go:ChartTypeData`, `appContext.charts`, `DataSource.LoadSKASupplyForCoin`.
  - Frontend: `public/js/charts/registry.js` (`getDefinition`, `registerCoinFactories`), `public/js/charts/format.js` (`xColumn`, `formatSkaAtomsExact`), `public/js/charts/definitions/coin_supply.js` (`coinSupplyDef`), per-chart definition modules, `public/js/helpers/chart_panel.js`, `public/js/helpers/uplot_adapter.js`, `public/js/helpers/uplot_ranger.js`, `public/js/helpers/chart_theme.js`.
- **Indirect dependencies:**
  - `cmd/dcrdata/internal/explorer/explorerroutes.go:Charts` builds `ActiveSKATypes`.
  - `cmd/dcrdata/views/charts.tmpl:33-41` consumes `ActiveSKATypes`.
  - `cmd/dcrdata/internal/explorer/explorer.go:657` calls `SetTip()` — any `ChartTip` struct field change requires updating here.
  - `cmd/dcrdata/internal/api/noop_ds_test.go` mock implements `LoadSKASupplyForCoin`.
- **Serialization boundaries:**
  - VAR JSON: `{bin, axis, h, [t,] supply: []uint64}` (numbers).
  - SKA JSON: `{bin, axis, h, [t,] supply: []string}` (strings, 18-decimal atoms, cumulative).
  - Tip charts JSON: window charts add an extra point when `tip.Height` is in a newer window; the `h` array is then **explicit** (not empty) for height-axis responses — frontend `toColumns` must handle this (`raw.h` present → use it, else derive from window index).
- **Rendering layers:** uPlot geometry (`toColumns`), on-hover legend (`formatValue` + `renderLegend`), axis labels (from `def.axes`), series visibility toggles (`def.controls.visibility`).
- **Silent failures:**
  - `def.series.length` mismatching the column count from `toColumns` — uPlot silently renders undefined values or drops series.
  - Coercing `data.supply` strings via `Number` for the legend rather than the geometry path drops precision past 15 digits (SKA values above ~10¹⁵ atoms).
  - Calling `accumulate()` on already-cumulative SKA data double-cumulates.
  - Forgetting `h` on a SKA time-axis response breaks `xColumn` for day-bin.
  - Adding a tip-reading chart maker without updating `invalidateTipCharts()` → stale cached JSON served until next window boundary.
  - Removing `logFloor: 1` from a SKA coin-supply series spec → log-axis collapse when supply has a zero-prefix.
- **Hard failures:**
  - `LoadSKASupplyForCoin` with `coinType == 0` → 3-target `Scan` on 2-column result → every row skipped → empty → HTTP 503.
  - `uint64` overflow if a future change pushes SKA values into `ChartUints`.
  - `concurrent map read and map write` fatal if `skaSupplyChart` reads concurrently with a stale-height reload of `SKASupply`.
  - Deadlock if any code path acquires `cacheMtx` then attempts `SetTip()` (which takes `tipMtx` → `cacheMtx`).

### 7. Common Pitfalls

- Reusing the VAR pipeline (`Blocks.NewAtoms`, `accumulate`, `*ATOMS_TO_VAR`) for SKA coins — overflows, loses precision, bypasses the per-coin map.
- Adding a new chart format that omits `h` for time-axis SKA responses (regression risk).
- Computing cumulative supply on the frontend — already done in Go.
- Adding a new named series color to `chart_theme.js` without adding the matching `.checkmark` background in `charts.scss` — visibility toggle swatch shows the wrong color.
- Adding a tip-reading chart maker (`ticketPriceChart`-style) without registering its cache key in `invalidateTipCharts()` — stale data served after each new block until the next periodic update.
- Reversing lock order (`cacheMtx` → `tipMtx`) anywhere in `ChartData` — deadlock.
- Building a `toColumns` that returns a different column count than `def.series.length` — silent rendering corruption (uPlot maps column N to series N-1; extras are ignored, missing cause `undefined`).
- Using `datum.value` (the float) rather than `datum.payload.supply[datum.idx]` (the atom string) for SKA legend formatting in `formatValue` — precision loss past ~15 significant digits.
- Adding a new VAR-supply variant on the legacy `coin-supply` chart ID instead of `coin-supply/0` — the bare ID is on the deprecation path.
- Building a Y-axis label with a hardcoded "DCR" or "VAR" — use `renderCoinType(coinType)` from `ska_helper.js`.

### 8. Evidence

- **Chart key constants:** `db/cache/charts.go:29` (`CoinSupply = "coin-supply"`), `:64` (`SKASupplyPrefix = "coin-supply/"`), `:32-33` (`POWDifficulty`, `TicketPrice`), `:40` (`PercentStaked`).
- **ChartTip struct:** `db/cache/charts.go:490`.
- **ChartData struct:** `db/cache/charts.go:567`; `Tip ChartTip` at `:586`, `tipMtx` at `:587`.
- **SetTip / invalidateTipCharts:** `db/cache/charts.go:908-933`.
- **ReorgHandler (window-aware):** `db/cache/charts.go:748-783`.
- **powDifficultyChart:** `db/cache/charts.go:1831-1899`.
- **ticketPriceChart:** `db/cache/charts.go:1901-1976`.
- **stakedCoinsChart:** `db/cache/charts.go:2162-2223`.
- **skaSupplyChart:** `db/cache/charts.go:2228-` (coinType-0 short-circuit; reads `charts.mtx.RLock()` — mismatch vs `SKASupplyMtx`).
- **Cache types:** `db/cache/charts.go:384` (`SKASupplyChartData`), `:567` (`ChartData`).
- **DB loader:** `db/dcrpg/pgblockchain.go:1087` (`LoadSKASupplyForCoin`); `SKASupplyMtx.Lock()` write at `:1136-1142`.
- **SQL:** `db/dcrpg/internal/vinoutstmts.go:130-138` (`SelectCoinSupply`), `:251-259` (`SelectSKACoinSupplyPerBlock`), `:261-269` (`SelectVARCoinSupplyPerBlock`).
- **API handler:** `cmd/dcrdata/internal/api/apiroutes.go:1942-1975` (`ChartTypeData`).
- **Explorer SetTip call:** `cmd/dcrdata/internal/explorer/explorer.go:648-665`.
- **Page handler:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1911-1943` (`Charts`).
- **Template:** `cmd/dcrdata/views/charts.tmpl:33-41`.
- **Registry:** `cmd/dcrdata/public/js/charts/registry.js` (`register`, `registerCoinFactories`, `getDefinition`, `coinTypeFromName`).
- **Format helpers:** `cmd/dcrdata/public/js/charts/format.js` (`xColumn`, `formatSkaAtomsExact`, `ATOMS_TO_VAR`, `intComma`).
- **Coin supply definition:** `cmd/dcrdata/public/js/charts/definitions/coin_supply.js` (`coinSupplyDef`; `logFloor: 1`; `formatValue` using `datum.payload.supply[datum.idx]`).
- **Ticket price definition:** `cmd/dcrdata/public/js/charts/definitions/ticket_price.js` (`toColumns` with `raw.h` priority over index-derived xs).
- **PoW difficulty definition:** `cmd/dcrdata/public/js/charts/definitions/pow_difficulty.js` (`toColumns` with `raw.h` priority).
- **Theme:** `cmd/dcrdata/public/js/helpers/chart_theme.js` (`PALETTE`, `SERIES_COLORS`, `colorForIndex`, `seriesColorByKey`; secondary dark `#4dabf7`).
- **uPlot adapter:** `cmd/dcrdata/public/js/helpers/uplot_adapter.js` (`createChart`, `buildOpts`, `stack`, `resolveSeriesColor`; `stack()` added; `def.stacked`/`bands` support; `s.paths`/`s.barAlign`/`s.barSize` per-series overrides; seeded visibility; `setVisibility` early-return + stacked-rebuild).
- **Ranger:** `cmd/dcrdata/public/js/helpers/uplot_ranger.js` (`createRanger`; `RANGER_HEIGHT = 44`; `setSelection` clamps to data extent + min-width 1 device pixel).
- **Chart panel:** `cmd/dcrdata/public/js/helpers/chart_panel.js` (`createChartPanel`, `ChartPanel.render`, `_ensureChart`, `_ensureRanger`, `setXRange`, `installTooltip`, `renderLegend`, `installTouchScrub`, `_setDark`, `destroy`).
- **Controller:** `cmd/dcrdata/public/js/controllers/charts_controller.js` (`fetchGeneration`, `this.panel`, `selectChart`, `memoizedDef`, `renderChart`, `computeZoomTarget`, `persistRange`, `applyControlVisibility`).
- **SKA helpers:** `cmd/dcrdata/public/js/helpers/ska_helper.js:78` (`splitSkaAtomsNoTrailing`), `:16` (`renderCoinType`).
- **Charts SCSS:** `cmd/dcrdata/public/scss/charts.scss` — `.chartview.chart-hashrate .dygraph-y2label` (y2 axis label color gate); `.customcheck .checkmark` colors (`.received` dark-mode mint `#2dd8a3` added; `.sent` corrected to `#e03131` PALETTE[1]; `.net` corrected to `#f08c00` PALETTE[3]); `.tp-chart-ranger` (full-width ranger variant for ticketpool, sharing `@mixin ranger-select-styles` with `.chart-ranger`); `body.darkBG .btn_sm` color overrides.
- **Key commits:** `538d5cd1` initial SKA chart support; `19a114c1` cumulative + height alignment; `a9db4b3b` `h` field on time-axis; `b448cb64` ChartTip + PartialWindow (live tip override); `053c51ae` ReorgHandler window-aware snipping; `c513c564` fetchGeneration race guard; `567780a3` log-floor clamp; `b2a86725` uPlot rewrite merge base; dark secondary `#4dabf7` (chart.scss + chart_theme.js); `7a2e5da9` ChartPanel retrofit + block-bin 0-based + stack() + RANGER_HEIGHT 44.

See also:

- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: out-of-band shared page state)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: `commonData` nil render crash)
- /wiki/core/constraints.md (depends-on: C1 numeric precision & bifurcation; C2 dual pipeline; C7 centralized coin-type label rendering)
- /wiki/code-analysis/address/flow.full.md (shares-pattern-with: TurboQuery URL state, `Zoom` validation; charts controller additionally calls `handle.setXRange`/`ranger.setSelection` for zoom persistence)
