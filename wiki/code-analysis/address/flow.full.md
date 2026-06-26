# Address Page — Full Flow

> **Code-grounded as of `HEAD` = `fcad89dd`** (re-verified 2026-06-25). This Refresh
> pass (Tier 1, anchor `bba67634→fcad89dd`) re-traced the three changed covered files:
> `address_controller.js` (Dygraphs→ChartPanel retrofit), `address.tmpl` (Sent checkbox
> default + `rangerView` target), and `db/dcrpg/queries.go` (missed-votes reorg-recovery
> rewrite — **not address-related**; address-relevant functions in `queries.go` unchanged).
> Two widen targets added to coverage: `cmd/dcrdata/public/js/helpers/chart_panel.js` and
> `cmd/dcrdata/public/js/charts/definitions/address.js`. The DB/API/template layers and
> all constraints from the prior trace remain accurate. Prior anchor `bba67634`; see §9
> (`flow.compact.md`) for the full stale-claim delta.

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
        → address_controller.js: defFor(chart, coin) → def; panel.render(def, payload, settings, opts)
          → charts/definitions/address.js: def.toColumns(raw, settings) → columns
            def.formatValue(seriesIdx, datum) → display string (SKA precision firewall here)
```

---

## Section 3 — Per-Layer Breakdown

### 3.1 Coin filter (source of truth) — *unchanged*

- **`db/dbtypes/types.go:50`** — `const CoinTypeAll = uint8(255)`.
- **`cmd/dcrdata/internal/middleware/apimiddleware.go:819–840`** — `CoinCtx`
  parses `?coin=` to `uint8`; absent/invalid/`255` ⇒ `CoinTypeAll`; `1–254` ⇒
  SKA coin; stored under `ctxCoin`. `GetCoinCtx(r)` returns it (default
  `CoinTypeAll`).
- Guarded by **`db/dbtypes/coinfilter_test.go::TestCoinTypeAllSentinel`** (new):
  `CoinTypeAll` must stay `255` and collide with no real coin index.

### 3.2 DB layer (`db/dcrpg/pgblockchain.go`, `db/dcrpg/queries.go`)

**`AddressHistory` signature** `(... txnView dbtypes.AddrTxnViewType, coinType uint8)`
(`pgblockchain.go:2436`). New filter-before-paginate branch (`:~2448-2520`):

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

**`AddressData` mempool overlay rewritten** (`:~2704-2878`): unconfirmed
funding/spending rows are appended to `addrData.Transactions` **only when
`coinTypeFilter == CoinTypeAll || == coinType`**, and the entire
`received/sent/numReceived/numSent/skaReceivedByType/skaSpentByType`
accumulator block was **deleted**. Balance is now purely confirmed-DB.
Unconfirmed activity surfaces only via `NumUnconfirmed` /
`NumUnconfirmedByCoin` (code comment after the spending loop states this is by
design — commit `6e92df4c`).

**`utxoStore.set()` now stores `SKAValue`** (`pgblockchain.go:176-196`): prior to
commit `b13091c8` the `utxo.set()` and `Set()` methods dropped the `SKAValue`
field from `UTXOData`, defaulting it to `""`. When `insertSpendingAddressRow`
later wrote the spending address row it used the empty `SKAValue` from cache,
so `addresses.ska_value=''` for all SKA spending rows. `selectAddressAmountFlowByAddress`
treated `''` as NULL → `sent_ska` was always 0 → the chart balance line equalled
the received line for every SKA address. **Fixed:** `utxoStore.set()` now takes
`skaValue string` as its eighth parameter and stores it directly. The callers
`pgblockchain.go:4707` and `:4325` pass `vout.SKAValue`/`utxo.SKAValue`.

**`retrieveAddressBalance` now computes per-coin stake ratios** (`queries.go:1440-1632`):
The stake-ratio logic was generalised from the prior VAR-only path in
`ReduceAddressHistory` to a full SQL-backed per-coin implementation. For VAR
(coinType==0) `FromStake`/`ToStake` are computed from `fromStakeVAR`/`toStakeVAR`
int64 accumulators; for SKA (coinType>0) per-coin `skaFromStake[coinType] *big.Int`
accumulators collect PoS/SSFee atoms and divide by `skaReceivedExclIssuance`
(queries.go:1600-1619). `HasStakeOutputs()` and `HasStakeInputs()` on
`AddressBalance` (types.go:2457-2474) now iterate the full `Coins` map rather
than a flat VAR-only value. **Practical invariant unchanged:** SKA staking is
not planned (see project memory), so SKA `FromStake` is always 0.0 in production.

`AddressHistoryAll`, `addressInfo`, retry recursion, and `AddressTransactionsAll`
now pass `dbtypes.CoinTypeAll` explicitly.

**`retrieveAddressMergedTxns` rewritten** (`db/dcrpg/queries.go:1897`): now
`db.QueryContext(ctx, internal.SelectAddressMergedView, address, N, offset)` +
`scanAddressMergedRows`. Previously routed through `retrieveAddressTxnsStmt(... 0)`,
which bound `coinType=0` as `$2` = **LIMIT 0** on the merged statement (which has
no `coin_type` predicate and uses `$2` for LIMIT) → silently zero rows
(the "merged-view LIMIT-0 bug", commit `be28442e`). Merged view aggregates
**all coin types**; it must be queried directly.

### 3.3 Interface change — 6 sites

`AddressHistory`'s new `coinType` param propagates to:
`explorer.explorerDataSource` (`explorer.go:80`), `api.DataSource`
(`apiroutes.go:58`), and mocks `noop_ds_test.go`, `explorer_test.go`,
`pgblockchain_test.go`.

### 3.4 Data structures (source of truth — `db/dbtypes/types.go`)

- `AddressInfo` (`:2335-2384`): `NumUnconfirmed int64` (`:2355`),
  **`NumUnconfirmedByCoin map[uint8]int64`** (`:2357`), `Balance *AddressBalance`
  (`:2373`), **`ActiveCoins []uint8`** (`:2378`).
- `CoinBalance` (`:2391-2403`): `CoinType`, `NumSpent/NumUnspent`,
  `TotalSpent/TotalUnspent int64` (VAR atoms),
  `TotalSpentSKA/TotalUnspentSKA string` (SKA atoms),
  **`TotalReceived int64` / `TotalReceivedSKA string`** (precomputed),
  **`FromStake/ToStake float64`** (per-coin stake ratio — populated by
  `retrieveAddressBalance`; VAR: int64 accumulators; SKA: `*big.Int` — in
  practice 0.0 for SKA since staking is VAR-only).
- `AddressBalance` (`:2407-2412`): `Coins map[uint8]*CoinBalance`,
  `TotalOutputs/TotalInputs`. Legacy flat fields (`TotalUnspent/TotalSpent/
  NumSpent/NumUnspent`) still present for JSON back-compat, synced from
  `Coins[0]` only; template no longer reads them.
- `HasStakeOutputs()`/`HasStakeInputs()` (`:2457-2474`): iterate the full
  `Coins` map (multi-coin aware); return true if any coin has `FromStake > 0`.
- `ActiveCoins` populated at `pgblockchain.go:2665` (no confirmed txns) and
  earlier branch; `NumUnconfirmedByCoin` at `:2750`.

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

**`templates.go:796-808`** — new `jsonMarshal` func: coerces `[]uint8`→`[]int`
before `json.Marshal` (else `[]byte` alias renders base64), so `ActiveCoins`
serializes as a JSON array for `data-active-coins`.

**`explorerroutes.go`** `AddressPage`/`AddressTable`: `linkTemplate` gets
`&coin=%d` appended when `GetCoinCtx(r) != CoinTypeAll`, so pagination links
preserve the filter.

### 3.6 Transformation 2 — controller (`address_controller.js`) and chart definitions (`charts/definitions/address.js`)

The controller was retrofitted from a Dygraph-per-chart model (Dygraphs library,
inline processors, `skaAtomsByTime` Map) to a single `ChartPanel` instance. The
three chart definitions were extracted to
`cmd/dcrdata/public/js/charts/definitions/address.js`; the SKA precision firewall
moved into each definition's `formatValue` hook, eliminating the `skaAtomsByTime` Map.

**Stable coin-selector mechanics (unchanged):**
`coin` in `TurboQuery.nullTemplate` (`:120`); `coinUrlSegment()`, `normalizeCoinSetting()`,
`effectiveCoin()`, `changeCoin()` — unchanged. `activeCoins` from `data-active-coins`.
Chart cache keys `${chart}-${bin}-${coin}` — unchanged. `drawGraph` short-circuit also
compares `settings.coin`.

**ChartPanel construction** (`connect()`, lines `:171–179`):

```js
ctrl.panel = createChartPanel(ctrl.chartTarget, {
  xTime: true,
  rangerEl: ctrl.hasRangerViewTarget ? ctrl.rangerViewTarget : null,
  formatX: (x) => `Date: ${humanize.date(x * 1000, false, true)}`,
  rangerData: (cols) => [cols[0], rangerColumn(cols[1])],
  onRangeChange: (min, max) => {
    ctrl.settings.zoom = Zoom.encode(min * 1000, max * 1000)
    ctrl.query.replace(ctrl.settings)
    ctrl.setSelectedZoom(Zoom.mapKey(ctrl.settings.zoom, ctrl.xExtent))
  }
})
```

`rangerView` target (`address.tmpl:271`): `<div data-address-target="rangerView" class="chart-ranger">` immediately below the chart div. `rangerData` extracts the primary series via `rangerColumn(cols[1])`, which sustains the last real value into the trailing null bucket appended by `padTrailingBin` (histogram bars are left-aligned and padded with a trailing null so the domain reaches the current period's end; without sustain the ranger's overview LINE stops at the last real point, leaving the newest bar uncovered). The main chart must keep the null (no phantom bar); sustain is ranger-only.

**Chart definitions** (`charts/definitions/address.js`):

Each factory returns `{name, label, stacked, series[], axes[], toColumns(raw, settings), formatValue(seriesIdx, datum)}`.

- **`typesDef()`** — stacked bars. `toColumns` maps `raw.time → UNIX seconds` via `secondsFromTimes`, reads `{sentRtx, receivedRtx, tickets, votes, revokeTx}`, appends a trailing null via `padTrailingBin`. `formatValue` reads `datum.payload[TYPE_SERIES[seriesIdx].field][datum.idx]` directly (raw integer counts; coin-independent).
- **`balanceDef(coinType)`** — stepped area (single series). `toColumns`: VAR reads `raw.balance[]` (float64 array); SKA reads `raw.balance_atoms[]` and converts `Number(s) * 1e-18` for pixel geometry only. A leading 0-balance sentinel and trailing sustain point are inserted (matching Dygraphs `padPoints(sustain=true)`). `formatValue`: VAR emits `${datum.value}`; **SKA reads `raw.balance_atoms[datum.idx - 1]`** (adjusted for the leading 0-pad) and formats via `formatSkaAtomsExact` — never uses `datum.value`, which is lossy. **SKA precision firewall lives here.**
- **`amountflowDef(coinType)`** — stacked bars (4 series: `Received`, `Spent`, `Net Received`, `Net Spent`). `toColumns`: VAR maps `raw.received`/`raw.sent`/`raw.net` directly, sign-splits `net` into two non-negative columns; SKA converts `Number(s) * 1e-18` for geometry. `padTrailingBin` appended. `formatValue`: VAR reads **`datum.payload.received[i]`/`sent[i]`/`net[i]`** (NOT `datum.value` — stacking makes that the cumulative total, not the raw series value); SKA reads `raw.received_atoms[i]`, `raw.sent_atoms[i]`, `raw.net_atoms[i]`, sign-splits via `absAtom()`, formats via `formatSkaAtomsExact`. **SKA precision firewall lives here.**

Both float-lossy definitions (`balanceDef`, `amountflowDef` for SKA) use `Number(atom) * 1e-18` only for pixel positioning — the displayed value is always read from the raw payload strings.

**processData → popChartCache → renderChart**:

- `processData()` (`:501`) stores **raw API payload** directly: `ctrl.retrievedData[`${key}-${bin}-${coin}`] = data` where `key = chart === 'balance' ? 'amountflow' : chart` (balance and amountflow share one endpoint and one cache slot).
- `defFor(chart, coin)` (`:513`) returns `typesDef()`, `balanceDef(coin)`, or `amountflowDef(coin)`.
- `popChartCache(chart, bin)` (async, `:519`): sets `ctrl.payload` and `ctrl.currentDef = ctrl.defFor(chart, coin)`, calls `await ctrl.renderChart()`, then `validateZoom`.
- `renderChart()` (async, `:544`):
  - `settings = { binSize: binSizeMs / 1000 }` (seconds).
  - Decodes `this.settings.zoom` → `opts.range = { min, max }` (seconds) when present and valid; the panel seeds both chart and ranger to that range before the first `setData`.
  - Calls `await this.panel.render(def, this.payload, settings, opts)`.
  - After render: if `def.name === 'amountflow'` and flow boxes exist, applies `this.panel.handle.setVisibility(flowVisibility(this.flow))`.
  - Reads `xExtent` (ms) back from `this.panel.handle.uplot.data[0]` for zoom-preset math.

**`flowVisibility(bitmap)` export** (`:30`):
Changed from index-keyed (`{0: bool, 1: bool, 2: bool, 3: bool}`) to **label-keyed** (`{Received: bool, Spent: bool, 'Net Received': bool, 'Net Spent': bool}`) for the uPlot adapter's `setVisibility` API. The 3-bit bitmap semantics are unchanged (bit 0 = Received, bit 1 = Sent, bit 2 = Net; Net still drives both net series). Unit-tested in `address_controller.test.js`.

**`rangerColumn(col)` export** (`:47`): sustains the trailing null in a histogram column for the ranger overview. No-op when the column has no trailing null (e.g., the balance chart already sustains its last value).

**Flow mutual exclusivity** (new): Net (Received − Sent) must not be stacked on Received/Spent (double-counting). `enforceFlowExclusivity(changed)` (`:642`) resolves on user toggle; `clampFlowExclusivity()` (`:659`) resolves programmatically (saved/crafted `?flow=`). Both are called from `updateFlow()` (`:619`) and `setFlowChecks()`; neither fires `change` events, so no re-entry. Resolves in Net's favour.

**Zoom handling** (revised):
- `_drawCallback`/`_zoomCallback` removed; the panel's `onRangeChange` callback (ms) fires for both chart drag and ranger drag.
- `setZoom(start, end)` (ms) (`:698`) calls `this.panel.setXRange(start / 1000, end / 1000)` (converts to seconds at the uPlot boundary); keeps `Zoom.encode` in ms.
- `validateZoom()` (`:579`) guards against a malformed `?zoom=` (undefined `.start`/`.end`); falls back to `setZoom(xExtent[0], xExtent[1])` + `setSelectedZoom('all')`.
- `setButtonVisibility()` never hides the currently-selected button (fix for a young SKA coin dropping the Month button while still grouped by month).

**Chart title**: still written to `ctrl.chartTitleTarget.textContent` (`address.tmpl:271`); not a uPlot/Dygraph axis label.

**`maxAddrRows`/`pageSizeOptions` removed**, always-enabled 20/40/80/160 dropdown (unchanged since `4d5f63ee`).
Confirmed-tx handler still decrements **only the `numUnconfirmed` target** matching `data-coin-type` (unchanged).

### 3.7 Chart serialization (`db/dbtypes/types.go:2079-2095`,
`db/dcrpg/internal/addrstmts.go:365-373`, `db/dcrpg/queries.go:4404-4446`)

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
- **`ChartsData` JSON tags ↔ `charts/definitions/address.js` payload field names** — `omitempty`
  means a renamed tag silently disappears (`undefined` in `toColumns`/`formatValue`); chart goes
  blank or shows NaN with no error. The fields read by the definitions: `time`, `received`,
  `sent`, `net`, `balance`, `received_atoms`, `sent_atoms`, `net_atoms`, `balance_atoms`,
  `sentRtx`, `receivedRtx`, `tickets`, `votes`, `revokeTx`.
- **`effectiveCoin()` (JS) ↔ backend `CoinTypeAll→0` collapse** (`:3285-3287`) — the
  same rule implemented twice; divergence shows the wrong coin's chart silently.
- **`def === ctrl.currentDef` (identity check in `panel.render`)** — ChartPanel reuses
  the existing uPlot handle when `def` is the same object reference; a new factory call
  each render triggers a full chart rebuild (DOM teardown + `createChart`). `defFor()`
  must return a stable reference from `ctrl.currentDef`, not be called again in `renderChart`.
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
   `Number()` permitted only for chart pixel positioning (`toColumns` geometry), never
   for displayed values — `formatValue` in each definition reads the original atom strings
   from `datum.payload` directly (e.g., `raw.balance_atoms[datum.idx - 1]`). The `skaAtomsByTime`
   Map that bridged this boundary in the Dygraphs controller is gone.
5. **Merged view has no `coin_type` predicate.** It aggregates all coins; query
   directly with `(address, N, offset)`, never via the coin-injecting stmt
   helper (LIMIT-0 trap).
6. **Centralized coin labels (core constraint C7).** Use `coinSymbol`
   (template) / `renderCoinType` (JS); no hard-coded `DCR`/`VAR` literals.
7. **CSV download is a deliberate full, non-merged, all-coin export.** The
   `address.tmpl:346` link is static — it carries no `?coin=` / `?txntype=`,
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
  `pgblockchain.go:2592/2648` and `:2719` — patch *both* branches.
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
- `ChartsData` tag rename (omitempty hides absence) → `undefined` in `toColumns`/`formatValue` → blank or NaN chart.
- `formatValue` reading `datum.value` instead of raw payload field on a stacked chart → cumulative stacked total shown as per-series value; for SKA this also bypasses the precision firewall.
- `data-coin-type` string-compare drift → unconfirmed count never decrements.
- A new `defFor()` call inside `renderChart()` (not stored in `ctrl.currentDef`) breaks the identity check → chart rebuilds every render (no silent data error, but repeated DOM teardown).
- Malformed `?zoom=` from a crafted URL → `validateZoom` falls back to full extent (guarded since this pass; would have blanked the chart before).

**Hard failures**
- `AddressHistory` signature mismatch → compile error (multi-module).
- `jsonMarshal` removed → base64 in attr → `JSON.parse` throws →
  `activeCoins=[]` → empty card, disabled selectors (degrades, not crash).

---

## Section 7 — Common Pitfalls

- Editing `AddressHistory` without the 4 mocks → multi-module build break.
- "Fixing" unconfirmed display by re-adding mempool amounts to balance — that
  removal was deliberate (confirmed-only).
- Renaming a `ChartsData` field and missing the payload field name in the definition's
  `toColumns`/`formatValue` — blank or NaN chart, no error (`omitempty` hides absence).
- Using `datum.value` in a stacked chart's `formatValue` — that's the cumulative stacked
  total; read the raw payload field directly (`datum.payload.received[datum.idx]` etc.).
- Routing the merged query through the coin-injecting helper — LIMIT-0, zero rows, no error.
- Calling `defFor()` inside `renderChart()` instead of reading `ctrl.currentDef` — breaks
  ChartPanel's identity check, triggering a full chart rebuild every render.
- Trusting the prior wiki's "frontend VAR-only / `coin` not in null-template" — both now false.
- Populating only one of the two `ActiveCoins` assignment branches.
- "Fixing" the CSV download so it respects the page Type/Coin filters — the
  unfiltered full export is intentional (Constraint 7), not an oversight.
- Letting Net be stacked on Received/Sent in the amount-flow chart — double-counting;
  `enforceFlowExclusivity`/`clampFlowExclusivity` enforce mutual exclusivity, don't bypass them.

---

## Section 8 — Evidence

Tier 1 Refresh at `HEAD = fcad89dd` (anchor `bba67634→fcad89dd`). Re-traced:
`address_controller.js` (ChartPanel retrofit), `address.tmpl` (Sent default + rangerView),
`db/dcrpg/queries.go` (missed-votes functions — not address-relevant; address functions unchanged).
Widened into: `cmd/dcrdata/public/js/helpers/chart_panel.js` and
`cmd/dcrdata/public/js/charts/definitions/address.js`. Original anchor `1b670255` (PR #265/#266).

**Original evidence (PR #265/#266):**
- PR #265: `8cf06854`, `8b5c3a1b`, `9f5d5a7e`, `f3e2d687`, `a4457a7a`,
  `a9b24127`, `2297e522`.
- PR #266 / db series: `6e92df4c`, `0c389276`, `d4bf6cff`, `f3231a78`,
  `61661722`, `be28442e`, `1b670255`.
- Charts SKA SQL precision (`#263`, still valid): `49953185`, `6837673f`.

