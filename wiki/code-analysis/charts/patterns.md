## Two coin-supply pipelines under one chart-ID namespace

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
"Coin supply" is served by two code paths that share the `coin-supply` / `coin-supply/{N}` chart-ID namespace but no code:

- **VAR (legacy):** PG `vins.value_in` deltas pre-loaded into `ChartData.Blocks.NewAtoms` / `Days.NewAtoms` (`ChartUints = []uint64`). `coinSupplyChart` ([db/cache/charts.go:1349](../../../db/cache/charts.go)) calls `accumulate(charts.Blocks.NewAtoms)` ([:1356](../../../db/cache/charts.go)) / `accumulate(charts.Days.NewAtoms)` ([:1371](../../../db/cache/charts.go)) at chart time, emits `{h, [t,] supply: []uint64}` via `encode`, and the result goes through `cacheChart`.
- **SKA (per-coin, lazy):** `(*ChartData).Chart` ([:1093](../../../db/cache/charts.go)) finds no `chartMakers[chartID]` entry, and when `IsSKASupplyChart(chartID)` ([:93](../../../db/cache/charts.go)) is true dispatches to `skaSupplyChart` ([:1789](../../../db/cache/charts.go)) — outside the cache. Cumulation is precomputed by `LoadSKASupplyForCoin` ([db/dcrpg/pgblockchain.go:1087](../../../db/dcrpg/pgblockchain.go)) via `*big.Int` running total ([:1127-1134](../../../db/dcrpg/pgblockchain.go)) into `charts.SKASupply[coinType]{Heights, Timestamps, Values []string}`.

`coin-supply/0` is the path-uniform alias for the legacy VAR data: `skaSupplyChart` short-circuits `coinType == 0` back to `coinSupplyChart` ([:1796-1798](../../../db/cache/charts.go)). The bare `coin-supply` ID is on the deprecation path; the dropdown only emits `coin-supply/0` and `coin-supply/{N}` ([cmd/dcrdata/views/charts.tmpl:33-34](../../../cmd/dcrdata/views/charts.tmpl)).

**Constraints:**
- Register a new *cached* chart in `chartMakers` ([:1072](../../../db/cache/charts.go)); a new SKA per-coin chart extends the `IsSKASupplyChart` family and is intentionally *not* cached.
- Never add a new VAR-supply variant under the bare `coin-supply` ID — use the `coin-supply/` prefixed namespace.
- `accumulate` ([:1148](../../../db/cache/charts.go)) is a `uint64` accumulator; it is only ever applied to `ChartUints` (`*.NewAtoms`, `*.BlockSize`). It MUST NOT be applied to `SKASupply.Values` (already cumulative; would double-sum and overflow).

**depends-on:** [impact.md → "Risk: `accumulate` / `ChartUints` applied to SKA supply"](impact.md), [impact.md → "Risk: VAR-circulation endpoint duality broken"](impact.md).

---

## String precision through the SKA supply pipeline

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/mempool/flow.full.md](../mempool/flow.full.md)

**Description:**
SKA atoms (18 decimals) travel as decimal-integer strings end-to-end so the value never touches `float64`:

- SQL: `COALESCE(sum(vouts.ska_value::numeric), 0)::text AS total` ([db/dcrpg/internal/vinoutstmts.go:253](../../../db/dcrpg/internal/vinoutstmts.go)).
- Go: scanned into `[]string`, summed with `big.Int.Add` / re-emitted via `runningTotal.String()` ([db/dcrpg/pgblockchain.go:1117-1126](../../../db/dcrpg/pgblockchain.go)); stored as `SKASupplyChartData.Values []string` ([db/cache/charts.go:301-308](../../../db/cache/charts.go)).
- JSON: `supply: []string`.
- JS: `data.supply.map((s) => Number(s) * 1e-18)` builds the Dygraphs line only (precision-lossy, accepted by spec §5), while the original strings are stashed in `this._skaSupplyRaw` and the legend renders them via `formatSkaAtomsExact` → `splitSkaAtomsNoTrailing` ([cmd/dcrdata/public/js/controllers/charts_controller.js:662-687](../../../cmd/dcrdata/public/js/controllers/charts_controller.js), helper at [cmd/dcrdata/public/js/helpers/ska_helper.js:78](../../../cmd/dcrdata/public/js/helpers/ska_helper.js)).

