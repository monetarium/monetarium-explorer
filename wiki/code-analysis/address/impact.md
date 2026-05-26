# Address area — mutation impact (consolidated)

> Code-grounded as of `HEAD = 1b670255` (PR #265/#266 + the `db/dcrpg` coin-filter
> series). This single file replaces the former `summary.impact.md`,
> `transactions.impact.md`, and `charts.impact.md`, which documented the
> *pre-multi-coin-frontend migration* — that migration has **shipped**, so their
> central thesis ("backend complete, frontend VAR-only, template would crash if
> flat fields removed") is false. Folded in this `Consolidate: address` pass.
> Only the still-true blast radius is carried forward below.

Maps how a change to address-page data structures / multi-coin logic propagates,
and where it fails. Layers that **do not share code**: DB aggregation,
mempool overlay, REST/CSV, server templates, Stimulus controller.

---

## Risk: `AddressData`/`AddressHistory` coin-filter signature fan-out

**Trigger:** changing the signature of `AddressData`, `AddressHistory`, `AddressRowsCompact`, or `TxHistoryData` (all now carry `coinType uint8`).

**Failure mode:** loud (compile failure) — *if* every site is found. The hazard is the mock sites: missing one fails the build of that test package only, easy to overlook across 10 modules.

**Affected sites:**
- Production: `db/dcrpg/pgblockchain.go`; the two Go interfaces — `cmd/dcrdata/internal/explorer/explorer.go` (~:105) and `cmd/dcrdata/internal/api/apiroutes.go` (~:58); `explorerUI.AddressListData` ([explorerroutes.go:1879-1884](cmd/dcrdata/internal/explorer/explorerroutes.go#L1879-L1884)).
- Four mock files (must stay in lockstep): [explorer_test.go:50](cmd/dcrdata/internal/explorer/explorer_test.go#L50), [api/noop_ds_test.go:29](cmd/dcrdata/internal/api/noop_ds_test.go#L29), [api/address_api_test.go:15](cmd/dcrdata/internal/api/address_api_test.go#L15), [api/apiroutes_test.go:337](cmd/dcrdata/internal/api/apiroutes_test.go#L337).

**Constraint:** when adding a per-coin field on `AddressInfo`/`CoinBalance`, populate it in **all three** aggregators (see patterns.md "Coin-aware aggregation in three pipelines") plus the `ActiveCoins`/`NumUnconfirmedByCoin` branches; a field set in only one is silently wrong for the other code paths / page positions.

---

## Risk: `CoinTypeAll = 255` dual semantics

**Trigger:** adding a new code path that consumes `coinType` without deciding what `255` means there.

**Failure mode:** silent — wrong rows or an empty result with no error.

**Description:** `dbtypes.CoinTypeAll = uint8(255)` ([types.go:47-49](db/dbtypes/types.go#L47-L49)) has **two** meanings:
- **Table / CSV / counts pipelines:** 255 = "no filter — show all coins". In-memory row filters (`AddressRowsCompact`, `AddressCache.Rows`) **must short-circuit** on `CoinTypeAll` and return all rows. Missing the short-circuit makes `if r.CoinType == coinType` match nothing → the no-`?coin=` CSV comes back empty (regression: `db/cache/addresscache_test.go::TestAddressCacheRows_CoinTypeAll`).
- **Chart pipeline:** 255 is meaningless (charts are inherently per-coin) and collapses to `0` (VAR) at [pgblockchain.go:3327-3330](db/dcrpg/pgblockchain.go#L3327-L3330). The JS `effectiveCoin()` mirrors this collapse — change one, change both.

**Constraint:** `CoinTypeAll` must stay `255`, distinct from every real coin (`TestCoinTypeAllSentinel`). Renaming the exported constant touches every caller.

---

## Risk: SKA routed through the VAR/`float64` (or `value INT8`) pipeline — precision corruption

**Trigger:** summing SKA via SQL `SUM(value)`; passing an SKA atom string through `dcrutil.Amount.ToCoin()`; `Number()`/`parseInt` on an SKA string for a displayed value.

**Failure mode:** silent — zeros, truncation, or scientific notation; invisible until an SKA-holding address is viewed.

**Description (the PR #263 bug class):** the `addresses.value INT8` column stores the VAR-atom representation regardless of coin type; for SKA rows it's the truncated INT8 of `vout.Value` (commonly `0`). `selectAddressAmountFlowByAddress` formerly summed `value` for both coin families, so `parseRowsSentReceived`'s `*big.Int` accumulator faithfully accumulated zeros and `/api/address/{addr}/amountflow/{bin}?coin=N` shipped zeroed series for every SKA coin — invisible because no frontend exercised the SKA path. **Fixed in PR #263:** the SQL now emits parallel `received_ska`/`sent_ska` from `COALESCE(SUM(NULLIF(ska_value,'')::numeric),0)::text` and the scanner builds `*big.Int` from those text columns ([addrstmts.go:351-359](db/dcrpg/internal/addrstmts.go#L351-L359), [queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331)). The same dual-column pattern is in `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)).

**Constraint (C1):** any new monetary-aggregate SQL must emit both VAR and SKA columns; SKA stays a `*big.Int`-backed decimal string to the render boundary. See patterns.md "Dual VAR/SKA SUM" and "SKA decimal-string atom pipeline".

---

## Risk: stale chart data on coin switch (client cache)

**Trigger:** adding a client-side cache that varies by coin without including `coin` in its key, or removing `coin` from `ctrl.retrievedData`'s key.

**Failure mode:** silent — the chart replays another coin's cached series.

**Description:** the chart cache `ctrl.retrievedData` is keyed by `` `${chart}-${bin}-${coin}` `` ([address_controller.js:644](cmd/dcrdata/public/js/controllers/address_controller.js#L644)); `changeCoin` invalidates via a `__force_refetch__` sentinel (~:461-472). Server cache `AddressCacheItem.history` is keyed `(address, HistoryChart, grouping, coinType)`. **Cache invalidation (`FreshenAddressCaches`) is per-address, not per-(address, coin)** — a reorg invalidates all coins together (intentional; don't "optimize" to per-coin without re-checking reorg correctness).

---

## Risk: `?coin=` filter desync between server and client

**Trigger:** adding a URL builder or pagination link that doesn't route through `coinUrlSegment()`, or a persisted URL key not declared in the TurboQuery null-template.

**Failure mode:** silent UX — the table/chart shows a different coin than the URL/selector implies; the filter is dropped on XHR refresh.

**Description:** the backend respects `?coin=` on both the HTML and XHR/CSV/chart paths. The frontend keeps parity via: `coin` in `TurboQuery.nullTemplate` ([address_controller.js:290](cmd/dcrdata/public/js/controllers/address_controller.js#L290)); `coinUrlSegment()` appended in `makeTableUrl`, the chart fetch, and `setTablePaginationLinks`; the Go `linkTemplate` appending `&coin=` when `coinType != CoinTypeAll`. Undeclared keys are silently stripped by `query.replace`. Any new persisted key or URL builder must touch all of these together (see patterns.md "TurboQuery URL ownership").

---

## Risk: removing the legacy flat-field shim (now backend-only)

**Trigger:** deleting `AddressBalance.{TotalUnspent,TotalSpent,NumSpent,NumUnspent}`.

**Failure mode:** loud for the single Go sync point (compile); **silent/contractual** for JSON API consumers.

**Description:** these four `int64` fields ([types.go:2431-2435](db/dbtypes/types.go#L2431-L2435), under `// TODO: Remove ... once frontend is updated for multi-coin support`) are **no longer template-read** — `address.tmpl` renders from `Balance.Coins[*]`. They are now (a) populated by a **single** sync point — `ReduceAddressHistory` ([types.go:2591-2597](db/dbtypes/types.go#L2591-L2597), mirrored from `Coins[0]`), and (b) still JSON-serialized (`json:"total_unspent"`, `total_spent`, `num_spent`, `num_unspent`). Removal is now a backend-only task: drop the four fields + that one sync, and account for external consumers of those JSON keys. The pre-#265 "three sync points, template crashes on removal, migrate template first" framing is **obsolete**.

---

## Risk: CSV schema is backward-incompatible (already shipped)

**Trigger:** none needed — this already shipped and external CSV consumers may break.

**Failure mode:** loud for external tooling; silent for the explorer.

**Description:** `/download/address/io/{address}` header gained a `coin_type` column and the `value` column was **renamed to `amount`**. SKA amounts are bare decimal coin amounts (atoms ÷ 1e18, no label) via `dbtypes.FormatSKACoins` — uniform parseable numbers across VAR/SKA rows, coin disambiguated by `coin_type`. The CSV is a **deliberate full export**: the download link (`address.tmpl`) is static (no `?coin=`/`?txntype=`); `addressIoCsv` always pulls `AddressRowsCompact(..., CoinTypeAll)`. Scoping it to on-page filters was explicitly declined — don't "fix" it.

---

## Resolved (no longer a risk) — recorded so it isn't re-flagged

- **sstxcommitment SKA false-positive — FIXED.** `extras.tmpl` now guards the heuristic with `if and (eq .CoinType 0) (eq .SentTotal 0.0)` (VAR-only), so SKA debit rows are no longer misclassified as "sstxcommitment". Residual minor fragility: it is still a float-compare-to-magic-value for VAR; replacing it with an explicit `AddressTx` flag remains a nice-to-have, not a bug.
- **Per-row coin fields unread by template — FIXED.** `AddressTx.{CoinType,SKAValue,ReceivedTotalSKA,SentTotalSKA}` ([types.go:2294-2302](db/dbtypes/types.go#L2294-L2302)) are read by `extras.tmpl` (Coin column at ~:218/:250; per-coin amount branches).
- **`FiatBalance` dead code — REMOVED.** The field, the handler `nil` assignment, and the `if $.FiatBalance` template branch were all deleted; `xcBot.Conversion` is no longer called from the address handler. Reviving fiat needs a multi-coin price model that does not exist (open question below).
- **`coin` not in TurboQuery / VAR-only legend / no Coin column / float SKA chart accumulator — all SHIPPED.** See [flow.compact.md](flow.compact.md) Stale-Claim Delta.

---

## Open product/UX questions (cannot be answered from code)

These survive the migration and still gate feature work:

1. **Stake rows under `?coin=N`, N≠0.** `FromStake`/`ToStake` are VAR-only ratios; backend returns them regardless of `?coin=`. Hide when a non-VAR coin is selected, or always show?
2. **Fiat for a multi-coin address.** Needs a multi-coin price feed in `exchanges/` (does not exist) plus a UX choice (hide / VAR-only / per-coin / cross-coin sum).
3. **Merged view across coins.** Backend SQL filters by `coin_type`, so "merged per coin" is the natural answer; merging across coins is invalid (different scales). Confirm the footnote text still holds.
4. **CSV filename has no coin suffix** — possible ambiguity for repeat downloads; CSV cache invalidation does not consider coin (different `?coin=` URLs cache separately by URL, but a reorg may leave one coin's cache stale).
5. **Per-coin live balance updates.** Today only `numUnconfirmed` (per-coin via `data-coin-type`) and the table `txnCount` update on `BLOCK_RECEIVED`; Balance/Received/Spent are SSR-only. Live per-coin balance would need a WS payload + JS `BigInt` math (C1).

---

## See also

- [flow.full.md](flow.full.md) — per-layer trace these risks are grounded in.
- [flow.compact.md](flow.compact.md) — Stale-Claim Delta (what shipped vs. the prior revision).
- [patterns.md](patterns.md) — the reusable behaviors whose constraints these risks enforce (`shares-pattern-with`).
- /wiki/code-analysis/transaction/impact.md (shares-pattern-with: the per-tx page reached from the address table renders coins via the same `{{if eq .CoinType 0}}` idiom).
- /wiki/core/constraints.md C1 (numeric precision & bifurcation), C7 (centralized coin-type label rendering).
