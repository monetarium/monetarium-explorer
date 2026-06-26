# /ticketpool — Mutation Impact

## Risk: PoolTicketsData column-Scan desync

**Trigger:** any change to the column list in `SelectTicketsByPrice`, `selectTicketsByPurchaseDate`, or `SelectTicketsByType` — including reordering, adding, or dropping a SELECT expression.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.1, §3.2
**Failure mode:** silent
**Description:** [db/dcrpg/queries.go:1138-1236](../../../db/dcrpg/queries.go#L1138-L1236) uses positional `rows.Scan(&timestamp, &price, &immature, &live)` / `Scan(&price, &immature, &live)` / `Scan(&output, &count)`. Reordering swaps fields without error. The same struct (`dbtypes.PoolTicketsData`) is populated by all three; partial mismatches surface only as wrong values on the chart, not as runtime errors. Same class as [/wiki/code-analysis/time-based-blocks/impact.md](../time-based-blocks/impact.md) and [/wiki/code-analysis/windows/impact.md](../windows/impact.md).

## Risk: REST/WS payload drift

**Trigger:** adding a field to `apitypes.TicketPoolChartsData` on one of the two sites that produce it (REST `getTicketPoolCharts` or WS `getticketpooldata` switch case) without updating the other.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.4, §3.6
**Failure mode:** silent
**Description:** Initial page load uses HTTP `/api/ticketpool/charts` → new field renders. First `newblock` arrives, JS fires WS request, WS payload is missing the new field → JS reads `undefined` and either no-ops or zeroes out a series. The chart looks correct on first paint and silently degrades on update — the exact failure-mode signature flagged by C8 in [/wiki/core/constraints.md](../../core/constraints.md). A symmetric risk applies in reverse if the WS branch is updated first.

## Risk: Mempool.Price formula changes

**Trigger:** modifying `DataCache.GetTicketPriceCountTime` ([mempool/mempoolcache.go:192-214](../../../mempool/mempoolcache.go#L192-L214)) — the single producer of `mempool.{price,count,time}` for both REST and WS.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.5
**Failure mode:** silent (numeric drift)
**Description:** Since [#290](https://github.com/monetarium/monetarium-explorer/issues/290) both `appContext.getTicketPoolCharts` (REST) and `(*explorerUI).buildTicketPoolChartsData` (WS) delegate to `DataSource.GetMempoolPriceCountTime`, so a single edit reaches both consumers and the two transports cannot drift. Changing the numeric formula (e.g. tweaking the rolling-fee window or swapping `stakeDiff.ToCoin() + feeAvg` for another estimate) shifts the chart legend on every page that consumes this field; the change is invisible at compile time. Changing the return shape (e.g. promoting `Price float64` to a string) is **loud** — both consumers fail to compile.

> **History:** Pre-[#290](https://github.com/monetarium/monetarium-explorer/issues/290), the WS branch reimplemented the overlay manually (`inv.Tickets[0].TotalOut` etc.) — same JSON shape, different semantics. The mempool dot on `/ticketpool` jumped between the initial HTTP load and every `newblock` WS refresh. Do not reintroduce a parallel computation in the WS handler.

## Risk: WS event-name drift

**Trigger:** renaming `'getticketpooldata'`, `'getticketpooldataResp'`, or `'newblock'` on either the JS or Go side.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.6
- /wiki/code-analysis/decodetx/impact.md R1
**Failure mode:** silent
**Description:** JS hardcodes the three strings in [ticketpool_controller.js:150-160](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L150-L160); the server side spells `"getticketpooldata"` in the switch case ([websockethandlers.go:169](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L169)) and appends `+ "Resp"` at line 231. The `disconnect()` deregister calls also depend on the same literals. Rename safety = grep across both `.js` and `.go`, plus the suffix-appending line. Same R1-class risk as [/wiki/code-analysis/decodetx/impact.md](../decodetx/impact.md).

## Risk: TimeGrouping enum drift

**Trigger:** adding a new bars/zoom interval in the JS controller without extending `dbtypes.TimeBasedGroupings` / `TimeGroupingFromStr` / `NumIntervals` and/or the `barsOrder`/`zoomOrder` maps in `onZoom`.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.1, §3.4
**Failure mode:** loud (REST 422 / WS "Error: unknown interval"), but silent on the UI side: the failing tile shows the previous chart with no visible error message. A missing `barsOrder`/`zoomOrder` entry evaluates as `NaN` → the auto-coarsen guard silently never fires.
**Description:** JS sends `bars` as `"all"/"day"/"wk"/"mo"`. `TimeGroupingFromStr` rejects anything else as `UnknownGrouping`. The map `dbtypes.TimeBasedGroupings`, the switch in `TimeGroupingFromStr`, the JS button HTML, and the `barsOrder`/`zoomOrder` maps in `onZoom` must all move together. Note `tpUpdatePermission` is built off the same `NumIntervals` constant — new enum values automatically get a lock.

## Risk: SKA-through-VAR pipeline corruption

**Trigger:** any attempt to introduce SKA-denominated tickets into this trace without rewriting `PoolTicketsData.Price` from `[]float64` to a string/`*big.Int` shape.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.2, §3.9
- /wiki/code-analysis/charts/impact.md (analogous SKA-through-float trap)
**Failure mode:** silent corruption
**Description:** Tickets are a VAR-only PoS instrument by chain design ([/wiki/core/staking-rewards.md](../../core/staking-rewards.md) §2). `retrieveTicketsByDate` does `uint64(price*1e8) / (live+immature)` then `toCoin(uint64)` — both rely on values fitting in `float64`'s significand. SKA atom counts (18 decimals) overflow this window; results would silently round/drift. C1 violation.

## Risk: Cache-loop removal

**Trigger:** simplifying `ticketPoolVisualization` ([db/dcrpg/pgblockchain.go:1899-1943](../../../db/dcrpg/pgblockchain.go#L1899-L1943)) by removing the `for { ... heightEnd != height ... }` retry.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.3
**Failure mode:** silent
**Description:** Without the loop, the three sub-charts (time / price / outputs) can be drawn at different block heights when the tip advances mid-query — the page would self-disagree by one block on a busy chain. The loop is the only thing that enforces the "one (height, interval) per cache entry" invariant.

## Risk: Process-global cache cross-talk

**Trigger:** instantiating a second `ChainDB` in the same process (multi-network test harness, dual-mode build).
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.3
**Failure mode:** silent
**Description:** `ticketPoolGraphsCache` is `var` at the package level ([db/dcrpg/pgblockchain.go:90](../../../db/dcrpg/pgblockchain.go#L90)). Two `ChainDB` instances would share it and serve each other's data. Not a risk today (single-instance binary) but is a footgun for any future multi-network refactor.

## Risk: C6 violation surface (populateOutputs)

**Trigger:** extending [ticketpool_controller.js:10-25](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L10-L25) (`populateOutputs`) to include user-derived strings or non-numeric data.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.9
**Failure mode:** XSS if untrusted strings are interpolated; otherwise none.
**Description:** Current code is safe because every interpolated value is forced through `parseInt()`. The function is the only `innerHTML`-based template on this page; widening it would re-introduce the C6 risk that the rest of the project's per-template `<template>` cloning specifically prevents.

## Risk: `/bydate` response asymmetry

**Trigger:** unifying `getTicketPoolByDate` to return a `TicketPoolChartsData` (instead of the anonymous `{Height, TimeChart}` struct) without updating the JS to handle `mempool`/`price_chart`/`outputs_chart` keys on this branch.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.4, §3.9
**Failure mode:** silent
**Description:** `onBarsChange` renders via `purchasesPanel.render(def, response.time_chart, mempoolSettings, opts)` using the **cached** `this.mempool` (from the last full-payload response); it never reads `response.mempool`. The guard `if ('mempool' in response)` is always false for bydate. If `/bydate` were widened to a full payload, the controller would still not update the price chart or outputs donut on bars change unless also updated to dispatch through `processData`.

## Risk: Def-memoization bypass

**Trigger:** calling `ticketpoolPurchases(barMode)` directly (not via `purchasesDefFor`) on every render, or constructing an inline def object per render call.
**Affected flows:**
- /wiki/code-analysis/ticketpool/flow.full.md §3.9, §3.10
**Failure mode:** UX regression (not a data correctness bug)
**Description:** ChartPanel decides setData vs. full rebuild by object identity. If a new def object is returned on every call, ChartPanel rebuilds on every `processData` invocation — resetting the zoom viewport on each `newblock` update. Particularly jarring during rapid block production. The `purchasesDefFor(barMode)` memoization exists exactly to prevent this; bypassing it is safe only for a deliberate forced rebuild.

See also:
- /wiki/code-analysis/ticketpool/flow.full.md
- /wiki/code-analysis/ticketpool/patterns.md
- /wiki/core/constraints.md (depends-on: C1, C2, C3, C6, C8)
- /wiki/code-analysis/decodetx/impact.md (shares-pattern-with: R1 WS event-name drift)
- /wiki/code-analysis/time-based-blocks/impact.md (shares-pattern-with: positional Scan desync)
- /wiki/code-analysis/windows/impact.md (shares-pattern-with: positional Scan desync)
- /wiki/code-analysis/charts/impact.md (shares-pattern-with: SKA-through-float silent corruption)
