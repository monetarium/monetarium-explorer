# Address Page — Full Flow

> **Code-grounded as of `HEAD` = `1b670255`** (PR #265 + PR #266 + the `db/dcrpg`
> coin-filter series, merged 2026-05-14/15). This supersedes the prior revision
> written at `a8f641f2` (2026-05-13), whose central thesis — "backend multi-coin,
> frontend renders VAR only, `?coin=` not wired in the controller" — is now false.
> See §9 (`flow.compact.md`) for the stale-claim delta table.

---

## Section 1 — Overview

This traces the **per-coin filter and multi-coin rendering path** for `/address/{addr}`:
`?coin=N` → `CoinCtx` middleware → `AddressHistory(... coinType)` →
per-coin balance + coin-filtered paginated rows → `address.tmpl` / `extras.tmpl`
→ `address_controller.js` (chart + table coin selectors, SKA-string legend).

The address page is now **multi-coin end-to-end**: VAR (coin 0) and SKA{n}
(coins 1–254) are filtered, aggregated, and rendered on both the summary card
and the transaction table; charts are per-coin. Mempool/unconfirmed activity is
**confirmed-only for balance** — unconfirmed counts surface separately.

---

## Section 2 — End-to-End Data Flow

```
?coin=N ─→ m.CoinCtx ─→ GetCoinCtx(r): uint8   (absent|invalid|255 ⇒ CoinTypeAll=255 = no filter; 1–254 = SKA coin)
  │
  ├─ HTML page:  AddressPage (explorerroutes.go)
  │     → AddressData(ctx, addr, N, off, txnType, coinType)        (pgblockchain.go)
  │       → AddressHistory(ctx, addr, N, off, txnView, coinType)
  │           ├─ coinType == CoinTypeAll → existing all-coin cache/SQL LIMIT/OFFSET path
  │           └─ coinType != CoinTypeAll → load FULL per-coin rows (cache or updateAddressRows),
  │                                        FILTER by r.CoinType, THEN SliceAddressRows,
  │                                        + always full AddressBalance (Coins map complete)
  │       → mempool overlay: append unconfirmed rows (coin-filtered), DO NOT touch balance
  │       → addrData{ Balance.Coins, ActiveCoins, NumUnconfirmed, NumUnconfirmedByCoin }
  │     → AddressPageData → templates.exec("address")
  │       → address.tmpl: range .ActiveCoins over Balance.Coins; data-active-coins='[…]' (jsonMarshal)
  │       → extras.tmpl:  per-row Coin column + SKA/VAR value branch
  │     → linkTemplate gets &coin=N appended when filtered
  │
  ├─ XHR table:  /addresstable/{addr}?txntype=…&n=…&start=…&coin=N
  │     → AddressTable → same AddressData path; linkTemplate also &coin=N
  │
  ├─ CSV download: /download/address/io/{addr}[/win]   (STATIC href — carries NO ?coin=, NO ?txntype=)
  │     → addressIoCsv → GetCoinCtx(r) ⇒ always CoinTypeAll (link never sets ?coin=)
  │       → AddressRowsCompact(ctx, addr, CoinTypeAll) ⇒ FULL non-merged, all-coin row set
  │     → streamed CSV. By design the on-page Type/Coin filters do NOT scope the
  │       download — it is a complete raw export. Rows still render the correct
  │       per-row coin/amount (compact rows carry CoinType + SKAValue).
  │
  └─ Charts:     /api/address/{addr}/{amountflow|types}/{bin}?coin=N
        → re.With(m.ChartGroupingCtx, m.CoinCtx) → getAddressTx*Data → GetCoinCtx(r)
        → TxHistoryData(...coinType) → retrieveTxHistoryByAmountFlow(...coinType)
          → MakeSelectAddressAmountFlowByAddress  (dual VAR INT8 / SKA numeric::text columns)
          → parseRowsSentReceived(rows, coinType) with big.Int cumulative balance accumulator
        → ChartsData{ Received,Sent,Net,Balance (VAR) | ReceivedAtoms,SentAtoms,NetAtoms,BalanceAtoms (SKA) }
        → address_controller.js: amountFlowProcessor(data, effectiveCoin(), skaAtomsByTime)
```

