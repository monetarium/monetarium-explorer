## Risk: `accumulate` / `ChartUints` applied to SKA supply

**Trigger:**
Calling `accumulate(...)` on `SKASupply[coinType].Values`, or pushing SKA atom values into a `ChartUints` (`[]uint64`) field — e.g. a refactor that tries to "unify" the VAR and SKA chart makers.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent.

**Description:**
`accumulate` ([db/cache/charts.go approx :1148](../../../db/cache/charts.go)) is a `uint64` running sum used only for `ChartUints`. `SKASupply.Values` is already cumulative (`*big.Int` running total computed in `LoadSKASupplyForCoin`), so accumulating again produces a double-summed series with no error. Separately, an 18-decimal SKA atom value overflows `uint64` long before it overflows `*big.Int`, so coercing it into `ChartUints` truncates silently. The chart simply renders wrong numbers; nothing logs.

---

## Risk: SKA precision lost via `float64` coercion in the legend

**Trigger:**
Rendering the chart legend from `Number(s)` / `parseFloat(s)` of `data.supply` rather than from the raw atom string via `datum.payload.supply[datum.idx]`, or removing the exact-string path from `formatValue` in `coinSupplyDef`.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/mempool/flow.full.md](../mempool/flow.full.md)

**Failure mode:** silent.

