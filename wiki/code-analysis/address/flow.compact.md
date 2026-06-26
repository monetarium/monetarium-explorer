### One-line Flow
chi `/address/{addr}` → `AddressPathCtx` → `AddressPage` + `middleware.GetCoinCtx` → `AddressData(...coinType)` → `AddressHistory(...,coinType)` [`coinType≠255`: load full per-coin rows, **filter then `SliceAddressRows`**, + full `AddressBalance`] → mempool overlay appends coin-filtered unconfirmed rows but **not** balance → `AddressInfo{Balance.Coins, ActiveCoins, NumUnconfirmedByCoin}` → `address.tmpl` (`range .ActiveCoins`) + `extras.tmpl` (Coin column) → `address` controller (TurboQuery incl. `coin`; charts `/api/address/{addr}/{types|amountflow}/{bin}?coin=N` → raw payload cached → `defFor(chart,coin)` → `ChartPanel.render(def, payload, settings, opts)` → `def.toColumns` + `def.formatValue` (SKA precision firewall in `formatValue`)).

> Re-verified at `HEAD=fcad89dd` (2026-06-25). Tier 1 Refresh (anchor `bba67634→fcad89dd`):
> re-traced `address_controller.js` (ChartPanel retrofit), `address.tmpl`, `queries.go`
> (missed-votes only — not address); widened into `chart_panel.js` + `charts/definitions/address.js`.
> DB/API/template layers and all constraints from the prior trace remain accurate.

### Key Architectural Patterns
- **Filter-before-paginate (new invariant):** coin-filtered `AddressHistory` pulls the full per-coin row set (cache or `updateAddressRows`), filters by `r.CoinType`, *then* `SliceAddressRows`. Filtering after LIMIT/OFFSET = unreachable rows. Guarded by `db/dbtypes/coinfilter_test.go`.
- **`?coin=` URL contract via `CoinCtx`:** `?coin=N` (1–254) selects one coin; absent/invalid/`255` ⇒ `CoinTypeAll=255` (no filter). Chart pipeline + JS `effectiveCoin()` both collapse `CoinTypeAll→0` (VAR). `coin` is in the controller TurboQuery null-template and on `linkTemplate`.
- **Confirmed-only balance:** the mempool accumulator block in `AddressData` was deleted; unconfirmed rows still listed (coin-filtered) but never folded into `Balance.Coins`. Unconfirmed surfaces via `NumUnconfirmed` / `NumUnconfirmedByCoin`.
- **ChartPanel + per-chart definitions:** the controller creates one `ChartPanel` (chart + tooltip + ranger + theme + resize) and selects a definition factory (`balanceDef`, `typesDef`, `amountflowDef` from `charts/definitions/address.js`) per chart type. The panel is told the raw payload; `def.toColumns` builds columns; `def.formatValue` renders the tooltip — **SKA precision firewall lives in `formatValue`** (reads exact atom strings from `datum.payload`, never `datum.value` which is the lossy stacked cumulative). The Dygraph chart processors (`amountFlowProcessor`, `makeAmountFormatter`, `skaAtomsByTime`) are gone.
- **Coin-keyed chart cache + ChartPanel identity:** client cache `ctrl.retrievedData` keys by `${chart}-${bin}-${coin}` (unchanged). ChartPanel reuses the uPlot handle when `def === ctrl.currentDef` (same object reference); `defFor()` is called once per `popChartCache` and stored in `ctrl.currentDef`. A new factory call inside `renderChart()` would break this.
- **`jsonMarshal` template func:** coerces `[]uint8`→`[]int` so `data-active-coins` is a JSON array, not base64; controller `JSON.parse`s it into `activeCoins`.