---

## Section 3 — Per-Layer Breakdown

### 3.1 Coin filter (source of truth) — *unchanged*

- **`db/dbtypes/types.go:49`** — `const CoinTypeAll = uint8(255)`.
- **`cmd/dcrdata/internal/middleware/apimiddleware.go:821–842`** — `CoinCtx`
  parses `?coin=` to `uint8`; absent/invalid/`255` ⇒ `CoinTypeAll`; `1–254` ⇒
  SKA coin; stored under `ctxCoin`. `GetCoinCtx(r)` returns it (default
  `CoinTypeAll`).
- Guarded by **`db/dbtypes/coinfilter_test.go::TestCoinTypeAllSentinel`** (new):
  `CoinTypeAll` must stay `255` and collide with no real coin index.

### 3.2 DB layer — the major behavioral change (`db/dcrpg/pgblockchain.go`)

**`AddressHistory` signature** now `(... txnView dbtypes.AddrTxnViewType, coinType uint8)`
(`:2419-2420`). New filter-before-paginate branch (`:~2427-2480`):

- When `coinType != CoinTypeAll`: get the **full per-coin row set** from
  `pgb.AddressCache.Rows(address, coinType)` (uncompacted) or, on cache miss,
  from `updateAddressRows(ctx, address)` filtered by `r.CoinType == coinType`;
  **then** `dbtypes.SliceAddressRows(fullRows, N, offset, txnView)`.
  *Filtering happens before LIMIT/OFFSET — never after.*
- Balance always comes from `pgb.AddressBalance(ctx, address)` (full per-coin),
  never the row-derived shortcut, so `Balance.Coins` stays complete for the
  coin selector even under a filter. Legacy flat fields are still synced from
  `Coins[0]` for back-compat but the template no longer reads them.
- `CoinTypeAll` path is the prior all-coin cache/SQL path, unchanged.

Codified by **`db/dbtypes/coinfilter_test.go::TestCoinFilterBeforePagination`**
(new, DB-free): filter-after-paginate leaves coin rows unreachable on page 0.

**`AddressData` mempool overlay rewritten** (`:~2740-2910`): unconfirmed
funding/spending rows are appended to `addrData.Transactions` **only when
`coinTypeFilter == CoinTypeAll || == coinType`**, and the entire
`received/sent/numReceived/numSent/skaReceivedByType/skaSpentByType`
accumulator block was **deleted**. Balance is now purely confirmed-DB.
Unconfirmed activity surfaces only via `NumUnconfirmed` /
`NumUnconfirmedByCoin` (code comment after the spending loop states this is by
design — commit `6e92df4c`).

`AddressHistoryAll`, `addressInfo`, retry recursion, and `AddressTransactionsAll`
now pass `dbtypes.CoinTypeAll` explicitly.

**`retrieveAddressMergedTxns` rewritten** (`db/dcrpg/queries.go:~1890`): now
`db.QueryContext(ctx, internal.SelectAddressMergedView, address, N, offset)` +
`scanAddressMergedRows`. Previously routed through `retrieveAddressTxnsStmt(... 0)`,
which bound `coinType=0` as `$2` = **LIMIT 0** on the merged statement (which has
no `coin_type` predicate and uses `$2` for LIMIT) → silently zero rows
(the "merged-view LIMIT-0 bug", commit `be28442e`). Merged view aggregates
**all coin types**; it must be queried directly.

### 3.3 Interface change — 6 sites