This is the same atom-string discipline used by the mempool aggregation pipeline; see [/wiki/code-analysis/mempool/patterns.md](../mempool/patterns.md) ("Atom-string arithmetic for multi-precision aggregation").

**Constraints:**
- The plotted Y value may be `Number(s) * 1e-18`; the legend MUST go through `formatSkaAtomsExact` / `splitSkaAtomsNoTrailing` on the raw string. Coercing `data.supply` via `Number`/`parseFloat` for the legend silently drops digits past ~15 significant figures.
- Cumulation lives in `LoadSKASupplyForCoin`, not in `skaSupplyChart`. A SKA chart maker must read `Values` verbatim and never re-accumulate.
- See [/wiki/core/constraints.md#C1](../../core/constraints.md#C1).

---

## `uint8` ↔ string chart-ID coupling, duplicated Go/JS

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
The coin type is encoded in the chart ID string and parsed by two independent implementations that must agree on the `coin-supply/` prefix and the `1..255` integer range:

- Go: `IsSKASupplyChart` ([db/cache/charts.go:93](../../../db/cache/charts.go)) is a prefix check; `SkaCoinType` ([:99](../../../db/cache/charts.go)) `fmt.Sscanf("%d")`s the suffix, returning `0` outside `1..255` (also used as the VAR sentinel).
- JS: `skaCoinTypeFromChart(name)` ([cmd/dcrdata/public/js/controllers/charts_controller.js:60](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) parses `coin-supply/{N}` → `0` if not `1..255`; `isCoinSupplyChart` ([:70](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) collapses bare `coin-supply` and `coin-supply/{N}` to one `switchKey` ([:528](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)).
- Routing: `m.CoinSupplyChartTypeCtx` ([cmd/dcrdata/internal/middleware/apimiddleware.go:799-803](../../../cmd/dcrdata/internal/middleware/apimiddleware.go)) re-prefixes the URL param to `"coin-supply/" + charttype` so the handler always sees the full ID; `m.ChartTypeCtx` ([:789](../../../cmd/dcrdata/internal/middleware/apimiddleware.go)) handles everything else. Routes at [cmd/dcrdata/internal/api/apirouter.go:240-242](../../../cmd/dcrdata/internal/api/apirouter.go).

**Constraints:**
- Changes to the prefix, the integer range, or the `0`-means-VAR sentinel must be mirrored in `SkaCoinType` (Go) and `skaCoinTypeFromChart` (JS) together — there is no shared parser.
- Coin labels must use `renderCoinType(coinType)` ([cmd/dcrdata/public/js/helpers/ska_helper.js:16](../../../cmd/dcrdata/public/js/helpers/ska_helper.js)) / `coinLabel = isSKA ? renderCoinType(coinType) : 'VAR'` ([charts_controller.js:527](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)); never inline `'SKA'+n` or hardcode `'DCR'`/`'VAR'`.
- See [/wiki/core/constraints.md#C7](../../core/constraints.md#C7) (centralized coin-type label rendering).

---

## `h` (height) field convention for time-axis alignment

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
Every SKA supply response that carries timestamps also carries a parallel `h` (block height) array so the frontend can align the time-axis series to block heights. `skaSupplyChart` emits `h` on the block-bin path verbatim; for day-bin it calls `aggregateSKASupply(timestamps, heights, values)` ([db/cache/charts.go:1814](../../../db/cache/charts.go)) which buckets by `t / 86400` ([:1827](../../../db/cache/charts.go)), keeps the **last** sample per day, and re-emits `(timestamp, height, value)` triples — heights are carried through aggregation, not dropped. Frontend `xFunc` selects `i` for block-bin and `data.h[i]` for day-bin requests.

**Constraints:**
- Any new SKA time-axis chart format MUST include `h` for every point that has a timestamp. Omitting it leaves the day-bin X mapping (`xFunc(i) = heights[i]`) with no data — the chart silently aligns to wrong heights or breaks.
- Day-bucketing keeps the last sample per `t/86400` day; this is correct *only* because `Values` are cumulative. A delta series would need a per-bucket sum instead.
- This is a contractual regression-fixed invariant (commits `a9db4b3b`, `19a114c1`).

**depends-on:** [impact.md → "Risk: SKA time-axis response missing `h`"](impact.md).

---

## Cache-write asymmetry between VAR and SKA charts

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`(*ChartData).Chart` ([db/cache/charts.go:1050](../../../db/cache/charts.go)) only calls `cacheChart(chartID, bin, axis, data)` on the `chartMakers` hit path — and only after running the maker under `charts.mtx.RLock()`. The `IsSKASupplyChart` branch returns `skaSupplyChart(...)` directly, **before** the cache write and **without** consulting `getCache`. Consequence: every SKA `coin-supply/{N}` request re-reads `SKASupply[coinType]`, re-marshals the JSON, and returns it fresh; VAR responses are byte-cached and keyed by `cacheID`.

The lazy DB load is a separate concern: `ChartTypeData` ([cmd/dcrdata/internal/api/apiroutes.go:1942](../../../cmd/dcrdata/internal/api/apiroutes.go)) populates `SKASupply[coinType]` once via `LoadSKASupplyForCoin` when `!c.charts.SKASupplyExists(coinType)`; subsequent requests skip the DB but still re-marshal.

**Constraints:**
- A future optimization that routes SKA through the JSON byte cache MUST add per-coin-type invalidation when a new block arrives (the VAR cache is invalidated via `cacheID`; SKA has no equivalent today).
- JS-level logic that relies on cache-busting semantics (e.g. anything mirroring `pubsubhub.go` cache invalidation) does not apply to SKA charts unless explicitly wired.

---

## Lazy SKA-supply load guarded by a mismatched mutex (latent race)

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`LoadSKASupplyForCoin` ([db/dcrpg/pgblockchain.go:1087](../../../db/dcrpg/pgblockchain.go)) assigns `charts.SKASupply[coinType] = cache.SKASupplyChartData{...}` under `charts.SKASupplyMtx.Lock()` ([:1136-1142](../../../db/dcrpg/pgblockchain.go)). The gate readers `SKASupplyExists` ([db/cache/charts.go:897-908](../../../db/cache/charts.go)) and `SKASupplyHeight` ([:911-919](../../../db/cache/charts.go)) read under `SKASupplyMtx.RLock()` — consistent with the writer. **But the chart reader `skaSupplyChart` reads `charts.SKASupply[coinType]` under `charts.mtx.RLock()` ([:1801-1807](../../../db/cache/charts.go)) — a *different* mutex**, so the writer's lock does not exclude it. Because the load gate now also reloads on staleness (`currHeight - cachedHeight > skaSupplyStaleHeightThreshold`), a reload (writer) can run concurrently with a render (reader) of the same coin → a latent Go `concurrent map read and map write`. The pattern to learn from: a dedicated mutex only helps if **every** accessor uses it.

**Constraints:**
- All `SKASupply` access must go through one mutex. Today the reader/writer split is `charts.mtx` vs `SKASupplyMtx` — a real defect; unify on `SKASupplyMtx`.
- The gate is a non-atomic check-then-act, so two concurrent requests can both run the loader. Harmless for corruption (each write serialized, identical data, last-writer-wins) but redundant; a per-coin singleflight removes the duplicate work.

**depends-on:** [impact.md → "SKA supply map read/write under mismatched locks"](impact.md).

---

## TurboQuery + `Zoom` URL state, with cross-range projection

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md)

**Description:**
The charts controller drives all URL state through TurboQuery + `Zoom.validate`, the same pattern the address controller uses. Charts additionally calls `Zoom.project(this.settings.zoom, oldLimits, this.limits)` ([cmd/dcrdata/public/js/controllers/charts_controller.js:901](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) when the data range changes — e.g. switching between a VAR chart and a SKA chart with different height/time extents — which the address controller does not do. Behavior is correct but the projection step is easy to miss when changing zoom handling.

**Constraints:**
- Switching between VAR and SKA charts changes the data range; any new zoom logic must keep `Zoom.project` applied across that transition or stale `?zoom=` produces an out-of-range view.
- Shares the broader TurboQuery/`Zoom` pattern with the address controller; see [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md) §5.

---

## Cross-page navigation from a chart `<select>` option

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
`hashrate-shares` is added as a `<select>` option in `charts.tmpl:41` but does not correspond to an `/api/chart/…` endpoint. In `selectChart()` ([charts_controller.js:853](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)), the controller tests for `selection === 'hashrate-shares'`, calls `Turbolinks.visit('/hashrate-shares')`, and returns immediately — no data fetch, no Dygraphs update. The navigation uses `Turbolinks.visit` (same mechanism as `pagenavigation_controller` and all other in-app nav) rather than `window.location.assign`, so the controller's `disconnect()` lifecycle hook fires cleanly and tears down the Dygraphs instance before the body swap. This pattern extends the chart selector beyond a pure chart-type picker into a navigation hub for chart-adjacent pages.

**Constraints:**
- Any new cross-page option must: (1) add the early-return guard first in `selectChart()`; (2) use `Turbolinks.visit` (not `window.location.assign`) to let the lifecycle fire cleanly.
- The target page must have its own controller — the charts controller does not survive the Turbolinks body swap.
- If the target page URL changes (e.g. `/hashrate-shares` → `/miners`), the string in `selectChart()` and the `<option value>` in `charts.tmpl` must be updated together — they are a duplicated pair with no shared constant.

---

## `chart-hashrate` CSS class gate for chart-specific y2label color

**Appears in:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Description:**
The Active Miners y2-axis label on the hashrate chart needs to match the `#c60` (orange) series line color in light mode. Rather than a JS `gOptions.y2label`-style color override (which Dygraphs doesn't expose), the approach is a CSS class gate: `selectChart()` ([charts_controller.js:878–883](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) adds `chart-hashrate` to `chartsViewTarget` (the `<div class="chartview">`) when `hashrate` is selected and removes it for every other selection. The SCSS rule `.chartview.chart-hashrate .dygraph-y2label { color: #c60 }` ([charts.scss:260](../../../cmd/dcrdata/public/scss/charts.scss)) then scopes the override. Dark mode inherits the generic `body.darkBG .chartview .dygraph-y2label { color: #2970ff }` rule ([charts.scss:264](../../../cmd/dcrdata/public/scss/charts.scss)) — no additional dark-mode hashrate rule is needed because `#2970ff` matches the hashrate series color in dark mode.

**Constraints:**
- The CSS class name in `selectChart()` and in `charts.scss` must stay in sync. Renaming one without the other silently reverts the y2label to the generic default color.
- The toggle removes the class on non-hashrate selections, so it is inherently stateless across chart switches — no cleanup needed beyond the removal.
- This approach (add/remove class on the wrapper → SCSS selector) is the correct extension point for future chart-specific label or legend color overrides; avoid JS `gOptions` color hacks.

---

See also:
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md) (derived-from: §4 cross-layer, §5 constraints, §7 pitfalls)
- [/wiki/code-analysis/charts/impact.md](impact.md) (shares-pattern-with: the constraints here exist to prevent the risks documented there)
- [/wiki/core/constraints.md#C1](../../core/constraints.md#C1) (depends-on: SKA `float64` vs `big.Int`/string precision — the string-end-to-end SKA rule)
- [/wiki/core/constraints.md#C7](../../core/constraints.md#C7) (depends-on: centralized coin-type label rendering — `renderCoinType`)
- [/wiki/code-analysis/mempool/patterns.md](../mempool/patterns.md) (shares-pattern-with: atom-string arithmetic for multi-precision aggregation)
- [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md) (shares-pattern-with: TurboQuery + `Zoom` validation; charts additionally projects zoom across data-range changes)