### Critical Constraints
- **Coin filter must precede LIMIT/OFFSET** (`TestCoinFilterBeforePagination`).
- **`CoinTypeAll` must stay 255**, distinct from every real coin (`TestCoinTypeAllSentinel`). Any in-memory `if r.CoinType == coinType` row filter must short-circuit on `CoinTypeAll` (return all rows) — `AddressCache.Rows` / `AddressRowsCompact` do; missing this empties the no-`?coin=` CSV (`TestAddressCacheRows_CoinTypeAll`).
- **`utxoStore.set()` must pass `SKAValue` through.** The `skaValue string` eighth parameter of `utxoStore.set()` (pgblockchain.go:176) feeds `insertSpendingAddressRow`; dropping it silently zeroes `sent_ska` on every address amount-flow chart for SKA coins.
- **Mempool must not affect balance** — confirmed-DB only by design; don't reintroduce the deleted accumulator.
- **Merged view has no `coin_type` predicate** — query `SelectAddressMergedView` directly with `(address,N,offset)`; the old stmt-helper route bound `coinType=0` as `LIMIT 0` → zero rows (fixed `be28442e`).
- **CSV download is a deliberate full export.** `/download/address/io/{addr}` link (`address.tmpl:346`) is static — no `?coin=`/`?txntype=`; `addressIoCsv` always pulls `AddressRowsCompact(..., CoinTypeAll)`. On-page Type/Coin filters scoping it was explicitly declined; don't "fix" it.
- **Merged rows carry coin + SKA.** `AddressRowMerged{CoinType, SKAAtomsCredit/Debit *big.Int}`; `Merge*` builders fold via `add()`, `UncompactMergedRows` emits `CoinType`+`SKAValueStr()`. Guarded by `TestMergedRowsPreserveCoinAndSKA`/`TestMergedCompactMixedCoins`.
- **SKA precision (C1):** `def.formatValue` reads exact atom strings from `datum.payload`; `Number(atom)*1e-18` is geometry-only (in `toColumns`). Never read `datum.value` in `formatValue` for stacked charts — that's the cumulative stacked total.
- **Flow mutual exclusivity:** Net (Received − Sent) must not be stacked with Received/Sent. `enforceFlowExclusivity`/`clampFlowExclusivity` enforce this; bypass = double-counted bars.
- **Coin labels centralized (C7):** `coinSymbol` (template) / `renderCoinType` (JS); no `DCR`/`VAR` literals.
- `AddressHistory(... txnView, coinType uint8)` — 6-site signature (DB, two Go interfaces, four mocks).

### Mutation Checklist
- [ ] Change `AddressHistory` signature? Update `db/dcrpg/pgblockchain.go`, `explorer.go:80`, `apiroutes.go:58`, and mocks `noop_ds_test.go`, `explorer_test.go`, `pgblockchain_test.go`.
- [ ] Per-coin field on `AddressInfo`/`CoinBalance`? Populate at `pgblockchain.go:2592` **and** `:2648` (both `ActiveCoins` branches) and `:2719` (`NumUnconfirmedByCoin`); confirm `retrieveAddressBalance` aggregate + the filter-before-paginate balance path.
- [ ] New URL query key? Add to `address_controller.js` null-template (`:120`), URL builders, `linkTemplate` (Go), and decide `CoinCtx` involvement.
- [ ] `ChartsData` field rename? Update the matching field name in the definition's `toColumns` + `formatValue` — `omitempty` hides a mismatch (silent blank/NaN chart).
- [ ] New chart value in `formatValue`? Read `datum.payload.<field>[datum.idx]`, NOT `datum.value` (stacking makes that the cumulative total).
- [ ] New chart definition? Return a stable factory reference (via `ctrl.defFor`) stored in `ctrl.currentDef`; don't re-call the factory inside `renderChart`.
- [ ] Amount-flow series change (add/remove)? Update `flowVisibility` bitmap width + label keys + `enforceFlowExclusivity` NET value + `address_controller.test.js` mapping table.
- [ ] Unconfirmed display work? Use `NumUnconfirmedByCoin`; do NOT re-fold mempool amounts into balance.
- [ ] Merged-view query? Call `SelectAddressMergedView` directly `(address,N,offset)`; never via the coin-injecting stmt helper.
- [ ] SKA values in template? `coinSymbol`/`skaDecimalParts`. In JS `formatValue`? Read raw atom string from `datum.payload`; format via `formatSkaAtomsExact`; never `datum.value`.
- [ ] `data-coin-type` attr or unconfirmed-decrement logic? Keep SSR attr and JS string compare in lockstep.

