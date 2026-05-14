### One-line Flow
chi `/address/{addr}` → `AddressPathCtx` → `AddressPage` → `parseAddressParams` + `middleware.GetCoinCtx` → `AddressListData(... coinType)` → PG `AddressData` (`AddressHistory` + `mergedTxnCount` / `CountTransactions` + `FillAddressTransactions` + `mempool.UnconfirmedTxnsForAddress` returning per-coin counts) → `templates.exec("address", AddressPageData{Data:*AddressInfo, Pages, FiatBalance:nil})` → `address` Stimulus controller (TurboQuery URL state; charts via `/api/address/{addr}/{types|amountflow}/{bin}?coin=N`; table via `/addresstable/{addr}?...&coin=N`; CSV via `/download/address/io/{addr}?coin=N`).

### Key Architectural Patterns
- **Inline page-payload struct:** `AddressPageData{*CommonPageData, Data, Type, CRLFDownload, Pages, FiatBalance interface{}}` — the project's standard wrapper around a `dbtypes.*Info` core. `FiatBalance` is currently always `nil` (commented `TODO: Remove once frontend is updated for multi-coin support`).
- **Dual-field migration shim:** `AddressBalance` carries both the new `Coins map[uint8]*CoinBalance` (per-coin truth) and legacy flat `TotalSpent`/`TotalUnspent`/`NumSpent`/`NumUnspent` fields synced from `Coins[0]` (VAR-only). The template still reads the flat fields. Three sync points must stay in lockstep: `ReduceAddressHistory`, `AddressBalance` shortcut, and `AddressData` after the cache miss path.
- **`?coin=` URL contract via `CoinCtx` middleware:** `?coin=N` (1-255) selects a single coin; absence or `255` means "no filter". A single sentinel `dbtypes.CoinTypeAll = 255` flows everywhere; chart pipeline collapses `CoinTypeAll → 0` (VAR) silently.
- **Per-coin SKA accumulation:** every place that aggregates SKA atoms uses `*big.Int` + `dbtypes.BigAddSKA(acc, decimalString)` and writes back as `string` (e.g. `CoinBalance.TotalReceivedSKA`, `ChartsData.BalanceAtoms`). VAR continues to flow as `int64` atoms / `float64` coins.
- **Shared params parser:** `parseAddressParams` is reused by HTML (`AddressPage`), XHR (`AddressTable`); coin filter comes from `middleware.GetCoinCtx(r)` — out-of-band from `parseAddressParams`. Both entry points must read both.
- **TurboQuery URL ownership:** every UI write (chart, bin, zoom, pagination, type filter) goes through `this.query.replace(this.settings)` (history-replace, no full nav). All persisted keys must be declared with null values in `connect()`. `coin` is **not** in the null-template today.
- **Zoom encoding:** base-36 ms timestamps `"<start>-<end>"`; `Zoom.validate` clamps silently to current data range — stale values never error.

### Critical Constraints
- **Backend is multi-coin; frontend renders VAR only (summary card + chart axes).** `AddressBalance.Coins` is populated end-to-end, but `address.tmpl` reads `Balance.TotalUnspent`/`Balance.TotalSpent`/`Balance.NumSpent`/`Balance.NumUnspent` (all flat-VAR fields) and labels everything `DCR`. Chart controller still emits `${series.y} DCR`, `Total (DCR)`, `Balance (DCR)`. SKA-aware payload (`ReceivedTotalSKA`, `SentTotalSKA`, `BalanceAtoms`, etc.) is delivered but unread.
- **`?coin=` is in the URL contract for backend, not yet for the controller.** TurboQuery null-template (`address_controller.js:211-219`) does not declare `coin`. Adding a coin selector means: declare here, thread through `fetchTable`/`fetchGraphData` URL builders, and add to the `address.tmpl` container `data-` attrs.
- **`FiatBalance` is currently always `nil`.** The `if $.FiatBalance` branch in the template never fires; the fiat row was removed pending a multi-coin price model.
- **Dummy/zero address branch** (`AddressInfo.IsDummyAddress: true`) prevents DB timeouts on the unspendable ticket-change address. Required.
- **Stale `?zoom=` across chart-type changes:** `changeGraph`/`changeBin` call `setGraphQuery` without resetting `settings.zoom`; URL keeps the prior chart's window, `validateZoom` silently clamps it.
- **SKA precision in chart `amountflow` SQL — fixed in PR #263.** `selectAddressAmountFlowByAddress` now emits dual VAR/SKA `SUM` columns (`value INT8` for `coin_type = 0`; `NULLIF(ska_value,'')::numeric::text` for `coin_type > 0`), and `parseRowsSentReceived` scans both pairs — building the `*big.Int` accumulator from the text columns when `coinType > 0`. The previous bug (single `SUM(value)` truncating 1e18 SKA atoms to ~zero) is gone end-to-end on the backend. See `charts.impact.md §6.3` for the trace.

