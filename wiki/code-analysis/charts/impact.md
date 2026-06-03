## Risk: `accumulate` / `ChartUints` applied to SKA supply

**Trigger:**
Calling `accumulate(...)` on `SKASupply[coinType].Values`, or pushing SKA atom values into a `ChartUints` (`[]uint64`) field such as `Blocks.NewAtoms` — e.g. a refactor that tries to "unify" the VAR and SKA chart makers.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent.

**Description:**
`accumulate` ([db/cache/charts.go:1148](../../../db/cache/charts.go)) is a `uint64` running sum used only for `ChartUints`. `SKASupply.Values` is already cumulative (`*big.Int` running total computed in `LoadSKASupplyForCoin` at [db/dcrpg/pgblockchain.go:1127-1134](../../../db/dcrpg/pgblockchain.go)), so accumulating again produces a double-summed series with no error. Separately, an 18-decimal SKA atom value overflows `uint64` long before it overflows `*big.Int`, so coercing it into `ChartUints` truncates silently. The chart simply renders wrong numbers; nothing logs. `coinSupplyChart` ([:1349](../../../db/cache/charts.go)) is correct because it accumulates `Blocks.NewAtoms` / `Days.NewAtoms` ([:1356](../../../db/cache/charts.go), [:1371](../../../db/cache/charts.go)) which are VAR `uint64` deltas — that invariant must not be extended to SKA.

---

## Risk: SKA precision lost via `float64` coercion in the legend

**Trigger:**
Rendering the chart legend from `Number(s)` / `parseFloat(s)` of `data.supply` instead of from the raw atom string, or removing the `this._skaSupplyRaw` stash that feeds `formatSkaAtomsExact`.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/mempool/flow.full.md](../mempool/flow.full.md)

**Failure mode:** silent.

