### 1. Overview
Tracing the data flow that renders the address page (`/address/{address}`), powers its chart endpoints, persists chart/pagination state in the URL via TurboQuery, and threads the new `?coin=N` filter through every read path (HTML, XHR, chart API, CSV). Captures (a) the multi-coin backend shape that landed in commits `4ebe5cf0…7a08c3d3` (PR #258), (b) the dual-field migration shim the frontend still depends on, (c) the stale-zoom-param failure mode in the chart controller, and (d) the SKA-precision fix in the chart `amountflow` SQL (PR #263, commit `49953185`).

### 2. End-to-End Data Flow
chi router (`main.go`) → `AddressPathCtx` middleware → `explorerUI.AddressPage` → `parseAddressParams` + `middleware.GetCoinCtx` → `AddressListData(ctx, addr, txnType, N, offset, coinType)` → `dataSource.AddressData` (PG: `AddressHistory` for paginated rows + `*AddressBalance` with `Coins map[uint8]*CoinBalance` + `retrieveAddressCoinTypes` for `ActiveCoins` + `mergedTxnCount`/`CountTransactions` + `FillAddressTransactions` + `mempool.UnconfirmedTxnsForAddress` → per-coin overlay onto `Balance.Coins`) → `templates.exec("address", AddressPageData)` → `views/address.tmpl` → browser → `address` Stimulus controller (`TurboQuery` for URL state, fetches `/api/address/{addr}/{types|amountflow}/{bin}` for charts and `/addresstable/{addr}?...` for table refresh).

### 3. Per-Layer Breakdown
- **Location:** [cmd/dcrdata/main.go:768-769](cmd/dcrdata/main.go#L768-L769)
  - **Data Structures:** chi route, `AddressPathCtx` puts address into `ctxAddress`.
  - **Transformations:** Two routes share the same middleware — `/address/{address}` → `AddressPage`, `/addresstable/{address}` → `AddressTable`.

- **Location:** [cmd/dcrdata/internal/middleware/apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842)
  - **Data Structures:** `ctxCoin` context key, `uint8` value.
  - **Transformations:** `CoinCtx` parses `?coin=N` (1-255). Missing/invalid → `dbtypes.CoinTypeAll = 255` sentinel ([db/dbtypes/types.go:47-49](db/dbtypes/types.go#L47-L49)). `GetCoinCtx(r)` returns the value or `CoinTypeAll` if absent.

- **Location:** [cmd/dcrdata/internal/explorer/explorerroutes.go:1535-1648](cmd/dcrdata/internal/explorer/explorerroutes.go#L1535-L1648)
  - **Data Structures:** Inline `AddressPageData{*CommonPageData, Data: *dbtypes.AddressInfo, Type txhelpers.AddressType, CRLFDownload bool, Pages []pageNumber, FiatBalance interface{}}` (1539-1546). `FiatBalance` is `interface{}` and **always set to `nil`** at 1633 — the fiat row in the template never fires today.
  - **Transformations:** `parseAddressParams` (1549) extracts `address`, `txntype`, `n`, `start`; coin comes separately via `middleware.GetCoinCtx(r)` (1605, passed into `AddressListData`). Zero/dummy address branch (1593-1603) short-circuits DB reads and builds an empty `AddressBalance` with `Coins: nil` (initialized later in the template path). `calcPages` (1632) builds pagination. `templates.exec("address", pageData)` (1635).
  - **Note:** Inline payload's `FiatBalance interface{}` and the `nil` assignment carry `TODO: Remove once frontend is updated for multi-coin support`. The `if $.FiatBalance` branch in `address.tmpl:54` is therefore dead code today.

- **Location:** [cmd/dcrdata/internal/explorer/explorerroutes.go:1652-1704](cmd/dcrdata/internal/explorer/explorerroutes.go#L1652-L1704)
  - **Data Structures:** XHR response struct `{TxnCount int64, HTML string, Pages []pageNumber}`.
  - **Transformations:** Same `parseAddressParams` + `middleware.GetCoinCtx(r)` (1656, 1663). Calls `AddressListData` (1663) and renders only the `addresstable` template fragment (1682-1686). Returns JSON `{tx_count: addrData.TxnCount + addrData.NumUnconfirmed, html, pages}`.

- **Location:** [cmd/dcrdata/internal/explorer/explorerroutes.go:1875-1889](cmd/dcrdata/internal/explorer/explorerroutes.go#L1875-L1889)
  - **Data Structures:** `AddressListData(ctx, addr, txnType, N, offset, coinType uint8) (*dbtypes.AddressInfo, error)`.
  - **Transformations:** Thin pass-through to `dataSource.AddressData`. The `coinType` arg is the only addition over the legacy signature.

- **Location:** [db/dcrpg/pgblockchain.go:2533-2917](db/dcrpg/pgblockchain.go#L2533-L2917) (`AddressData`)
  - **Data Structures:** `*dbtypes.AddressInfo` (`db/dbtypes/types.go:2322`), `*dbtypes.AddressBalance` (`types.go:2392`), `*dbtypes.CoinBalance` (`types.go:2379`).
  - **Transformations:**
    1. `AddressHistory` (2547) returns confirmed rows + balance (with `Coins` map populated by either the shortcut path through `ReduceAddressHistory` or the cache miss path through `retrieveAddressBalance`).
    2. `retrieveAddressCoinTypes` (2553) → SQL `SelectAddressCoinTypes` → `ActiveCoins []uint8` sorted.
    3. `ReduceAddressHistory` builds the skeleton (2581) — note this populates `Balance` from the **paginated row slice only**; the code at 2601 explicitly **overwrites** with the full `balance` from `AddressHistory` to avoid wrong totals on non-first pages (commit `961bbb0c`).
    4. Legacy flat-field sync from `Coins[0]` (2610-2615): `balance.TotalSpent = varBal.TotalSpent`, etc. Same sync repeats at 2512-2519 inside `AddressHistory`.
    5. `KnownTransactions/KnownFundingTxns/KnownSpendingTxns` derived from `Balance.Coins[coinType]` (or summed across all coins when `coinType == CoinTypeAll`) at 2618-2630.
    6. `TxnCount`: `mergedTxnCount(ctx, addr, txnType, coinType)` for merged views; for `AddrTxnAll` non-merged, uses `CountTransactions(ctx, addr, txnType, coinType)` (real DB count, not balance-derived — commit `7a08c3d3`) with a fallback to `KnownFundingTxns + KnownSpendingTxns`.
    7. `FillAddressTransactions` (2677) back-fills `Size`, `FormattedSize`, `Total`, `Time`, `Confirmations`, `MatchedTxIndex`.
    8. `mp.UnconfirmedTxnsForAddress(address)` (2687) returns `(*AddressOutpoints, map[uint8]int64, error)`. The per-coin map populates `NumUnconfirmedByCoin` (2701) and totals into `NumUnconfirmed` (2697).
    9. Mempool overlay (2712-2871): coin-aware. Funding-side reads `coinType` from `fundingTx.CoinInfo[f.Index]`; spending-side reads `f.CoinType`. Per-coin SKA accumulators (`skaReceivedByType`, `skaSpentByType`) of `*big.Int`, written back to `Balance.Coins[ct].TotalReceivedSKA / TotalSpentSKA / TotalUnspentSKA` (2887-2911).

- **Location:** [db/dbtypes/types.go:2456-2613](db/dbtypes/types.go#L2456-L2613) (`ReduceAddressHistory`)
  - **Data Structures:** `AddressInfo`, `AddressBalance{Coins, TotalInputs, TotalOutputs, FromStake, ToStake, +legacy flat fields}`, `CoinBalance{NumSpent, NumUnspent, TotalSpent/TotalUnspent (VAR int64), TotalSpentSKA/TotalUnspentSKA/TotalReceivedSKA (string)}`.
  - **Transformations:** Walks `addrHist`, switches on `coinType` per row. VAR rows: `receivedVAR += value`, `tx.ReceivedTotal = ToCoin(value)`. SKA rows: `bigAddSKA(receivedSKAByCoin[ct], addrOut.SKAValue)` and `tx.ReceivedTotalSKA = addrOut.SKAValue`. After the loop, materializes `*big.Int` accumulators into `CoinBalance.Total*SKA` strings (2568-2588). Also produces `ActiveCoins` from `coins` map keys, sorted ascending (2593-2597).
  - **Critical:** Legacy flat-field sync at 2557-2562: `balance.TotalUnspent = coins[0].TotalUnspent`, etc. **Coins[0] only.** If only SKA activity exists, these fields stay at zero.

- **Location:** [db/dbtypes/types.go:2252-2273](db/dbtypes/types.go#L2252-L2273) (`AddressTx`)
  - **Data Structures:** Adds `ReceivedTotalSKA string`, `SentTotalSKA string` (2264-2265), `CoinType uint8`, `SKAValue string` (2271-2272) alongside the existing `ReceivedTotal float64` / `SentTotal float64`.
  - **Note:** Template (`extras.tmpl:251-284`) still reads only the float fields.

- **Location:** [db/dcrpg/queries.go:1472-1610](db/dcrpg/queries.go#L1472-L1610) (`retrieveAddressBalance`)
  - **Data Structures:** Same `AddressBalance` shape; SQL is `SelectAddressSpentUnspentCountAndValue`.
  - **Transformations:** SQL groups by `(tx_type=0, coin_type, is_funding, matching_tx_hash IS NULL)` and emits both `SUM(value)` (VAR atoms) and `COALESCE(SUM(NULLIF(ska_value, '')::numeric), 0)::text AS ska_total` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)). Go-side: per-row `Scan(&isRegular, &coinType, &count, &totalValue, &skaTotal, &isFunding, &noMatchingTx)`. VAR (`coinType == 0`) goes to `CoinBalance.TotalSpent/TotalUnspent int64`; SKA accumulates into local `skaSpent`/`skaUnspent` `map[uint8]*big.Int`, then materializes into `CoinBalance.Total*SKA` strings (1570+).

- **Location:** [db/dcrpg/pgblockchain.go:3323-3397](db/dcrpg/pgblockchain.go#L3323-L3397) (`TxHistoryData`)
  - **Data Structures:** `TxHistoryData(ctx, address, addrChart dbtypes.HistoryChart, chartGroupings dbtypes.TimeBasedGrouping, coinType uint8) (*dbtypes.ChartsData, error)`.
  - **Transformations:** Default-coin collapse: `if coinType == CoinTypeAll { coinType = 0 }` (3328-3330) — charts are inherently per-coin. Cache lookup with coin-keyed key: `AddressCache.HistoryChart(addr, chart, grouping, coinType)` (3343). Per-address `CacheLocks.bal.TryLock` singleflight (3354). Dispatch to `retrieveTxHistoryByType` ([queries.go:2054-2089](db/dcrpg/queries.go#L2054-L2089)) or `retrieveTxHistoryByAmountFlow` ([queries.go:2091-2102](db/dcrpg/queries.go#L2091-L2102)). Store result keyed by coin: `StoreHistoryChart(addr, chart, grouping, coinType, cd, blockID)` (3394).

- **Location:** [db/cache/addresscache.go:375-486,1143-1199](db/cache/addresscache.go#L375-L1199) (`AddressCache.HistoryChart` / `StoreHistoryChart`)
  - **Data Structures:** `TxHistory{TypeByInterval [NumIntervals]map[uint8]*ChartsData, AmtFlowByInterval [NumIntervals]map[uint8]*ChartsData}` (378-379) — the coin-type map is the **inner** key, allowing per-coin caching at the same (address, interval).
  - **Transformations:** `(d *AddressCacheItem).HistoryChart` (461) returns `m[coinType]` if present; `StoreHistoryChart` (1143) lazily allocates the inner map then writes `m[coinType] = cd`.

- **Location:** [db/dcrpg/queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331) (`parseRowsSentReceived`)
  - **Data Structures:** Populates `dbtypes.ChartsData` ([types.go:2041-2057](db/dbtypes/types.go#L2041-L2057)) including `BalanceAtoms []string`, `ReceivedAtoms []string`, `SentAtoms []string`, `NetAtoms []string` (new SKA-string parallel fields).
  - **Transformations:** Scans four sum columns from `selectAddressAmountFlowByAddress`: `receivedVAR, sentVAR uint64` (`value INT8` partitioned by `coin_type = 0` / `is_funding`) and `receivedSKAStr, sentSKAStr string` (`NULLIF(ska_value,'')::numeric::text` partitioned by `coin_type > 0` / `is_funding`). VAR branch (`coinType == 0`): `toCoin = float64(amt) / 1e8` over `receivedVAR`/`sentVAR`, populate `Received/Sent/Net/Balance []float64`. SKA branch: `new(big.Int).SetString(*SKAStr, 10)` for per-row deltas, `*big.Int` accumulators emit `*Atoms []string`.
  - **✅ SKA precision fix (PR #263, commit `49953185`):** previously the row scanned only `Scan(&blockTime, &received, &sent uint64)` and reused the VAR `uint64`s for SKA — sending the truncated `addresses.value INT8` (which stores `vout.Value` regardless of coin type at [queries.go:2280](db/dcrpg/queries.go#L2280)) through `*big.Int.SetUint64`. SKA atoms (1e18 scale) live in `ska_value TEXT` and were ignored by the old single-pair SUM, so `Received/Sent/Net/Balance Atoms` were zeroed for every SKA coin. The fix added two text columns to the SQL and a four-column `Scan`; the SKA branch now builds `*big.Int` from `SetString(receivedSKAStr, 10)` etc. `COALESCE(..., 0)::text` in the SQL guarantees a valid decimal string. See `charts.impact.md §6.3` for the full before/after.

- **Location:** [cmd/dcrdata/internal/api/apirouter.go:178-200](cmd/dcrdata/internal/api/apirouter.go#L178-L200) + [apiroutes.go:1827-1896](cmd/dcrdata/internal/api/apiroutes.go#L1827-L1896)
  - **Data Structures:** `*dbtypes.ChartsData`.
  - **Transformations:** Routes are scoped by `m.AddressPathCtxN(1)`; chart routes additionally pass through `m.ChartGroupingCtx, m.CoinCtx` (185-186). Handlers `getAddressTxTypesData` (1827) and `getAddressTxAmountFlowData` (1864) call `DataSource.TxHistoryData(ctx, address, TxsType|AmountFlow, interval, coinType)`.
  - **Data interface:** `DataSource.TxHistoryData(... coinType uint8)`, `DataSource.AddressRowsCompact(... coinType uint8)` ([apiroutes.go:64-71](cmd/dcrdata/internal/api/apiroutes.go#L64-L71)).

- **Location:** [cmd/dcrdata/internal/api/apirouter.go:313-320](cmd/dcrdata/internal/api/apirouter.go#L313-L320) + [apiroutes.go:1728-1825](cmd/dcrdata/internal/api/apiroutes.go#L1728-L1825) (CSV download)
  - **Data Structures:** `[]*dbtypes.AddressRowCompact` (with `CoinType uint8` field at [types.go:1314](db/dbtypes/types.go#L1314)).
  - **Transformations:** `/download/address/io/{address}` and `/download/address/io/{address}/win` are wrapped in `m.CoinCtx` (apirouter.go:318). Handler calls `DataSource.AddressRowsCompact(ctx, address, coinType)` ([pgblockchain.go:2266-2310](db/dcrpg/pgblockchain.go#L2266-L2310)) which filters in-memory by `r.CoinType == coinType` (2303). CSV header: `tx_hash, direction, io_index, valid_mainchain, coin_type, amount, time_stamp, tx_type, matching_tx_hash` (1776-1777). Amount column: VAR → `strconv.FormatFloat(dcrutil.Amount(r.Value).ToCoin(), 'f', 8, 64)`; SKA → `dbtypes.FormatSKAPerVAR(r.SKAValue, r.CoinType)` (1803-1807). **Note:** SKA value is rendered as a human-readable string like `"1.23 SKA1"`, not raw atoms.

- **Location:** [cmd/dcrdata/views/address.tmpl](cmd/dcrdata/views/address.tmpl)
  - **Data Structures:** All `.Data.*` fields are public fields on `dbtypes.AddressInfo`/`AddressBalance`. Pagination links use `?start=`, `?n=`, `?txntype=` (lines 202, 211, 234, 248). **No `?coin=` in any server-rendered URL today.**
  - **Transformations:** Summary card reads `.Balance.TotalUnspent`/`.Balance.TotalSpent`/`.Balance.NumSpent`/`.Balance.NumUnspent` (lines 15, 48, 63, 70, 77, 83) — the legacy flat fields, kept in sync from `Coins[0]`. Helpers: `amountAsDecimalParts`, `toFloat64Amount` (`dcrutil.Amount.ToCoin() float64`) — VAR-only. Coin label is hard-coded `DCR` at 48, 50, 64, 66, 77, 79. `if $.FiatBalance` block (54-56) is unreachable because handler sets `FiatBalance: nil`. Container `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` (15) is read by the controller into `ctrl.balance` (230) and unused.

- **Location:** [cmd/dcrdata/views/extras.tmpl:210-315](cmd/dcrdata/views/extras.tmpl#L210-L315) (`addressTable`)
  - **Data Structures:** Per-row reads `AddressTx.{TxID, TxType, MergedTxnCount, SentTotal, ReceivedTotal, IsFunding, MatchedTx, MatchedTxIndex, Time, BlockHeight, Confirmations, FormattedSize}`. Headers hard-code `Credit VAR`/`Debit VAR` (222, 227, 230, 231, 233, 235, 236).
  - **Transformations:** Amounts via `float64AsDecimalParts .SentTotal 8 false` / `.ReceivedTotal 8 false`. **Does not read `.ReceivedTotalSKA`/`.SentTotalSKA`/`.CoinType`/`.SKAValue`.** SKA rows therefore render `0` in the amount cell, except for the `if eq .SentTotal 0.0` debit branch (277) which forces "sstxcommitment" — false-positive for SKA debits.

- **Location:** [cmd/dcrdata/public/js/controllers/address_controller.js](cmd/dcrdata/public/js/controllers/address_controller.js)
  - **Data Structures:** `this.settings` (chart, zoom, bin, flow, n, start, txntype — see line 211-219) backed by `TurboQuery`. `coin` is **not** in the null-template.
  - **Transformations:** `connect()` (194) seeds `settings` from URL via `query.update` (233). `drawGraph()` (473) short-circuits zoom-only changes (482-488); otherwise `fetchGraphData` (496) hits `/api/address/${addr}/${chartKey}/${bin}` (517-521) with `chartKey = chart === 'balance' ? 'amountflow' : chart`. **No `?coin=` is appended.** `popChartCache → validateZoom` (588 → 610) calls `Zoom.validate` (612) and `setZoom` (613). All URL writes flow through `query.replace(this.settings)` from `setGraphQuery` (635), `setZoom` (683), Dygraph callbacks (738, 749), and `fetchTable` (361). Legend formatter still emits `${series.y} DCR` (84); ylabels `Total (DCR)` (130) / `Balance (DCR)` (140). `amountFlowProcessor` (30-53) integrates `d.net[i]` as JS `Number` — float-only; ignores `BalanceAtoms`/`ReceivedAtoms`/`SentAtoms`/`NetAtoms` in the response.

### 4. Cross-Layer Dependencies
- **Template ↔ struct:** every `.Data.*` reference in `views/address.tmpl` and the `addressTable` template in `views/extras.tmpl` is a public field on `dbtypes.AddressInfo`/`AddressBalance`/`AddressTx`; renames break template parsing at runtime.
- **Dual-field migration shim:** the template reads `Balance.TotalUnspent`/etc. (flat-VAR) but the truth is in `Balance.Coins[*]`. Three Go-side sync points must stay in lockstep:
  1. `ReduceAddressHistory` ([types.go:2557-2562](db/dbtypes/types.go#L2557-L2562)) — paginated shortcut.
  2. `AddressHistory` cache-miss path ([pgblockchain.go:2512-2519](db/dcrpg/pgblockchain.go#L2512-L2519)).
  3. `AddressData` after full balance overwrite ([pgblockchain.go:2610-2615](db/dcrpg/pgblockchain.go#L2610-L2615)).
- **Pagination URL contract:** `?start=`, `?n=`, `?txntype=` are produced by both server-rendered links (template) and client-side `fetchTable`; both must match `parseAddressParams` keys. `coin` is **only** in the server-side middleware contract; no client-side write today.
- **Chart URL contract:** `<select>` option `value` (`balance`/`types`/`amountflow`, template 128-130) ↔ `apirouter.go:185-186` URL segment ↔ `address_controller.js:fetchGraphData` (517-521). Renaming silently 404s. `coin=` is a new optional segment but the controller does not emit it.
- **Shared params parser + middleware:** `AddressPage` (1535) and `AddressTable` (1652) both call `parseAddressParams` and `middleware.GetCoinCtx`; drift between server-rendered initial table and XHR-refreshed table is a class of subtle bugs.
- **CoinType context propagation:** `CoinTypeAll = 255` flows uniformly from `CoinCtx` → handler → `AddressListData` → `AddressData` → coin-aware SQL (`countMerged*`, `retrieveAddressTxns`, `nonMergedTxnCount`) where each function maps `CoinTypeAll` to the all-coin SQL variant (e.g. `SelectAddressesMergedCountAll` vs `SelectAddressesMergedCount`). For chart endpoints, `CoinTypeAll → 0` (VAR) — different semantics; do not confuse.
- **Cache key co-dependency:** `AddressCache.HistoryChart` is keyed by `(address, HistoryChart, TimeBasedGrouping, coinType)`. Cache freshness invalidation (`FreshenAddressCaches`) is still global per-address — a reorg invalidates all coin types together.
- **Co-mounted controllers:** `data-controller="address newblock"` (template line 11) — `newblock` mutates `data-newblock-target="confirmations"` cells; `address._confirmMempoolTxs` (774) walks `pendingTargets` and decrements `numUnconfirmedTargets`. The address controller's `numUnconfirmed` decrement is **single-counter** today; the backend's `NumUnconfirmedByCoin` map is delivered but unread.

### 5. Critical Constraints
- **Backend multi-coin / frontend single-coin asymmetry:** `AddressInfo.Balance.Coins`, `AddressInfo.ActiveCoins`, `AddressTx.ReceivedTotalSKA`/`SentTotalSKA`/`CoinType`/`SKAValue`, `ChartsData.BalanceAtoms`/`ReceivedAtoms`/`SentAtoms`/`NetAtoms`, `AddressInfo.NumUnconfirmedByCoin`, and `AddressRowCompact.CoinType` are all populated end-to-end. The template + JS controller still render exactly one coin (VAR) and label everything `DCR`. This is the "last unconverted surface" the `feat/address-ui` branch is intended to fix.
- **`CoinTypeAll = 255` sentinel has two meanings:** "no filter — show all coins" everywhere except chart endpoints, where it collapses to `0` (VAR). Documented at [pgblockchain.go:3327-3330](db/dcrpg/pgblockchain.go#L3327-L3330).
- **SKA precision invariant (C1):** SKA atoms live in `addresses.ska_value TEXT` and `vins.ska_value TEXT`; SKA aggregates must stay as decimal strings backed by `*big.Int`. `dbtypes.BigAddSKA(acc, str)` is the canonical accumulator. The `chart amountflow` SQL + `parseRowsSentReceived` now honor this invariant end-to-end as of PR #263 (formerly the SUM-the-wrong-column violation noted in older revisions of this doc).
- **Chart endpoints are single-coin:** `TxHistoryData` always operates on one coin; no aggregate-across-coins option. The legacy "coin-agnostic" behavior was replaced.
- **Dummy/zero address short-circuit (1593-1603):** required because zero addresses have so many outputs that DB queries time out. Removing it is a hard regression.
- **Zoom encoding:** `Zoom.encode` (`helpers/zoom_helper.js`) is base-36 ms timestamps `"<start>-<end>"`. Stale values across chart-type changes parse cleanly but lie outside the new chart's range, so `Zoom.validate` clamps silently — never throws.
- **TurboQuery null-template:** every URL key the controller mutates must be declared with a null value in `connect()` settings (`address_controller.js:211-219`); undeclared keys aren't persisted. `coin` is **not** declared today.
- **`FiatBalance` is wired to `nil`:** `xcBot.Conversion` is no longer called from the address handler. The `if $.FiatBalance` template branch is unreachable. Re-enabling fiat requires a multi-coin price model.

### 6. Mutation Impact
When modifying the address page or its chart/table state, check:
- **Direct dependencies:** `dbtypes.AddressInfo`/`AddressBalance`/`CoinBalance`/`AddressTx`/`AddressRowCompact`/`ChartsData` field names — referenced by `views/address.tmpl`, `views/extras.tmpl` (`addressTable`), three handlers in `explorerroutes.go` (`AddressPage`, `AddressTable`, `AddressListData`), DB layer, and four mocks (`explorer_test.go`, `noop_ds_test.go`, `address_api_test.go`, `apiroutes_test.go`).
- **Indirect dependencies:** `address_controller.js` URL contract (chart kind, group-by bin, pagination keys; **no `coin` today**), `apirouter.go:178-200, 313-320` route segments, `middleware.CoinCtx` semantics (255 = "no filter" vs charts' 255→0 collapse).
- **Serialization boundaries:** `/api/address/{addr}/{kind}/{bin}?coin=N` JSON shape (`*dbtypes.ChartsData`); `/addresstable/{addr}?...&coin=N` HTML fragment (`{tx_count, html, pages}`); `/download/address/io/{addr}?coin=N` CSV with columns `tx_hash, direction, io_index, valid_mainchain, coin_type, amount, time_stamp, tx_type, matching_tx_hash`; bookmarked URLs with `?zoom=`/`?chart=`/`?bin=`/`?start=`.
- **Rendering layers:** template precision helpers (DCR-only today), Dygraph zoom validation (`validateZoom` at 610), chart legend/ylabel strings (still `DCR`).
- **Silent failures:**
  - SKA balance / amount precision loss in `address.tmpl` and `extras.tmpl` (uses `.TotalUnspent`/`.SentTotal`/`.ReceivedTotal` — all coin-agnostic floats representing VAR only).
  - (Fixed in PR #263 — formerly: SKA `amountflow` chart silently truncated/zero because the SQL summed `value` not `ska_value::numeric`. Kept as a historical note because tests written against the broken-but-stable backend may still encode the old shape; SQL is now [addrstmts.go:351-359](db/dcrpg/internal/addrstmts.go#L351-L359) and scan in [queries.go:4296-4324](db/dcrpg/queries.go#L4296-L4324).)
  - Stale `?zoom=` after chart-type change — `setGraphQuery` (635) writes prior chart's zoom into the URL of the new chart; `Zoom.validate` clamps silently. Refresh re-applies the wrong window.
  - `if eq .SentTotal 0.0` (extras.tmpl:277) classifies every SKA debit row as "sstxcommitment".
  - `db/cache` desync after a reorg — chart series stale while table is fresh.
  - Legacy flat-field sync (`balance.TotalUnspent = Coins[0].TotalUnspent`) writes zero for pure-SKA addresses; template renders `0 DCR`.
- **Hard failures:**
  - Template parse error if `AddressInfo`/`AddressBalance`/`AddressTx` field is renamed without updating both `address.tmpl` and the `addressTable` block in `extras.tmpl`.
  - 404 on chart fetch if `<option value>` doesn't match an API route segment.
  - `txhelpers.AddressValidation` rejection (1556) renders an error page; template never executes.
  - DataSource interface signature drift — must update production type plus four mocks together.

### 7. Common Pitfalls
- Adding more `dcrutil.Amount.ToCoin()`/`toFloat64Amount` calls to the address template — locks in SKA precision loss and re-cements the migration shim.
- Calling `setGraphQuery` without first deciding whether `settings.zoom` is still meaningful for the new chart — exact mechanism behind the stale-zoom defect (`changeGraph` at 620, `changeBin` at 626).
- Adding a new query param (e.g. `coin`) without declaring a null entry in `connect()` 211-219 — `TurboQuery` won't persist it.
- Updating `AddressPage` without mirroring the change in `AddressTable` (1652) — XHR refresh diverges from initial render. Both also need the same `middleware.GetCoinCtx(r)` plumbing.
- Renaming `<select>` chart option values without updating `apirouter.go` and `fetchGraphData` URL construction.
- Adding a new per-coin field to `AddressBalance` and forgetting to wire one of: `ReduceAddressHistory`, `retrieveAddressBalance`, the mempool overlay in `AddressData`, or the flat-field sync.
- Writing SKA aggregation in SQL via `SUM(value)` — the `value INT8` column stores `vout.Value`, not SKA atoms. Use `SUM(NULLIF(ska_value,'')::numeric)::text` and scan as string. The dual-column pattern (VAR sums + SKA sums in one query, guarded by `coin_type` `CASE`s) was established by PR #263 for `selectAddressAmountFlowByAddress`; copy that shape rather than the pre-fix single-`SUM(value)` shape.
- Confusing `CoinTypeAll`'s semantics: 255 = "all coins" for table/CSV/counts, but 255 → 0 (VAR) for chart endpoints.

### 8. Evidence
- **Routes:** [cmd/dcrdata/main.go:768-769](cmd/dcrdata/main.go#L768-L769); `AddressPathCtx` middleware at `cmd/dcrdata/internal/explorer/explorermiddleware.go`.
- **CoinCtx middleware:** [cmd/dcrdata/internal/middleware/apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842).
- **Page handler:** [cmd/dcrdata/internal/explorer/explorerroutes.go:1535](cmd/dcrdata/internal/explorer/explorerroutes.go#L1535) (`AddressPage`), inline struct at 1539-1546, `parseAddressParams` at 1549, `AddressListData` at 1605, `FiatBalance: nil` at 1633, `templates.exec` at 1635, dummy address branch 1593-1603.
- **Table XHR handler:** [explorerroutes.go:1652](cmd/dcrdata/internal/explorer/explorerroutes.go#L1652) (`AddressTable`).
- **AddressListData:** [explorerroutes.go:1875](cmd/dcrdata/internal/explorer/explorerroutes.go#L1875).
- **DB layer:** [db/dcrpg/pgblockchain.go:2533](db/dcrpg/pgblockchain.go#L2533) (`AddressData`), 2419 (`AddressHistory`), 2389 (`CountTransactions`), 2312 (`retrieveMergedTxnCount`), 2332 (`mergedTxnCount`), 2345 (`nonMergedTxnCount`), 2947 (`FillAddressTransactions`), 2687 (mempool overlay invocation), 3325 (`TxHistoryData`), 2266 (`AddressRowsCompact`).
- **DB queries:** [db/dcrpg/queries.go:1450](db/dcrpg/queries.go#L1450) (`retrieveAddressCoinTypes`), 1472 (`retrieveAddressBalance`), 1874 (`retrieveAddressTxns`), 1908 (`retrieveAddressCount`), 2054 (`retrieveTxHistoryByType`), 2096 (`retrieveTxHistoryByAmountFlow`), 4289 (`parseRowsSentReceived` — now scans 4 cols; SKA fix per PR #263).
- **DB SQL:** [db/dcrpg/internal/addrstmts.go:234](db/dcrpg/internal/addrstmts.go#L234) (`SelectAddressSpentUnspentCountAndValue`), 249 (`SelectAddressCoinTypes`), 270 (`SelectAddressLimitNByAddress`), 276 (`...All`), 338 (`selectAddressTxTypesByAddress` — with `coin_type=$2`), 351 (`selectAddressAmountFlowByAddress` — dual VAR/SKA `SUM` columns; PR #263 fix).
- **Types:** [db/dbtypes/types.go:2322](db/dbtypes/types.go#L2322) (`AddressInfo` — with `Coins`, `ActiveCoins`, `NumUnconfirmedByCoin`), 2375 (`CoinBalance`), 2392 (`AddressBalance` — `Coins map[uint8]*CoinBalance` + legacy flat fields), 2456 (`ReduceAddressHistory`), 2252 (`AddressTx`), 1304 (`AddressRowCompact` with `CoinType`), 2041 (`ChartsData` with `*Atoms` parallel SKA series), 47 (`CoinTypeAll = 255`).
- **Cache:** [db/cache/addresscache.go:378](db/cache/addresscache.go#L378) (`TxHistory` shape), 461 (`AddressCacheItem.HistoryChart`), 866 (`AddressCache.HistoryChart`), 1143 (`StoreHistoryChart`).
- **Chart API:** [cmd/dcrdata/internal/api/apirouter.go:178-200](cmd/dcrdata/internal/api/apirouter.go#L178-L200); handlers [apiroutes.go:1827,1864](cmd/dcrdata/internal/api/apiroutes.go#L1827-L1864).
- **CSV API:** [apirouter.go:313-320](cmd/dcrdata/internal/api/apirouter.go#L313-L320); handler [apiroutes.go:1728-1825](cmd/dcrdata/internal/api/apiroutes.go#L1728-L1825).
- **DataSource interface + mocks:** [apiroutes.go:64-71](cmd/dcrdata/internal/api/apiroutes.go#L64-L71); [explorer.go:105-106](cmd/dcrdata/internal/explorer/explorer.go#L105-L106); mocks at `cmd/dcrdata/internal/explorer/explorer_test.go`, `cmd/dcrdata/internal/api/noop_ds_test.go:40,53`, `cmd/dcrdata/internal/api/address_api_test.go:15`, `cmd/dcrdata/internal/api/apiroutes_test.go:337,359,383`.
- **Mempool:** [mempool/monitor.go:481-572](mempool/monitor.go#L481-L572) (`UnconfirmedTxnsForAddress` returns `map[uint8]int64`).
- **Template:** [cmd/dcrdata/views/address.tmpl](cmd/dcrdata/views/address.tmpl) (DCR labels lines 48, 50, 64, 66, 77, 79; pagination URLs 202, 211, 234, 248; chart options 128-130; group-by buttons 154-158; container `data-` attrs 10-16; `if $.FiatBalance` unreachable today at 54-56).
- **addressTable:** [cmd/dcrdata/views/extras.tmpl:210-315](cmd/dcrdata/views/extras.tmpl#L210-L315) (Credit/Debit VAR literals at 222, 227, 230, 231, 233, 235, 236; float-only amount rendering at 251, 254, 258, 262, 265, 267, 277, 284).
- **Frontend controller:** [cmd/dcrdata/public/js/controllers/address_controller.js](cmd/dcrdata/public/js/controllers/address_controller.js) — `connect` 194, settings template 211-219, `query.update` 233, zoom-button-clear 236-240, DCR legend 84, ylabels 130/140, `amountFlowProcessor` 30-53, `makeTableUrl` 319-323, `fetchTable` 361, `drawGraph` 473, `fetchGraphData` 496-527, `popChartCache` 548, `validateZoom` 610, `changeGraph` 620, `changeBin` 626, `setGraphQuery` 635, `onZoom` 666, `setZoom` 683-692, Dygraph callbacks 738/749, `_confirmMempoolTxs` 774.
- **Zoom helper:** [cmd/dcrdata/public/js/helpers/zoom_helper.js](cmd/dcrdata/public/js/helpers/zoom_helper.js) — `Zoom.encode/decode/validate/mapValue/mapKey`.

See also:
- /wiki/code-analysis/address/flow.compact.md (compact-of: this trace)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: dual-field migration shim, `CoinCtx` URL/middleware contract)
- /wiki/code-analysis/address/summary.impact.md (depends-on: legacy flat-field sync — the surface still reading it)
- /wiki/code-analysis/address/transactions.impact.md (depends-on: `AddressTx.SKAValue`/`SentTotalSKA` plumbing — already populated, unread)
- /wiki/code-analysis/address/charts.impact.md (depends-on: chart `?coin=` URL wiring + SKA SQL precision fix in PR #263)
- /wiki/code-analysis/charts/flow.full.md (shares-pattern-with: TurboQuery URL-state persistence; `Zoom` validation; per-coin chart pipelines)
- /wiki/code-analysis/transaction/flow.full.md (depends-on: address transaction list rendering)
- /wiki/code-analysis/mempool/flow.full.md (depends-on: `UnconfirmedTxnsForAddress` now returns per-coin map; address overlay consumes it)
- /wiki/core/constraints.md#C1 (depends-on: numeric precision & bifurcation — backend honored, template+controller still violate)
- /wiki/core/constraints.md#C7 (depends-on: centralised coin-type label rendering — `DCR` literals still in `address.tmpl`, `extras.tmpl addressTable`, `address_controller.js`)