**Refresh delta (`1b670255→a48ea0e1`) — address-domain commits (prior pass):**
- `b13091c8` — `utxoStore.set()` stores `SKAValue` (fixes SKA amount-flow sent=0).
- `e15efe10` — fix SKA spent regression from empty `ska_value`.
- `031c9bc4`, `72a2645a`, `a61fe0f6`, `1367121b` — multi-coin stake metrics.
- `151a272c` — `AddressRowMerged` carries `CoinType` + `SKAAtomsCredit/Debit`.
- `9a8361e0` — `CoinTypeAll` short-circuit + CSV fix.
- `738735c9` — `flowVisibility(bitmap)` export (Dygraph, now superseded).
- `4d5f63ee` — paginator cleanup.
- `ae0812a8`, `b67b3068`, `89f89186`, `92a4bebc` — template/CSS.
- `460f5ecd` — release cleanup.

**Refresh delta (`bba67634→fcad89dd`) — this pass (Tier 1):**
- `address_controller.js` — full ChartPanel retrofit: Dygraphs removed; `createChartPanel`
  introduced; `amountFlowProcessor`/`makeAmountFormatter`/`txTypesFunc`/`skaAtomsByTime`
  deleted; `defFor`/`renderChart`/`enforceFlowExclusivity`/`clampFlowExclusivity` added;
  `flowVisibility` changed to label-keyed; `rangerColumn` export added; `setZoom` now calls
  `panel.setXRange(ms/1000)`; `validateZoom` malformed-URL guard added; `setButtonVisibility`
  never hides selected button; `rangerView` target added.
