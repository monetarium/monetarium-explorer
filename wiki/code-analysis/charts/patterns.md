## uPlot definition-registry architecture

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
Each chart type is a self-contained ES module in `public/js/charts/definitions/` that exports a descriptor object (`{ name, controls, axes, series, toColumns(), formatValue() }`). The module calls `register(def)` at load time; `definitions/index.js` imports all modules as side effects. The controller calls `getDefinition(name)` and is fully chart-type-agnostic — all data-to-series transformation lives in `toColumns()`, all on-hover formatting in `formatValue(seriesIdx, datum, settings)` where `datum = { idx, payload, value }` and `datum.payload` is the raw API JSON.

Coin-typed charts (`coin-supply/{N}`, `fees/{N}`) use factories instead of static definitions. `registerCoinFactories(supplyFactory, feesFactoryFn)` stores two functions; `getDefinition` calls the appropriate factory on each lookup, producing a fresh definition parameterized by the coin type.

Format helpers shared by all definitions live in `public/js/charts/format.js` (`xColumn`, `intComma`, `formatSkaAtomsExact`, `ATOMS_TO_VAR`, etc.). Theme colors live in `public/js/helpers/chart_theme.js`. The uPlot instance is created by `uplot_adapter.js:createChart`.

**Constraints:**
- `def.series.length` MUST match the column count that `toColumns()` returns. Mismatches are silently accepted by uPlot but render wrong data.
- `xColumn(raw, n)` from `format.js` is the canonical x-column builder — use it in `toColumns` rather than ad-hoc derivations.
- `formatValue` receives `datum.payload` (the raw API JSON) so exact atom strings are reachable without floating-point coercion.
- Any new coin-typed chart must call `registerCoinFactories` in `definitions/index.js` (not `register(def)` for a static key, since the name encodes the coin type).

---

## `ChartTip` live-tip override for window-edge charts

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`explorer.Store()` ([cmd/dcrdata/internal/explorer/explorer.go:657](../../../cmd/dcrdata/internal/explorer/explorer.go)) calls `cd.SetTip(cache.ChartTip{...})` on every new block, pushing the current RPC values (height, block time, ticket price, PoW difficulty, pool value, coin supply). `SetTip` ([db/cache/charts.go:908](../../../db/cache/charts.go)) holds `tipMtx.Lock()`, stores the struct in `ChartData.Tip`, then calls `invalidateTipCharts()` which acquires `cacheMtx.Lock()` to delete cached JSON for the affected charts.

Chart makers read `charts.Tip` under `tipMtx.RLock()` at chart-build time:
- **`powDifficultyChart` / `ticketPriceChart`** — compare `tip.Height`'s window (`tip.Height / DiffInterval`) against the last stored window height. If same → mutate the last series point in a copy. If newer (DB lag) → append a live partial-window point with `windowStartHeight = int32(tip.Height) / DiffInterval * DiffInterval` and a window-start time found by scanning `Blocks.Height` backwards, falling back to projection from last-window duration, then `tip.Time`.
- **`stakedCoinsChart`** — override guard is `tip.CoinSupply > 0` (block/day bins have no window concept); overrides the last `circulation` and `poolVal` points unconditionally.

`invalidateTipCharts` ([db/cache/charts.go:919](../../../db/cache/charts.go)) deletes: `TicketPrice` + `POWDifficulty` (WindowBin × HeightAxis + TimeAxis), `PercentStaked` (BlockBin + DayBin × HeightAxis + TimeAxis).

**Constraints:**
- Any new chart maker that reads `charts.Tip` MUST register its `cacheKey()` combinations in `invalidateTipCharts()`, or stale cached JSON is served after each new block until the next `cacheID` update.
- **Lock ordering: `tipMtx` → `cacheMtx`.** `SetTip` holds `tipMtx.Lock()` while calling `invalidateTipCharts()` which acquires `cacheMtx.Lock()`. Never reverse this order.
- Tip values come from `blockData` in `explorer.Store()`. Adding a new `ChartTip` field requires updating both the struct and the `cd.SetTip(...)` call.

---

## `fetchGeneration` monotonic race guard

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`charts_controller.js` maintains `this.fetchGeneration` — a monotonic integer bumped at the start of every `selectChart()`. Each `await` point inside `selectChart()` and `renderChart()` re-checks `gen !== this.fetchGeneration`; if a newer selection landed during the async gap, the stale result is discarded:

