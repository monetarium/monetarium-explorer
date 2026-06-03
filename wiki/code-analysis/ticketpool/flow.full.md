# /ticketpool — Full Data-Flow Trace

## Section 1 — Overview

`/ticketpool` is a **no-data HTML shell + three live data channels**. The Go handler returns only the template + `commonData`; every data series rendered by Dygraphs (purchase-time histogram, price histogram, sstxcommitment-output donut) reaches the page via:

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
     initialize() → lazy-import Dygraphs → makePurchasesGraph / makePriceGraph
     connect()    → ws.registerEvtHandler('newblock')         → ws.send('getticketpooldata', this.bars)
                  → ws.registerEvtHandler('getticketpooldataResp') → processData(JSON.parse(evt))
                  → fetchAll() → GET /api/ticketpool/charts
     onBarsChange → GET /api/ticketpool/bydate/{bars} → purchasesGraph.updateOptions
     processData  → purchasesGraphData / priceGraphData / populateOutputs
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

**Location:** [db/dcrpg/queries.go:1138-1236](../../../db/dcrpg/queries.go#L1138-L1236).

`dbtypes.PoolTicketsData` ([db/dbtypes/types.go:2120-2128](../../../db/dbtypes/types.go#L2120-L2128)) is a flat-arrays-of-equal-length struct (`Time`, `Price`, `Mempool`, `Immature`, `Live`, `Outputs`, `Count`). One struct, three different population shapes:

| Producer | Fields populated | Notes |
|---|---|---|
| `retrieveTicketsByDate` | `Time`, `Immature`, `Live`, `Price` | `Price[i] = toCoin(uint64(SUM(price)*1e8) / (live+immature))` — average per group as float64 VAR. |
| `retrieveTicketByPrice` | `Immature`, `Live`, `Price` | `Price[i]` scanned directly from `price::NUMERIC` into Go `float64`. |
| `retrieveTicketsGroupedByType` | `Outputs`, `Count` | `Outputs[i] = (num_vout - 1) / 2` (sstxcommitment count). |

Critical detail: `retrieveTicketsByDate` does `uint64(price*1e8) / (live+immature)` — the `*1e8` round-trip via `float64` is a VAR-only path; safe per C1. **Do not extend this routine to SKA atoms** without rewriting to `*big.Int`.

`toCoin(amt) = float64(amt)/1e8` ([db/dcrpg/queries.go:4297-4299](../../../db/dcrpg/queries.go#L4297-L4299)) — generic over `int64|uint64`, VAR-only.

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

The `/bydate/{tp}` response uses an anonymous struct `{ Height int64; TimeChart *PoolTicketsData }` ([cmd/dcrdata/internal/api/apiroutes.go:1316-1322](../../../cmd/dcrdata/internal/api/apiroutes.go#L1316-L1322)). **The JS controller relies on `data.time_chart` and never reads `data.height` from this response** (note: capitalization mismatch — Go field `Height` serializes to `"height"`, but the JS controller only reads `data.height` from the *charts* / WS payloads, not from `bydate`). The `bydate` response carries no mempool.

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

Both calls dispatch to `*ChainDB.GetMempoolPriceCountTime` ([db/dcrpg/pgblockchain.go:6402-6406](../../../db/dcrpg/pgblockchain.go#L6402-L6406)) → [mempool/mempoolcache.go:192-214](../../../mempool/mempoolcache.go#L192-L214):

```go
return &apitypes.PriceCountTime{
    Price: dcrutil.Amount(c.stakeDiff).ToCoin() + feeAvg,  // stakeDiff + rolling avg of last N fees
    Count: numFees,
    Time:  dbtypes.NewTimeDef(c.timestamp),
}
```

`Price` is therefore always the **predicted next-block ticket price** (`stakeDiff + feeAvg`) regardless of which transport delivered it; `Count` is the number of fees averaged into the cache; `Time` is the cache update timestamp. The cache helper locks its own state, so neither caller takes `MempoolInventory().RLock()`.

> **History note.** Pre-PR #290 the WS branch reimplemented this overlay manually as `mp.Price = inv.Tickets[0].TotalOut` / `mp.Count = len(inv.Tickets)` / `mp.Time = NewTimeDefFromUNIX(inv.Tickets[0].Time)`. Same JSON shape, different semantics: the `/ticketpool` Dygraph dot visibly jumped between the initial HTTP load (REST) and every `newblock` refresh (WS). Issue [#290](https://github.com/monetarium/monetarium-explorer/issues/290) collapsed both paths onto `DataSource.GetMempoolPriceCountTime` via the new package-local helper `(*explorerUI).buildTicketPoolChartsData`.

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

A static shell with `data-controller="ticketpool"`. Three Dygraph mount points (`#tickets-by-purchase-date`, `#tickets-by-purchase-price`) plus one table for the outputs donut (`data-ticketpool-target="outputs"`). Zoom and Bars button rows are mirror-symmetric (same four values: `all` / `day` / `wk` / `mo`). The template carries **no server-rendered data series whatsoever**.

### 3.9 JS controller

**Location:** [cmd/dcrdata/public/js/controllers/ticketpool_controller.js](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js).

- `initialize()` — lazy-imports Dygraphs (`/* webpackChunkName: "dygraphs" */`), builds two empty graphs (`makePurchasesGraph` with seed `[[0,0,0,0,0]]`, `makePriceGraph` with seed `[[0,0,0,0]]`).
- `connect()` — registers `newblock` (→ re-fire WS request) and `getticketpooldataResp` (→ `processData`) handlers, then runs `fetchAll()`.
- `fetchAll()` — `requestJSON('/api/ticketpool/charts')` → `processData`.
- `processData(data)` — branches on which keys are present (full payload sets all four; `bydate` only sets `time_chart`). Mempool overlay is merged into the time chart only if `tipHeight === data.height` (`processData` line 180).
- `purchasesGraphData(items, memP)` — iterates `items.time[]` (parses ISO strings → `Date`), produces rows `[date, mempoolCount, immature, live, price]`. Sets module-globals `origDate` (epoch ms of first bucket) and `ms` (epoch ms of last bucket + 1000ms) used by `getWindow` for the Zoom buttons.
- `priceGraphData(items, memP)` — special-cases when mempool price matches an existing bucket vs. a new bucket; resorts via `Comparator` if a new bucket was added.
- `populateOutputs(data)` — builds the donut table via `innerHTML` from numeric values it pre-coerces with `parseInt()`; safe from XSS only because every interpolated value is numeric. **Violates C6** (no `<template>` clone) — accepted because inputs are integers, not free strings.
- `onBarsChange(e)` — sets `this.bars`, GETs `/api/ticketpool/bydate/{bars}`, calls `purchasesGraphData(response.time_chart)` (no mempool merge in this branch) and updates the purchases graph only.
- `disconnect()` — destroys both Dygraphs and deregisters WS handlers.

Labels are VAR-only and consistent: `'A.v.g. Tickets Value (VAR)'` (purchases y2-axis, [ticketpool_controller.js:257](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L257)) and `'Ticket Price (VAR)'` (price x-axis, [:286](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L286)). The former purchases-axis `(DCR)` leak has been fixed; both are hardcoded `(VAR)` literals — acceptable because tickets are a VAR-only PoS instrument, so C7's `coinSymbol`/`renderCoinType` helpers are not required for these static axis labels.

## Section 4 — Cross-Layer Dependencies

| From | To | Coupling | Brittleness |
|---|---|---|---|
| JS `bars` button label | `dbtypes.TimeGroupingFromStr` | Strings `"all"/"day"/"wk"/"mo"` must match the switch in [db/dbtypes/types.go:842-857](../../../db/dbtypes/types.go#L842-L857). | Adding a new button on the JS side without extending the Go switch silently falls into `UnknownGrouping` → 422 (REST) / WS error. |
| `dbtypes.PoolTicketsData` field order | three different SQL `rows.Scan` calls | Positional, not named — `Scan(&timestamp, &price, &immature, &live)` vs `Scan(&price, &immature, &live)` vs `Scan(&output, &count)`. | Reordering the columns in a `SELECT` silently swaps fields. Same class of risk as time-based-blocks ([/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md)). |
| JS `processData` | `apitypes.TicketPoolChartsData` JSON tags | `data.time_chart`, `data.price_chart`, `data.outputs_chart`, `data.mempool`, `data.height` — read by name from the parsed JSON. | Renaming a JSON tag on the Go side without updating the JS reader silently drops a series. No type check. |
| WS `getticketpooldata` `EventId` literal | `webData.EventId = msg.EventId + "Resp"` ([websockethandlers.go:231](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L231)) | JS hard-codes `'getticketpooldata'` and `'getticketpooldataResp'`. | Renaming the event on either side silently breaks live refresh — JS continues to render only the initial HTTP fetch. (Same R1-class drift as [/wiki/code-analysis/decodetx/impact.md](../decodetx/impact.md).) |
| `ticketPoolGraphsCache` (package `var`) | `ChainDB` instance | Process-global, not per-instance. | A second `ChainDB` in the same binary (testing, multi-network) would silently share cache and serve cross-instance data. Single-instance today. |
| JS `processData` height gate | `this.tipHeight === data.height` | The "mempool overlay only when fresh" rule relies on the WS payload setting `data.height` and `data.mempool` together. | If WS ever returned `height` without `mempool` (or vice versa), the time chart could lock out future mempool merges (line 180). |

## Section 5 — Critical Constraints

- **C1 (precision):** Tickets are a VAR-only PoS instrument (see [/wiki/core/staking-rewards.md](../../core/staking-rewards.md) §2 — ticket price, returned cost, and 1/5-of-50% subsidy share are all VAR-denominated). `PoolTicketsData.Price []float64`, `MempoolTx.TotalOut float64`, `toCoin() float64`, Dygraphs `digitsAfterDecimal: 8` — the entire pipeline is float64 VAR end-to-end. **This is intentional; safe under C1 *only* because tickets are VAR.** Any attempt to introduce a SKA-denominated ticket variant must rewrite the struct away from `[]float64` to `[]string` and replace `toCoin`/`*1e8` with `*big.Int` arithmetic.
- **C2 (dual pipeline mutation):** Two collection paths feed the page — DB (Postgres `tickets` JOIN) and live mempool (`DataCache` via `GetMempoolPriceCountTime`). Any change to the ticket-row population (e.g. adding a new column to the SELECT for filtering) must update three `Scan` sites *and* the cache invariant that all three sub-charts share one `(height, interval)` key. The mempool overlay now has a single producer shared by REST and WS (§3.5); historically it was two divergent formulas (resolved in [#290](https://github.com/monetarium/monetarium-explorer/issues/290)).
- **C3 (template+WS parity):** The HTML template carries **no** chart data — there is no SSR variant to keep in parity. The two non-static data paths (REST and WS) carry the **same struct** *and* (after [#290](https://github.com/monetarium/monetarium-explorer/issues/290)) the same producer for every field, so they cannot drift on the mempool overlay. Adding new top-level fields to `TicketPoolChartsData` still requires updating both producer sites — see Section 6.
- **C6 (template cloning):** `populateOutputs` builds the donut table via `innerHTML` concatenation, not `<template>` cloning. Tolerated because all interpolated values are pre-coerced with `parseInt()` to integers. **Do not extend the function with any user-derived string** without converting to a `<template>` clone.
- **C7 (coin-symbol helper):** Resolved — both chart axes now read `(VAR)` ([ticketpool_controller.js:257](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L257) and [:286](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L286)); the former purchases-axis `(DCR)` leak is gone. These are static VAR-only labels, so the centralized `renderCoinType`/`coinSymbol` helpers do not apply.

## Section 6 — Mutation Impact

When modifying `/ticketpool`, check:

| Mutation | Direct deps | Indirect deps | Failure mode |
|---|---|---|---|
| Add a column to `PoolTicketsData` | All three Scan sites; both Go consumers (REST + WS); JS `processData`; potentially Dygraphs labels/colors arrays | Cache struct (per-interval map values are the same struct → automatic) | **Loud** if Go consumer dereferences a nil slice; **silent** if JS just ignores the unknown key. |
| Reorder columns in any of the three SQL statements | The matching `rows.Scan` call | Cache shape | **Silent** — values swap with no error (positional Scan). |
| Add a new time-grouping (e.g. `"hr"`) | `dbtypes.TimeBasedGroupings` map, `TimeGroupingFromStr` switch, `NumIntervals` constant, `formatGroupingQuery` regex, JS bar button HTML, controller `bars` whitelist | Cache map size (`tpUpdatePermission` map is built from the same enum, so new entries get a lock automatically) | **Loud**: missing enum entry → `UnknownGrouping` → 422 on REST, "Error: unknown interval" on WS. **Silent**: missing JS button just means the user can't pick it. |
| Add a new chart series (e.g. revoked-tickets buckets) | `PoolTicketsData` arrays, new SQL, new Scan, new cache field; **both** REST and WS payloads + JS `processData` branch | Bars-only `/bydate` response intentionally drops `price_chart` and `outputs_chart` — decide if the new field belongs there too | **Silent** drift between REST/WS if only one is updated (C3-shaped). |
| Change `MempoolPriceCountTime.Price` semantics | `mempoolcache.GetTicketPriceCountTime` | Both REST and WS read this through `DataSource.GetMempoolPriceCountTime` (since [#290](https://github.com/monetarium/monetarium-explorer/issues/290)), so a single edit reaches both consumers. | **Loud** if the return type changes (compile error in both consumers); **silent** if only the numeric formula changes (chart legend just shows a different value). |
| Tune the cache invalidation key (e.g. add a fee-mix sub-key) | `TicketPoolData` and `UpdateTicketPoolData` signatures; `tpUpdatePermission` map type | Any test that asserts old behavior | **Silent** stale data; possibly **loud** if existing callers don't supply the new key. |
| Rename the WS event | Both string literals in JS (`'newblock'`, `'getticketpooldata'`, `'getticketpooldataResp'`) and the server switch case + suffix append | JS `disconnect()` deregister call uses the same string | **Silent** — `newblock` refresh loop silently breaks; initial HTTP load still works. |
| Promote tickets to SKA | Every `float64` in this trace becomes `*big.Int` or `string`; `digitsAfterDecimal: 8` becomes invalid; `populateOutputs` table is fine (integer counts); the `*1e8` round-trip in `retrieveTicketsByDate` becomes a precision-loss site | This is effectively a full rewrite of the pipeline; not a minor change | **Silent corruption** — exceeds float64 significand; see [/wiki/code-analysis/charts/impact.md](../charts/impact.md) for the analogous SKA-through-float trap. |

## Section 7 — Common Pitfalls

- **Assuming `/ticketpool` is push-driven.** It is not. The server's `sigNewBlock` carries `WebsocketBlock`, not ticket data. The JS controller *re-requests* ticket data on every `newblock` — every connected client triggers a fresh `TicketPoolVisualization(ctx, <their-bars>)` per block. The cache absorbs the duplication (single updater wins via `TryLock`); without the cache, this would be N concurrent DB hits per block.
- **Editing one of the three Scan calls and forgetting the others.** All three populate the same `PoolTicketsData` struct, but each fills a different field subset. A new SELECT column on one branch leaves zero values in the slices populated by the other two — and Dygraphs renders zero as a real value, not a gap.
- **Adding SKA support in the wrong place.** Tickets are VAR by chain design. The temptation to "make this multi-coin" would corrupt SKA precision (C1) and produce nonsense data — tickets do not exist for SKA coins.
- **Forgetting that `/api/ticketpool/bydate/{tp}` returns no `mempool` field.** A future refactor that unifies the two REST handlers via the same response struct must either backfill `Mempool` or leave it nil and document the asymmetry. The JS `onBarsChange` does *not* call `processData`; it goes straight to `purchasesGraph.updateOptions`, bypassing the mempool-overlay logic.
- **Reintroducing a separate mempool overlay producer for WS.** The WS path must keep delegating to `DataSource.GetMempoolPriceCountTime` via `buildTicketPoolChartsData` — historically a hand-rolled `inv.Tickets[0].TotalOut` block at `websockethandlers.go` produced a different `mempool.{price,count,time}` than REST and caused the mempool dot to jump on every `newblock` refresh ([#290](https://github.com/monetarium/monetarium-explorer/issues/290)).
- **Cache + height-changed-mid-query.** `ticketPoolVisualization` retries the three SQL queries if `pgb.Height()` advanced between first and last query; do not remove this retry loop ([db/dcrpg/pgblockchain.go:1909-1940](../../../db/dcrpg/pgblockchain.go#L1909-L1940)) — without it the three charts could disagree by one block on rapid reorgs / fast tip advance.

## Section 8 — Evidence

- Handler: [cmd/dcrdata/internal/explorer/explorerroutes.go:811-824](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L811-L824)
- Template: [cmd/dcrdata/views/ticketpool.tmpl](../../../cmd/dcrdata/views/ticketpool.tmpl)
- JS controller: [cmd/dcrdata/public/js/controllers/ticketpool_controller.js](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js)
- API routes: [cmd/dcrdata/internal/api/apirouter.go:245-249](../../../cmd/dcrdata/internal/api/apirouter.go#L245-L249)
- API handlers: [cmd/dcrdata/internal/api/apiroutes.go:1257-1325](../../../cmd/dcrdata/internal/api/apiroutes.go#L1257-L1325)
- Middleware: [cmd/dcrdata/internal/middleware/apimiddleware.go:691-699](../../../cmd/dcrdata/internal/middleware/apimiddleware.go#L691-L699)
- WS handler: [cmd/dcrdata/internal/explorer/websockethandlers.go:169-231](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L169-L231)
- DB cache: [db/dcrpg/pgblockchain.go:74-132](../../../db/dcrpg/pgblockchain.go#L74-L132), [db/dcrpg/pgblockchain.go:1830-1943](../../../db/dcrpg/pgblockchain.go#L1830-L1943)
- DB queries: [db/dcrpg/queries.go:1138-1236](../../../db/dcrpg/queries.go#L1138-L1236), [db/dcrpg/queries.go:4297-4299](../../../db/dcrpg/queries.go#L4297-L4299)
- DB SQL: [db/dcrpg/internal/stakestmts.go:106-122](../../../db/dcrpg/internal/stakestmts.go#L106-L122), [db/dcrpg/internal/stakestmts.go:509-512](../../../db/dcrpg/internal/stakestmts.go#L509-L512), [db/dcrpg/internal/txstmts.go:165-170](../../../db/dcrpg/internal/txstmts.go#L165-L170)
- Mempool overlay: [mempool/mempoolcache.go:192-214](../../../mempool/mempoolcache.go#L192-L214), [db/dcrpg/pgblockchain.go:6402-6406](../../../db/dcrpg/pgblockchain.go#L6402-L6406)
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