### Mutation Checklist
When modifying the address page:
- [ ] Touching `AddressInfo`/`AddressBalance` fields? Grep `address.tmpl`, `addressTable.tmpl` (defined in `extras.tmpl`), the three handlers in `explorerroutes.go` (`AddressPage` ~1535, `AddressTable` ~1652, `AddressListData` ~1875), DB layer (`pgblockchain.go` AddressData/AddressHistory/retrieveAddressBalance/ReduceAddressHistory), and four mocks: `cmd/dcrdata/internal/explorer/explorer_test.go`, `cmd/dcrdata/internal/api/noop_ds_test.go`, `cmd/dcrdata/internal/api/address_api_test.go`, `cmd/dcrdata/internal/api/apiroutes_test.go`.
- [ ] Adding a per-coin field? It needs to populate from **three** code paths: `ReduceAddressHistory` (paginated row reduction), `retrieveAddressBalance` (SQL aggregate), and `AddressData`'s mempool overlay. Drop the legacy flat-field sync only when the template stops reading it.
- [ ] New URL query key? Add a null entry in `address_controller.js:connect()` settings template (211-219) **and** decide whether it belongs in the URL builders (`makeTableUrl` ~319, `fetchGraphData` ~517). For coin-aware keys, also touch `apirouter.go` (`m.CoinCtx` middleware chain) and CSV route.
- [ ] New chart kind or group-by bin? Match `<select>`/`<button>` `name`/`value` ↔ `apirouter.go` URL segment ↔ `fetchGraphData` URL construction.
- [ ] Touching zoom-relevant code? Decide explicitly what `settings.zoom` means after the change (drop / project / keep) before `setGraphQuery` writes it to the URL.
- [ ] Working on the chart `amountflow` SQL or `parseRowsSentReceived`? The dual-column SKA/VAR pattern was established by PR #263 — preserve it: VAR sums `value INT8`, SKA sums `NULLIF(ska_value,'')::numeric::text`, and the Go scan reads four columns (`receivedVAR, sentVAR uint64, receivedSKAStr, sentSKAStr string`).
- [ ] Multi-coin frontend work? `AddressInfo.Balance.Coins` already carries the per-coin map; `ActiveCoins []uint8` carries the sorted list. Format SKA atoms as strings via `formatAtomsAsCoinString`/`skaDecimalParts`/`coinSymbol` at the template boundary, never via `ToCoin()`.

See also:
- /wiki/code-analysis/charts/flow.compact.md (shares-pattern-with: TurboQuery + Zoom validation; per-coin chart endpoints)
- /wiki/code-analysis/transaction/flow.compact.md (depends-on: address tx list rendering)
- /wiki/code-analysis/address/summary.impact.md (depends-on: summary card multi-coin migration — last unconverted surface)
- /wiki/code-analysis/address/transactions.impact.md (depends-on: per-tx Coin column / coin filter UX)
- /wiki/code-analysis/address/charts.impact.md (depends-on: chart `?coin=` URL wiring; SKA SQL precision fix in PR #263)
- /wiki/core/constraints.md#C1 (depends-on: float64-vs-string precision — backend honored, template + controller still violate for SKA)
- /wiki/core/constraints.md#C7 (depends-on: centralised coin-type label rendering — `DCR` literals still hard-coded in `address.tmpl` and `address_controller.js`)