- After the `requestJSON()` fetch: don't clobber `this.payload` with stale data.
- After the `createChart()` await: if superseded, call `h.destroy()` on the just-built uPlot instance instead of adopting it, so it isn't orphaned in the DOM.

Without this guard, rapidly switching the chart `<select>` could: (a) have a slow fetch resolving after a faster one, overwriting `this.payload` with data for the wrong chart, or (b) have two concurrent `createChart()` calls both resolve, orphaning the first uPlot root (canvas + event listeners left in the DOM with `destroy()` never called).

**Constraints:**
- Any new `await` point inside `selectChart()` or `renderChart()` (or any async path launched from them) must check `gen !== this.fetchGeneration` before applying its result.
- `pendingCreate` holds the in-flight `createChart()` promise; code paths that depend on the chart being ready must await it or guard on `this.handle`.

---

## Two coin-supply pipelines under one chart-ID namespace

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
"Coin supply" is served by two code paths that share the `coin-supply` / `coin-supply/{N}` chart-ID namespace but no code:

- **VAR (legacy):** PG `vins.value_in` deltas pre-loaded into `ChartData.Blocks.NewAtoms` / `Days.NewAtoms` (`ChartUints = []uint64`). `coinSupplyChart` ([db/cache/charts.go:1262 approx](../../../db/cache/charts.go)) calls `accumulate(charts.Blocks.NewAtoms)` / `accumulate(charts.Days.NewAtoms)` at chart time, emits `{h, [t,] supply: []uint64}` via `encode`, and the result goes through `cacheChart`.
- **SKA (per-coin, lazy):** `(*ChartData).Chart` finds no `chartMakers[chartID]` entry, and when `IsSKASupplyChart(chartID)` ([db/cache/charts.go:93 approx](../../../db/cache/charts.go)) is true dispatches to `skaSupplyChart` — outside the cache. Cumulation is precomputed by `LoadSKASupplyForCoin` ([db/dcrpg/pgblockchain.go:1087](../../../db/dcrpg/pgblockchain.go)) via `*big.Int` running total into `charts.SKASupply[coinType]{Heights, Timestamps, Values []string}`.

`coin-supply/0` is the path-uniform alias for the legacy VAR data: `skaSupplyChart` short-circuits `coinType == 0` back to `coinSupplyChart`. The bare `coin-supply` ID is on the deprecation path; the dropdown only emits `coin-supply/0` and `coin-supply/{N}`.

On the frontend, the factory `coinSupplyDef(coinType)` ([cmd/dcrdata/public/js/charts/definitions/coin_supply.js](../../../cmd/dcrdata/public/js/charts/definitions/coin_supply.js)) produces a definition for both VAR and SKA. `isSKA = coinType > 0` branches `toColumns` and `formatValue`.

**Constraints:**
- Register a new *cached* chart in `chartMakers`; a new SKA per-coin chart extends the `IsSKASupplyChart` family and is intentionally *not* cached.
- Never add a new VAR-supply variant under the bare `coin-supply` ID — use the `coin-supply/` prefixed namespace.
- `accumulate` is a `uint64` accumulator; it MUST NOT be applied to `SKASupply.Values` (already cumulative; would double-sum and overflow).

**depends-on:** [impact.md → "Risk: `accumulate` / `ChartUints` applied to SKA supply"](impact.md), [impact.md → "Risk: VAR-circulation endpoint duality broken"](impact.md).

---

## String precision through the SKA supply pipeline

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/mempool/flow.full.md](../mempool/flow.full.md)

**Description:**
SKA atoms (18 decimals) travel as decimal-integer strings end-to-end so the value never touches `float64`:

