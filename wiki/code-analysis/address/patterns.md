# Address area — recurring patterns

> Code-grounded as of `HEAD = a48ea0e1` (original multi-coin at `1b670255`;
> post-launch fixes through 2026-06-18). The three former sub-area impact notes
> were folded into a single [impact.md](impact.md) in the prior Consolidate pass.

Patterns extracted from [flow.full.md](flow.full.md) and grounded in current code.
Each recurs across 2+ surfaces of the address area; cross-domain links noted.

---

## `CoinCtx` URL contract (backend **and** frontend)

**Appears in:** [flow.full.md](flow.full.md) (HTML, XHR, chart API, CSV), [impact.md](impact.md) (signature fan-out + sentinel risk).

**Description:**
Optional `?coin=N` query parameter (1–254) is parsed by `middleware.CoinCtx` ([cmd/dcrdata/internal/middleware/apimiddleware.go:816-840](cmd/dcrdata/internal/middleware/apimiddleware.go#L816-L840)) and stored in the request context. Handlers retrieve it via `middleware.GetCoinCtx(r)`. Missing/invalid resolves to the sentinel `dbtypes.CoinTypeAll = 255` ([db/dbtypes/types.go:48-50](db/dbtypes/types.go#L48-L50)).

Wrapped at the router level on the chart and CSV API routes ([apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186), [apirouter.go:298-306](cmd/dcrdata/internal/api/apirouter.go#L298-L306)); the explorer routes (`/address/{address}`, `/addresstable/{address}`) call `middleware.GetCoinCtx(r)` directly (same `CoinTypeAll` default when the key is absent).

**The frontend now fully participates in this contract** (this is the key reversal vs. the pre-#265/#266 docs):

- `coin` is declared in the controller's `TurboQuery.nullTemplate([...])` ([address_controller.js:282-291](cmd/dcrdata/public/js/controllers/address_controller.js#L282-L291), `'coin'` at line 290).
- `coinUrlSegment()` ([address_controller.js:400-403](cmd/dcrdata/public/js/controllers/address_controller.js#L400-L403)) appends `&coin=${coin}`; called from `makeTableUrl` (~:395), `setTablePaginationLinks` (~:557), and the chart fetch path.
- `data-active-coins='{{jsonMarshal .ActiveCoins}}'` ([address.tmpl:15](cmd/dcrdata/views/address.tmpl#L15)) → controller `activeCoins` (~:303-309); `changeCoin` handler (~:456-467) updates settings, invalidates the chart cache, refetches the table.
- `effectiveCoin()` (~:436-446) collapses `CoinTypeAll → 0` on the JS side, **mirroring the backend chart collapse** at [pgblockchain.go:3285-3287](db/dcrpg/pgblockchain.go#L3285-L3287).

**Constraints:**
- `CoinTypeAll = 255` has **two semantics** — see [impact.md](impact.md) "CoinTypeAll dual semantics". Table/CSV/counts: 255 = "no filter, all coins". Chart pipeline: 255 collapses to 0 (VAR).
- The sentinel is exported and used across modules; renaming touches every caller.
- The frontend/back-end collapse rule (`CoinTypeAll→0` for charts) is duplicated in Go and JS — change one, change both.

---

## Coin-aware aggregation in three pipelines

**Appears in:** [flow.full.md](flow.full.md) (`AddressData` mempool overlay), [impact.md](impact.md) (aggregator drift risk).

**Description:**
Three Go-side functions independently aggregate per-coin balance information from different data sources. They must all produce the same `Coins map[uint8]*CoinBalance` shape:

1. **`ReduceAddressHistory`** ([db/dbtypes/types.go:2485-2626](db/dbtypes/types.go#L2485-L2626)) — reduces an `[]*AddressRow` slice (paginated). VAR via `int64` accumulators; SKA via `map[uint8]*big.Int` accumulators, materialized as decimal strings on `CoinBalance.Total*SKA`.
2. **`retrieveAddressBalance`** ([db/dcrpg/queries.go:1440-1632](db/dcrpg/queries.go#L1440-L1632)) — SQL aggregation via `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-261](db/dcrpg/internal/addrstmts.go#L234-L261)). Same per-coin shape; SQL emits both `SUM(value)` (VAR) and `COALESCE(SUM(NULLIF(ska_value,'')::numeric),0)::text` (SKA).
3. **`AddressData` mempool overlay** ([db/dcrpg/pgblockchain.go](db/dcrpg/pgblockchain.go)) — overlays unconfirmed mempool transactions onto the per-coin row list. VAR via `int64`; SKA via `map[uint8]*big.Int`. **Confirmed-only balance invariant:** the overlay lists coin-filtered unconfirmed rows but does **not** fold them into `Balance.Coins` (the pre-#265 accumulator was deleted; see [flow.full.md](flow.full.md)).

**Constraints:**
- All call `dbtypes.BigAddSKA(acc, decimalString)` ([types.go:2420-2427](db/dbtypes/types.go#L2420-L2427)) — the canonical SKA accumulator; silently no-ops on empty/zero strings.
- A new aggregation source must follow the same shape: VAR `int64`, SKA `*big.Int`-then-string.
- `TotalReceived = TotalSpent + TotalUnspent` (VAR) and the SKA equivalent are precomputed by `ReduceAddressHistory`; aggregators that don't populate `TotalReceived*` drift **silently** — see [impact.md](impact.md).

---

## Per-coin caching (server **and** client)

**Appears in:** [flow.full.md](flow.full.md) (chart cache key), [impact.md](impact.md) (stale-cache-on-coin-switch risk).

**Description:**
Server: `AddressCacheItem.history` holds `TypeByInterval`/`AmtFlowByInterval` as `[dbtypes.NumIntervals]map[uint8]*dbtypes.ChartsData` ([db/cache/addresscache.go](db/cache/addresscache.go)); the inner map is keyed by coin type. Accessor `HistoryChart(addr, addrChart, grouping, coinType)` / writer `StoreHistoryChart(...)`. The `Rows` cache (table + CSV) is **not** per-coin keyed — coin filtering happens in-memory after the cache hit, and **must short-circuit on `CoinTypeAll`** (`AddressRowsCompact` returns all rows; missing this empties the no-`?coin=` CSV).

Client: the chart cache `ctrl.retrievedData` **is** keyed by coin — `` `${chart}-${bin}-${coin}` `` ([address_controller.js:623](cmd/dcrdata/public/js/controllers/address_controller.js#L623)); `drawGraph`'s short-circuit also compares `settings.coin`. (This is the reversal of the pre-#265 `${chart}-${bin}` key.)

**Constraints:**
- Cache freshness invalidation (`FreshenAddressCaches`) is per-address, **not** per-(address, coin) — a reorg invalidates all coin types together.
- A new coin-keyed server cache must keep the `[NumIntervals] → map[uint8]*T` shape.
- Any new client cache that varies by coin must include `coin` in its key or be cleared on `changeCoin` (the `__force_refetch__` mechanism, ~:456-467).

---

## SKA decimal-string atom pipeline

**Appears in:** [flow.full.md](flow.full.md), [impact.md](impact.md). Cross-domain: the same string discipline recurs in `mempool` (`addAtomStrings`) and `charts` (`coin-supply`) — see See-also.

**Description:**
SKA atoms (1e18 scale) exceed `float64`'s significand and `int64`'s range. The canonical pipeline keeps SKA values as decimal strings backed by `*big.Int`:

- **DB column**: `addresses.ska_value TEXT` / `vins.ska_value TEXT`.
- **SQL aggregation**: `COALESCE(SUM(NULLIF(ska_value,'')::numeric),0)::text` — accumulate as `numeric`, cast back to `text`.
- **Go accumulator**: `dbtypes.BigAddSKA(acc *big.Int, s string)` ([types.go:2420-2427](db/dbtypes/types.go#L2420-L2427)) — silently no-ops on empty/zero strings.
- **Output type**: `string` (`*big.Int.String()`): `CoinBalance.TotalUnspentSKA`, `AddressTx.ReceivedTotalSKA`, `ChartsData.BalanceAtoms []string`, etc.
- **CSV display formatting**: `dbtypes.FormatSKACoins(atomsStr)` ([types.go:2440-2453](db/dbtypes/types.go#L2440-L2453)) — bare decimal coin amount (atoms ÷ 1e18, no label; coin disambiguated by the separate `coin_type` column). The earlier label-appending `dbtypes.FormatSKAPerVAR` was **deleted** in the multi-coin CSV change — do not reference it.
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

- `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-261](db/dcrpg/internal/addrstmts.go#L234-L261)) — established the pattern.
- `selectAddressAmountFlowByAddress` ([addrstmts.go:365-373](db/dcrpg/internal/addrstmts.go#L365-L373)) — adopted it in PR #263, with `CASE WHEN coin_type = 0 / > 0` guards as belt-and-braces.
- `parseRowsSentReceived` ([db/dcrpg/queries.go:4285-4327](db/dcrpg/queries.go#L4285-L4327)) — canonical four-column scanner: `receivedVAR,sentVAR uint64` + `receivedSKAStr,sentSKAStr string`; `coinType == 0` uses the VAR pair, `coinType > 0` builds `*big.Int` via `SetString` on the SKA strings.

**Historical anti-pattern (do not replicate):** pre-PR-#263, `selectAddressAmountFlowByAddress` summed a single `value INT8` for both coin families; for SKA rows that column holds the truncated INT8 representation (commonly `0`), so the `*big.Int` accumulator faithfully accumulated zeros. The bug was invisible because no frontend exercised the SKA path. Full trace in [impact.md](impact.md).

**Why it's easy to fall into:** count-only SQL like `selectAddressTxTypesByAddress` works correctly without touching `ska_value` (counts are coin-agnostic), so it's tempting to add `coin_type=$2` to other queries and assume they work — they don't if they involve `value`.

**Constraints:**
- New monetary-aggregate SQL must select both `value` and `NULLIF(ska_value,'')::numeric::text`, and the scanner must dispatch by `coin_type`.
- `COALESCE(...,0)::text` is mandatory — guarantees a valid decimal string for `big.Int.SetString` even on empty result sets.

---

## VAR-only stake metrics (code is multi-coin aware; practice is VAR-only)

**Appears in:** [flow.full.md](flow.full.md), [impact.md](impact.md).

**Description:**
"Stake" semantics (inherited from Decred consensus) apply to **VAR only in production**,
but the code was generalised to multi-coin in the post-`1b670255` fixes:

- `CoinBalance.FromStake`/`ToStake float64` — now computed **per-coin** by
  `retrieveAddressBalance` (queries.go:1600-1619): VAR via `int64` accumulators;
  SKA via per-coin `skaFromStake *big.Int` accumulators. In practice, SKA
  `FromStake` is always 0.0 (SKA staking not planned — see project memory).
- `HasStakeOutputs()`/`HasStakeInputs()` (types.go:2457-2474) — now iterate the
  full `Coins` map rather than a single flat float, so they return false for
  pure-SKA addresses as expected.
- `ChartsData.Tickets`/`Votes`/`RevokeTx` from `selectAddressTxTypesByAddress`
  (`tx_type` 1/2/3) — with coin-filtered SQL these remain zero for `coinType > 0`.
- Summary-card stake rows (`address.tmpl:129-154`) are gated by `HasStakeOutputs()`
  /`HasStakeInputs()`; they now range over `ActiveCoins` and print per-coin
  percentages, but the gate means they only render when VAR `FromStake > 0`.

**Constraints:**
- The multi-coin code path is guarded by the `HasStakeOutputs/HasStakeInputs` gate
  on the template side — it is safe but currently dead for non-VAR coins.
- Don't surface stake metrics for SKA without first checking whether the
  gate semantics still hold (SKA does not participate in the stake mechanism).
- When `?coin=N` with `N != 0`, stake rows should hide (UX decision tracked in
  [impact.md](impact.md) open questions).

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

## Atomic chart series visibility (`flowVisibility`)

**Appears in:** [flow.full.md](flow.full.md) §3.6.

**Description:**
The amount-flow chart has three toggleable series (Sent / Received / Net). Each
checkbox maps to a Dygraph series index. The naive pattern — calling
`graph.setVisibility(index, bool)` per index in a loop — triggers Dygraph's
`predraw_` hook on every call. When all series are transiently invisible (e.g.,
unchecking Received when only Received was checked), `computeCombinedSeriesAndLimits_`
dereferences `d[0].length` on an empty combined array and throws.

`flowVisibility(bitmap)` (address_controller.js:209-224) is an exported pure
function: it takes a 3-bit integer (bit 0 = Sent, bit 1 = Received, bit 2 = Net)
and returns `{0: bool, 1: bool, 2: bool}`. `updateFlow` calls
`this.graph.setVisibility(flowVisibility(bitmap))` (`:795`) in a single call,
so Dygraph sees the final visibility map atomically. The function is unit-tested
in `address_controller.test.js` (mapping table + the regression case).

**Constraints:**
- Always update all three series in one `setVisibility(object)` call; never loop
  `setVisibility(index, bool)` — the transient-empty state can crash.
- If the series count changes (e.g., a fourth flow series), update the bitmap
  width in `flowVisibility` and the test mapping table together.

---

## See also

- [flow.compact.md](flow.compact.md) — high-level summary incorporating these patterns; Stale-Claim Delta table.
- [flow.full.md](flow.full.md) — detailed per-layer trace; each pattern grounded in file:line here.
- [impact.md](impact.md) — consolidated current-reality mutation blast radius (signature fan-out, sentinel semantics, SKA precision, caches, flat-field shim, CSV rename, live-update contract).
- /wiki/code-analysis/transaction/flow.full.md (shares-pattern-with: the per-row `{{if eq .CoinType 0}}…{{else}} skaDecimalParts …{{end}}` render idiom).
- /wiki/code-analysis/mempool/patterns.md (shares-pattern-with: SKA decimal-atom-string pipeline — `dbtypes.BigAddSKA` here is the same precision discipline as mempool `addAtomStrings(…, isBig)`).
- /wiki/core/constraints.md C1 (numeric precision & bifurcation — float64 VAR vs `*big.Int`/string SKA), C7 (centralized coin-type label rendering: `coinSymbol`/`renderCoinType`).
