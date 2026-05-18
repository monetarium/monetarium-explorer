# Address area — recurring patterns

> Code-grounded as of `HEAD = 1b670255` (PR #265/#266 + the `db/dcrpg` coin-filter
> series). The pre-#265/#266 "backend multi-coin, frontend VAR-only, migration
> pending" framing is **overturned**: the address page is multi-coin end-to-end on
> both backend and frontend. The three former sub-area impact notes
> (`summary/transactions/charts.impact.md`) were folded into a single
> [impact.md](impact.md) in this same `Consolidate: address` pass.

Patterns extracted from [flow.full.md](flow.full.md) and grounded in current code.
Each recurs across 2+ surfaces of the address area; cross-domain links noted.

---

## `CoinCtx` URL contract (backend **and** frontend)

**Appears in:** [flow.full.md](flow.full.md) (HTML, XHR, chart API, CSV), [impact.md](impact.md) (signature fan-out + sentinel risk).

**Description:**
Optional `?coin=N` query parameter (1–254) is parsed by `middleware.CoinCtx` ([cmd/dcrdata/internal/middleware/apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842)) and stored in the request context. Handlers retrieve it via `middleware.GetCoinCtx(r)`. Missing/invalid resolves to the sentinel `dbtypes.CoinTypeAll = 255` ([db/dbtypes/types.go:47-49](db/dbtypes/types.go#L47-L49)).

Wrapped at the router level on the chart and CSV API routes ([apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186), [apirouter.go:313-320](cmd/dcrdata/internal/api/apirouter.go#L313-L320)); the explorer routes (`/address/{address}`, `/addresstable/{address}`) call `middleware.GetCoinCtx(r)` directly (same `CoinTypeAll` default when the key is absent).

**The frontend now fully participates in this contract** (this is the key reversal vs. the pre-#265/#266 docs):

- `coin` is declared in the controller's `TurboQuery.nullTemplate([...])` ([address_controller.js:282-291](cmd/dcrdata/public/js/controllers/address_controller.js#L282-L291), `'coin'` at line 290).
- `coinUrlSegment()` ([address_controller.js:405-408](cmd/dcrdata/public/js/controllers/address_controller.js#L405-L408)) appends `&coin=${coin}`; called from `makeTableUrl` (~:402), `setTablePaginationLinks` (~:589), and the chart fetch path.
- `data-active-coins='{{jsonMarshal .ActiveCoins}}'` ([address.tmpl:15](cmd/dcrdata/views/address.tmpl#L15)) → controller `activeCoins` (~:303-309); `changeCoin` handler (~:461-472) updates settings, invalidates the chart cache, refetches the table.
- `effectiveCoin()` (~:439-451) collapses `CoinTypeAll → 0` on the JS side, **mirroring the backend chart collapse** at [pgblockchain.go:3327-3330](db/dcrpg/pgblockchain.go#L3327-L3330).

**Constraints:**
- `CoinTypeAll = 255` has **two semantics** — see [impact.md](impact.md) "CoinTypeAll dual semantics". Table/CSV/counts: 255 = "no filter, all coins". Chart pipeline: 255 collapses to 0 (VAR).
- The sentinel is exported and used across modules; renaming touches every caller.
- The frontend/back-end collapse rule (`CoinTypeAll→0` for charts) is duplicated in Go and JS — change one, change both.

---

## Coin-aware aggregation in three pipelines

**Appears in:** [flow.full.md](flow.full.md) (`AddressData` mempool overlay), [impact.md](impact.md) (aggregator drift risk).

**Description:**
Three Go-side functions independently aggregate per-coin balance information from different data sources. They must all produce the same `Coins map[uint8]*CoinBalance` shape:

1. **`ReduceAddressHistory`** ([db/dbtypes/types.go:2456-2613](db/dbtypes/types.go#L2456-L2613)) — reduces an `[]*AddressRow` slice (paginated). VAR via `int64` accumulators; SKA via `map[uint8]*big.Int` accumulators, materialized as decimal strings on `CoinBalance.Total*SKA`.
2. **`retrieveAddressBalance`** ([db/dcrpg/queries.go:1472-1610](db/dcrpg/queries.go#L1472-L1610)) — SQL aggregation via `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)). Same per-coin shape; SQL emits both `SUM(value)` (VAR) and `COALESCE(SUM(NULLIF(ska_value,'')::numeric),0)::text` (SKA).
3. **`AddressData` mempool overlay** ([db/dcrpg/pgblockchain.go](db/dcrpg/pgblockchain.go)) — overlays unconfirmed mempool transactions onto the per-coin row list. VAR via `int64`; SKA via `map[uint8]*big.Int`. **Confirmed-only balance invariant:** the overlay lists coin-filtered unconfirmed rows but does **not** fold them into `Balance.Coins` (the pre-#265 accumulator was deleted; see [flow.full.md](flow.full.md)).

**Constraints:**
- All call `dbtypes.BigAddSKA(acc, decimalString)` ([types.go:2444-2454](db/dbtypes/types.go#L2444-L2454)) — the canonical SKA accumulator; silently no-ops on empty/zero strings.
- A new aggregation source must follow the same shape: VAR `int64`, SKA `*big.Int`-then-string.
- `TotalReceived = TotalSpent + TotalUnspent` (VAR) and the SKA equivalent are precomputed by `ReduceAddressHistory`; aggregators that don't populate `TotalReceived*` drift **silently** — see [impact.md](impact.md).

---

## Per-coin caching (server **and** client)

**Appears in:** [flow.full.md](flow.full.md) (chart cache key), [impact.md](impact.md) (stale-cache-on-coin-switch risk).

**Description:**
Server: `AddressCacheItem.history` holds `TypeByInterval`/`AmtFlowByInterval` as `[dbtypes.NumIntervals]map[uint8]*dbtypes.ChartsData` ([db/cache/addresscache.go](db/cache/addresscache.go)); the inner map is keyed by coin type. Accessor `HistoryChart(addr, addrChart, grouping, coinType)` / writer `StoreHistoryChart(...)`. The `Rows` cache (table + CSV) is **not** per-coin keyed — coin filtering happens in-memory after the cache hit, and **must short-circuit on `CoinTypeAll`** (`AddressRowsCompact` returns all rows; missing this empties the no-`?coin=` CSV).

Client: the chart cache `ctrl.retrievedData` **is** keyed by coin — `` `${chart}-${bin}-${coin}` `` ([address_controller.js:644](cmd/dcrdata/public/js/controllers/address_controller.js#L644)); `drawGraph`'s short-circuit also compares `settings.coin`. (This is the reversal of the pre-#265 `${chart}-${bin}` key.)

**Constraints:**
- Cache freshness invalidation (`FreshenAddressCaches`) is per-address, **not** per-(address, coin) — a reorg invalidates all coin types together.
- A new coin-keyed server cache must keep the `[NumIntervals] → map[uint8]*T` shape.
- Any new client cache that varies by coin must include `coin` in its key or be cleared on `changeCoin` (the `__force_refetch__` mechanism, ~:461-472).

---

## SKA decimal-string atom pipeline

**Appears in:** [flow.full.md](flow.full.md), [impact.md](impact.md). Cross-domain: the same string discipline recurs in `mempool` (`addAtomStrings`) and `charts` (`coin-supply`) — see See-also.

**Description:**
SKA atoms (1e18 scale) exceed `float64`'s significand and `int64`'s range. The canonical pipeline keeps SKA values as decimal strings backed by `*big.Int`:

- **DB column**: `addresses.ska_value TEXT` / `vins.ska_value TEXT`.
- **SQL aggregation**: `COALESCE(SUM(NULLIF(ska_value,'')::numeric),0)::text` — accumulate as `numeric`, cast back to `text`.
- **Go accumulator**: `dbtypes.BigAddSKA(acc *big.Int, s string)` ([types.go:2444-2454](db/dbtypes/types.go#L2444-L2454)) — silently no-ops on empty/zero strings.
- **Output type**: `string` (`*big.Int.String()`): `CoinBalance.TotalUnspentSKA`, `AddressTx.ReceivedTotalSKA`, `ChartsData.BalanceAtoms []string`, etc.
- **CSV display formatting**: `dbtypes.FormatSKACoins(atomsStr)` ([types.go:2456-2477](db/dbtypes/types.go#L2456-L2477)) — bare decimal coin amount (atoms ÷ 1e18, no label; coin disambiguated by the separate `coin_type` column). The earlier label-appending `dbtypes.FormatSKAPerVAR` was **deleted** in the multi-coin CSV change — do not reference it.
- **Template helpers**: `skaDecimalParts`, `skaDecimalPartsNoTrailing`, `coinSymbol` ([cmd/dcrdata/internal/explorer/templates.go](cmd/dcrdata/internal/explorer/templates.go)); JS side `renderCoinType`, `splitSkaAtomsNoTrailing` ([cmd/dcrdata/public/js/helpers/ska_helper.js](cmd/dcrdata/public/js/helpers/ska_helper.js)).

**Constraints (C1):**
- Never `dcrutil.Amount.ToCoin()` (float64) for SKA — that's the VAR pipeline.
- Never sum SKA via SQL `SUM(value)` — `value` is the VAR-atom `INT8` column; use `SUM(NULLIF(ska_value,'')::numeric)::text` (the PR #263 fix — see [impact.md](impact.md)).
- Don't `parseInt`/`Number()` an SKA string for a *displayed* value in JS — use string arithmetic / `BigInt`. (`Number()` is acceptable only for pixel positioning; the legend must read the original string.)
- `""`/`"0"` are the empty/zero state (no NULL semantics).

---

## Dual VAR/SKA SUM in address aggregates (do this, not single `SUM(value)`)

**Appears in:** [flow.full.md](flow.full.md), [impact.md](impact.md) (the PR #263 precision-bug class).

**Description:**
Any SQL that aggregates address-level monetary values must emit **both** a VAR `SUM(value)` and a SKA `COALESCE(SUM(NULLIF(ska_value,'')::numeric),0)::text`, and the Go-side scanner must read both pairs and dispatch by `coin_type`. Canonical examples:

- `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)) — established the pattern.
- `selectAddressAmountFlowByAddress` ([addrstmts.go:351-359](db/dcrpg/internal/addrstmts.go#L351-L359)) — adopted it in PR #263, with `CASE WHEN coin_type = 0 / > 0` guards as belt-and-braces.
- `parseRowsSentReceived` ([db/dcrpg/queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331)) — canonical four-column scanner: `receivedVAR,sentVAR uint64` + `receivedSKAStr,sentSKAStr string`; `coinType == 0` uses the VAR pair, `coinType > 0` builds `*big.Int` via `SetString` on the SKA strings.

**Historical anti-pattern (do not replicate):** pre-PR-#263, `selectAddressAmountFlowByAddress` summed a single `value INT8` for both coin families; for SKA rows that column holds the truncated INT8 representation (commonly `0`), so the `*big.Int` accumulator faithfully accumulated zeros. The bug was invisible because no frontend exercised the SKA path. Full trace in [impact.md](impact.md).

**Why it's easy to fall into:** count-only SQL like `selectAddressTxTypesByAddress` works correctly without touching `ska_value` (counts are coin-agnostic), so it's tempting to add `coin_type=$2` to other queries and assume they work — they don't if they involve `value`.

**Constraints:**
- New monetary-aggregate SQL must select both `value` and `NULLIF(ska_value,'')::numeric::text`, and the scanner must dispatch by `coin_type`.
- `COALESCE(...,0)::text` is mandatory — guarantees a valid decimal string for `big.Int.SetString` even on empty result sets.

---

## VAR-only stake metrics

**Appears in:** [flow.full.md](flow.full.md), [impact.md](impact.md).

**Description:**
"Stake" semantics (inherited from Decred consensus) apply to **VAR only**. Three places carry the assumption:

- `AddressBalance.FromStake`/`ToStake float64` — computed in `ReduceAddressHistory` as VAR-only ratios.
- `ChartsData.Tickets`/`Votes`/`RevokeTx` from `selectAddressTxTypesByAddress` (`tx_type` 1/2/3) — with coin-filtered SQL these are zero for `coinType > 0`.
- The summary-card stake rows are gated by `HasStakeOutputs()`/`HasStakeInputs()` (both compare the VAR float) — they never fire for pure-SKA addresses.

**Constraints:**
- Don't surface stake metrics for non-VAR coins without first defining what they would mean — SKA does not participate in the stake mechanism.
- When `?coin=N` with `N != 0`, stake rows should hide (UX decision tracked in [impact.md](impact.md) open questions).

---

## Legacy flat-field shim (residual cleanup, not a migration-in-progress)

**Appears in:** [impact.md](impact.md) (loud-failure-on-removal + JSON-consumer risk).

**Description:**
`AddressBalance` still carries four legacy flat VAR fields — `TotalUnspent`, `TotalSpent`, `NumSpent`, `NumUnspent int64` ([db/dbtypes/types.go:2431-2435](db/dbtypes/types.go#L2431-L2435)) under `// TODO: Remove these fields once frontend is updated for multi-coin support`. **The frontend no longer reads them** — `address.tmpl` renders from `Balance.Coins[*]` (`range .ActiveCoins`). They are now: (a) populated by a **single** sync point (`ReduceAddressHistory`, [types.go:2591-2597](db/dbtypes/types.go#L2591-L2597), mirrored from `Coins[0]`), and (b) still JSON-serialized (`json:"total_unspent"` etc.) on the API. The pre-#265 "three sync points / template crashes if removed" framing is **stale** — it is now one sync point and a JSON-contract concern, not a template dependency.

**Constraints:**
- Don't add new flat fields — new per-coin information goes into `Coins[*]` only.
- Removing the flat fields is now a backend-only task: drop the four fields + the single `ReduceAddressHistory` sync, and account for API consumers of the `total_*`/`num_*` JSON keys (no template change needed). Full blast radius in [impact.md](impact.md).

---

## TurboQuery URL ownership

**Appears in:** [flow.full.md](flow.full.md), [impact.md](impact.md).

**Description:**
The `address` Stimulus controller owns URL state via the `TurboQuery` helper. On `connect`: `ctrl.settings = TurboQuery.nullTemplate([...keys])` ([address_controller.js:282-291](cmd/dcrdata/public/js/controllers/address_controller.js#L282-L291)) declares every persisted key; `ctrl.query.update(settings)` populates from URL; each state change writes back via `ctrl.query.replace(this.settings)`.

Keys declared today: `chart`, `zoom`, `bin`, `flow`, `n`, `start`, `txntype`, **`coin`** (line 290). (`coin` was added in #265/#266 — the pre-#265 "`coin` not declared" claim is overturned.)

**Constraints:**
- Undeclared URL keys are silently dropped on `query.replace`.
- A new persisted key requires updating the `nullTemplate` call **and** every URL builder that should emit it (`makeTableUrl`, the chart fetch path, `setTablePaginationLinks`) **and** the Go `linkTemplate` (which now appends `&coin=` when `coinType != CoinTypeAll`).
- Callers of `query.replace` emit the full settings object — a new key must be set on `settings` (or remain `null`) before every `replace`.

---

## See also

- [flow.compact.md](flow.compact.md) — high-level summary incorporating these patterns; Stale-Claim Delta table.
- [flow.full.md](flow.full.md) — detailed per-layer trace; each pattern grounded in file:line here.
- [impact.md](impact.md) — consolidated current-reality mutation blast radius (signature fan-out, sentinel semantics, SKA precision, caches, flat-field shim, CSV rename, live-update contract).
- /wiki/code-analysis/transaction/flow.full.md (shares-pattern-with: the per-row `{{if eq .CoinType 0}}…{{else}} skaDecimalParts …{{end}}` render idiom).
- /wiki/code-analysis/mempool/patterns.md (shares-pattern-with: SKA decimal-atom-string pipeline — `dbtypes.BigAddSKA` here is the same precision discipline as mempool `addAtomStrings(…, isBig)`).
- /wiki/core/constraints.md C1 (numeric precision & bifurcation — float64 VAR vs `*big.Int`/string SKA), C7 (centralized coin-type label rendering: `coinSymbol`/`renderCoinType`).