- SQL: `COALESCE(sum(vouts.ska_value::numeric), 0)::text AS total` ([db/dcrpg/internal/vinoutstmts.go:253 approx](../../../db/dcrpg/internal/vinoutstmts.go)).
- Go: scanned into `[]string`, summed with `big.Int.Add` / re-emitted via `runningTotal.String()` ([db/dcrpg/pgblockchain.go:1117-1126 approx](../../../db/dcrpg/pgblockchain.go)); stored as `SKASupplyChartData.Values []string`.
- JSON: `supply: []string`.
- JS: `data.supply.map((s) => Number(s) * 1e-18)` builds the uPlot geometry series only (precision-lossy, accepted by spec §5), while `formatValue` reads `datum.payload.supply[datum.idx]` (the raw API string) and renders via `formatSkaAtomsExact` → `splitSkaAtomsNoTrailing` ([cmd/dcrdata/public/js/charts/format.js](../../../cmd/dcrdata/public/js/charts/format.js), helper at [cmd/dcrdata/public/js/helpers/ska_helper.js:78](../../../cmd/dcrdata/public/js/helpers/ska_helper.js)).

This is the same atom-string discipline used by the mempool aggregation pipeline; see [/wiki/code-analysis/mempool/patterns.md](../mempool/patterns.md) ("Atom-string arithmetic for multi-precision aggregation").