### Stale-Claim Delta (prior `a8f641f2` → `1b670255` — original multi-coin)
| Prior wiki claim | Current reality |
|---|---|
| Frontend renders VAR only; hard-coded `DCR` | Multi-coin end-to-end; `coinSymbol`/`renderCoinType`; per-coin summary + Coin column |
| `coin` not in TurboQuery null-template; controller not coin-aware | `coin` in null-template; `changeCoin`/`coinUrlSegment`/`effectiveCoin`; coin-keyed cache |
| `FiatBalance` always nil, branch never fires | Field + template branch **deleted** |
| Mempool overlay folds into balance totals | Removed; balance confirmed-only; mempool via `NumUnconfirmedByCoin` |
| `AddressHistory(... txnView)` | `AddressHistory(... txnView, coinType uint8)` |
| (not documented) | merged-view LIMIT-0 fix + filter-before-paginate invariant + regression tests |
| Chart `amountflow` SKA SQL fix (PR #263) | Still valid; JS chart pipeline now coin-keyed + server-precomputed cumulative balance |

### Stale-Claim Delta (`1b670255` → `a48ea0e1` — prior Refresh)
| Prior wiki claim | Current reality |
|---|---|
| `utxoStore` SKA handling undocumented | `utxoStore.set()` now stores `SKAValue` (pgblockchain.go:176-196); prior omission caused all SKA spending rows to have `ska_value=''` → `sent_ska=0` on amount-flow charts |
| `FromStake`/`ToStake` VAR-only | `retrieveAddressBalance` computes per-coin `FromStake`/`ToStake`; VAR-only in practice (SKA staking not planned) |
| Dygraph `ylabel` for chart title | `ylabel` removed; title in `data-address-target="chartTitle"` DOM div |
| `maxAddrRows` / `pageSizeOptions` in controller | Both removed; always-enabled 20/40/80/160 dropdown |
| Per-index `setVisibility` loop in `updateFlow` | `flowVisibility(bitmap)` export returns single map; one `setVisibility(object)` call |

### Stale-Claim Delta (`bba67634` → `fcad89dd` — this Refresh, Tier 1)
| Prior wiki claim | Current reality |
|---|---|
| `amountFlowProcessor(data, effectiveCoin(), skaAtomsByTime)` in chart flow | Removed; raw payload cached; `defFor(chart,coin)` selects definition; `ChartPanel.render(def, payload, settings, opts)` |
| `skaAtomsByTime` Map bridges SKA atom strings to legend | Deleted; SKA precision firewall lives in `def.formatValue` which reads `datum.payload` directly |
| `Dygraph` lazy-loaded in controller | Dygraphs removed; replaced by `createChartPanel` from `helpers/chart_panel.js` |
| `flowVisibility` returns index-keyed `{0:bool, 1:bool, 2:bool, 3:bool}` | Now label-keyed `{Received, Spent, 'Net Received', 'Net Spent': bool}` for uPlot adapter |
| `_drawCallback`/`_zoomCallback` handle zoom URL persistence | Removed; `onRangeChange` in `createChartPanel` options fires for both chart drag and ranger drag |
| `setZoom` calls `graph.updateOptions({dateWindow})` | Calls `panel.setXRange(start/1000, end/1000)` (ms→seconds at uPlot boundary) |
| `ctrl.xRange` / `ctrl.graph` | `ctrl.xExtent` / `ctrl.panel` |
| No mutual exclusivity on Net/Sent/Received checkboxes | `enforceFlowExclusivity`/`clampFlowExclusivity` enforce Net ↔ Sent/Received mutual exclusivity |
| No ranger strip on address charts | `rangerView` target (`address.tmpl:271`) + `rangerColumn` export in controller |
| "Sent" checkbox unchecked by default | Now `checked="checked"` by default in `address.tmpl` |

See also:
- /wiki/code-analysis/address/flow.full.md (Sections 1–8)
- /wiki/code-analysis/charts/flow.compact.md (shares-pattern-with: TurboQuery URL ownership; per-coin chart endpoints; SKA atom strings; ChartPanel)
- /wiki/code-analysis/transaction/flow.compact.md (depends-on: address tx-list / Coin-column rendering)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: CoinCtx contract, coin-aware aggregation, per-coin caching, SKA decimal-string pipeline, TurboQuery URL ownership, flowVisibility)
- /wiki/code-analysis/address/impact.md (depends-on: consolidated current-reality blast radius — signature fan-out, CoinTypeAll sentinel, SKA precision, caches, flat-field shim, CSV rename)
- /wiki/core/constraints.md#C1, #C7 (now honored in template + controller definitions)