`AddressHistory`'s new `coinType` param propagates to:
`explorer.explorerDataSource` (`explorer.go:105`), `api.DataSource`
(`apiroutes.go:58`), and mocks `noop_ds_test.go`, `explorer_test.go`,
`pgblockchain_test.go`.

### 3.4 Data structures (source of truth — `db/dbtypes/types.go`)

- `AddressInfo` (`:2323-2373`): `NumUnconfirmed int64` (`:2343`),
  **`NumUnconfirmedByCoin map[uint8]int64`** (`:2345`), `Balance *AddressBalance`
  (`:2361`), **`ActiveCoins []uint8`** (`:2366`).
- `CoinBalance` (`:2379-2389`): `CoinType`, `NumSpent/NumUnspent`,
  `TotalSpent/TotalUnspent int64` (VAR atoms),
  `TotalSpentSKA/TotalUnspentSKA string` (SKA atoms),
  **`TotalReceived int64` / `TotalReceivedSKA string`** (precomputed).
- `AddressBalance` (`:2393-2406`): `Coins map[uint8]*CoinBalance`,
  `TotalOutputs/TotalInputs`, `FromStake/ToStake`, plus legacy flat
  `TotalUnspent/TotalSpent/NumSpent/NumUnspent` (synced from `Coins[0]`,
  back-compat only).
- `ActiveCoins` populated at `pgblockchain.go:2626` (no confirmed txns) and
  `:2691` (confirmed txns); `NumUnconfirmedByCoin` at `:2762`.

### 3.5 Transformation 1 — templates

**`address.tmpl`:** summary card `range $ct := .ActiveCoins`, indexes
`$balance.Coins`, renders VAR via `amountAsDecimalParts` and SKA via
`skaDecimalParts $cb.TotalUnspentSKA / TotalReceivedSKA / TotalSpentSKA`,
labelled `{{coinSymbol $ct}}`; `&mdash;` empty state. `Received`/`Spent`
counts now from `$balance.TotalOutputs`/`TotalInputs`. Unconfirmed block
ranges `.NumUnconfirmedByCoin` per coin with
`data-coin-type`/`data-count` attrs. Stake rows gated on `$varCB`
(VAR-only metric). The container's `data-address-balance` attr was
**replaced** by `data-active-coins='{{jsonMarshal .ActiveCoins}}'`. Two
coin `<select>`s added (chart card → `data-address-target="coin"`,
`address#changeCoin`; table → `data-address-target="coinFilter"`),
disabled/single-option when `ActiveCoins` ≤ 1; txntype select disabled
when `not .ActiveCoins`. **`FiatBalance` field + `if $.FiatBalance`
branch deleted** (and removed from the `AddressPageData` struct in
`explorerroutes.go`).

**`extras.tmpl`** (address tx table): new `<th>Coin</th>` +
`<td data-coin-type="{{.CoinType}}">{{coinSymbol .CoinType}}</td>`; every
value cell branches `{{if eq .CoinType 0}}float64AsDecimalParts …{{else}}
skaDecimalParts .SKAValue true{{end}}`; `Credit VAR`/`Debit VAR` headers
renamed to `Credit`/`Debit`; `sstxcommitment` gate now also requires
`eq .CoinType 0`.

**`templates.go:768-780`** — new `jsonMarshal` func: coerces `[]uint8`→`[]int`
before `json.Marshal` (else `[]byte` alias renders base64), so `ActiveCoins`
serializes as a JSON array for `data-active-coins`.

**`explorerroutes.go`** `AddressPage`/`AddressTable`: `linkTemplate` gets
`&coin=%d` appended when `GetCoinCtx(r) != CoinTypeAll`, so pagination links
preserve the filter.

### 3.6 Transformation 2 — controller (`address_controller.js`)

- `coin` **added to the TurboQuery null-template** (`:271-275`) and to targets
  (`coinFilter`, `coin`).