**Constraints:**
- The plotted Y value may be `Number(s) * 1e-18`; the legend MUST go through `formatSkaAtomsExact` / `splitSkaAtomsNoTrailing` on the raw string. Using `datum.value` (the float) for the legend silently drops digits past ~15 significant figures.
- Cumulation lives in `LoadSKASupplyForCoin`, not in `skaSupplyChart`. A SKA chart maker must read `Values` verbatim and never re-accumulate.
- See [/wiki/core/constraints.md#C1](../../core/constraints.md#C1).

---

## `uint8` ↔ string chart-ID coupling, duplicated Go/JS

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
The coin type is encoded in the chart ID string and parsed by two independent implementations that must agree on the `coin-supply/` prefix and the `1..255` integer range:

- Go: `IsSKASupplyChart` is a prefix check; `SkaCoinType` `fmt.Sscanf("%d")`s the suffix, returning `0` outside `1..255` (also used as the VAR sentinel).
- JS: `coinTypeFromName(name)` in `registry.js` ([cmd/dcrdata/public/js/charts/registry.js](../../../cmd/dcrdata/public/js/charts/registry.js)) parses `coin-supply/{N}` → `0` if not `1..255`; `isCoinSupplyName` tests the prefix.
- Routing: `m.CoinSupplyChartTypeCtx` re-prefixes the URL param to `"coin-supply/" + charttype`; `m.ChartTypeCtx` handles everything else.

**Constraints:**
- Changes to the prefix, the integer range, or the `0`-means-VAR sentinel must be mirrored in `SkaCoinType` (Go) and `coinTypeFromName` (JS) together — there is no shared parser.
- Coin labels must use `renderCoinType(coinType)` ([cmd/dcrdata/public/js/helpers/ska_helper.js:16](../../../cmd/dcrdata/public/js/helpers/ska_helper.js)) / `coinLabel = renderCoinType(coinType)` in the definition; never inline `'SKA'+n` or hardcode `'DCR'`/`'VAR'`.
- See [/wiki/core/constraints.md#C7](../../core/constraints.md#C7) (centralized coin-type label rendering).

---

## `h` (height) field convention for time-axis alignment

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
Every SKA supply response that carries timestamps also carries a parallel `h` (block height) array. `skaSupplyChart` emits `h` on the block-bin path verbatim; for day-bin it calls `aggregateSKASupply` which buckets by `t / 86400`, keeps the **last** sample per day, and re-emits `(timestamp, height, value)` triples — heights are carried through aggregation, not dropped.

Frontend: `xColumn(raw, n)` in `format.js` handles the height-bin → `offset + raw.h[i]` path. For block-bin it uses a 1-based index (no `raw.h` needed). For time axis it uses `raw.t`. Definition `toColumns` calls `xColumn(raw, ys.length)`.

Similarly, the live-tip window-append in `powDifficultyChart` / `ticketPriceChart` now emits an explicit `h` array containing both the historical heights and the appended `windowStartHeight`. Frontend `toColumns` for these definitions checks `raw.h` before falling back to index-derived xs.

**Constraints:**
- Any new SKA time-axis chart format MUST include `h` for every point that has a timestamp. Omitting it breaks `xColumn`'s height-bin path.
- Day-bucketing keeps the last sample per `t/86400` day; correct *only* because `Values` are cumulative.
- Window-edge charts must emit an explicit `h` array alongside the appended live-tip point so height-axis clients can decode the correct block position.
- This is a contractual regression-fixed invariant (commits `a9db4b3b`, `19a114c1`).

**depends-on:** [impact.md → "Risk: SKA time-axis response missing `h`"](impact.md).

---

## Cache-write asymmetry between VAR and SKA charts

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`(*ChartData).Chart` ([db/cache/charts.go:1093 approx](../../../db/cache/charts.go)) only calls `cacheChart(chartID, bin, axis, data)` on the `chartMakers` hit path. The `IsSKASupplyChart` branch returns `skaSupplyChart(...)` directly, before the cache write and without consulting `getCache`. Consequence: every SKA `coin-supply/{N}` request re-reads `SKASupply[coinType]`, re-marshals the JSON, and returns it fresh; VAR responses are byte-cached.

The lazy DB load (`ChartTypeData` calling `LoadSKASupplyForCoin`) is a separate concern from the chart-time JSON cache.

**Constraints:**
- A future optimization routing SKA through the JSON byte cache MUST add per-coin-type invalidation when a new block arrives.
- `invalidateTipCharts()` only targets named `chartMakers` charts; it does NOT invalidate SKA coin-supply charts (they have no cached JSON today).

---

## Lazy SKA-supply load guarded by a mismatched mutex (latent race)

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`LoadSKASupplyForCoin` ([db/dcrpg/pgblockchain.go:1087](../../../db/dcrpg/pgblockchain.go)) assigns `charts.SKASupply[coinType]` under `charts.SKASupplyMtx.Lock()`. The gate readers `SKASupplyExists` and `SKASupplyHeight` use `SKASupplyMtx.RLock()` — consistent with the writer. **But `skaSupplyChart` reads `charts.SKASupply[coinType]` under `charts.mtx.RLock()` — a *different* mutex**, so the writer's lock does not exclude it. Because `ChartTypeData` also reloads on staleness (`currHeight - cachedHeight > 10`), a reload (writer, `SKASupplyMtx`) can run concurrently with a render (reader, `charts.mtx`) of the same coin → latent Go `concurrent map read and map write` fatal error.

**Constraints:**
- All `SKASupply` access must go through one mutex. The fix is to make `skaSupplyChart` read under `SKASupplyMtx.RLock()` (matching the writer).
- The gate is a non-atomic check-then-act, so two concurrent requests can both run the loader; harmless for data correctness (last-writer-wins, identical data) but redundant. A per-coin singleflight removes duplicate work.

**depends-on:** [impact.md → "SKA supply map read/write under mismatched locks"](impact.md).

---

## `chart_theme.js` as single source of color truth

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`public/js/helpers/chart_theme.js` is the single source of truth for all chart colors used by both the uPlot charts (via `uplot_adapter.js`) and the hashrate-shares SVG pie (via `colorForIndex`). It defines:

- `PALETTE` — 25-entry categorical palette. Index 0 (`PRIMARY`) is theme-aware: light `#2970FF`, dark `#2DD8A3` (mint, ~4.5:1 contrast).
- `SERIES_COLORS` — named overrides for specific series: `tickets-price`, `tickets-bought` (dark `#4dabf7`), `hashrate-rate`, `hashrate-miners` (dark `#4dabf7`). Dark secondary (y2) series use `#4dabf7` (~4.3:1) instead of `#2970ff` (~2.4:1) for legibility.
- `colorForIndex(i, dark)`, `seriesColorByKey(key, dark)` — resolution functions.

`uplot_adapter.js:resolveSeriesColor(s, i, dark)` applies them in order: explicit `s.color` → named `seriesColorByKey(s.colorKey)` → palette `colorForIndex(s.colorIndex ?? i)`.

The `.vSelector .checkmark` background-color values in `charts.scss` MUST stay in sync with `SERIES_COLORS` dark-mode values (visibility toggle swatches mirror the series line color).

**Constraints:**
- Adding a new named series color: update `SERIES_COLORS` in `chart_theme.js` AND the matching `.checkmark` rule in `charts.scss`.
- Renaming a `colorKey` in a series spec: update both the spec and the `SERIES_COLORS` key — there is no runtime error for a missing key (falls back to palette index).

---

## TurboQuery + `Zoom` URL state, with range persistence via ranger strip

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md)

**Description:**
The charts controller drives all URL state through TurboQuery + `Zoom.encode/decode`. The uPlot chart reports x-range changes via `onRangeChange` (hook in `createChart`); the controller calls `persistRange(min, max, snap)` which maps the range back to a zoom preset key or encodes a custom base-36 range.

The ranger strip (overview navigator, `uplot_ranger.js`) drives the main chart via `onRangerSelect(min, max)` → `handle.setXRange(min, max)` (silent — does not re-fire `onRangeChange`). Zooms applied programmatically (`applyZoom`, presets, defaults) use `setMainXRange(min, max)` which updates both the main chart and the strip in lockstep.

The charts controller no longer uses `Zoom.project(...)` (which was a Dygraphs-era range projection across data-range changes). The uPlot path encodes and decodes absolute x-values in plot units directly.

**Constraints:**
- `encodeRange(min, max)` stores in ms for time charts (plot x is seconds → multiply by 1000) and raw for height charts. `decodeRange(encoded)` reverses. Mismatching the unit causes a stale or out-of-bounds zoom.
- Zoom presets (`'day'`, `'week'`, `'month'`, `'year'`, `'all'`) snap to trailing windows ending at `dataMax`; custom ranges clear every preset. `persistRange(snap=false)` from the ranger strip always stores a custom range.
- Shares the TurboQuery/`Zoom` pattern with the address controller; see [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md) §5.

---

## Cross-page navigation from a chart `<select>` option

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`hashrate-shares` is a `<select>` option in `charts.tmpl:41` that does not correspond to an `/api/chart/…` endpoint. In `selectChart()` ([charts_controller.js:238](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)), the controller tests `selection === 'hashrate-shares'`, calls `Turbolinks.visit('/hashrate-shares')`, and returns immediately — no `getDefinition`, no data fetch, no uPlot update. The navigation uses `Turbolinks.visit` so the controller's `disconnect()` lifecycle hook fires cleanly and tears down the uPlot instance before the body swap.

**Constraints:**
- Any new cross-page option must: (1) add the early-return guard first in `selectChart()`; (2) use `Turbolinks.visit` (not `window.location.assign`) to let the lifecycle fire cleanly.
- If the target page URL changes, the string in `selectChart()` and the `<option value>` in `charts.tmpl` must be updated together — they are a duplicated pair with no shared constant.

---

## `chart-hashrate` CSS class gate for chart-specific y2label color

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
The Active Miners y2-axis label on the hashrate chart needs to match the `#c60` (orange) series line color in light mode. `applyControlVisibility(def, selection)` ([charts_controller.js:648-652](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) adds `chart-hashrate` to `chartsViewTarget` when `hashrate` is selected and removes it for every other selection. The SCSS rule `.chartview.chart-hashrate .dygraph-y2label { color: #c60 }` ([charts.scss:260](../../../cmd/dcrdata/public/scss/charts.scss)) scopes the override. (Note: the CSS selector still targets `.dygraph-y2label` because the uPlot migration left the existing Dygraphs-named class in the SCSS; it applies equally to any `.dygraph-y2label`-classed element rendered by uPlot's axis label injection, if the adapter adopts the same class.)

**Constraints:**
- The CSS class name in `applyControlVisibility()` and in `charts.scss` must stay in sync.
- The toggle removes the class on non-hashrate selections, so it is stateless across chart switches.

---

See also:
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md) (derived-from: §4 cross-layer, §5 constraints, §7 pitfalls)
- [/wiki/code-analysis/charts/impact.md](impact.md) (shares-pattern-with: the constraints here exist to prevent the risks documented there)
- [/wiki/core/constraints.md#C1](../../core/constraints.md#C1) (depends-on: SKA `float64` vs `big.Int`/string precision — the string-end-to-end SKA rule)
- [/wiki/core/constraints.md#C7](../../core/constraints.md#C7) (depends-on: centralized coin-type label rendering — `renderCoinType`)
- [/wiki/code-analysis/mempool/patterns.md](../mempool/patterns.md) (shares-pattern-with: atom-string arithmetic for multi-precision aggregation)
- [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md) (shares-pattern-with: TurboQuery + `Zoom` validation; charts uses `setXRange`/`setSelection` instead of `Zoom.project`)