- `address.tmpl` — "Sent" checkbox defaults to `checked`; `rangerView` target div added.
- `db/dcrpg/queries.go` — `retrieveMissedVotes`/`appendMissedVotesPerWindow` reorg recovery
  (missed-votes chart domain; **not address-relevant**).

**Widen targets added this pass:**
- `cmd/dcrdata/public/js/helpers/chart_panel.js` — `ChartPanel` class; `createChartPanel`.
- `cmd/dcrdata/public/js/charts/definitions/address.js` — `typesDef`, `balanceDef`, `amountflowDef`, `secondsFromTimes`, `rangerColumn` (re-exported in controller), `padTrailingBin`.

Primary files: `db/dcrpg/pgblockchain.go`, `db/dcrpg/queries.go`,
`db/dcrpg/internal/addrstmts.go`, `db/dbtypes/types.go`,
`db/dbtypes/coinfilter_test.go`, `cmd/dcrdata/internal/middleware/apimiddleware.go`,
`cmd/dcrdata/internal/api/apirouter.go`, `…/api/apiroutes.go`,
`cmd/dcrdata/internal/explorer/explorerroutes.go`, `…/explorer/explorer.go`,
`…/explorer/templates.go`, `cmd/dcrdata/views/address.tmpl`,
`cmd/dcrdata/views/extras.tmpl`,
`cmd/dcrdata/public/js/controllers/address_controller.js`,
`cmd/dcrdata/public/js/helpers/ska_helper.js`,
`cmd/dcrdata/public/js/helpers/chart_panel.js`,
`cmd/dcrdata/public/js/charts/definitions/address.js`.

---

See also:
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: `*CommonPageData` struct-embedding template injection — `AddressPageData`)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: `commonData` nil render crash)
- /wiki/code-analysis/charts/flow.full.md (shares-pattern-with: TurboQuery URL ownership; per-coin chart endpoints; SKA atom string pipeline)
- /wiki/code-analysis/transaction/flow.full.md (depends-on: address tx-list / Coin-column rendering)
- /wiki/code-analysis/address/patterns.md (shares-pattern-with: CoinCtx URL contract, coin-aware aggregation, per-coin caching, SKA decimal-string pipeline, TurboQuery URL ownership)
- /wiki/code-analysis/address/impact.md (depends-on: consolidated mutation blast radius — signature fan-out, CoinTypeAll sentinel, SKA precision, caches, flat-field shim, CSV schema)
- /wiki/core/constraints.md#C1 (depends-on: float64-vs-string SKA precision — now honored in template + controller)
- /wiki/core/constraints.md#C7 (depends-on: centralized coin labels — now honored via coinSymbol/renderCoinType)
