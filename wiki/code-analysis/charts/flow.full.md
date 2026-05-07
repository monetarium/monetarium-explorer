### 1. Overview

End-to-end trace of the `/charts` page after the SKA-supply rollout. Two chart pipelines now coexist for "coin supply":

- **VAR / legacy `coin-supply`** — pre-loaded delta cache (`ChartData.Blocks.NewAtoms`, `[]uint64`), accumulated on demand with `accumulate()`, and rendered through `circulationFunc` (Dygraphs float). This is the original Decred path; its design assumes 8-decimal atoms fit in `uint64` and `float64`.
- **SKA `coin-supply/{N}` (1 ≤ N ≤ 255)** — lazy, per-request load through a different code path: SQL returns per-block deltas, Go computes the running cumulative as `*big.Int` strings, the result is held in `ChartData.SKASupply[uint8]SKASupplyChartData`, and the JSON response carries exact 18-decimal strings (`supply: []string`) plus aligned block heights (`h`). The Dygraphs line still uses float (acceptable per spec §5), but the legend pulls the original string and renders it via `splitSkaAtomsNoTrailing`.

The `/api/chart/coin-supply/0` route (introduced for path-uniformity) maps internally back to the legacy VAR path. The dropdown is now driven by `ActiveSKATypes` from `HomeInfo.SKACoinSupply`, so only coins with non-zero supply appear.

### 2. End-to-End Data Flow

**Common entry:**
chi `GET /api/chart/{charttype}` → `m.ChartTypeCtx` (or `m.CoinSupplyChartTypeCtx` for `/coin-supply/{n}`) → `appContext.ChartTypeData` → `(*ChartData).Chart(chartID, bin, axis)`.

**VAR path (`coin-supply` or `coin-supply/0`):**
PostgreSQL `vins.value_in` deltas → `pgb.coinSupply` fetcher (registered as a chartSource) populates `ChartData.Blocks.NewAtoms` (`ChartUints` / `[]uint64`) → `chartMakers["coin-supply"] = coinSupplyChart` → `accumulate(NewAtoms)` + `encode(...)` JSON → cached in `cachedCharts` → `writeJSONBytes` → `charts_controller.js` → `circulationFunc` (`v * 1e-8`) → Dygraphs.

**SKA path (`coin-supply/{N}`, N ≥ 1):**
`ChartTypeData` checks `IsSKASupplyChart(chartType)`; if `!SKASupplyExists(coinType)` it calls `DataSource.LoadSKASupplyForCoin(ctx, charts, coinType)` → SQL `SelectSKACoinSupplyPerBlock` (returns `block_height`, `block_time`, `total::text` per block) → Go scans into `[]int64`/`[]int64`/`[]string` → running `*big.Int` accumulator → stored in `charts.SKASupply[coinType]` (`{Heights, Timestamps, Values}`) → `(*ChartData).Chart` falls through to `charts.skaSupplyChart(...)` → emits `{bin, axis, h, [t,] supply: []string}` JSON via `json.Marshal` (no `accumulate`, no cache write) → frontend `plotGraph case 'coin-supply'` `isSKA` branch maps `data.supply` to floats for the line and stashes the raw strings in `this._skaSupplyRaw` for the exact-precision legend.

### 3. Per-Layer Breakdown