**Description:**
The plotted Dygraphs Y value is intentionally `Number(s) * 1e-18` ([cmd/dcrdata/public/js/controllers/charts_controller.js:614](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) and lossy past `float64`'s 53-bit significand — that is accepted by spec §5 for the *line*. The **legend** must stay exact: the controller stores `this._skaSupplyRaw = data.supply` ([:613](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)) and the SKA legend formatter renders `formatSkaAtomsExact(raw)` → `splitSkaAtomsNoTrailing` ([cmd/dcrdata/public/js/helpers/ska_helper.js:78](../../../cmd/dcrdata/public/js/helpers/ska_helper.js)) on the original string ([:628-629](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)). Routing the legend through the float drops the last digits of any SKA value above ~10 — visible only on a manual spot-check of a large supply figure. Same root cause as the mempool float-coercion risk; see [/wiki/code-analysis/mempool/impact.md](../mempool/impact.md) and [/wiki/core/constraints.md#C1](../../core/constraints.md#C1).

---

## Risk: SKA time-axis response missing `h`

**Trigger:**
Adding a new SKA chart format (or modifying `skaSupplyChart` / `aggregateSKASupply`) that emits timestamps without the parallel `h` (block height) array.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent.

**Description:**
The frontend `xFunc` selects `data.h[i]` as the X coordinate for day-bin SKA requests. If a time-axis response omits `h`, `heights[i]` is `undefined`, so points have no block alignment and the chart silently mis-renders (wrong X, or a broken series) — no exception is thrown. `aggregateSKASupply` ([db/cache/charts.go:1911](../../../db/cache/charts.go)) deliberately carries `heights` through the `t / 86400` day bucketing ([:1924](../../../db/cache/charts.go)) for exactly this reason. This was a real regression fixed by commits `a9db4b3b` (added `h` on the time axis) and `19a114c1` (made `h` + cumulation invariants); re-introducing the omission re-introduces the bug.

---

## Risk: `LoadSKASupplyForCoin` invoked with `coinType == 0`

**Trigger:**
Removing or weakening the `coinType > 0` guard in `ChartTypeData` ([cmd/dcrdata/internal/api/apiroutes.go:1901](../../../cmd/dcrdata/internal/api/apiroutes.go)), or calling `LoadSKASupplyForCoin(ctx, charts, 0)` from any new caller.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** loud, but degraded — the request returns HTTP 503 instead of the VAR chart; not a panic.

**Description:**
With `coinType == 0`, `LoadSKASupplyForCoin` runs `SelectVARCoinSupplyPerBlock` ([db/dcrpg/internal/vinoutstmts.go:295](../../../db/dcrpg/internal/vinoutstmts.go)) which selects **2 columns** (`block_time, total`), but the row loop does `rows.Scan(&h, &t, &v)` with **3 targets** ([db/dcrpg/pgblockchain.go:1111](../../../db/dcrpg/pgblockchain.go)). The scan error is caught per-row and `continue`d (logged at `Warnf`, [:1112-1113](../../../db/dcrpg/pgblockchain.go)), so no rows accumulate and the function returns `fmt.Errorf("no data found for coin type %d")` ([:1146](../../../db/dcrpg/pgblockchain.go)). `ChartTypeData` only `Warnf`s on loader error and continues; the subsequent `charts.Chart` call routes `coin-supply/0` through `skaSupplyChart`'s `coinType == 0` short-circuit to `coinSupplyChart` ([db/cache/charts.go:1796-1797](../../../db/cache/charts.go)), so the VAR chart *does* still render — the broken loader path is dead weight, not a crash. This is **not a panic**. The real exposure: a *non-handler* caller of `LoadSKASupplyForCoin(…, 0)` that trusts a nil error would observe an empty `SKASupply[0]`.

---

## Risk: SKA supply map read/write under mismatched locks (latent fatal-error path)

**Trigger:**
A reload of `coin-supply/{N}` (first-load, **or** a stale-height-triggered reload of an already-loaded coin) running concurrently with another request rendering that same coin's chart; or a refactor that assumes `SKASupply` is fully lock-protected.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** silent in the common single-flight case, but a latent Go `concurrent map read and map write` **fatal error** exists under concurrency. (Real defect, not just doc drift — see note.)

**Description:**
`LoadSKASupplyForCoin` now writes `charts.SKASupply[coinType]` under `charts.SKASupplyMtx.Lock()` ([db/dcrpg/pgblockchain.go:1136-1142](../../../db/dcrpg/pgblockchain.go)), and the gate readers `SKASupplyExists` ([db/cache/charts.go:897-908](../../../db/cache/charts.go)) and `SKASupplyHeight` ([:911-919](../../../db/cache/charts.go)) take `SKASupplyMtx.RLock()` — so the gate is consistent with the writer. **But the actual chart reader `skaSupplyChart` reads `charts.SKASupply[coinType]` under `charts.mtx.RLock()` ([db/cache/charts.go:1801-1807](../../../db/cache/charts.go)) — a *different* mutex.** `SKASupplyMtx.Lock()` does not exclude a `charts.mtx`-guarded reader, so a write and a `skaSupplyChart` read of the same map can run concurrently → Go's `concurrent map read and map write` fatal error.

This was latent-but-hard-to-reach while loads happened only on first request (the loading goroutine loads then reads in sequence). It became reachable when the gate gained a **stale-height reload** branch: `ChartTypeData` now reloads when `currHeight - cachedHeight > skaSupplyStaleHeightThreshold` (=10) even though the coin already exists ([cmd/dcrdata/internal/api/apiroutes.go:1888, 1901-1912](../../../cmd/dcrdata/internal/api/apiroutes.go)). So request A can reload (writer, `SKASupplyMtx`) while request B renders the existing series (reader, `charts.mtx`) — two locks, no mutual exclusion.

> Fix direction (real code bug): make `skaSupplyChart` read under `SKASupplyMtx.RLock()` (matching the writer), or unify all `SKASupply` access on one mutex. Separately, the gate stays a non-atomic check-then-act, so two concurrent reloads still both run `LoadSKASupplyForCoin` — now harmless for corruption (each write serialized under `SKASupplyMtx`, identical data, last-writer-wins) but redundant work; a per-coin singleflight would remove it.

---

## Risk: VAR-circulation endpoint duality broken

**Trigger:**
Removing the bare `coin-supply` chart ID / `chartMakers["coin-supply"]` entry while leaving `coin-supply/0` consumers, or vice versa; or adding a new VAR-supply variant under the bare `coin-supply` ID.

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** loud (chart 404/unknown) for whichever surface still references the removed ID.

**Description:**
`coin-supply` (legacy, via `chartMakers` [db/cache/charts.go:1072](../../../db/cache/charts.go) → `coinSupplyChart` → cached) and `coin-supply/0` (via `skaSupplyChart`'s `coinType == 0` short-circuit [:1796-1797](../../../db/cache/charts.go) → `coinSupplyChart`, **not** cached) resolve to the same VAR data through two code paths. The dropdown ([cmd/dcrdata/views/charts.tmpl:40-41](../../../cmd/dcrdata/views/charts.tmpl)) only emits `coin-supply/0`; the bare ID is deprecated but still reachable and still drives the `circulationFunc` projection/inflation logic ([cmd/dcrdata/public/js/controllers/charts_controller.js:294](../../../cmd/dcrdata/public/js/controllers/charts_controller.js), reached via `isCoinSupplyChart` switch-collapse at [:478](../../../cmd/dcrdata/public/js/controllers/charts_controller.js)). Removing one ID without re-pointing the inflation/projection logic and any API/test references to the survivor produces an `UnknownChartErr` 404 on that surface. New VAR variants must go under the `coin-supply/` prefixed namespace, not the bare ID.

---

## Risk: `LoadSKASupplyForCoin` signature change without updating implementers

**Trigger:**
Changing the `LoadSKASupplyForCoin(ctx, *cache.ChartData, uint8) error` signature on the `DataSource` interface ([cmd/dcrdata/internal/api/apiroutes.go:112](../../../cmd/dcrdata/internal/api/apiroutes.go)).

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)

**Failure mode:** loud (compile failure) — but only in the test build until the mock is fixed.

**Description:**
The interface is implemented by the real `(*ChainDB).LoadSKASupplyForCoin` ([db/dcrpg/pgblockchain.go:1087](../../../db/dcrpg/pgblockchain.go)) **and** the test stub `noopDS.LoadSKASupplyForCoin` ([cmd/dcrdata/internal/api/noop_ds_test.go:127](../../../cmd/dcrdata/internal/api/noop_ds_test.go)). A signature change that compiles the production code can still leave the API package's tests un-buildable until the noop mock is updated in lockstep.

---

## Risk: `ActiveSKATypes` projection drift hides coins from the dropdown

**Trigger:**
Changing how `HomeInfo.SKACoinSupply` is tracked, or the `ActiveSKATypes` projection in `(*explorerUI).Charts` ([cmd/dcrdata/internal/explorer/explorerroutes.go:1692-1697](../../../cmd/dcrdata/internal/explorer/explorerroutes.go)).

**Affected flows:**
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md)
- [/wiki/code-analysis/page-rendering/flow.full.md](../page-rendering/flow.full.md)

