# /ticketpool — Architectural Patterns

## P1: Form-shell + WS-RPC refresh loop

**What:** The server handler is a one-line `templates.exec("ticketpool", commonData(r))`; no data is injected via SSR. All chart data arrives at the client through three independent channels (HTTP `/api/ticketpool/charts`, HTTP `/api/ticketpool/bydate/{tp}`, and WS request/response `getticketpooldata`→`getticketpooldataResp`). The `newblock` WS signal carries `WebsocketBlock` (not ticketpool data); the JS controller listens for it and **re-requests** ticketpool data on every block by calling `ws.send('getticketpooldata', this.bars)`.

**Where:** [cmd/dcrdata/internal/explorer/explorerroutes.go:811-824](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L811-L824) (handler), [cmd/dcrdata/views/ticketpool.tmpl](../../../cmd/dcrdata/views/ticketpool.tmpl) (template), [cmd/dcrdata/public/js/controllers/ticketpool_controller.js:149-163](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L149-L163) (controller).

**Constraints:**
- Event names (`'newblock'`, `'getticketpooldata'`, `'getticketpooldataResp'`) are duplicated across JS and the server switch + `EventId + "Resp"` suffix. Renaming any one silently breaks live refresh.
- Initial render of the page shows two empty Dygraphs (seed rows `[[0,0,0,0,0]]` / `[[0,0,0,0]]`) until `fetchAll()` returns. Acceptable latency for this page; do not paper over with synthetic data.
- This shape is shared with `/decodetx` (see [/wiki/code-analysis/decodetx/patterns.md](../decodetx/patterns.md) P1). Both pages survive without server-rendered data because the wait for the first WS/HTTP fetch is short and the empty chart is visually obvious.

## P2: Tri-modal struct with positional Scan

**What:** `dbtypes.PoolTicketsData` is one struct of seven parallel `[]…` slices (`Time`, `Price`, `Mempool`, `Immature`, `Live`, `Outputs`, `Count`). Three SQL queries each populate a different subset using positional `rows.Scan`. The JS controller branches on which field-subset is non-empty.

