# /ticketpool — Full Data-Flow Trace

## Section 1 — Overview

`/ticketpool` is a **no-data HTML shell + three live data channels**. The Go handler returns only the template + `commonData`; every data series rendered by ChartPanel/uPlot (purchase-time histogram, price histogram, sstxcommitment-output donut) reaches the page via:

1. HTTP `GET /api/ticketpool/charts` on first connect (full payload).
2. HTTP `GET /api/ticketpool/bydate/{tp}` on **Bars** button change (time chart only, re-binned).
3. WebSocket `getticketpooldata <bars>` request fired by the JS on every `newblock` signal → `getticketpooldataResp` (full payload).

All three sources funnel through one DB helper: `ChainDB.TicketPoolVisualization(ctx, interval)`. Results are memoized in a **process-global, height-keyed, lazy-refresh cache** (`ticketPoolGraphsCache`) gated by per-interval `trylock.Mutex` (stale-while-revalidate).

Ticket data is **VAR-only by chain design** (PoS staking instrument denominated in VAR; tickets pay out per [/wiki/core/staking-rewards.md](../../core/staking-rewards.md) §2–3). `PoolTicketsData.Price` is `[]float64`, safe under C1.

## Section 2 — End-to-End Data Flow

```
Postgres `tickets` JOIN `transactions`
   │  retrieveTicketsByDate / retrieveTicketByPrice / retrieveTicketsGroupedByType
   ▼
ChainDB.ticketPoolVisualization  →  ticketPoolGraphsCache (per-interval, height-keyed)
   │
   ├─ HTTP path:
   │     appContext.getTicketPoolCharts   ← /api/ticketpool/charts
   │     appContext.getTicketPoolByDate   ← /api/ticketpool/bydate/{tp}   (TicketPoolCtx middleware)
   │        + DataSource.GetMempoolPriceCountTime()  →  apitypes.PriceCountTime
   │     ▼
   │     apitypes.TicketPoolChartsData (JSON)
   │
   └─ WS path:
         explorerUI.RootWebsocket switch "getticketpooldata"
            → (*explorerUI).buildTicketPoolChartsData
               + DataSource.GetMempoolPriceCountTime()  →  apitypes.PriceCountTime  ← same source as REST
         ▼
         apitypes.TicketPoolChartsData (JSON, event "getticketpooldataResp")

Browser:
  views/ticketpool.tmpl  (static shell, data-controller="ticketpool")
  public/js/controllers/ticketpool_controller.js
     initialize()   → sets this.zoom/bars/mempool state; no async chart setup (synchronous)
     connect()      → createChartPanel(#tickets-by-purchase-date, {rangerEl:purchasesRangerTarget,...})
                    → createChartPanel(#tickets-by-purchase-price, {rangerEl:priceRangerTarget,...})
                    → ws.registerEvtHandler('newblock')         → ws.send('getticketpooldata', this.bars)
                    → ws.registerEvtHandler('getticketpooldataResp') → processData(JSON.parse(evt))
                    → fetchAll() → GET /api/ticketpool/charts
     processData    → renderOrUpdatePurchases(timeData, mempool) → purchasesPanel.render(def, data, settings, opts)
                    → renderOrUpdatePrice(priceData, mempool) → pricePanel.render(def, data, settings, opts)
     onBarsChange   → GET /api/ticketpool/bydate/{bars} → purchasesDefFor(bars) → purchasesPanel.render(newDef, data, {}, opts)
     onZoom async   → if zoom finer than bars: auto-coarsen bars + refetch + purchasesPanel.render(def, data, {}, {range})
                    → else: computeZoomWindow(zoom, xs) → purchasesPanel.setXRange(lo, hi)
```

## Section 3 — Per-Layer Breakdown

### 3.1 Postgres / SQL

