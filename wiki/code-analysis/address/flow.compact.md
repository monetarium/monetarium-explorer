### One-line Flow
chi `/address/{addr}` → `AddressPathCtx` → `AddressPage` + `middleware.GetCoinCtx` → `AddressData(...coinType)` → `AddressHistory(...,coinType)` [`coinType≠255`: load full per-coin rows, **filter then `SliceAddressRows`**, + full `AddressBalance`] → mempool overlay appends coin-filtered unconfirmed rows but **not** balance → `AddressInfo{Balance.Coins, ActiveCoins, NumUnconfirmedByCoin}` → `address.tmpl` (`range .ActiveCoins`) + `extras.tmpl` (Coin column) → `address` controller (TurboQuery incl. `coin`; charts `/api/address/{addr}/{types|amountflow}/{bin}?coin=N`; table `/addresstable/{addr}?...&coin=N`).

> Revised at `HEAD=1b670255` (PR #265/#266 + db coin-filter series). Prior revision (`a8f641f2`) is overturned — see delta table below.

### Key Architectural Patterns
- **Filter-before-paginate (new invariant):** coin-filtered `AddressHistory` pulls the full per-coin row set (cache or `updateAddressRows`), filters by `r.CoinType`, *then* `SliceAddressRows`. Filtering after LIMIT/OFFSET = unreachable rows. Guarded by `db/dbtypes/coinfilter_test.go`.
- **`?coin=` URL contract via `CoinCtx`:** `?coin=N` (1–254) selects one coin; absent/invalid/`255` ⇒ `CoinTypeAll=255` (no filter). Chart pipeline + JS `effectiveCoin()` both collapse `CoinTypeAll→0` (VAR). `coin` is now in the controller TurboQuery null-template and on `linkTemplate`.
- **Confirmed-only balance:** the mempool accumulator block in `AddressData` was deleted; unconfirmed rows still listed (coin-filtered) but never folded into `Balance.Coins`. Unconfirmed surfaces via `NumUnconfirmed` / `NumUnconfirmedByCoin`.
- **Per-coin SKA strings end-to-end:** `CoinBalance.Total*SKA` strings + `ChartsData.*Atoms` strings; server precomputes cumulative VAR `Balance` (int64→float64) and SKA `BalanceAtoms` (`big.Int`→string). JS uses `Number()` only for pixel positioning; legend reads original strings from `skaAtomsByTime`.
- **`jsonMarshal` template func:** coerces `[]uint8`→`[]int` so `data-active-coins` is a JSON array, not base64; controller `JSON.parse`s it into `activeCoins`.
- **Coin-keyed chart cache:** keys are `${chart}-${bin}-${coin}`; `drawGraph` short-circuit also compares `settings.coin`.

### Critical Constraints
- **Coin filter must precede LIMIT/OFFSET** (`TestCoinFilterBeforePagination`).
- **`CoinTypeAll` must stay 255**, distinct from every real coin (`TestCoinTypeAllSentinel`).
- **Mempool must not affect balance** — confirmed-DB only by design; don't reintroduce the deleted accumulator.
- **Merged view has no `coin_type` predicate** — query `SelectAddressMergedView` directly with `(address,N,offset)`; the old stmt-helper route bound `coinType=0` as `LIMIT 0` → zero rows (fixed `be28442e`).
- **SKA precision (C1):** atoms stay strings to the render boundary; never `ToCoin()`/float a displayed SKA value.
- **Coin labels centralized (C7):** `coinSymbol` (template) / `renderCoinType` (JS); no `DCR`/`VAR` literals.
- `AddressHistory(... txnView, coinType uint8)` — 6-site signature (DB, two Go interfaces, four mocks).

### Mutation Checklist
- [ ] Change `AddressHistory` signature? Update `db/dcrpg/pgblockchain.go`, `explorer.go:105`, `apiroutes.go:58`, and mocks `noop_ds_test.go`, `explorer_test.go`, `pgblockchain_test.go`.
- [ ] Per-coin field on `AddressInfo`/`CoinBalance`? Populate at `pgblockchain.go:2626` **and** `:2691` (both `ActiveCoins` branches) and `:2762` (`NumUnconfirmedByCoin`); confirm `retrieveAddressBalance` aggregate + the filter-before-paginate balance path.
- [ ] New URL query key? Add to `address_controller.js` null-template (`:271-275`), `coinUrlSegment`/URL builders, `linkTemplate` (Go), and decide `CoinCtx` involvement.
- [ ] `ChartsData` field rename? Update the matching JS string key in `amountFlowProcessor` — `omitempty` hides a mismatch (silent blank SKA chart).
- [ ] Unconfirmed display work? Use `NumUnconfirmedByCoin`; do NOT re-fold mempool amounts into balance.
- [ ] Merged-view query? Call `SelectAddressMergedView` directly `(address,N,offset)`; never via the coin-injecting stmt helper.
- [ ] SKA values? `coinSymbol`/`skaDecimalParts` (template) or `renderCoinType`/`splitSkaAtomsNoTrailing` (JS); never float a displayed SKA amount.
- [ ] `data-coin-type` attr or unconfirmed-decrement logic? Keep the SSR attr and JS string compare in lockstep.

### Stale-Claim Delta (prior `a8f641f2` revision → current)
| Prior wiki claim | Current reality |
|---|---|
| Frontend renders VAR only; hard-coded `DCR` | Multi-coin end-to-end; `coinSymbol`/`renderCoinType`; per-coin summary + Coin column |
| `coin` not in TurboQuery null-template; controller not coin-aware | `coin` in null-template; `changeCoin`/`coinUrlSegment`/`effectiveCoin`; coin-keyed cache |
| `FiatBalance` always nil, branch never fires | Field + template branch **deleted** |
| Mempool overlay folds into balance totals | Removed; balance confirmed-only; mempool via `NumUnconfirmedByCoin` |
| `AddressHistory(... txnView)` | `AddressHistory(... txnView, coinType uint8)` |
| (not documented) | merged-view LIMIT-0 fix + filter-before-paginate invariant + regression tests |
| Chart `amountflow` SKA SQL fix (PR #263) | Still valid; JS chart pipeline now coin-keyed + server-precomputed cumulative balance |

See also:
- /wiki/code-analysis/address/flow.full.md (Sections 1–8)
- /wiki/code-analysis/charts/flow.compact.md (shares-pattern-with: TurboQuery URL ownership; per-coin chart endpoints; SKA atom strings)
- /wiki/code-analysis/transaction/flow.compact.md (depends-on: address tx-list / Coin-column rendering)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: CoinCtx contract, coin-aware aggregation — **reconcile via `Consolidate: address`**)
- /wiki/code-analysis/address/{summary,transactions,charts}.impact.md (**describe now-completed/overturned migration — stale, reconcile next**)
- /wiki/core/constraints.md#C1, #C7 (now honored in template + controller)