**Failure mode:** silent (a valid SKA coin is missing from the dropdown).

**Description:**
The dropdown is built from `ActiveSKATypes`, projected from `pageData.HomeInfo.SKACoinSupply` at page render and consumed by [cmd/dcrdata/views/charts.tmpl:40-41](../../../cmd/dcrdata/views/charts.tmpl). A coin with zero supply at render time is omitted from the dropdown — but the `/api/chart/coin-supply/{N}` endpoint still works for it (returning HTTP 503 only when no rows exist). So a projection bug doesn't error; it just makes a chart unreachable through the UI while remaining reachable by direct API call, which masks the regression in manual testing. Reads `pageData.HomeInfo.SKACoinSupply` under the shared page-state RLock — see [/wiki/code-analysis/page-rendering/impact.md](../page-rendering/impact.md).

---

See also:
- [/wiki/code-analysis/charts/flow.full.md](flow.full.md) (derived-from: §5 critical constraints, §6 mutation impact, §7 common pitfalls)
- [/wiki/code-analysis/charts/patterns.md](patterns.md) (shares-pattern-with: the patterns whose constraints these risks violate)
- [/wiki/core/constraints.md#C1](../../core/constraints.md#C1) (depends-on: SKA `float64` vs `big.Int`/string precision)
- [/wiki/code-analysis/mempool/impact.md](../mempool/impact.md) (shares-pattern-with: SKA precision lost via `float64` coercion — same root cause across domains)
- [/wiki/code-analysis/page-rendering/impact.md](../page-rendering/impact.md) (depends-on: shared `pageData.HomeInfo` page-state access)