**Location:** [db/dcrpg/internal/stakestmts.go:106-122](../../../db/dcrpg/internal/stakestmts.go#L106-L122), [db/dcrpg/internal/stakestmts.go:509-512](../../../db/dcrpg/internal/stakestmts.go#L509-L512), [db/dcrpg/internal/txstmts.go:165-170](../../../db/dcrpg/internal/txstmts.go#L165-L170).

Three statements, all filtering `pool_status = 0 AND tickets.is_mainchain = TRUE`:

- `SelectTicketsByPrice` — `SELECT price::NUMERIC, SUM(... block_height >= $1) immature, SUM(... < $1) live ... GROUP BY price::NUMERIC ORDER BY price::NUMERIC`.
- `selectTicketsByPurchaseDate` (templated via `MakeSelectTicketsByPurchaseDate` → `formatGroupingQuery(... "transactions.block_time")`) — same shape, grouping is a Postgres `date_trunc` expression substituted via `%s`. The grouping string comes from `dbtypes.TimeBasedGrouping.String()` (`"all"|"year"|"month"|"week"|"day"`). `formatGroupingQuery` is the same family used by [/wiki/code-analysis/time-based-blocks/patterns.md](../time-based-blocks/patterns.md).
- `SelectTicketsByType` — `SELECT DISTINCT num_vout, COUNT(*) ... GROUP BY num_vout`. Maps directly to the donut "Distribution of Tickets by Reward Outputs".

Maturity boundary is computed in Go, not SQL: `bestBlock - chainParams.TicketMaturity` ([db/dcrpg/pgblockchain.go:1785-1790](../../../db/dcrpg/pgblockchain.go#L1785-L1790)). Postgres only knows the parameter `$1`.

### 3.2 Scan / shaping into `dbtypes.PoolTicketsData`

**Location:** [db/dcrpg/queries.go:1106-1200](../../../db/dcrpg/queries.go#L1106-L1200).

`dbtypes.PoolTicketsData` ([db/dbtypes/types.go:2120-2128](../../../db/dbtypes/types.go#L2120-L2128)) is a flat-arrays-of-equal-length struct (`Time`, `Price`, `Mempool`, `Immature`, `Live`, `Outputs`, `Count`). One struct, three different population shapes:

| Producer | Fields populated | Notes |
|---|---|---|
| `retrieveTicketsByDate` | `Time`, `Immature`, `Live`, `Price` | `Price[i] = toCoin(uint64(SUM(price)*1e8) / (live+immature))` — average per group as float64 VAR. |
| `retrieveTicketByPrice` | `Immature`, `Live`, `Price` | `Price[i]` scanned directly from `price::NUMERIC` into Go `float64`. |
| `retrieveTicketsGroupedByType` | `Outputs`, `Count` | `Outputs[i] = (num_vout - 1) / 2` (sstxcommitment count). |

Critical detail: `retrieveTicketsByDate` does `uint64(price*1e8) / (live+immature)` — the `*1e8` round-trip via `float64` is a VAR-only path; safe per C1. **Do not extend this routine to SKA atoms** without rewriting to `*big.Int`.

`toCoin(amt) = float64(amt)/1e8` ([db/dcrpg/queries.go:4400-4402](../../../db/dcrpg/queries.go#L4400-L4402)) — generic over `int64|uint64`, VAR-only.

Note: `db/dcrpg/queries.go` also contains `retrieveMissedVotes` / `appendMissedVotesPerWindow` (lines 3605+) which were updated for reorg cursor handling — those functions are **not part of the ticketpool flow** and do not affect this trace.

### 3.3 Cache layer

**Location:** [db/dcrpg/pgblockchain.go:74-132](../../../db/dcrpg/pgblockchain.go#L74-L132), [db/dcrpg/pgblockchain.go:1830-1943](../../../db/dcrpg/pgblockchain.go#L1830-L1943).

- `ticketPoolGraphsCache` is a **package-level `var`** — process-global, not per-`ChainDB`. Single-instance binary today; flag for future.
- Per-interval maps: `Height[interval]`, `TimeGraphCache[interval]`, `PriceGraphCache[interval]`, `DonutGraphCache[interval]`.
- Freshness: `isStale = (cache.Height[interval] != pgb.Height())`. No proactive invalidation; cache is refreshed lazily on first request after the block tip changes.
- Concurrency: a `RWMutex` guards the cache maps; **`pgb.tpUpdatePermission[interval]` (`trylock.Mutex`)** gates which goroutine becomes the updater. A caller that finds stale data and *cannot* `TryLock` returns the stale copy immediately (does not block); a caller that finds *no* data blocks on the same lock until the in-flight updater finishes.
- After refresh, the inner `ticketPoolVisualization` ([db/dcrpg/pgblockchain.go:1899-1943](../../../db/dcrpg/pgblockchain.go#L1899-L1943)) re-checks `pgb.Height()` after the three SQL queries and **retries from scratch if the height changed mid-query** to keep `(timeChart, priceChart, donutChart)` mutually consistent at a single height.

### 3.4 HTTP API (REST)

**Location:** [cmd/dcrdata/internal/api/apirouter.go:245-249](../../../cmd/dcrdata/internal/api/apirouter.go#L245-L249), [cmd/dcrdata/internal/api/apiroutes.go:1257-1325](../../../cmd/dcrdata/internal/api/apiroutes.go#L1257-L1325).

Routes:

- `GET /api/ticketpool/charts` → `getTicketPoolCharts` → `TicketPoolVisualization(ctx, AllGrouping)` **always**. Wraps in `apitypes.TicketPoolChartsData` and tacks on `Mempool: GetMempoolPriceCountTime()`.
- `GET /api/ticketpool/bydate/{tp}` → `TicketPoolCtx` middleware ([cmd/dcrdata/internal/middleware/apimiddleware.go:691-699](../../../cmd/dcrdata/internal/middleware/apimiddleware.go#L691-L699)) stuffs `{tp}` into the request context → `getTicketPoolByDate` reads it via `m.GetTpCtx(r)`, defaults to `"day"` when empty, runs `TimeGroupingFromStr`, returns **only `TimeChart` + `height`** (price/donut discarded). `UnknownGrouping` → 422.
- `GET /api/ticketpool/` → routed to `getTicketPoolByDate` with no `{tp}` → defaults to `"day"`.

The wire shape for the full payload is `apitypes.TicketPoolChartsData`:

```go
// api/types/apitypes.go:933-939
type TicketPoolChartsData struct {
    ChartHeight  uint64                   `json:"height"`
    TimeChart    *dbtypes.PoolTicketsData `json:"time_chart"`
    PriceChart   *dbtypes.PoolTicketsData `json:"price_chart"`
    OutputsChart *dbtypes.PoolTicketsData `json:"outputs_chart"`
    Mempool      *PriceCountTime          `json:"mempool"`
}
```

The `/bydate/{tp}` response uses an anonymous struct `{ Height int64; TimeChart *PoolTicketsData }` ([cmd/dcrdata/internal/api/apiroutes.go:1316-1322](../../../cmd/dcrdata/internal/api/apiroutes.go#L1316-L1322)). The `bydate` response carries **no** `mempool` field. The JS `onBarsChange` guards with `if ('mempool' in response)` before updating `this.mempool`, so the cached mempool from the last full-payload response is used for overlay rendering.

### 3.5 Mempool overlay (single source, both transports)

Both REST and WS read the mempool overlay from the same DataSource helper, so the same `*apitypes.PriceCountTime` is emitted on either transport for a given chain/mempool state.

REST `getTicketPoolCharts` ([cmd/dcrdata/internal/api/apiroutes.go:1274](../../../cmd/dcrdata/internal/api/apiroutes.go#L1274)):

```go
mp := c.DataSource.GetMempoolPriceCountTime()
```

WS `getticketpooldata` ([cmd/dcrdata/internal/explorer/websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go), inside `buildTicketPoolChartsData`):

```go
Mempool: exp.dataSource.GetMempoolPriceCountTime(),
```

Both calls dispatch to `*ChainDB.GetMempoolPriceCountTime` ([db/dcrpg/pgblockchain.go:6414](../../../db/dcrpg/pgblockchain.go#L6414)) → `DataCache.GetTicketPriceCountTime` ([mempool/mempoolcache.go:197-218](../../../mempool/mempoolcache.go#L197-L218)):

```go
return &apitypes.PriceCountTime{
    Price: dcrutil.Amount(c.stakeDiff).ToCoin() + feeAvg,  // stakeDiff + rolling avg of last N fees
    Count: numFees,
    Time:  dbtypes.NewTimeDef(c.timestamp),
}
```

`Price` is therefore always the **predicted next-block ticket price** (`stakeDiff + feeAvg`) regardless of which transport delivered it; `Count` is the number of fees averaged into the cache; `Time` is the cache update timestamp. The cache helper locks its own state, so neither caller takes `MempoolInventory().RLock()`.

`c.stakeDiff` is written by `StoreMPData` ([mempool/mempoolcache.go:46-76](../../../mempool/mempoolcache.go#L46-L76)). As of the current codebase, `StoreMPData` uses fail-soft semantics: if `dcrutil.NewAmount(stakeData.StakeDiff)` returns an error (invalid stake diff value from the node), it logs a warning and **leaves `c.stakeDiff` at its previous value** rather than resetting it to zero. Consequently, the mempool overlay `Price` on the ticketpool chart continues to show the last valid tick-diff estimate rather than collapsing to `feeAvg` alone on a transient bad value.

> **History note.** Pre-PR #290 the WS branch reimplemented this overlay manually as `mp.Price = inv.Tickets[0].TotalOut` / `mp.Count = len(inv.Tickets)` / `mp.Time = NewTimeDefFromUNIX(inv.Tickets[0].Time)`. Same JSON shape, different semantics: the `/ticketpool` chart dot visibly jumped between the initial HTTP load (REST) and every `newblock` refresh (WS). Issue [#290](https://github.com/monetarium/monetarium-explorer/issues/290) collapsed both paths onto `DataSource.GetMempoolPriceCountTime` via the new package-local helper `(*explorerUI).buildTicketPoolChartsData`.

### 3.6 WebSocket request/response path

**Location:** [cmd/dcrdata/internal/explorer/websockethandlers.go:169-221](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L169-L221).

The explorer `/ws` handler is a request/response RPC-over-WebSocket switch (same shape as `decodetx` / `getmempooltxs` — see [/wiki/code-analysis/decodetx/patterns.md](../decodetx/patterns.md) P1). The client sends `WebSocketMessage{EventId: "getticketpooldata", Message: "<interval-string>"}`; the server replies with `EventId: "getticketpooldataResp"` (suffix appended at the bottom of the `select`: `webData.EventId = msg.EventId + "Resp"`). The case body delegates the payload assembly to `(*explorerUI).buildTicketPoolChartsData`, which mirrors the REST `getTicketPoolCharts` handler so both transports emit the same `TicketPoolChartsData` (including `Mempool`) for a given chain/mempool state.

The `newblock` push on the *server* (`sigNewBlock`) does **not** deliver ticketpool data — it delivers a `WebsocketBlock{Block, Extra}` ([cmd/dcrdata/internal/explorer/websockethandlers.go:271-282](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L271-L282)). The *client* JS listens for the `newblock` event and reactively re-requests ticketpool data via `ws.send('getticketpooldata', this.bars)`. So `newblock` is a refresh **trigger**, not a payload carrier — and the server has zero knowledge of which `bars` setting each client holds.

### 3.7 Server-side page handler

**Location:** [cmd/dcrdata/internal/explorer/explorerroutes.go:811-824](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L811-L824).

```go
func (exp *explorerUI) Ticketpool(w http.ResponseWriter, r *http.Request) {
    str, err := exp.templates.exec("ticketpool", exp.commonData(r))
    // ...
}
```

A no-compute handler — same "form-shell" shape as `/decodetx` ([/wiki/code-analysis/decodetx/patterns.md](../decodetx/patterns.md) P1) and `/parameters` ([/wiki/code-analysis/parameters/patterns.md](../parameters/patterns.md)). The only data injected at render time is `*CommonPageData` (see [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md)).

### 3.8 Template

**Location:** [cmd/dcrdata/views/ticketpool.tmpl](../../../cmd/dcrdata/views/ticketpool.tmpl).

A static shell with `data-controller="ticketpool"`. Key structural changes from the Dygraphs version:

- **Button controls** migrated from `<input type="button" name="all">` with `.btn-active` class to Bootstrap nav-pill `<li class="nav-item nav-link" data-option="all">` with `.active` class. The JS controller reads `e.currentTarget` and `target.dataset.option` (not `e.target.name`) for the selected value.
- **Ranger divs** added below each chart: `<div data-ticketpool-target="purchasesRanger" class="tp-chart-ranger">` and `priceRanger`. These are the uPlot overview strips created by ChartPanel.
- **Chart title divs** placed above each `chart-wrapper`: `<div class="dygraph-label dygraph-title mb-1">...</div>` (class name is legacy dygraph labeling, now used for styling the title regardless of chart engine).
- Three chart mount points: `#tickets-by-purchase-date` (purchases), `#tickets-by-purchase-price` (price), `data-ticketpool-target="outputs"` (donut table — unchanged, still DOM-built).
- Carries **no server-rendered data series whatsoever**.

### 3.9 JS controller

**Location:** [cmd/dcrdata/public/js/controllers/ticketpool_controller.js](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js).

Imports (current):
- `createChartPanel` from `../helpers/chart_panel` — the uPlot-based chart abstraction
- `humanize` from `../helpers/humanize_helper` — for x-axis date formatting
- `{ ticketpoolPurchases }` from `../charts/definitions/ticketpool_purchases` — bar-mode-aware factory
- `{ ticketpoolPrice }` from `../charts/definitions/ticketpool_price` — static price chart def
- `{ timesToEpoch, computeZoomWindow, alignViewportToData }` from `../helpers/ticketpool_zoom` — pure zoom math

**Static targets:** `['zoom', 'bars', 'age', 'wrapper', 'outputs', 'purchasesRanger', 'priceRanger']`.

**Lifecycle:**

- `initialize()` — **synchronous** (no lazy import). Sets `this.mempool = false`, `this.tipHeight = 0`, `this.zoom = 'all'`, `this.bars = 'all'`, `this._purchasesDefCache = {}`. No chart construction here.
- `connect()` — creates `this.purchasesPanel` via `createChartPanel(#tickets-by-purchase-date, { xTime: true, rangerEl: this.purchasesRangerTarget, formatX, rangerData, rangerDef, rangerSeedOnce: true })` and `this.pricePanel` via `createChartPanel(#tickets-by-purchase-price, { xTime: false, rangerEl: this.priceRangerTarget, formatX, rangerData, rangerDef })`. Registers WS handlers, then calls `fetchAll()`.
- `fetchAll()` → `requestJSON('/api/ticketpool/charts')` → `processData(chartsResponse)`.
- `processData(data)` — branches on present keys. Mempool overlay is merged into the time chart only when `this.tipHeight === data.height && this.bars === 'all'` (line 101). Delegates to `renderOrUpdatePurchases` and `renderOrUpdatePrice` rather than calling Dygraphs directly.
- `purchasesDefFor(barMode)` — **memoizes** the def per bar mode. Stable ref → ChartPanel does a cheap `setData` call; new bar mode → new def ref → ChartPanel rebuilds with correct `granularBarPaths` geometry. This is a deliberate contract with ChartPanel.
- `renderOrUpdatePurchases(timeData, mempool)` — computes an expand-only x-range (data extent unioned with current viewport via `alignViewportToData`; right edge padded by 1% or 1h to avoid clipping the mempool point). Calls `this.purchasesPanel.render(def, timeData, { mempool }, { range })`.
- `renderOrUpdatePrice(priceData, mempool)` — same range-preservation logic for the price (x-axis) viewport.
- `onZoom(e) async` — reads `target.dataset.option`. **Auto-coarsening:** if the zoom preset is finer than current bar aggregation (e.g. zooming to `day` with `bars=mo`), it automatically coarsens bars, refetches `/bydate/{newBars}`, anchors the zoom window at the ranger's far-right edge, and calls `purchasesPanel.render`. Otherwise (no refetch needed), derives window via `computeZoomWindow(zoom, xs)` from the ranger data and calls `purchasesPanel.setXRange(lo, hi)`.
- `onBarsChange(e) async` — reads `target.dataset.option`. Fetches `/bydate/{bars}`. Guards `if ('mempool' in response)` before updating `this.mempool` (bydate response has no `mempool` key; this guard is forward-safe). Computes an expand-only range, then calls `purchasesPanel.render(purchasesDefFor(this.bars), response.time_chart, mempoolSettings, opts)`. A new `bars` value produces a new def from the cache → ChartPanel rebuild.
- `disconnect()` — unsubscribes WS handlers, destroys both panels.

**populateOutputs** (lines 10–25): builds the donut table via `innerHTML` from numeric values pre-coerced with `parseInt()`. Unchanged from previous version. C6 exception still applies.

### 3.10 Chart definitions (widened)

**Location:** [cmd/dcrdata/public/js/charts/definitions/ticketpool_purchases.js](../../../cmd/dcrdata/public/js/charts/definitions/ticketpool_purchases.js), [cmd/dcrdata/public/js/charts/definitions/ticketpool_price.js](../../../cmd/dcrdata/public/js/charts/definitions/ticketpool_price.js).

Both definitions follow the standard ChartPanel def schema: `{ name, label, axes[], series[], toColumns(data, settings), formatValue(seriesIdx, datum) }`.

**`ticketpoolPurchases(barMode)`** — factory (not a static object):
- `toColumns(data, settings)` — converts `{time[], mempool[], immature[], live[], price[]}` → column arrays for uPlot. ISO time strings → epoch seconds. For bucketed modes (`day|wk|mo`), appends a "period-end" boundary point **before** any mempool point (so the step line extends to the bucket end without using the mempool timestamp as an anchor). If `settings.mempool`, appends the mempool row with a +1s offset guard (avoids exact-timestamp collision with last historical point).
- `granularBarPaths(UPlot, s, barMode)` — bar path function: bucketed modes use `align:1, size:[1]` (full-width left-aligned); blocks/fallback uses centered capped bars with configurable size/align from the series def.
- `formatValue(seriesIdx, datum)` — series 3 (Ticket Value) formats as `N.NNNN VAR`; series 4 (hidden point series) returns `''`; others format as integers.

**`ticketpoolPrice`** — static def:
- `toColumns(data, settings)` — converts `{price[], immature[], live[]}`. Mempool entry inserted sorted by price (binary search for insertion point, `Array.splice` for new price point, or augments existing bucket's mempool count if price already present). Returns `[prices, mem, imm, live, live, pts]` (6 columns; `live` doubled for y2-axis placeholder).
- Series 3 is a hidden y2-axis placeholder (needed to satisfy ChartPanel's dual-axis layout contract).

### 3.11 Zoom helpers (widened)

**Location:** [cmd/dcrdata/public/js/helpers/ticketpool_zoom.js](../../../cmd/dcrdata/public/js/helpers/ticketpool_zoom.js).

Pure math functions, no DOM or uPlot dependency — designed for unit-testability in isolation:

- `timesToEpoch(times)` — ISO string array → epoch-seconds `Float64Array`.
- `computeZoomWindow(val, xs)` — for `day|wk|mo` presets, anchors at `xs[last]` and spans backward by `PRESET_SECONDS[val]`; returns full range if data is narrower than the preset, or if `val='all'`. Internal `clampWindow` prevents the lo boundary from going before the first data point.
- `alignViewportToData(prevMin, prevMax, dataMin, dataMax)` — returns `[max(prevMin,dataMin), max(prevMax,dataMax)]` — an expand-only union of the saved viewport and the new data extent.

## Section 4 — Cross-Layer Dependencies

| From | To | Coupling | Brittleness |
|---|---|---|---|
| JS `bars` button `data-option` value | `dbtypes.TimeGroupingFromStr` | Strings `"all"/"day"/"wk"/"mo"` must match the switch in [db/dbtypes/types.go:842-857](../../../db/dbtypes/types.go#L842-L857). | Adding a new button on the JS side without extending the Go switch silently falls into `UnknownGrouping` → 422 (REST) / WS error. |
| JS `zoom` button `data-option` value | `onZoom` auto-coarsen logic | `barsOrder` / `zoomOrder` maps in `onZoom` determine coarsening direction. | Adding a new zoom level without extending both maps in the controller breaks the coarsen guard silently. |
| `dbtypes.PoolTicketsData` field order | three different SQL `rows.Scan` calls | Positional, not named — `Scan(&timestamp, &price, &immature, &live)` vs `Scan(&price, &immature, &live)` vs `Scan(&output, &count)`. | Reordering the columns in a `SELECT` silently swaps fields. Same class of risk as time-based-blocks ([/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md)). |
| JS `processData` | `apitypes.TicketPoolChartsData` JSON tags | `data.time_chart`, `data.price_chart`, `data.outputs_chart`, `data.mempool`, `data.height` — read by name from the parsed JSON. | Renaming a JSON tag on the Go side without updating the JS reader silently drops a series. No type check. |
| `toColumns(data, settings)` in chart defs | `PoolTicketsData` field names | `data.time`, `data.immature`, `data.live`, `data.price` are accessed by name in both def files. | Renaming `PoolTicketsData` JSON field names breaks the def's `toColumns` silently. |
| WS `getticketpooldata` `EventId` literal | `webData.EventId = msg.EventId + "Resp"` ([websockethandlers.go:231](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L231)) | JS hard-codes `'getticketpooldata'` and `'getticketpooldataResp'`. | Renaming the event on either side silently breaks live refresh — JS continues to render only the initial HTTP fetch. (Same R1-class drift as [/wiki/code-analysis/decodetx/impact.md](../decodetx/impact.md).) |
| `ticketpoolPurchases(barMode)` def-cache | `purchasesPanel.render()` | Stable def ref → ChartPanel setData; new def ref → full rebuild. The `purchasesDefFor` memoization exploits object-identity. | Bypassing the cache (returning a new object on every call) causes ChartPanel to rebuild on every data update, discarding the zoom viewport. Not a silent correctness bug, but a visible UX regression. |
| `purchasesRanger` / `priceRanger` targets | `createChartPanel(..., { rangerEl })` | Template must declare both targets for the ranger strips to mount. | Removing a `data-ticketpool-target` attribute from the template silently leaves the ranger strip container empty (no error). |
| `ticketPoolGraphsCache` (package `var`) | `ChainDB` instance | Process-global, not per-instance. | A second `ChainDB` in the same binary (testing, multi-network) would silently share cache and serve cross-instance data. Single-instance today. |

## Section 5 — Critical Constraints

- **C1 (precision):** Tickets are a VAR-only PoS instrument (see [/wiki/core/staking-rewards.md](../../core/staking-rewards.md) §2 — ticket price, returned cost, and 1/5-of-50% subsidy share are all VAR-denominated). `PoolTicketsData.Price []float64`, `MempoolTx.TotalOut float64`, `toCoin() float64`, uPlot tooltip formatValue uses `toLocaleString(maximumFractionDigits:8)` — the entire pipeline is float64 VAR end-to-end. **This is intentional; safe under C1 *only* because tickets are VAR.** Any attempt to introduce a SKA-denominated ticket variant must rewrite the struct away from `[]float64` to `[]string` and replace `toCoin`/`*1e8` with `*big.Int` arithmetic.
- **C2 (dual pipeline mutation):** Two collection paths feed the page — DB (Postgres `tickets` JOIN) and live mempool (`DataCache` via `GetMempoolPriceCountTime`). Any change to the ticket-row population (e.g. adding a new column to the SELECT for filtering) must update three `Scan` sites *and* the cache invariant that all three sub-charts share one `(height, interval)` key. The mempool overlay now has a single producer shared by REST and WS (§3.5); historically it was two divergent formulas (resolved in [#290](https://github.com/monetarium/monetarium-explorer/issues/290)).
- **C3 (template+WS parity):** The HTML template carries **no** chart data — there is no SSR variant to keep in parity. The two non-static data paths (REST and WS) carry the **same struct** *and* (after [#290](https://github.com/monetarium/monetarium-explorer/issues/290)) the same producer for every field, so they cannot drift on the mempool overlay. Adding new top-level fields to `TicketPoolChartsData` still requires updating both producer sites — see Section 6.
- **C6 (template cloning):** `populateOutputs` builds the donut table via `innerHTML` concatenation, not `<template>` cloning. Tolerated because all interpolated values are pre-coerced with `parseInt()` to integers. **Do not extend the function with any user-derived string** without converting to a `<template>` clone.
- **C7 (coin-symbol):** Both chart def axis labels are VAR-only hardcoded: `'A.v.g. Tickets Value (VAR)'` (purchases y2-axis in `ticketpool_purchases.js:62`) and `'Ticket Price (VAR)'` (price x-axis label in template). These are static VAR-only labels, so the centralized `renderCoinType`/`coinSymbol` helpers do not apply.

## Section 6 — Mutation Impact

When modifying `/ticketpool`, check:

| Mutation | Direct deps | Indirect deps | Failure mode |
|---|---|---|---|
| Add a column to `PoolTicketsData` | All three Scan sites; both Go consumers (REST + WS); `toColumns` in both chart defs; JS `processData` | Cache struct (per-interval map values are the same struct → automatic) | **Loud** if Go consumer dereferences a nil slice; **silent** if `toColumns` just ignores the unknown key. |
| Reorder columns in any of the three SQL statements | The matching `rows.Scan` call | Cache shape | **Silent** — values swap with no error (positional Scan). |
| Add a new time-grouping (e.g. `"hr"`) | `dbtypes.TimeBasedGroupings` map, `TimeGroupingFromStr` switch, `NumIntervals` constant, `formatGroupingQuery` regex; JS bar button HTML, controller `barsOrder` / `zoomOrder` maps in `onZoom`; `purchasesDefFor` cache (new key is handled automatically) | `tpUpdatePermission` map built from the same enum → new entries get a lock automatically | **Loud**: missing enum entry → `UnknownGrouping` → 422 on REST, "Error: unknown interval" on WS. **Silent**: missing JS button / missing `barsOrder` entry just means the user can't pick it / auto-coarsen guard breaks. |
| Add a new chart series (e.g. revoked-ticket buckets) | `PoolTicketsData` arrays; new SQL; new Scan; new cache field; **both** REST and WS payloads; update `toColumns` in the def to add the column; update `series[]` in the def; update `formatValue` | Bars-only `/bydate` response intentionally drops `price_chart` and `outputs_chart` — decide if the new field belongs there too | **Silent** drift between REST/WS if only one producer is updated (C3-shaped). |
| Change `MempoolPriceCountTime.Price` semantics | `mempoolcache.GetTicketPriceCountTime` | Both REST and WS read this through `DataSource.GetMempoolPriceCountTime` (since [#290](https://github.com/monetarium/monetarium-explorer/issues/290)), so a single edit reaches both consumers. | **Loud** if the return type changes (compile error in both consumers); **silent** if only the numeric formula changes. |
| Change button value strings (`data-option`) | Template `data-option="..."` and Go `TimeGroupingFromStr` switch | `barsOrder` / `zoomOrder` in `onZoom`; `purchasesDefFor` cache key | **Silent** on the Go side (returns `UnknownGrouping` → 422); **visible** in console if `onZoom`'s coarsen logic misroutes. |
| Bypass `purchasesDefFor` memoization | ChartPanel rebuilds on every data update | Ranger range is reset on rebuild | **UX regression** (viewport jump) but not a data correctness bug. |
| Rename the WS event | Both string literals in JS (`'getticketpooldata'`, `'getticketpooldataResp'`) and the server switch case + suffix append | JS `disconnect()` deregister call uses the same string | **Silent** — `newblock` refresh loop silently breaks; initial HTTP load still works. |
| Remove `purchasesRanger` or `priceRanger` target from template | `createChartPanel` receives no `rangerEl` | Ranger strip is not rendered | **Silent** — ChartPanel gracefully skips the ranger if `rangerEl` is absent. Zoom-preset buttons may still work but anchor from chart data (not block-level ranger data). |
| Promote tickets to SKA | Every `float64` in this trace becomes `*big.Int` or `string`; `maximumFractionDigits:8` becomes invalid; `*1e8` round-trip in `retrieveTicketsByDate` becomes a precision-loss site; `toColumns` needs `BigInt` parsing | This is effectively a full rewrite of the pipeline; not a minor change | **Silent corruption** — exceeds float64 significand; see [/wiki/code-analysis/charts/impact.md](../charts/impact.md) for the analogous SKA-through-float trap. |

## Section 7 — Common Pitfalls

- **Assuming `/ticketpool` is push-driven.** It is not. The server's `sigNewBlock` carries `WebsocketBlock`, not ticket data. The JS controller *re-requests* ticket data on every `newblock` — every connected client triggers a fresh `TicketPoolVisualization(ctx, <their-bars>)` per block. The cache absorbs the duplication (single updater wins via `TryLock`); without the cache, this would be N concurrent DB hits per block.
- **Editing one of the three Scan calls and forgetting the others.** All three populate the same `PoolTicketsData` struct, but each fills a different field subset. A new SELECT column on one branch leaves zero values in the slices populated by the other two — and uPlot renders zero as a real value, not a gap.
- **Adding SKA support in the wrong place.** Tickets are VAR by chain design. The temptation to "make this multi-coin" would corrupt SKA precision (C1) and produce nonsense data — tickets do not exist for SKA coins.
- **Forgetting that `/api/ticketpool/bydate/{tp}` returns no `mempool` field.** The controller's `onBarsChange` guards with `if ('mempool' in response)` — this is always false for bydate. The cached `this.mempool` (from the last full-payload response) is used. A future refactor that unifies the two REST handlers must either backfill `Mempool` or leave this guard in place.
- **Creating a new `ticketpoolPurchases(barMode)` def on every render call instead of memoizing.** ChartPanel uses object identity to decide setData vs. rebuild. A fresh def object on every call (even with the same barMode) causes a rebuild with every `processData` invocation, resetting the viewport. Always route through `purchasesDefFor(barMode)`.
- **Adding a new zoom or bars option without updating `barsOrder`/`zoomOrder` in `onZoom`.** The auto-coarsening logic compares numeric order of the current zoom and bars values against these maps. A missing entry evaluates as `undefined`, which coerces to `NaN` in numeric comparisons — the coarsening guard silently always evaluates to false.
- **Reintroducing a separate mempool overlay producer for WS.** The WS path must keep delegating to `DataSource.GetMempoolPriceCountTime` via `buildTicketPoolChartsData` — historically a hand-rolled `inv.Tickets[0].TotalOut` block at `websockethandlers.go` produced a different `mempool.{price,count,time}` than REST ([#290](https://github.com/monetarium/monetarium-explorer/issues/290)).
- **Expecting stakeDiff to reset to zero on a bad node value.** `StoreMPData` uses fail-soft semantics: an invalid `StakeDiff` from the node logs a warning and leaves `c.stakeDiff` unchanged. Tests asserting a zero-Price after a bad StakeDiff call will fail; this is correct behavior.
- **Cache + height-changed-mid-query.** `ticketPoolVisualization` retries the three SQL queries if `pgb.Height()` advanced between first and last query; do not remove this retry loop ([db/dcrpg/pgblockchain.go:1909-1940](../../../db/dcrpg/pgblockchain.go#L1909-L1940)) — without it the three charts could disagree by one block on rapid reorgs / fast tip advance.
- **Confusing the `extendToPeriodEnd` ordering invariant.** In `ticketpool_purchases.js`, `extendToPeriodEnd(cols, barMode)` must be called *before* appending the mempool point. The mempool timestamp (next-block estimate) must not be used as the period-end anchor — it would compute the wrong boundary. The comment in `toColumns` documents this explicitly.

## Section 8 — Evidence

- Handler: [cmd/dcrdata/internal/explorer/explorerroutes.go:811-824](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L811-L824)
- Template: [cmd/dcrdata/views/ticketpool.tmpl](../../../cmd/dcrdata/views/ticketpool.tmpl)
- JS controller: [cmd/dcrdata/public/js/controllers/ticketpool_controller.js](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js)
- Chart def (purchases): [cmd/dcrdata/public/js/charts/definitions/ticketpool_purchases.js](../../../cmd/dcrdata/public/js/charts/definitions/ticketpool_purchases.js)
- Chart def (price): [cmd/dcrdata/public/js/charts/definitions/ticketpool_price.js](../../../cmd/dcrdata/public/js/charts/definitions/ticketpool_price.js)
- Zoom helpers: [cmd/dcrdata/public/js/helpers/ticketpool_zoom.js](../../../cmd/dcrdata/public/js/helpers/ticketpool_zoom.js)
- API routes: [cmd/dcrdata/internal/api/apirouter.go:245-249](../../../cmd/dcrdata/internal/api/apirouter.go#L245-L249)
- API handlers: [cmd/dcrdata/internal/api/apiroutes.go:1257-1325](../../../cmd/dcrdata/internal/api/apiroutes.go#L1257-L1325)
- Middleware: [cmd/dcrdata/internal/middleware/apimiddleware.go:691-699](../../../cmd/dcrdata/internal/middleware/apimiddleware.go#L691-L699)
- WS handler: [cmd/dcrdata/internal/explorer/websockethandlers.go:169-231](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L169-L231)
- DB cache: [db/dcrpg/pgblockchain.go:74-132](../../../db/dcrpg/pgblockchain.go#L74-L132), [db/dcrpg/pgblockchain.go:1830-1943](../../../db/dcrpg/pgblockchain.go#L1830-L1943)
- DB queries (ticketpool section): [db/dcrpg/queries.go:1106-1200](../../../db/dcrpg/queries.go#L1106-L1200), [db/dcrpg/queries.go:4400-4402](../../../db/dcrpg/queries.go#L4400-L4402)
- DB SQL: [db/dcrpg/internal/stakestmts.go:106-122](../../../db/dcrpg/internal/stakestmts.go#L106-L122), [db/dcrpg/internal/stakestmts.go:509-512](../../../db/dcrpg/internal/stakestmts.go#L509-L512), [db/dcrpg/internal/txstmts.go:165-170](../../../db/dcrpg/internal/txstmts.go#L165-L170)
- Mempool overlay: [mempool/mempoolcache.go:46-76](../../../mempool/mempoolcache.go#L46-L76) (`StoreMPData`, fail-soft stakeDiff), [mempool/mempoolcache.go:197-218](../../../mempool/mempoolcache.go#L197-L218) (`GetTicketPriceCountTime`), [db/dcrpg/pgblockchain.go:6414](../../../db/dcrpg/pgblockchain.go#L6414) (`GetMempoolPriceCountTime`)
- Types: [api/types/apitypes.go:931-960](../../../api/types/apitypes.go#L931-L960), [db/dbtypes/types.go:2118-2128](../../../db/dbtypes/types.go#L2118-L2128), [db/dbtypes/types.go:827-857](../../../db/dbtypes/types.go#L827-L857)

See also:
- /wiki/core/constraints.md (depends-on: C1 numeric precision — VAR-only float64 pipeline; C2 dual collection paths; C3 REST/WS payload parity; C6 template-cloning exception in `populateOutputs`)
- /wiki/core/staking-rewards.md (depends-on: tickets are VAR-only by chain design)
- /wiki/code-analysis/decodetx/patterns.md (shares-pattern-with: P1 form-shell over WS-RPC; the `getticketpooldata` switch is the same shape as `decodetx`/`sendtx`)
- /wiki/code-analysis/parameters/flow.full.md (shares-pattern-with: no-compute Go handler that renders only `commonData`)
- /wiki/code-analysis/page-rendering/patterns.md (depends-on: `*CommonPageData` template injection)
- /wiki/code-analysis/time-based-blocks/patterns.md (shares-pattern-with: `formatGroupingQuery` family + positional `rows.Scan` invariant)
- /wiki/code-analysis/charts/impact.md (shares-pattern-with: SKA-through-float trap — relevant if tickets ever go multi-coin)
- /wiki/code-analysis/mempool/flow.full.md (depends-on: `MempoolInventory` + `MempoolCache` upstream producers of the WS / REST mempool overlay)
- /wiki/code-analysis/chart-panel/flow.full.md (depends-on: ChartPanel API — `createChartPanel`, `panel.render`, `panel.setXRange`, `panel.handle`, `panel.ranger`)