- New `coinUrlSegment()` (`&coin=` or empty), `normalizeCoinSetting()`
  (validates against `activeCoins`, syncs both selectors, canonicalizes string
  form), `effectiveCoin()` (returns the integer coin used for chart fetches —
  **mirrors backend `CoinTypeAll→0` collapse**: explicit coin, else first
  `activeCoins`, else 0), `changeCoin(e)` (sets `settings.coin`, resets
  pagination, forces chart refetch via `state.coin='__force_refetch__'`).
- `activeCoins` parsed from `data-active-coins` (try/catch → `[]` on bad JSON).
- Chart cache keys now `${chart}-${bin}-${coin}` (`fetchGraphData :625`,
  `processData`, `popChartCache :679`); `drawGraph` short-circuit also compares
  `settings.coin === state.coin`. Chart URL: `?coin=${coin}` appended.
- `amountFlowProcessor(d, binSize, coinType, atomsByTime)`: VAR reads the
  **server-precomputed `d.balance[i]`** (old JS `balance += v` accumulator
  removed — was lossy at high balances); SKA reads `d.received_atoms /
  sent_atoms / net_atoms / balance_atoms` strings, sign-splits on the string,
  stores originals in `skaAtomsByTime` Map keyed by `time.getTime()`, uses
  `Number()` only for pixel positioning.
- `makeAmountFormatter(coinType, atomsByTime)` builds the legend per-fetch;
  SKA values rendered from the atom strings via `formatSkaAtoms` →
  `splitSkaAtomsNoTrailing`; label via `renderCoinType`. `ylabel`/
  `legendFormatter` are now per-fetch in `popChartCache`, not static.
- Confirmed-tx handler decrements **only the `numUnconfirmed` target whose
  `data-coin-type` matches** the row's `data-coin-type`.

### 3.7 Chart serialization (`db/dbtypes/types.go:2041-2057`,
`db/dcrpg/internal/addrstmts.go:351-359`, `db/dcrpg/queries.go:4301-4343`)

`ChartsData` json tags: `received/sent/net/balance` (VAR float64) and
`received_atoms/sent_atoms/net_atoms/balance_atoms` (SKA string), all
`omitempty`. SQL emits VAR via `SUM(... value ...)` for `coin_type=0` and SKA
via `COALESCE(SUM(... NULLIF(ska_value,'')::numeric ...),0)::text` for
`coin_type>0`; `WHERE coin_type=$2`. `parseRowsSentReceived` runs a per-row
cumulative accumulator: `int64 balanceVAR` → `items.Balance`, `big.Int
balanceSKA` → `items.BalanceAtoms`.

### 3.8 Helpers (`cmd/dcrdata/public/js/helpers/ska_helper.js`)

- `renderCoinType(coinType)` (`:16-23`) → `"VAR"` | `"SKA1".."SKA255"` | `"-"`.
- `splitSkaAtomsNoTrailing(atomStr,…)` (`:78-81`) → `{intPart,bold,rest,
  trailingZeros:''}`.

---

## Section 4 — Cross-Layer Dependencies

- **`AddressHistory` signature** — DB ↔ two Go interfaces ↔ four test mocks
  (6 sites). Any further param change re-touches all six across modules.
- **`ChartsData` JSON tags ↔ `amountFlowProcessor` string keys** — `omitempty`
  means a renamed tag silently disappears; SKA chart goes blank, no error.
- **`effectiveCoin()` (JS) ↔ backend `CoinTypeAll→0` collapse** — the same rule
  implemented twice; divergence shows the wrong coin's chart silently.
- **`data-coin-type` SSR attr (`extras.tmpl`) ↔ unconfirmed-decrement compare**
  — string equality; format/type drift silently stops decrementing.
- **`jsonMarshal` ↔ `data-active-coins` ↔ controller `activeCoins`** — if the
  func is removed/changed, base64 reaches `JSON.parse`, which throws and the
  catch yields `activeCoins=[]` → empty summary card, all selectors disabled.
