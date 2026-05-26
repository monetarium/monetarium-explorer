# /ticketpool — Compact Knowledge

## Flow

`Postgres tickets/transactions → ChainDB.TicketPoolVisualization → ticketPoolGraphsCache (process-global, height-keyed, trylock-gated) → {HTTP /api/ticketpool/charts | HTTP /api/ticketpool/bydate/{tp} | WS getticketpooldata→Resp} → ticketpool_controller.js processData → Dygraphs purchases+price + DOM outputs table`. Server handler `explorerUI.Ticketpool` renders only the template shell with `commonData`; **zero chart data is SSR-injected**. JS re-requests over WS on every `newblock` signal (server `sigNewBlock` carries `WebsocketBlock`, not ticket data).

## Key Architectural Patterns

- **P1 Form-shell over WS-RPC.** Same shape as `/decodetx`: HTML carries no data; JS holds the `getticketpooldata`/`getticketpooldataResp` request/response loop. Refresh trigger = client-side `newblock` listener, not a server push of ticket data.
- **P2 Tri-modal struct with positional Scan.** One `dbtypes.PoolTicketsData` (`Time/Price/Mempool/Immature/Live/Outputs/Count` parallel slices) is populated by three different SQL Scans, each filling a different field subset. Column reordering swaps fields silently.
- **P3 Stale-while-revalidate cache.** Package-`var` `ticketPoolGraphsCache` keyed `(interval, height)`. `TryLock` on `tpUpdatePermission[interval]` picks the updater; stale data is served immediately to non-updaters. Inner refresh retries on `pgb.Height()` advance to keep the three sub-charts consistent at one block.
- **P4 Single delegation helper consumed by both transports.** Both REST `getTicketPoolCharts` and WS `(*explorerUI).buildTicketPoolChartsData` route `mempool.{price,count,time}` through `DataSource.GetMempoolPriceCountTime` → `stakeDiff.ToCoin() + feeAvg`. The two transports cannot drift. (Pre-[#290](https://github.com/monetarium/monetarium-explorer/issues/290) the WS path reimplemented the overlay as `inv.Tickets[0].TotalOut`; do not reintroduce.)

## Critical Constraints

- Tickets are **VAR-only** (C1, [/wiki/core/staking-rewards.md](../../core/staking-rewards.md) §2). Entire pipeline is float64; safe *only* because of VAR's 8-decimal precision. Adding SKA tickets requires a full `[]string`/`*big.Int` rewrite.
- `Bars` button strings (`"all"/"day"/"wk"/"mo"`) must match `dbtypes.TimeGroupingFromStr`; mismatch silently falls into `UnknownGrouping` → 422.
- WS event names `getticketpooldata` / `getticketpooldataResp` are hardcoded in both JS and the Go switch; `EventId + "Resp"` is appended server-side.
- `populateOutputs` uses `innerHTML` (C6 exception); tolerated because all interpolated values pass through `parseInt()`. Do not add string interpolation.
- JS purchases-chart y2 label says `(DCR)`; price-chart x-label says `(VAR)`. Legacy `DCR` leak.

## Mutation Checklist

When changing `/ticketpool`: (1) align all three `rows.Scan` calls with their SELECT column order; (2) mirror any new field across REST `getTicketPoolCharts` and WS `(*explorerUI).buildTicketPoolChartsData` payloads; (3) edit the mempool overlay only at `mempoolcache.GetTicketPriceCountTime` — both transports read it through `DataSource.GetMempoolPriceCountTime`, so do not reintroduce a parallel WS computation; (4) extend `dbtypes.TimeBasedGroupings` map + `TimeGroupingFromStr` switch + JS button HTML together; (5) never widen `PoolTicketsData.Price` to carry SKA without converting to a string/BigInt pipeline; (6) preserve the height-retry loop in `ticketPoolVisualization` to keep the three sub-charts at one block.

See also:
- [/wiki/code-analysis/ticketpool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/ticketpool/patterns.md](patterns.md)
- [/wiki/code-analysis/ticketpool/impact.md](impact.md)
- [/wiki/core/constraints.md](../../core/constraints.md) (C1, C2, C3, C6, C7, C8)