**Description:**
The plotted uPlot Y value is intentionally `Number(s) * 1e-18` (lossy past `float64`'s 53-bit significand) — accepted by spec §5 for the *line*. The **legend** must stay exact: `coinSupplyDef(N).formatValue` reads `datum.payload.supply[datum.idx]` (the raw API string) and renders via `formatSkaAtomsExact` → `splitSkaAtomsNoTrailing` ([cmd/dcrdata/public/js/charts/format.js](../../../cmd/dcrdata/public/js/charts/format.js)). Routing the legend through the float drops the last digits of any SKA value above ~10¹⁵ atoms. Same root cause as the mempool float-coercion risk; see [/wiki/code-analysis/mempool/impact.md](../mempool/impact.md) and [/wiki/core/constraints.md#C1](../../core/constraints.md#C1).

---

## Risk: SKA time-axis response missing `h`

**Trigger:**
Adding a new SKA chart format (or modifying `skaSupplyChart` / `aggregateSKASupply`) that emits timestamps without the parallel `h` (block height) array.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent.

**Description:**
`xColumn(raw, n)` in `format.js` uses `raw.h[i]` as the X coordinate for height-axis SKA day-bin requests. If a time-axis response omits `h`, the height-axis path produces `undefined` x-values — the chart silently misrenders. `aggregateSKASupply` deliberately carries `heights` through the `t / 86400` day bucketing for exactly this reason. This was a real regression fixed by commits `a9db4b3b`, `19a114c1`.

---

## Risk: `LoadSKASupplyForCoin` invoked with `coinType == 0`

**Trigger:**
Removing or weakening the `coinType > 0` guard in `ChartTypeData` ([cmd/dcrdata/internal/api/apiroutes.go:1901 approx](../../../cmd/dcrdata/internal/api/apiroutes.go)), or calling `LoadSKASupplyForCoin(ctx, charts, 0)` from any new caller.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** loud, but degraded — the request returns HTTP 503; not a panic.

**Description:**
With `coinType == 0`, `LoadSKASupplyForCoin` runs `SelectVARCoinSupplyPerBlock` which selects **2 columns** (`block_time, total`), but the row loop does `rows.Scan(&h, &t, &v)` with **3 targets**. The scan error is caught per-row, logged at `Warnf`, and `continue`d, so no rows accumulate and the function returns `"no data found for coin type 0"`. `ChartTypeData` only `Warnf`s on loader error and continues; the subsequent `charts.Chart` call routes `coin-supply/0` through `skaSupplyChart`'s `coinType == 0` short-circuit to `coinSupplyChart`, so the VAR chart *does* still render — the broken loader path is dead weight, not a crash. Real exposure: a non-handler caller of `LoadSKASupplyForCoin(…, 0)` that trusts a nil error would observe an empty `SKASupply[0]`.

---

## Risk: SKA supply map read/write under mismatched locks (latent fatal-error path)

**Trigger:**
A reload of `coin-supply/{N}` (first-load, **or** a stale-height-triggered reload) running concurrently with another request rendering that same coin's chart; or a refactor that assumes `SKASupply` is fully lock-protected.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** latent Go `concurrent map read and map write` **fatal error** (real defect).

**Description:**
`LoadSKASupplyForCoin` writes `charts.SKASupply[coinType]` under `charts.SKASupplyMtx.Lock()`, and the gate readers `SKASupplyExists` / `SKASupplyHeight` use `SKASupplyMtx.RLock()` — consistent with the writer. **But `skaSupplyChart` reads `charts.SKASupply[coinType]` under `charts.mtx.RLock()` — a *different* mutex.** `SKASupplyMtx.Lock()` does not exclude a `charts.mtx`-guarded reader. With the stale-height reload branch (`currHeight - cachedHeight > 10`), a reload (writer, `SKASupplyMtx`) can run concurrently with a render (reader, `charts.mtx`) → Go's `concurrent map read and map write` fatal error.

> Fix direction: make `skaSupplyChart` read under `SKASupplyMtx.RLock()` (matching the writer), or unify all `SKASupply` access on one mutex.

---

## Risk: VAR-circulation endpoint duality broken

**Trigger:**
Removing the bare `coin-supply` chart ID / `chartMakers["coin-supply"]` entry while leaving `coin-supply/0` consumers, or vice versa; or adding a new VAR-supply variant under the bare `coin-supply` ID.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** loud (chart 404/unknown).

**Description:**
`coin-supply` (legacy, via `chartMakers` → `coinSupplyChart` → cached) and `coin-supply/0` (via `skaSupplyChart`'s `coinType == 0` short-circuit → `coinSupplyChart`, **not** cached) resolve to the same VAR data through two code paths. The dropdown only emits `coin-supply/0`; the bare ID is deprecated but still reachable and still drives `coinSupplyDef(0)`'s `toColumns` via the registry. Removing one ID without re-pointing the consumer produces an `UnknownChartErr` 404. New VAR variants must go under the `coin-supply/` prefixed namespace.

---

## Risk: `LoadSKASupplyForCoin` signature change without updating implementers

**Trigger:**
Changing the `LoadSKASupplyForCoin(ctx, *cache.ChartData, uint8) error` signature on the `DataSource` interface ([cmd/dcrdata/internal/api/apiroutes.go:112 approx](../../../cmd/dcrdata/internal/api/apiroutes.go)).

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** loud (compile failure in the test build).

**Description:**
The interface is implemented by the real `(*ChainDB).LoadSKASupplyForCoin` ([db/dcrpg/pgblockchain.go:1087](../../../db/dcrpg/pgblockchain.go)) **and** the test stub `noopDS.LoadSKASupplyForCoin` ([cmd/dcrdata/internal/api/noop_ds_test.go:127 approx](../../../cmd/dcrdata/internal/api/noop_ds_test.go)). A signature change can leave the API package's tests un-buildable until the mock is updated in lockstep.

---

## Risk: `ActiveSKATypes` projection drift hides coins from the dropdown

**Trigger:**
Changing how `HomeInfo.SKACoinSupply` is tracked, or the `ActiveSKATypes` projection in `(*explorerUI).Charts` ([cmd/dcrdata/internal/explorer/explorerroutes.go:1692-1697 approx](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)).

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/page-rendering/flow.full.md](../page-rendering/flow.full.md)

**Failure mode:** silent (a valid SKA coin is missing from the dropdown).

**Description:**
The dropdown is built from `ActiveSKATypes` at page render. A coin with zero supply at render time is omitted — but the `/api/chart/coin-supply/{N}` endpoint still works for it (returning HTTP 503 only when no rows exist). So a projection bug doesn't error; it just makes a chart unreachable through the UI while remaining reachable by direct API call, which masks the regression in manual testing.

---

## Risk: Tip-reading chart maker added without updating `invalidateTipCharts`

**Trigger:**
Adding a new chart maker that reads `charts.Tip` under `tipMtx.RLock()` without registering its `cacheKey()` combinations in `invalidateTipCharts()` ([db/cache/charts.go:919](../../../db/cache/charts.go)).

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent (stale data served).

**Description:**
`SetTip()` calls `invalidateTipCharts()` on every new block to flush cached JSON for charts whose last data point now reflects stale pre-tip values. If a new maker reads `Tip` but its cache key is not in `invalidateTipCharts()`, the cached response from the previous block is served until the next `cacheID` update (next window boundary for window charts). The chart's last data point will lag the home page's current value by up to one full window period — visually inconsistent but not an error.

Currently registered in `invalidateTipCharts`: `TicketPrice` (WindowBin × both axes), `POWDifficulty` (WindowBin × both axes), `PercentStaked` (BlockBin + DayBin × both axes).

---

## Risk: Lock ordering reversed (`cacheMtx` → `tipMtx`)

**Trigger:**
Any code path that acquires `cacheMtx` (e.g. `cacheChart`, `getCache`) while then calling `SetTip()`, or that holds `tipMtx` while trying to read/write a chart response under `charts.mtx`.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** deadlock (hard, runtime goroutine block).

**Description:**
`SetTip()` holds `tipMtx.Lock()` while calling `invalidateTipCharts()`, which acquires `cacheMtx.Lock()`. This establishes the lock order: **`tipMtx` must be acquired before `cacheMtx`** whenever both are needed. Reversing this — e.g. a path that holds `cacheMtx` and then calls `SetTip()` — creates a classic AB–BA deadlock. Similarly, chart makers read `tip` under `tipMtx.RLock()` *inside* the chart-build path which runs under `charts.mtx.RLock()`, so `charts.mtx` → `tipMtx` is also an established order; code that holds `tipMtx` and tries to acquire `charts.mtx` in write mode would deadlock.

---

## Risk: `def.series.length` mismatch with `toColumns()` column count

**Trigger:**
Writing a `toColumns()` that returns more or fewer columns than `def.series.length`; or changing `def.series` (adding/removing a series) without updating `toColumns`.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent rendering corruption.

**Description:**
`renderChart()` in the controller calls `renderDef.toColumns(this.payload, ...)` and passes the result directly to `createChart` / `handle.setData(cols)`. uPlot maps `cols[N]` to series `N-1` (column 0 is always x). Extra columns are ignored; missing columns produce `undefined` y-values rendered as gaps or NaN. There is no validation at the adapter or controller boundary — mismatches are invisible until the chart renders wrong.

---

## Risk: `logFloor` removed from SKA coin-supply series spec

**Trigger:**
Removing the `logFloor: 1` property from the SKA series in `coinSupplyDef(N).series` ([cmd/dcrdata/public/js/charts/definitions/coin_supply.js](../../../cmd/dcrdata/public/js/charts/definitions/coin_supply.js)), or adding a new SKA supply-like series without it.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent cosmetic regression (log axis collapses to a point).

**Description:**
SKA coin supply starts at zero (before genesis) and then rises to a large plateau. On a log scale, `log10(0) = -Infinity` collapses the y-axis: all zero-supply points share the same y coordinate as the minimum positive value, making the series appear as a vertical spike at the left edge. `logFloor: 1` (applied by `uplot_adapter.buildOpts`) floors plotted values at 1 whole coin on log scale, preventing the collapse. The exact atom value is still displayed correctly in the tooltip because `formatValue` reads from `datum.payload` (the raw API string), not from the floored plot value. See also: Dygraphs-era fix #499/#507 (`clampLogFloor`).

---

See also:
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md) (derived-from: §5 critical constraints, §6 mutation impact, §7 common pitfalls)
- [/wiki/code-analysis/charts/patterns.md](patterns.md) (shares-pattern-with: the patterns whose constraints these risks violate)
- [/wiki/core/constraints.md#C1](../../core/constraints.md#C1) (depends-on: SKA `float64` vs `big.Int`/string precision)
- [/wiki/code-analysis/mempool/impact.md](../mempool/impact.md) (shares-pattern-with: SKA precision lost via `float64` coercion — same root cause across domains)
- [/wiki/code-analysis/page-rendering/impact.md](../page-rendering/impact.md) (depends-on: shared `pageData.HomeInfo` page-state access)