- **`linkTemplate &coin=` (Go) ↔ `coinUrlSegment()` (JS)** — both must append
  the filter or pagination/CSV silently drops scope.

---

## Section 5 — Critical Constraints

1. **Coin filter MUST precede LIMIT/OFFSET.** Enforced invariant
   (`TestCoinFilterBeforePagination`). Filter-after-paginate ⇒ under-filled,
   unreachable pages while per-coin counts say rows exist.
2. **`CoinTypeAll` must stay `255`, distinct from every real coin.**
   (`TestCoinTypeAllSentinel`.)
3. **Unconfirmed/mempool MUST NOT affect balance.** Balance is confirmed-DB
   only by design; mempool surfaces via `NumUnconfirmedByCoin`. Do not
   reintroduce the deleted accumulator block.
4. **SKA precision (core constraint C1).** SKA atoms stay strings end-to-end;
   `Number()` permitted only for chart pixel positioning, never for displayed
   values — the legend reads the original strings from `skaAtomsByTime`.
5. **Merged view has no `coin_type` predicate.** It aggregates all coins; query
   directly with `(address, N, offset)`, never via the coin-injecting stmt
   helper (LIMIT-0 trap).
6. **Centralized coin labels (core constraint C7).** Use `coinSymbol`
   (template) / `renderCoinType` (JS); no hard-coded `DCR`/`VAR` literals.
7. **CSV download is a deliberate full, non-merged, all-coin export.** The
   `address.tmpl:327` link is static — it carries no `?coin=` / `?txntype=`,
   and the controller never rewrites it. `addressIoCsv` reads `GetCoinCtx(r)`
   (so a future link *could* scope by coin) but never reads `txntype` and
   always calls `AddressRowsCompact`. The on-page Type/Coin filters scoping the
   download was considered and explicitly declined; it is a raw data dump, not
   a "what you see" export. Don't "fix" the unfiltered behavior as a bug.