**Where:** [db/dbtypes/types.go:2118-2128](../../../db/dbtypes/types.go#L2118-L2128); producers in [db/dcrpg/queries.go:1138-1236](../../../db/dcrpg/queries.go#L1138-L1236); consumer dispatch in [ticketpool_controller.js:172-199](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L172-L199).

**Constraints:**
- The struct's seven slices must always be either fully populated *for the relevant chart* or all absent — partial population would render zeroes (Dygraphs treats zero as a real value).
- Adding a column to any of the three `SELECT`s requires updating the matching `rows.Scan` call positionally **and** the consumer (`processData` branch). No name-based safety net.
- Same positional-Scan risk as [/wiki/code-analysis/time-based-blocks/patterns.md](../time-based-blocks/patterns.md) and [/wiki/code-analysis/windows/patterns.md](../windows/patterns.md).

## P3: Process-global stale-while-revalidate cache, height-keyed, trylock-gated

**What:** `ticketPoolGraphsCache` is a **package-level `var`** (not `*ChainDB`-scoped) holding per-interval `{Height, TimeGraph, PriceGraph, DonutGraph}`. On read: a `RWMutex` protects the maps. On freshness check: stale ⇔ `cache.Height[interval] != pgb.Height()`. On miss/stale: a per-interval `trylock.Mutex` (`tpUpdatePermission[interval]`) picks the single goroutine that runs the SQL refresh — concurrent callers either return stale data (if it exists) or block on the same lock waiting for the in-flight update. The inner `ticketPoolVisualization` re-fetches `pgb.Height()` before and after the three sub-queries and **loops if the tip advanced mid-query** to keep all three charts at one height.

**Where:** [db/dcrpg/pgblockchain.go:74-132](../../../db/dcrpg/pgblockchain.go#L74-L132) (cache types + helpers), [db/dcrpg/pgblockchain.go:1830-1943](../../../db/dcrpg/pgblockchain.go#L1830-L1943) (TicketPoolVisualization / inner ticketPoolVisualization with retry loop).

**Constraints:**
- No proactive invalidation — refresh only on next read after height change. Cold-cache + simultaneous WS `newblock` from many clients = one updater per interval; the rest get blocked or stale.
- The cache is process-global, not per-`ChainDB`. Multi-instance binaries would silently share. Single-instance today.
- All three sub-charts must share one `height` (the inner retry loop enforces this). Removing the loop introduces inter-chart inconsistency on rapid tip advance.

## P4: Single delegation helper consumed by both transports

**What:** `apitypes.PriceCountTime` is sent on both the REST path (`GET /api/ticketpool/charts`) and the WS path (`getticketpooldataResp`). Both producers delegate to the same DataSource method (`GetMempoolPriceCountTime`), so a given mempool/chain state yields the same `mempool.{price,count,time}` bytes regardless of which transport delivered the payload. The DataSource implementation locks its own cache (`mempool/mempoolcache.go`), so neither caller needs to take `MempoolInventory().RLock()` around the read.

**Where:** REST — [cmd/dcrdata/internal/api/apiroutes.go:1274](../../../cmd/dcrdata/internal/api/apiroutes.go#L1274) (`c.DataSource.GetMempoolPriceCountTime()`); WS — `(*explorerUI).buildTicketPoolChartsData` in [cmd/dcrdata/internal/explorer/websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go); shared producer — [db/dcrpg/pgblockchain.go:6402-6406](../../../db/dcrpg/pgblockchain.go#L6402-L6406) → [mempool/mempoolcache.go:192-214](../../../mempool/mempoolcache.go#L192-L214); type — [api/types/apitypes.go:955-960](../../../api/types/apitypes.go#L955-L960).

**Constraints:**
- New top-level fields on `TicketPoolChartsData` still need updates at **both** producer sites (REST handler + `buildTicketPoolChartsData`), but the mempool overlay itself is single-sourced — do not reintroduce a parallel computation in either branch.
- `(*explorerUI).buildTicketPoolChartsData` exists specifically to keep the WS switch arm a one-liner: any new logic for the `getticketpooldata` case belongs inside this helper, not inline in `RootWebsocket`'s `select`/`switch` block — both for testability and to keep the REST/WS parity obvious to readers.

**History:** Prior to [#290](https://github.com/monetarium/monetarium-explorer/issues/290) the WS path reimplemented this overlay manually (`mp.Price = inv.Tickets[0].TotalOut`, `mp.Count = len(inv.Tickets)`, `mp.Time = NewTimeDefFromUNIX(inv.Tickets[0].Time)`). Same JSON shape, different semantics — the `/ticketpool` Dygraph dot visibly jumped between the initial HTTP load and every `newblock` refresh. The fix collapses both paths onto `DataSource.GetMempoolPriceCountTime`.

## P5: VAR-only float64 staking pipeline

**What:** Every monetary value in this trace is `float64` VAR — `PoolTicketsData.Price []float64`, `MempoolTx.TotalOut float64`, `toCoin(amt) float64`, Dygraphs `digitsAfterDecimal: 8`. There is no SKA branch and there cannot be one without restructuring the data shape, because **tickets are a PoS staking instrument denominated only in VAR** ([/wiki/core/staking-rewards.md](../../core/staking-rewards.md) §2).

**Where:** [db/dbtypes/types.go:2118-2128](../../../db/dbtypes/types.go#L2118-L2128), [db/dcrpg/queries.go:1142-1204](../../../db/dcrpg/queries.go#L1142-L1204), [db/dcrpg/queries.go:4297-4299](../../../db/dcrpg/queries.go#L4297-L4299), [cmd/dcrdata/public/js/controllers/ticketpool_controller.js:111-122](../../../cmd/dcrdata/public/js/controllers/ticketpool_controller.js#L111-L122).

**Constraints:**
- The `uint64(price*1e8)` round-trip in `retrieveTicketsByDate` is VAR-safe only. Extending this path to handle SKA atoms via `float64` would silently corrupt values >2^53 atoms.
- "Make this multi-coin" is not a refactor — it is a redesign that requires upstream chain semantics for SKA tickets (which do not currently exist).

See also:
- /wiki/code-analysis/ticketpool/flow.full.md
- /wiki/code-analysis/ticketpool/impact.md
- /wiki/code-analysis/decodetx/patterns.md (shares-pattern-with: P1 form-shell over WS-RPC)
- /wiki/code-analysis/time-based-blocks/patterns.md (shares-pattern-with: P2 positional-Scan + `formatGroupingQuery`)
- /wiki/code-analysis/page-rendering/patterns.md (depends-on: commonData injection)
- /wiki/core/constraints.md (depends-on: C1 VAR-only float64; C3 REST/WS payload parity; C6 template-clone exception)