- **Location:** `db/dcrpg/internal/vinoutstmts.go:130-269`
  - **Data Structures:** PostgreSQL `vouts(value INT8, ska_value TEXT, coin_type)`, `transactions(block_height, block_time, is_mainchain, is_valid)`.
  - **Transformations:**
    - `SelectCoinSupply` (line 132) — sums `vins.value_in` per block (legacy VAR delta query).
    - `SelectSKACoinSupplyPerBlock` (line 253) — `sum(vouts.ska_value::numeric)::text` per `(block_height, block_time)` for `coin_type = $2`, filtered to mainchain & valid, ordered by height. Per-block values; cumulation happens in Go.
    - `SelectVARCoinSupplyPerBlock` (line 263) — `sum(vouts.value::numeric * 10000000000)::text` (multiplies by 10^10 so VAR values share SKA's 18-decimal scale). **Returns 2 columns** (`block_time, total`) — note the schema mismatch with `LoadSKASupplyForCoin`'s 3-column scan; reachable only if a future caller invokes the loader with `coinType == 0`, which the current handler short-circuits.

- **Location:** `db/dcrpg/pgblockchain.go:1078-1138` (`LoadSKASupplyForCoin`), `:3253-…` (`coinSupply` fetcher for the legacy VAR path).
  - **Data Structures:** `*sql.Rows` → `[]int64 blockHeights, []int64 timestamps, []string blockValues` → `*big.Int runningTotal` → `cache.SKASupplyChartData{Heights, Timestamps, Values: cumulativeValues}`.
  - **Transformations:** Streaming scan; on each row `runningTotal.Add(blockValue)`; the cumulative `runningTotal.String()` is appended to `cumulativeValues`. The completed three slices are written to `charts.SKASupply[coinType]` under no explicit cache lock — the map is mutated directly while `skaSupplyChart` reads it under `charts.mtx.RLock()`. Concurrent first-load on the same `coinType` is racy; subsequent reads are protected.

- **Location:** `db/cache/charts.go`
  - **Data Structures:**
    - VAR path: `ChartData.Blocks zoomSet` (`Height, Time, NewAtoms ChartUints`) + `Days zoomSet`. `ChartUints = []uint64`.
    - SKA path: `ChartData.SKASupply SKASupplyData = map[uint8]SKASupplyChartData{Heights []int64; Timestamps []int64; Values []string}`. Cumulative values are stored, not deltas.
  - **Transformations:**
    - `(*ChartData).Chart` (line 1050) — looks up `chartMakers[chartID]`; if absent and `IsSKASupplyChart(chartID)`, dispatches to `skaSupplyChart(...)` **without consulting or writing the JSON cache** (`cacheChart` is only called for `chartMakers` hits). VAR continues to be cached.
    - `coinSupplyChart` (line 1262) — VAR-only; uses `accumulate(charts.Blocks.NewAtoms)` (line 1269) for `BlockBin` and `accumulate(charts.Days.NewAtoms)` (line 1284) for `DayBin`; emits `{h, supply}` or `{h, t, supply}` via `encode`.
    - `skaSupplyChart` (line 1689) — coinType-0 short-circuits to `coinSupplyChart`. Otherwise reads `charts.SKASupply[coinType]` under `RLock`. For `BlockBin` it returns the per-block series verbatim; for `DayBin` it calls `aggregateSKASupply(timestamps, heights, values)` (line 1814), which buckets by `t / 86400`, keeps the **last** sample per day, and re-emits `(timestamp, height, value)` triples sorted ascending by day. The block-bin response always carries `h`; the day-bin time-axis response also carries `h` per fix `a9db4b3b`.
    - `accumulate` (line 1105) is **VAR-only**: `uint64` accumulator overflows for SKA atoms.

- **Location:** `cmd/dcrdata/internal/api/apiroutes.go:1889-1923` (`ChartTypeData`), router at `cmd/dcrdata/internal/api/apirouter.go:240-243` and middleware at `cmd/dcrdata/internal/middleware/apimiddleware.go:796-815`.
  - **Data Structures:** `c.charts *cache.ChartData`, `c.DataSource.LoadSKASupplyForCoin(...)`.
  - **Transformations:**
    - `r.With(m.CoinSupplyChartTypeCtx).Get("/coin-supply/{charttype}", app.ChartTypeData)` — for `coin-supply/N`, the middleware re-prefixes the URL param, putting `"coin-supply/" + charttype` into `ctxChartType`. The fallthrough `r.With(m.ChartTypeCtx).Get("/{charttype}", app.ChartTypeData)` covers everything else.
    - `ChartTypeData` first checks `IsSKASupplyChart(chartType) && coinType > 0 && !c.charts.SKASupplyExists(coinType)` and triggers `LoadSKASupplyForCoin`. If load fails it logs `Warnf` and continues; downstream `Chart(...)` then returns `"no SKA supply data found"`, which the handler maps to HTTP 503. Pure VAR requests skip the load entirely.

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1911-1943` (`Charts` handler).
  - **Data Structures:** `pageData.HomeInfo.SKACoinSupply []SKACoinSupplyEntry`, page payload `{*CommonPageData, Premine, TargetPoolSize, ActiveSKATypes []uint8}`.
  - **Transformations:** Reads home-info SKA supply under the existing `RLock`, projects active coin types into `ActiveSKATypes`, hands to template. Chart options for SKA exist only for coins with non-zero supply.

- **Location:** `cmd/dcrdata/views/charts.tmpl:40-41`
  - **Transformations:** `<option value="coin-supply/0">Circulation (VAR)</option>` followed by a `range $t := .ActiveSKATypes` loop emitting `<option value="coin-supply/{{$t}}">Circulation (SKA{{$t}})</option>`. The legacy bare `coin-supply` value is **deprecated** in favor of `coin-supply/0`.

- **Location:** `cmd/dcrdata/public/js/controllers/charts_controller.js`
  - **Data Structures:** Dygraph `[x, y, …]` rows. SKA: `this._skaSupplyRaw: string[]` retains the original 18-decimal atom strings; `coinLabel` from `renderCoinType(coinType)` (`'VAR'` / `'SKA{n}'`).
  - **Transformations:**
    - `skaCoinTypeFromChart(name)` (line 60) — parses `coin-supply/{N}` → 0 if not 1..255.
    - `isCoinSupplyChart(name)` (line 70) — collapses both legacy `coin-supply` and `coin-supply/{N}` for the switch dispatch (`switchKey` at line 528).
    - VAR branch (line 688) — `circulationFunc(data)` (line 300) does `supplies[i] * atomsToDCR` (i.e. `*1e-8`), tracks `inflation` via `blockReward(h)` per block, projects 6 months into the future. Legend uses `intComma(y)` + 'VAR'.
    - SKA branch (line 661-687) — multiplies the supply string by `1e-18` via `Number(s) * 1e-18` for the plotted line (precision-lossy, accepted by spec §5), but for the **legend** it pulls `this._skaSupplyRaw[i]` and renders via `formatSkaAtomsExact(raw)` (which calls `splitSkaAtomsNoTrailing` from `ska_helper.js`). The legend therefore preserves all 18 decimals (spec §4); the plotted Y value does not.
    - `legendFormatter` (line 136) — now logs `console.warn` for unknown chart types (added by `ddf17358`'s `default:` case at line 806).

### 4. Cross-Layer Dependencies

- **Two truth sources for "coin supply"**: legacy `Blocks.NewAtoms`/`Days.NewAtoms` (VAR deltas) versus per-coin-type `SKASupply` (SKA cumulative). They are populated by independent code paths and must stay in sync only insofar as the dropdown labels and chart formats are concerned. There is no shared lengthening / append code between them.
- **Cache symmetry break**: `chartMakers` results go through `cacheChart`; `skaSupplyChart` does not. SKA responses are recomputed (and re-marshaled) on every request. JS-level changes that depend on cache invalidation semantics (e.g. cache-busting in `pubsubhub.go`) need explicit handling for SKA charts if they are ever wired.
- **`uint8` ↔ string coupling**: chart ID parsing in Go (`SkaCoinType`) and JS (`skaCoinTypeFromChart`) must agree on `1..255`, the `coin-supply/` prefix, and the integer encoding. They are duplicated implementations.
- **Aggregation differs from the VAR pipeline.** VAR uses `accumulate()` over `[]uint64` once at chart time. SKA uses `*big.Int.Add` over the result set in `LoadSKASupplyForCoin` (per-load, once); the cached `Values` are already cumulative. `accumulate` MUST NOT be called on `SKASupply.Values`.
- **Dropdown composition**: `ActiveSKATypes` is computed from `HomeInfo.SKACoinSupply` at page render. If a coin has zero supply at the moment of render, it is hidden from the dropdown — the `/api/chart/coin-supply/{N}` endpoint, however, still works and returns 503 ("no SKA supply data found") for unknown types.
- **Cumulative+height alignment** (`19a114c1`): block-axis SKA responses always include `h`, and the block-bin frontend uses `i` (not `h`) as the X for block-bin requests but `h[i]` for day-bin (`xFunc` selection at lines 314-319). `t` is omitted on the height-axis path. Misnaming `h` will silently align the chart to the wrong heights.

### 5. Critical Constraints

- **VAR uses `[]uint64`**, accumulated via `accumulate()`; this overflows for SKA atoms (18 decimals). Never reuse `accumulate` or `ChartUints` for SKA.
- **SKA atoms travel as strings end-to-end**: SQL `::text`, Go `[]string` + `*big.Int`, JSON `"supply": []string`, JS `Number(...) * 1e-18` ONLY for the chart line, **never** for the legend. The legend MUST use `splitSkaAtomsNoTrailing` (or equivalent BigInt-safe helper) on the original raw string.
- **The `h` field is contractual** for time-axis SKA responses (regression-fixed in `a9db4b3b`); `19a114c1` made `h` and cumulation invariants. Any new SKA chart endpoint must keep them.
- **`skaSupplyChart` uses `RLock` only** — the loader writes to `charts.SKASupply` without taking a write lock, so concurrent first-loads on the same coin type can race. Acceptable because `LoadSKASupplyForCoin` is idempotent over the same data, but a refactor must preserve this invariant or add a write-lock.
- **Cache absent for SKA**: the JSON byte cache (`cacheChart`) is bypassed for `skaSupplyChart`. A future optimization that flips this on must invalidate per coin type when a new block arrives.
- **VAR-circulation endpoint duality**: `/api/chart/coin-supply` and `/api/chart/coin-supply/0` resolve to the same data via two different code paths. If the legacy `coin-supply` route is ever removed, the `circulationFunc` projection / inflation logic must follow it through.

### 6. Mutation Impact

When modifying chart data structures or pipelines, check ALL of:

- **Direct dependencies:**
  - VAR: `db/cache/charts.go:zoomSet.NewAtoms`, `coinSupplyChart`, `accumulate`.
  - SKA: `db/cache/charts.go:SKASupplyChartData`, `SKASupplyData`, `skaSupplyChart`, `aggregateSKASupply`; `db/dcrpg/pgblockchain.go:LoadSKASupplyForCoin`; SQL `SelectSKACoinSupplyPerBlock` / `SelectVARCoinSupplyPerBlock`.
  - API: `cmd/dcrdata/internal/api/apiroutes.go:ChartTypeData`, `appContext.charts`, `DataSource.LoadSKASupplyForCoin`.
  - Routing: `apirouter.go:240-243` and middleware `CoinSupplyChartTypeCtx` / `ChartTypeCtx`.
- **Indirect dependencies:**
  - `cmd/dcrdata/internal/explorer/explorerroutes.go:Charts` builds `ActiveSKATypes` from `HomeInfo.SKACoinSupply` — any change in how SKA supply is tracked propagates here.
  - `cmd/dcrdata/views/charts.tmpl:40-41` consumes `ActiveSKATypes` to render the dropdown.
  - `charts_controller.js` `skaCoinTypeFromChart`, `isCoinSupplyChart`, the SKA branch of `case 'coin-supply'`, and `formatSkaAtomsExact` (which depends on `splitSkaAtomsNoTrailing`).
  - `cmd/dcrdata/internal/api/noop_ds_test.go:131` mock implements `LoadSKASupplyForCoin` — interface signature change requires mock update.
- **Serialization boundaries:**
  - VAR JSON: `{bin, axis, h, [t,] supply: []uint64}` (numbers).
  - SKA JSON: `{bin, axis, h, [t,] supply: []string}` (strings, 18-decimal atoms, cumulative).
- **Rendering layers:** Dygraphs Y-axis (`Number`), legend formatter (string-precision for SKA), Y-axis label `Coin Supply (${coinLabel})`.
- **Silent failures:**
  - Coercing `data.supply` strings via `parseFloat` / `Number(...)` directly into the legend rather than into the line drops precision past 15 digits.
  - Calling `accumulate()` on already-cumulative SKA data double-cumulates.
  - Forgetting `h` on a SKA time-axis response leaves the frontend with no per-point block alignment, breaking `xFunc(i) = heights[i]` for the day bin.
  - Stale `?zoom=` after switching between VAR and SKA charts — the `charts` controller calls `Zoom.project(...)` across data-range changes (line 901), unlike the address controller; behavior is OK but worth understanding before changing.
- **Hard failures:**
  - `LoadSKASupplyForCoin` with `coinType == 0` would `Scan(&h, &t, &v)` against a 2-column query (`SelectVARCoinSupplyPerBlock`) and panic. Currently unreachable because the API handler short-circuits coinType=0; reachable if a refactor removes that guard.
  - `uint64` overflow if a future change pushes SKA values into `ChartUints`.
  - 503 response for `coin-supply/{N}` when no rows exist — handler returns `"chart data not available"`; chart UI shows the loading spinner indefinitely if not handled in JS.

### 7. Common Pitfalls

- Reusing the VAR pipeline (`Blocks.NewAtoms`, `accumulate`, `*atomsToDCR`) for SKA coins — it overflows, loses precision, and bypasses the per-coin map.
- Adding a new chart format that omits `h` for time-axis SKA responses (regression risk; `a9db4b3b` was a fix for exactly this).
- Computing cumulative supply on the frontend — already done in Go, doing it again in JS produces a double-summed series.
- Mutating `SKASupply[coinType]` from outside `LoadSKASupplyForCoin` without coordinating with `charts.mtx` — the existing loader writes without `Lock`, relying on idempotence.
- Adding a new VAR-supply variant on the legacy `coin-supply` chart ID instead of `coin-supply/0` — the legacy ID is on the deprecation path; add to the prefixed namespace.
- Building a Y-axis label with a hardcoded "DCR" or "VAR" — use `coinLabel = isSKA ? renderCoinType(coinType) : 'VAR'`.
- Wrapping `Number(s) * 1e-18` and using it for the legend — the legend MUST go through `formatSkaAtomsExact` / `splitSkaAtomsNoTrailing`.

### 8. Evidence

- **Chart key constants:** `db/cache/charts.go:29` (`CoinSupply = "coin-supply"`), `:64` (`SKASupplyPrefix = "coin-supply/"`), `:92-109` (`IsSKASupplyChart`, `SkaCoinType`).
- **Cache types:** `db/cache/charts.go:301-308` (`SKASupplyChartData`, `SKASupplyData`); `:461` (`charts.SKASupply` field).
- **Chart entry:** `db/cache/charts.go:1050-1078` (`(*ChartData).Chart`); SKA dispatch at `:1063-1064`.
- **VAR chart maker:** `db/cache/charts.go:1262` (`coinSupplyChart`), accumulator at `:1269` and `:1284`.
- **SKA chart maker:** `db/cache/charts.go:1689-1783` (`skaSupplyChart`, height/time emit, day aggregation).
- **Day aggregator:** `db/cache/charts.go:1812-1855+` (`aggregateSKASupply`).
- **DB loader:** `db/dcrpg/pgblockchain.go:1078-1138` (`LoadSKASupplyForCoin`); `*big.Int` cumulation at `:1117-1133`.
- **SQL:** `db/dcrpg/internal/vinoutstmts.go:130-138` (`SelectCoinSupply`), `:251-259` (`SelectSKACoinSupplyPerBlock`), `:261-269` (`SelectVARCoinSupplyPerBlock`).
- **API handler & routing:** `cmd/dcrdata/internal/api/apiroutes.go:1889-1923` (`ChartTypeData`); `cmd/dcrdata/internal/api/apirouter.go:240-243`; `cmd/dcrdata/internal/middleware/apimiddleware.go:796-815`.
- **Page handler & template:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1911-1943` (`Charts`); `cmd/dcrdata/views/charts.tmpl:40-41` (dropdown).
- **Frontend controller:** `cmd/dcrdata/public/js/controllers/charts_controller.js:60-77` (`skaCoinTypeFromChart`, `isCoinSupplyChart`, `formatSkaAtomsExact`); `:285-293` (`percentStakedFunc`); `:300-350` (`circulationFunc`); `:506-720` (`plotGraph`, with the `coin-supply` switch arm at `:661-720`); `:806-808` (default branch).
- **JS helpers:** `cmd/dcrdata/public/js/helpers/ska_helper.js:16` (`renderCoinType`), `:38` (`splitSkaAtoms`), `:78` (`splitSkaAtomsNoTrailing`).
- **Spec source:** `wiki/specs/chart-ska-coin-supply/spec.md`.
- **Key commits:** `538d5cd1` initial SKA chart support; `3e6d14cf` per-SKA endpoints; `19a114c1` cumulative + height alignment; `a9db4b3b` `h` field on time-axis; `ddf17358` frontend integration & default-case logging; `4af1009f` test/mock additions.

See also:
- /wiki/core/constraints.md (depends-on: C1 numeric precision & bifurcation — applies to the SKA pipeline `string`-end-to-end rule; C2 dual pipeline — VAR delta+`accumulate` vs SKA `*big.Int` cumulation; C7 centralized coin-type label rendering — `renderCoinType` / `coinSymbol`)
- /wiki/code-analysis/address/flow.full.md (shares-pattern-with: TurboQuery URL state, `Zoom` validation; the address chart endpoint reuses the same controller patterns. Note: charts controller calls `Zoom.project` across data-range changes (line 901); the address controller does not — see address/flow.full.md §5.)
