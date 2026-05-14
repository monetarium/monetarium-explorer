# Address area — recurring patterns

Patterns extracted from `flow.full.md`, `summary.impact.md`, `transactions.impact.md`, and `charts.impact.md`. Each appears in 2+ surfaces inside the address area; some also appear elsewhere (cross-domain links noted).

---

## `CoinCtx` URL contract

**Appears in:**

- [flow.full.md](flow.full.md) (HTML, XHR, chart API, CSV all read `middleware.GetCoinCtx(r)`)
- [transactions.impact.md](transactions.impact.md) (HTML/XHR/CSV)
- [charts.impact.md](charts.impact.md) (chart API)

**Description:**
Optional `?coin=N` query parameter (1-255) is parsed by `middleware.CoinCtx` ([cmd/dcrdata/internal/middleware/apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842)) and stored in the request context. Handlers retrieve it via `middleware.GetCoinCtx(r)`. Missing or invalid parameter resolves to the sentinel `dbtypes.CoinTypeAll = 255` ([db/dbtypes/types.go:47-49](db/dbtypes/types.go#L47-L49)).

The middleware wraps two route surfaces today:
- `/api/address/{address}/types/{chartgrouping}` and `/api/address/{address}/amountflow/{chartgrouping}` ([apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186)).
- `/download/address/io/{address}` and `/download/address/io/{address}/win` ([apirouter.go:313-320](cmd/dcrdata/internal/api/apirouter.go#L313-L320)).

For the explorer routes (`/address/{address}` and `/addresstable/{address}`), `CoinCtx` is **not** wrapped at the router level; the handler calls `middleware.GetCoinCtx(r)` directly anyway, so the same `CoinTypeAll` default applies (the parser inside `GetCoinCtx` returns the sentinel when the key is absent — see [apimiddleware.go:836-841](cmd/dcrdata/internal/middleware/apimiddleware.go#L836-L841)).

**Constraints:**
- The sentinel `CoinTypeAll = 255` has **two semantics**:
  - **Table / CSV / counts pipelines**: 255 means "no filter — show all coins". Functions like `nonMergedTxnCount`, `retrieveAddressTxns`, `countMerged*` switch to all-coin SQL variants (e.g. `SelectAddressesMergedCountAll` vs `SelectAddressesMergedCount`).
  - **Chart pipeline**: 255 collapses to 0 (VAR) at [pgblockchain.go:3327-3330](db/dcrpg/pgblockchain.go#L3327-L3330). Charts are inherently per-coin; "all" doesn't apply.
- The sentinel is exported and used across modules. Renaming requires touching every caller.
- The frontend does **not yet** participate in this contract: `address_controller.js` does not declare `coin` in its TurboQuery null-template and does not append `?coin=` to any XHR URL. Currently `?coin=` only flows on initial page load.

---

## Dual-field migration shim (per-coin map + legacy flat fields)

**Appears in:**

- [summary.impact.md](summary.impact.md) (template reads the flat fields)
- [transactions.impact.md](transactions.impact.md) (table-side counts derived from `Coins[*]` but summary numbers from flat fields)
- [flow.full.md](flow.full.md) (three sync points)

**Description:**
`AddressBalance` ([db/dbtypes/types.go:2392-2406](db/dbtypes/types.go#L2392-L2406)) carries both:

- **Per-coin truth**: `Coins map[uint8]*CoinBalance` plus `TotalOutputs`/`TotalInputs` (sums across all coins).
- **Legacy flat VAR fields** (marked `TODO: Remove these fields once frontend is updated for multi-coin support`): `TotalSpent int64`, `TotalUnspent int64`, `NumSpent int64`, `NumUnspent int64`. These are mirrored from `Coins[0]` (VAR-only) at three sync points:
  1. [db/dbtypes/types.go:2557-2562](db/dbtypes/types.go#L2557-L2562) — `ReduceAddressHistory` shortcut sync.
  2. [db/dcrpg/pgblockchain.go:2512-2519](db/dcrpg/pgblockchain.go#L2512-L2519) — `AddressHistory` cache-miss sync.
  3. [db/dcrpg/pgblockchain.go:2610-2615](db/dcrpg/pgblockchain.go#L2610-L2615) — `AddressData` post-overwrite sync.

The template (`address.tmpl:15, 48, 63, 70, 77, 83`) reads the flat fields. Removing the flat fields today crashes the template; removing the template references first and then deleting the sync points is the migration order.

The same pattern recurs at the `AddressTx` level: `ReceivedTotal float64`, `SentTotal float64` (VAR coins) coexist with `ReceivedTotalSKA string`, `SentTotalSKA string` (SKA atoms). The SKA fields are populated but not yet read by `extras.tmpl addressTable`; SKA rows render `0` in the amount column today.

**Constraints:**
- All three sync points must stay in lockstep — adding a fifth flat field without updating all three creates silent data drift.
- The legacy fields are **VAR-only** (mirror `Coins[0]`). For pure-SKA addresses they are zero, and the template displays `0 DCR`.
- Don't add new flat fields. Adding new per-coin information should populate `Coins[*]` only.
- The `AddressData` overwrite at [pgblockchain.go:2601](db/dcrpg/pgblockchain.go#L2601) (`addrData.Balance = balance`) is load-bearing: `ReduceAddressHistory` only sees the paginated row slice, so its computed balance is wrong for non-first pages. The full balance from `AddressHistory` overrides it. This was the fix in commit `961bbb0c`.

---

## Coin-aware aggregation in three pipelines

**Appears in:**

- [flow.full.md](flow.full.md) (`AddressData` mempool overlay)
- [summary.impact.md](summary.impact.md) (`retrieveAddressBalance` SQL aggregation)
- [transactions.impact.md](transactions.impact.md) (`ReduceAddressHistory` reduction)

**Description:**
Three Go-side functions independently aggregate per-coin balance information from different data sources. They must all produce the same `Coins map[uint8]*CoinBalance` shape:

1. **`ReduceAddressHistory`** ([db/dbtypes/types.go:2456-2613](db/dbtypes/types.go#L2456-L2613)) — reduces an `[]*AddressRow` slice (paginated). VAR via `int64` accumulators; SKA via `map[uint8]*big.Int` accumulators (`receivedSKAByCoin`, `spentSKAByCoin`), materialized as decimal strings on `CoinBalance.Total*SKA`.
2. **`retrieveAddressBalance`** ([db/dcrpg/queries.go:1472-1610](db/dcrpg/queries.go#L1472-L1610)) — SQL aggregation via `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)). Same per-coin shape. SQL emits both `SUM(value)` (VAR) and `COALESCE(SUM(NULLIF(ska_value, '')::numeric), 0)::text` (SKA) so Go-side reads both.
3. **`AddressData` mempool overlay** ([db/dcrpg/pgblockchain.go:2712-2911](db/dcrpg/pgblockchain.go#L2712-L2911)) — overlays unconfirmed mempool transactions onto the per-coin balance. VAR via `int64` (`received`, `sent`); SKA via `map[uint8]*big.Int` (`skaReceivedByType`, `skaSpentByType`).

**Constraints:**
- All three call `dbtypes.BigAddSKA(acc, decimalString)` to add SKA atoms into a `*big.Int` ([types.go:2413-2424](db/dbtypes/types.go#L2413-L2424)). This is the canonical SKA accumulator. It silently no-ops on empty/zero strings.
- Adding a new aggregation pipeline (e.g. a different mempool source) must follow the same shape: VAR int64, SKA `*big.Int`-then-string.
- All three write the same set of `CoinBalance` fields: `NumSpent`, `NumUnspent`, `TotalSpent`/`TotalUnspent`/`TotalReceived` (VAR), `TotalSpentSKA`/`TotalUnspentSKA`/`TotalReceivedSKA` (SKA).
- `TotalReceived = TotalSpent + TotalUnspent` (VAR) and `TotalReceivedSKA = TotalSpentSKA + TotalUnspentSKA` (SKA) are precomputed by `ReduceAddressHistory` ([types.go:2567](db/dbtypes/types.go#L2567)). Other aggregators currently do not all populate `TotalReceived*` — drift here is silent.

---

## Per-coin caching

**Appears in:**

- [flow.full.md](flow.full.md) (chart cache key)
- [charts.impact.md](charts.impact.md) (cache key includes coin type)

**Description:**
`AddressCacheItem.history` ([db/cache/addresscache.go:375-379](db/cache/addresscache.go#L375-L379)) holds:

```go
type TxHistory struct {
    TypeByInterval    [dbtypes.NumIntervals]map[uint8]*dbtypes.ChartsData
    AmtFlowByInterval [dbtypes.NumIntervals]map[uint8]*dbtypes.ChartsData
}
```

The inner `map[uint8]` is keyed by coin type. Accessor `HistoryChart(addrChart, chartGrouping, coinType)` and writer `StoreHistoryChart(addr, addrChart, chartGrouping, coinType, cd, block)` read/write `m[coinType]` after lazy-allocating the inner map.

The `Rows` cache (used by table + CSV) is **not** per-coin keyed — coin filtering happens in-memory after the cache hit ([pgblockchain.go:2266-2310](db/dcrpg/pgblockchain.go#L2266-L2310) — `AddressRowsCompact` filters `if r.CoinType == coinType`).

**Constraints:**
- Cache freshness invalidation (`FreshenAddressCaches`) is per-address, not per-(address, coin). A reorg invalidates all coin types together.
- Adding a new coin-keyed cache must follow the same shape: outer is `[NumIntervals]` (or whatever index) → inner is `map[uint8]*T`.
- The frontend chart-side cache (`ctrl.retrievedData` keyed by `${chart}-${bin}` at [address_controller.js:497](cmd/dcrdata/public/js/controllers/address_controller.js#L497)) does **not** include coin in its key. Adding a coin selector requires extending this key or clearing `retrievedData` on coin change.

---

## VAR-only stake metrics

**Appears in:**

- [summary.impact.md](summary.impact.md) (Stake spending / Stake income rows)
- [flow.full.md](flow.full.md) (FromStake/ToStake computation)
- [charts.impact.md](charts.impact.md) (Tx Type chart's Tickets/Votes/Revocations series)

**Description:**
"Stake" semantics on this chain (inherited from Decred consensus) apply to VAR only. Three places carry the assumption:

- `AddressBalance.FromStake float64` and `ToStake float64` ([types.go:2398-2399](db/dbtypes/types.go#L2398-L2399)). Computed in `ReduceAddressHistory` ([types.go:2541-2547](db/dbtypes/types.go#L2541-L2547)) as `fromStakeVAR / receivedVAR` and `toStakeVAR / sentVAR` — sums are VAR-only.
- `ChartsData.Tickets`, `Votes`, `RevokeTx` series populated by `selectAddressTxTypesByAddress` (`tx_type` 1/2/3 = SSTx/SSGen/SSRtx). With the SQL now coin-filtered, these series are zero for `coinType > 0`.
- Template `address.tmpl:93-101` renders Stake spending / Stake income rows gated by `HasStakeOutputs()` / `HasStakeInputs()` — both check `> 0` against the float field, so they never fire for pure-SKA addresses.

**Constraints:**
- Don't surface stake metrics for non-VAR coins without first defining what they would mean. SKA does not participate in the Decred stake mechanism.
- If the UI grows a coin selector, the stake rows should probably hide when `?coin=N` and `N != 0`.

---

## SKA decimal-string atom pipeline

**Appears in:**

- [flow.full.md](flow.full.md) (`parseRowsSentReceived`, `ReduceAddressHistory`, `retrieveAddressBalance`, mempool overlay)
- [summary.impact.md](summary.impact.md) (`CoinBalance.Total*SKA`)
- [transactions.impact.md](transactions.impact.md) (`AddressTx.ReceivedTotalSKA`/`SentTotalSKA`, CSV `FormatSKAPerVAR`)
- [charts.impact.md](charts.impact.md) (`ChartsData.BalanceAtoms`/`ReceivedAtoms`/`SentAtoms`/`NetAtoms`)

**Description:**
SKA atoms (1e18 scale) exceed `float64`'s significand and `int64`'s range. The canonical pipeline keeps SKA values as decimal strings backed by `*big.Int`:

- **DB column**: `addresses.ska_value TEXT` and `vins.ska_value TEXT` ([addrstmts.go:23](db/dcrpg/internal/addrstmts.go#L23)).
- **SQL aggregation**: `COALESCE(SUM(NULLIF(ska_value, '')::numeric), 0)::text` — accumulates as `numeric` then casts back to text. Used in `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)).
- **Go accumulator**: `dbtypes.BigAddSKA(acc *big.Int, s string)` ([types.go:2413-2424](db/dbtypes/types.go#L2413-L2424)) — silently no-ops on empty/zero strings.
- **Output type**: `string` (`*big.Int.String()`). Examples: `CoinBalance.TotalUnspentSKA`, `AddressTx.ReceivedTotalSKA`, `ChartsData.BalanceAtoms []string`.
- **Display formatting**: `dbtypes.FormatSKAPerVAR(atomsStr, coinType)` ([types.go:2428-2442](db/dbtypes/types.go#L2428-L2442)) — `*big.Float`-based decimal conversion, returns labeled coin string like `"1.23 SKA1"`.
- **Template helpers**: `formatAtomsAsCoinString`, `skaDecimalParts`, `skaDecimalPartsNoTrailing`, `coinSymbol` (defined in `cmd/dcrdata/internal/explorer/templates.go`).

**Constraints:**
- Never use `dcrutil.Amount.ToCoin()` (float64) for SKA — that's the VAR pipeline.
- Never sum SKA via SQL `SUM(value)` — `value` is the VAR-atom INT8 column. Use `SUM(NULLIF(ska_value,'')::numeric)::text`. (See `charts.impact.md §6.3` for the historical bug from violating this, fixed in PR #263.)
- Don't `parseInt(skaString)` in JS — use `BigInt(s)` or string arithmetic.
- The pipeline accepts `""` or `"0"` as the empty/zero state (no NULL semantics needed).

---

## TurboQuery URL ownership

**Appears in:**

- [flow.full.md](flow.full.md) (URL state via TurboQuery)
- [transactions.impact.md](transactions.impact.md) (table state)
- [charts.impact.md](charts.impact.md) (chart state)

**Description:**
The `address` Stimulus controller owns URL state via the `TurboQuery` helper ([cmd/dcrdata/public/js/helpers/turbolinks_helper.js](cmd/dcrdata/public/js/helpers/turbolinks_helper.js)). On `connect`:

1. `ctrl.settings = TurboQuery.nullTemplate([...keys])` — declare every persisted key with a `null` initial value ([address_controller.js:211-219](cmd/dcrdata/public/js/controllers/address_controller.js#L211-L219)).
2. `ctrl.query.update(settings)` — populate from URL on load.
3. Every state change writes back via `ctrl.query.replace(this.settings)` (history-replace, no full nav).

Keys declared today: `chart`, `zoom`, `bin`, `flow`, `n`, `start`, `txntype`. **Not declared**: `coin`.

**Constraints:**
- Undeclared URL keys are silently dropped on `query.replace` calls.
- Adding a new persisted key requires updating the `nullTemplate` call **and** every URL builder that should emit it (`makeTableUrl` 319-323, `fetchGraphData` 517-521, `setTablePaginationLinks` 437-471).
- Order matters: callers of `query.replace` always emit the full settings object, so a new key must be set on `settings` (or remain `null`) before every `replace` call.

---

## Dual VAR/SKA SUM in address aggregates (do this, not single `SUM(value)`)

**Appears in:**

- [flow.full.md](flow.full.md) (`parseRowsSentReceived` four-column scan)
- [charts.impact.md §6.3](charts.impact.md) (full trace + PR #263 fix)
- [flow.compact.md](flow.compact.md) (mutation checklist)

**Description:**
Any SQL that aggregates address-level monetary values must emit **both** a VAR `SUM(value)` and a SKA `COALESCE(SUM(NULLIF(ska_value,'')::numeric), 0)::text` — and the Go-side scanner must read both pairs and dispatch by `coinType`. The two canonical examples are:

- `SelectAddressSpentUnspentCountAndValue` ([db/dcrpg/internal/addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)) — established the pattern.
- `selectAddressAmountFlowByAddress` ([db/dcrpg/internal/addrstmts.go:351-359](db/dcrpg/internal/addrstmts.go#L351-L359)) — adopted the pattern in PR #263, with `CASE WHEN coin_type = 0` / `coin_type > 0` guards as belt-and-braces.

`parseRowsSentReceived` ([db/dcrpg/queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331)) is the canonical four-column scanner: `receivedVAR, sentVAR uint64, receivedSKAStr, sentSKAStr string`, then `coinType == 0` uses the VAR pair and `coinType > 0` builds `*big.Int` from `SetString` on the SKA strings.

**Historical anti-pattern (do not replicate)**: pre-PR-#263, `selectAddressAmountFlowByAddress` used a single `SUM(value)` for both coin families and `parseRowsSentReceived` scanned `received, sent uint64`. The `value INT8` column stores `vout.Value` regardless of coin type ([queries.go:2280](db/dcrpg/queries.go#L2280)), so for SKA rows the SUM returned the truncated INT8 representation (commonly `0`); the `*big.Int` accumulator faithfully accumulated zeros. The bug was invisible because no frontend exercised the SKA path. PR #263 landed the dual-column fix before the address-page multi-coin frontend (#249) wired the coin selector to `?coin=N`.

**Why this anti-pattern is easy to fall into**: the count-only SQL `selectAddressTxTypesByAddress` works correctly without touching `ska_value` (counts are coin-agnostic), so it's tempting to add `coin_type=$2` to other queries and assume they work. They don't if they involve `value`.

**Constraints:**
- Any new SQL aggregating address-level monetary values must select both `value` (for VAR) and `NULLIF(ska_value,'')::numeric::text` (for SKA), and the Go-side scanner must dispatch by `coin_type`.
- `COALESCE(..., 0)::text` is mandatory — guarantees a valid decimal string for `big.Int.SetString` even on empty result sets.
- `WHERE coin_type=$2` plus per-`SUM` `CASE WHEN coin_type = 0 / > 0` guards is the established belt-and-braces shape; one without the other is acceptable but the pair is what's in `selectAddressAmountFlowByAddress` today.

---

## See also

- [flow.compact.md](flow.compact.md) — high-level summary that incorporates these patterns.
- [flow.full.md](flow.full.md) — detailed per-layer trace; each pattern is grounded in specific file:line references here.
- /wiki/code-analysis/charts/patterns.md (if present) — string-only SKA pipeline appears there too in the coin-supply context; cross-reference if patterns become repo-wide.
- /wiki/core/constraints.md C1 (precision), C7 (centralized coin-type label rendering).