8. **Merged rows carry their coin type + SKA atoms.** `AddressRowMerged` has
   `CoinType` and `SKAAtomsCredit/Debit (*big.Int)`; the four `Merge*` builders
   fold each constituent via `add()` and `UncompactMergedRows` emits
   `CoinType` + `SKAValueStr()`. A tx is single-coin, so a tx-hash-keyed merged
   row is unambiguous. Guarded by `TestMergedRowsPreserveCoinAndSKA` /
   `TestMergedCompactMixedCoins`. (This supersedes the older assumption that
   merged rows were VAR-only — that produced the "Merged debits + SKA1 shows
   VAR" bug.)

---

## Section 6 — Mutation Impact

When modifying *the address coin-filter / multi-coin path*, check:

**Direct dependencies**
- `AddressHistory` 6-site signature (build break across modules if missed).
- `AddressData` mempool block — don't re-fold mempool into balance.
- `retrieveAddressMergedTxns` argument order (LIMIT-0 trap).
- `address.tmpl` `range .ActiveCoins`; `extras.tmpl` Coin column + SKA branch.
- `address_controller.js` null-template, cache keys, `effectiveCoin`.

**Indirect / derived**
- `ActiveCoins` / `NumUnconfirmedByCoin` populated only at
  `pgblockchain.go:2626/2691` and `:2762` — patch *both* branches.
- `Balance.Coins[0]` legacy-flat sync (drop only when nothing reads it).

**Serialization boundaries**
- `ChartsData` json tags; `data-active-coins` via `jsonMarshal`;
  `&coin=N` on `linkTemplate` (HTML + table) and all JS URL builders. The CSV
  download link is **static** and intentionally carries neither `&coin=N` nor
  `&txntype=` (see Constraint 7) — do not list it as a coin-URL builder.

**Rendering layers**
- Summary card, Coin column, chart legend/ylabel, coin selectors, unconfirmed
  badges.

**Silent failures**
- `effectiveCoin()` vs. backend collapse divergence (wrong coin chart).
- `ChartsData` tag rename (omitempty hides absence) → blank SKA chart.
- `data-coin-type` string-compare drift → unconfirmed count never decrements.
- Stale `?zoom=` carried across coin/chart-type change → `validateZoom`
  silently clamps (pre-existing latent issue, unchanged).

**Hard failures**
- `AddressHistory` signature mismatch → compile error (multi-module).
- `jsonMarshal` removed → base64 in attr → `JSON.parse` throws →
  `activeCoins=[]` → empty card, disabled selectors (degrades, not crash).

---

## Section 7 — Common Pitfalls

- Editing `AddressHistory` without the 4 mocks → multi-module build break.
- "Fixing" unconfirmed display by re-adding mempool amounts to balance — that
  removal was deliberate (confirmed-only).
- Renaming a `ChartsData` field and missing the JS string key — SKA chart
  silently blank (`omitempty`).
- Routing the merged query through the coin-injecting helper — LIMIT-0,
  zero rows, no error.
- Trusting the prior wiki's "frontend VAR-only / `coin` not in null-template"
  — both now false.
- Populating only one of the two `ActiveCoins` assignment branches.
- "Fixing" the CSV download so it respects the page Type/Coin filters — the
  unfiltered full export is intentional (Constraint 7), not an oversight.

---

## Section 8 — Evidence

All file:line references verified against working tree at `HEAD`
(`1b670255`). Diff base for the delta: `a8f641f2` (prior wiki revision,
2026-05-13). Relevant commits:
- PR #265: `8cf06854`, `8b5c3a1b`, `9f5d5a7e`, `f3e2d687`, `a4457a7a`,
  `a9b24127`, `2297e522`.
- PR #266 / db series: `6e92df4c`, `0c389276`, `d4bf6cff`, `f3231a78`,
  `61661722`, `be28442e`, `1b670255`.
- Charts SKA SQL precision (`#263`, still valid): `49953185`, `6837673f`.

Primary files: `db/dcrpg/pgblockchain.go`, `db/dcrpg/queries.go`,
`db/dcrpg/internal/addrstmts.go`, `db/dbtypes/types.go`,
`db/dbtypes/coinfilter_test.go`, `cmd/dcrdata/internal/middleware/apimiddleware.go`,
`cmd/dcrdata/internal/api/apirouter.go`, `…/api/apiroutes.go`,
`cmd/dcrdata/internal/explorer/explorerroutes.go`, `…/explorer/explorer.go`,
`…/explorer/templates.go`, `cmd/dcrdata/views/address.tmpl`,
`cmd/dcrdata/views/extras.tmpl`,
`cmd/dcrdata/public/js/controllers/address_controller.js`,
`cmd/dcrdata/public/js/helpers/ska_helper.js`.

---

See also:
- /wiki/code-analysis/charts/flow.full.md (shares-pattern-with: TurboQuery URL ownership; per-coin chart endpoints; SKA atom string pipeline)
- /wiki/code-analysis/transaction/flow.full.md (depends-on: address tx-list / Coin-column rendering)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: CoinCtx URL contract, coin-aware aggregation, per-coin caching — **needs reconciliation via `Consolidate: address`**)
- /wiki/code-analysis/address/summary.impact.md (depends-on: summary card — **describes now-completed migration, stale**)
- /wiki/code-analysis/address/transactions.impact.md (depends-on: Coin column / coin filter — **describes now-completed migration, stale**)
- /wiki/code-analysis/address/charts.impact.md (depends-on: chart `?coin=` wiring — **frontend now emits `?coin=`, partially stale**)
- /wiki/core/constraints.md#C1 (depends-on: float64-vs-string SKA precision — now honored in template + controller)
- /wiki/core/constraints.md#C7 (depends-on: centralized coin labels — now honored via coinSymbol/renderCoinType)
