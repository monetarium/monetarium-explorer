# Address summary card — multi-coin mutation impact

## TL;DR

The summary card is **the last unconverted surface** in the address page's multi-coin migration. The backend already produces full per-coin data (`AddressBalance.Coins map[uint8]*CoinBalance`, `AddressInfo.ActiveCoins []uint8`, `AddressInfo.NumUnconfirmedByCoin map[uint8]int64`, plus `*big.Int`-derived SKA atom strings), but [cmd/dcrdata/views/address.tmpl](cmd/dcrdata/views/address.tmpl) still reads `Balance.TotalUnspent` / `Balance.TotalSpent` / `Balance.NumSpent` / `Balance.NumUnspent` — flat int64 fields kept in sync from `Coins[0]` (VAR-only) for backward compat. Hard-coded `DCR` labels remain at lines 48, 50, 64, 66, 77, 79. `FiatBalance` is now wired to `nil` in the handler ([explorerroutes.go:1633](cmd/dcrdata/internal/explorer/explorerroutes.go#L1633)) — the `if $.FiatBalance` branch (54-56) is unreachable. Live updates still touch only `numUnconfirmed` and the table-region `txnCount`; `BLOCK_RECEIVED` does not refresh balances. Open product/UX questions §7 still drive whether the card shows per-coin rows, a coin selector, or both.

## 1. Scope

The "summary card" is the **left-top card** in `cmd/dcrdata/views/address.tmpl`. The container that owns its data is `<div class="container main">` at line 10–16, which mounts both the `address` and `newblock` Stimulus controllers. The summary card itself is the column at line 21 (`<div class="col-24 col-xl-11 bg-white px-3 py-3 position-relative">`) and ends at line 112.

DOM blocks inside that column, by sub-region:

- **Address heading + clipboard + QR** — `address.tmpl:22-38` (`Address` label, `data-address-target="addr"` clipboard hash-box, QR icon and box targets).
- **Type line** — `address.tmpl:39-41` (`{{.Type}}`).
- **Three summary numbers (Balance / Received / Spent)** — `address.tmpl:42-86`.
  - Balance — `address.tmpl:43-57` (number + fiat — fiat unreachable today).
  - Received — `address.tmpl:58-71` (number + outputs count).
  - Spent — `address.tmpl:72-84` (number + inputs count).
- **Unconfirmed / Stake spending / Stake income row** — `address.tmpl:87-103`.
- **Dummy address notice** — `address.tmpl:107-111`.

Out of scope: charts column (`address.tmpl:113-184`), transactions area (`address.tmpl:185-298`), `addresstable.tmpl`.

The container `<div class="container main">` (lines 10–16) is **shared** with the table region — its `data-address-*` attributes (`offset`, `dcraddress`, `txn-count`, `balance`) are read by `address_controller.js` for both summary and table behavior, see Cross-surface dependencies (§6).

## 2. Backend touch points

### 2.1 Handler entry point

[cmd/dcrdata/internal/explorer/explorerroutes.go:1535](cmd/dcrdata/internal/explorer/explorerroutes.go#L1535) — `AddressPage`.

- Inline payload struct `AddressPageData{*CommonPageData, Data *dbtypes.AddressInfo, Type txhelpers.AddressType, CRLFDownload bool, Pages []pageNumber, FiatBalance interface{}}` at 1539-1546. Note `FiatBalance` is `interface{}` and **always set to `nil`** at 1633 (carries `TODO: Remove once frontend is updated for multi-coin support`).
- Calls `parseAddressParams` (1549), then either short-circuits the dummy/zero address (1593-1603, returns an `AddressInfo` with an empty `AddressBalance{}` whose `Coins` map is `nil`) or calls `AddressListData(ctx, address, txnType, limitN, offsetAddrOuts, middleware.GetCoinCtx(r))` (1605) — coin filter comes through the new `CoinCtx` middleware.
- `xcBot.Conversion(...)` is **no longer called** here. The fiat row in the summary template is dead code.
- Renders via `templates.exec("address", pageData)` at 1635.

The XHR sibling `AddressTable` (1652) does **not** render the summary card, but it shares `parseAddressParams`, `middleware.GetCoinCtx`, and `AddressListData`, and it returns `tx_count = addrData.TxnCount + addrData.NumUnconfirmed` (1678). That value drives `paginationParams.count` in JS — see §6.

### 2.2 Struct fields read by the summary card

[db/dbtypes/types.go:2322-2373](db/dbtypes/types.go#L2322-L2373) — `AddressInfo`:

- `.Address` — `address.tmpl:5,13,25` (page title, controller attr, displayed string).
- `.Type` — `address.tmpl:40` (typed as `txhelpers.AddressType`, stringer used).
- `.Offset` — `address.tmpl:12` (controller attr).
- `.TxnCount` — combined with `.NumUnconfirmed` at `address.tmpl:8` into `$TxnCount`, then onto `data-address-txn-count` (line 14).
- `.NumUnconfirmed` — `address.tmpl:8,88,90`.
- `.IsDummyAddress` — `address.tmpl:108` (notice + suppresses table block at line 185).
- `.Balance` — pointer to `AddressBalance`; the rest of the summary card lives in this sub-struct.

New per-coin fields available on `AddressInfo` but **not yet read** by the template:

- `.ActiveCoins []uint8` (2366) — sorted list of coin types with activity at this address.
- `.NumUnconfirmedByCoin map[uint8]int64` (2345) — populated by `mempool.UnconfirmedTxnsForAddress` ([mempool/monitor.go:487-572](mempool/monitor.go#L487-L572)).
- `.KnownTransactions / .KnownFundingTxns / .KnownSpendingTxns` (2370-2372) — derived from `Balance.Coins[coinType]` (or summed across coins when `coinType == CoinTypeAll`) at [pgblockchain.go:2618-2630](db/dcrpg/pgblockchain.go#L2618-L2630).

[db/dbtypes/types.go:2392-2406](db/dbtypes/types.go#L2392-L2406) — `AddressBalance`:

- `Coins map[uint8]*CoinBalance` (2395) — the **per-coin truth**. Currently unread by the template.
- `TotalOutputs int64` (2396) — Σ(NumSpent + NumUnspent) across all coins.
- `TotalInputs int64` (2397) — Σ(NumSpent) across all coins.
- `FromStake float64` (2398) — VAR-only stake percentage. Stake spending % (`address.tmpl:95`) via `HasStakeOutputs()` gate.
- `ToStake float64` (2399) — VAR-only stake percentage. Stake income % (`address.tmpl:100`) via `HasStakeInputs()` gate.
- `TotalUnspent int64` (2402) — **legacy flat field, synced from `Coins[0].TotalUnspent`**. Read at template line 48 (Balance), line 15 (`data-address-balance` attr — VAR-only float).
- `TotalSpent int64` (2403) — **legacy flat field**. Read at line 77 (Spent), and as part of Received at line 63.
- `NumSpent int64` (2404) — **legacy flat field**. Spent inputs count (line 83) and part of Received outputs count (line 70).
- `NumUnspent int64` (2405) — **legacy flat field**. Part of Received outputs count (line 70).

The four legacy flat fields carry `TODO: Remove these fields once frontend is updated for multi-coin support` (2401). Removing them today would crash the template. The migration plan is: convert the template to read from `Coins[*]`, then drop the flat fields and their three sync points.

[db/dbtypes/types.go:2375-2389](db/dbtypes/types.go#L2375-L2389) — `CoinBalance`:

- `CoinType uint8`, `NumSpent`, `NumUnspent`.
- `TotalSpent int64`, `TotalUnspent int64`, `TotalReceived int64` — VAR atoms (1e8), meaningful only when `CoinType == 0`.
- `TotalSpentSKA string`, `TotalUnspentSKA string`, `TotalReceivedSKA string` — SKA atoms as decimal strings (1e18), meaningful only when `CoinType > 0`.

### 2.3 DB query that fills `AddressBalance` (now coin-aware)

[db/dcrpg/pgblockchain.go:2533-2530](db/dcrpg/pgblockchain.go#L2533) — `AddressData` invokes `AddressHistory` at 2547, which produces `*AddressBalance` either through:

- Shortcut path: `dbtypes.ReduceAddressHistory(addressRows)` at [pgblockchain.go:2482](db/dcrpg/pgblockchain.go#L2482) → directly assigns `addrInfo.Balance` (with full `Coins` map) at 2491.
- Cache miss path: `pgb.AddressBalance(ctx, address)` at 2502, which delegates to `retrieveAddressBalance` ([queries.go:1472-1610](db/dcrpg/queries.go#L1472-L1610)), which runs SQL `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)).

**The SQL groups by `coin_type` AND emits both `SUM(value)` (VAR atoms) and `COALESCE(SUM(NULLIF(ska_value, '')::numeric), 0)::text AS ska_total` (SKA atoms as decimal text)**. Go-side: `retrieveAddressBalance` reads `coin_type` per row, dispatches to the right `CoinBalance` slot, accumulates SKA into `map[uint8]*big.Int` and materializes back as strings on `CoinBalance.Total*SKA` ([queries.go:1517-1580](db/dcrpg/queries.go#L1517-L1580)).

`ReduceAddressHistory` does the same per-coin accumulation for the paginated row slice it sees ([types.go:2497-2588](db/dbtypes/types.go#L2497-L2588)).

**Critical:** `AddressData` explicitly **overwrites** `addrData.Balance` with the full `balance` from `AddressHistory` at [pgblockchain.go:2601](db/dcrpg/pgblockchain.go#L2601), then re-syncs the legacy flat fields from `Coins[0]` at 2610-2615 (commit `961bbb0c` — "summary balance always uses full DB balance"). Removing this overwrite makes the summary card show only the current page's balance.

### 2.4 Three legacy flat-field sync points (must stay in lockstep)

Search-and-replace target when migrating the template off the flat fields:

1. [db/dbtypes/types.go:2557-2562](db/dbtypes/types.go#L2557-L2562) — `ReduceAddressHistory` shortcut sync.
2. [db/dcrpg/pgblockchain.go:2512-2519](db/dcrpg/pgblockchain.go#L2512-L2519) — `AddressHistory` cache-miss sync.
3. [db/dcrpg/pgblockchain.go:2610-2615](db/dcrpg/pgblockchain.go#L2610-L2615) — `AddressData` post-overwrite sync.

All three copy `Coins[0].{TotalSpent, TotalUnspent, NumSpent, NumUnspent}` to the flat fields. Drop all three together when the template stops reading them.

### 2.5 FiatBalance is dead today

- Handler sets `FiatBalance: nil` ([explorerroutes.go:1633](cmd/dcrdata/internal/explorer/explorerroutes.go#L1633)) with `TODO: Remove once frontend is updated for multi-coin support`.
- Template branch `if $.FiatBalance` (`address.tmpl:54-56`) never fires.
- `exchanges.Conversion`/`xcBot.Conversion` are still defined in `exchanges/bot.go` but no longer called by the address handler. A multi-coin fiat display requires structural changes upstream (decision needed — see §7).

### 2.6 DataSource interface and mocks

- Interface declaration: [cmd/dcrdata/internal/explorer/explorer.go:105-106](cmd/dcrdata/internal/explorer/explorer.go#L105-L106)
  - `AddressHistory(ctx, address, N, offset, txnType) ([]*AddressRow, *AddressBalance, error)`
  - `AddressData(ctx, address, N, offset, txnType, coinType uint8) (*AddressInfo, error)` — **`coinType` added**
  - `DevBalance(ctx) (*AddressBalance, error)`
- Test mocks that must stay in sync (four files):
  - [cmd/dcrdata/internal/explorer/explorer_test.go](cmd/dcrdata/internal/explorer/explorer_test.go) — `mockDataSource.AddressHistory`, `AddressData`, `DevBalance`.
  - [cmd/dcrdata/internal/api/noop_ds_test.go:40,53](cmd/dcrdata/internal/api/noop_ds_test.go#L40-L53) — `noopDS.TxHistoryData(_, _, _, _, _ uint8)`, `noopDS.AddressRowsCompact(_, _, _ uint8)`.
  - [cmd/dcrdata/internal/api/address_api_test.go:15,33](cmd/dcrdata/internal/api/address_api_test.go#L15-L33) — `addressDS.AddressData(...)` with the coin-filter signature; coin-filtering test.
  - [cmd/dcrdata/internal/api/apiroutes_test.go:337,359,383](cmd/dcrdata/internal/api/apiroutes_test.go#L337-L383) — `addressChartDS.AddressData/TxHistoryData/AddressRowsCompact`.

Renaming or extending `AddressInfo`/`AddressBalance` requires updating all four mock sites plus the production type and interface.

## 3. Template touch points

All paths are `cmd/dcrdata/views/address.tmpl`. `.Data` is `*dbtypes.AddressInfo`; under `with .Data`, `.Balance` is `*dbtypes.AddressBalance`; `$.FiatBalance` is the page-level value (currently `nil`).

| Line | Reference                                                          | Helper(s) used                                | Notes                                                              |
| ---- | ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------ |
| 5    | `.Data.Address`                                                    | —                                             | Page title via `headData`.                                         |
| 8    | `.TxnCount`, `.NumUnconfirmed`                                     | `add`                                         | Derived `$TxnCount`.                                               |
| 9    | `.TxnType`                                                         | —                                             | `$txType`.                                                         |
| 12   | `.Offset`                                                          | —                                             | `data-address-offset`.                                             |
| 13   | `.Address`                                                         | —                                             | `data-address-dcraddress`.                                         |
| 14   | `$TxnCount`                                                        | —                                             | `data-address-txn-count`.                                          |
| 15   | `.Balance.TotalUnspent`                                            | `toFloat64Amount`                             | `data-address-balance` — **VAR-only float, read into ctrl.balance and unused**. |
| 25   | `.Address`                                                         | `template "copyTextIcon"`                     | Visible address text.                                              |
| 40   | `.Type`                                                            | —                                             | Stringer of `txhelpers.AddressType`.                               |
| 47-48| `.Balance`, `.Balance.TotalUnspent` (flat sync from `Coins[0]`)    | `amountAsDecimalParts`, `template decimalParts` | **Hard-coded `DCR`** label at line 48.                             |
| 50   | static "0" + "DCR"                                                 | —                                             | Empty-balance branch — **hard-coded `DCR`**.                       |
| 54-56| `$.FiatBalance.Value`, `$.FiatBalance.Index`                       | `threeSigFigs`                                | **Unreachable today** — handler always sets `FiatBalance: nil`.    |
| 62-64| `.Balance.TotalSpent`, `.Balance.TotalUnspent` (flat sync)         | `add`, `amountAsDecimalParts`                 | Received = spent + unspent. **Hard-coded `DCR`** at line 64.       |
| 66   | static "0" + "DCR"                                                 | —                                             | Empty-balance branch.                                              |
| 70   | `.Balance.NumSpent`, `.Balance.NumUnspent` (flat sync)             | `add`, `intComma`                             | "outputs" count.                                                   |
| 76-77| `.Balance.TotalSpent` (flat sync)                                  | `amountAsDecimalParts`, `template decimalParts` | **Hard-coded `DCR`** at line 77.                                   |
| 79   | static "0" + "DCR"                                                 | —                                             | Empty-balance branch.                                              |
| 83   | `.Balance.NumSpent` (flat sync)                                    | `intComma`                                    | "inputs" count.                                                    |
| 88-90| `.NumUnconfirmed` (single counter)                                 | `ne`                                          | Conditional row + raw count. `NumUnconfirmedByCoin` available but unread. |
| 93-95| `.Balance.HasStakeOutputs`, `.Balance.FromStake`                   | `printf "%.1f"`, `x100`                       | Stake spending %. Computed from VAR rows only ([types.go:2541-2547](db/dbtypes/types.go#L2541-L2547)). |
| 98-100| `.Balance.HasStakeInputs`, `.Balance.ToStake`                     | `printf "%.1f"`, `x100`                       | Stake income %. VAR-only.                                          |
| 108  | `.IsDummyAddress`                                                  | —                                             | Notice text.                                                       |

Helpers, with their definitions in `cmd/dcrdata/internal/explorer/templates.go`:

- `amountAsDecimalParts` — `dcrutil.Amount(v).ToCoin()` then `float64Formatting`. **VAR-only by construction.**
- `toFloat64Amount` — `dcrutil.Amount(intAmount).ToCoin()`. **VAR-only.**
- `intComma` — `humanize.Comma(toInt64(v))`. Coin-agnostic (counts).
- `x100` — float multiply. Coin-agnostic.
- `threeSigFigs` — formats the fiat float. Coin-agnostic but operates on the lossy fiat product (and is unreachable today).
- `add` — int64 sum.
- `template "decimalParts"` — `views/extras.tmpl`, layout-only (no math).

Helpers **available but unused** on this surface (already SKA-aware, declared in `templates.go`): `formatCoinAtoms`, `formatAtomsAsCoinString`, `skaDecimalParts` / `skaDecimalPartsNoTrailing`, `coinSymbol`. Multi-coin work for the summary card will route through these. Reference for the established pattern: `views/tx.tmpl` shows the `{{if eq .CoinType 0}}…{{else}}…{{end}}` + `{{coinSymbol .CoinType}}` idiom that this card needs to follow.

## 4. Frontend touch points

All paths are `cmd/dcrdata/public/js/controllers/address_controller.js` unless noted.

### 4.1 Stimulus targets within the summary card

Declared in the `targets` getter (lines 153–192):

- `addr` — line 156 declaration; consumed indirectly via `clipboard` controller (the `.clipboard` class triggers a separate controller; not used for state inside `address` itself).
- `qricon` — line 165, manipulated in `showQRCode`/`hideQRCode` (lines 308, 312).
- `qrbox` — line 167, toggled in `showQRCode`/`hideQRCode` (lines 294, 313).
- `qrimg` — line 166, populated with `<img src="${qrCodeImg}"/>` in `showQRCode` (line 304); opacity reset in `hideQRCode` (line 314).
- `numUnconfirmed` — line 161, mutated in `_confirmMempoolTxs` (lines 791-802) when a mempool tx confirms.

Other targets in §1's container that the summary card does **not** own but coexists with: `txnCount` (line 164, declared on the table region at `address.tmpl:192`), `fullscreen`, `bigchart`, `littlechart`, `chartbox`, `expando`, etc.

### 4.2 Container data attributes consumed by JS

Declared on `address.tmpl:10-16`:

- `data-address-offset` — read at `address_controller.js:227` (`paginationParams.offset`).
- `data-address-dcraddress` — read at line 225 (`ctrl.dcrAddress`); also consumed by `showQRCode` (line 299) and URL builders for the table fetch (lines 321, 364, 447).
- `data-address-txn-count` — read at line 228 (`paginationParams.count`).
- `data-address-balance` — read at line 230 (`ctrl.balance`). **Currently set but never used elsewhere in the controller** (no further reference). Always a VAR-only float (lossy if reused for SKA).

### 4.3 Actions wired to the summary card

- `data-action="click->address#showQRCode"` — `address.tmpl:28` → `showQRCode` (line 293).
- `data-action="click->address#hideQRCode"` — `address.tmpl:33` → `hideQRCode` (line 311).

There are **no actions** on Balance/Received/Spent/Stake-percent values — they are static after server render.

### 4.4 Live updates (`newblock` controller and BLOCK_RECEIVED)

- The container mounts both controllers: `data-controller="address newblock"` (`address.tmpl:11`).
- The `newblock` controller (`public/js/controllers/newblock_controller.js`) only operates on elements with `data-newblock-target="confirmations"`. The summary card has **no** such target — so `newblock` does not touch this surface directly.
- The `address` controller listens to `BLOCK_RECEIVED` via `globalEventBus.on('BLOCK_RECEIVED', this.confirmMempoolTxs)` at line 285. `_confirmMempoolTxs` (line 774) is the **only** path that updates summary-card DOM live:
  - Line 788-790: increments `data-address-target="txnCount"` (table region, line 192) and re-renders its text. Note this also re-renders `$TxnCount` semantics, but only in that span — the container's `data-address-txn-count` attr is **not** updated.
  - Line 791-802: walks `numUnconfirmed` targets, decrements the count, and hides the row when it reaches 0.
- **Balance / Received / Spent / Stake % are never updated live.** They reflect the state at SSR time and only change on a hard reload. (Fiat row is dead.)
- The backend's per-coin `NumUnconfirmedByCoin` is delivered but unread; per-coin live decrement is not implemented.

## 5. Multi-coin gaps (current state)

**Backend status: complete.** Frontend status: VAR-only. The remaining gaps are template + controller + UX decisions, not data-layer plumbing.

### 5.1 Balance number (`Balance.TotalUnspent`)

- `address.tmpl:15` — `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` — runs through `dcrutil.Amount.ToCoin()`. Lossy for SKA; reads the legacy flat field synced from `Coins[0]`. For pure-SKA addresses this is `0`.
- `address.tmpl:48` — `{{template "decimalParts" (amountAsDecimalParts .Balance.TotalUnspent true)}}<span ...>DCR</span>` — same lossy float64 path; **hard-coded `DCR`** label.
- `address.tmpl:50` — empty-branch `<span ...>DCR</span>` — hard-coded label.
- **Backend truth:** `Balance.Coins[0].TotalUnspent` (VAR int64) and `Balance.Coins[N].TotalUnspentSKA` (SKA decimal string) for each `N` in `ActiveCoins`. Replacement display can iterate `ActiveCoins`.

### 5.2 Received (`Balance.TotalSpent + Balance.TotalUnspent`)

- `address.tmpl:63-64` — `{{$received := add .Balance.TotalSpent .Balance.TotalUnspent}}` then `amountAsDecimalParts $received true` plus hard-coded `DCR`.
- `address.tmpl:66` — empty branch hard-coded `DCR`.
- Outputs count line `address.tmpl:70` (`.Balance.NumSpent + .Balance.NumUnspent`) is coin-agnostic (counts only).
- **Backend truth:** `Balance.Coins[N].TotalReceived` (VAR int64) and `Balance.Coins[N].TotalReceivedSKA` (SKA decimal string), precomputed at [types.go:2567-2588](db/dbtypes/types.go#L2567-L2588) and [queries.go:1570-1610](db/dcrpg/queries.go#L1570-L1610).

### 5.3 Spent (`Balance.TotalSpent`)

- `address.tmpl:77` — `amountAsDecimalParts .Balance.TotalSpent true` + hard-coded `DCR`.
- `address.tmpl:79` — empty branch hard-coded `DCR`.
- `address.tmpl:83` — `intComma .Balance.NumSpent` (count, coin-agnostic).
- **Backend truth:** `Balance.Coins[N].TotalSpent` (VAR) and `Balance.Coins[N].TotalSpentSKA` (SKA).

### 5.4 Fiat balance

- `address.tmpl:54-56` — guarded by `if $.FiatBalance`. **Branch never fires today** — handler at [explorerroutes.go:1633](cmd/dcrdata/internal/explorer/explorerroutes.go#L1633) sets `FiatBalance: nil`.
- The previous `xcBot.Conversion(dcrutil.Amount(addrData.Balance.TotalUnspent).ToCoin())` call has been removed.
- A multi-coin fiat display requires both a multi-coin price feed in `exchanges/` (does not exist today) and a UX decision (see §7).

### 5.5 Unconfirmed count

- `address.tmpl:88-91` — `if ne .NumUnconfirmed 0` and `<span class="addr-unconfirmed-count">{{.NumUnconfirmed}}</span>`.
- Backend: `mempool.UnconfirmedTxnsForAddress(address)` ([mempool/monitor.go:487-572](mempool/monitor.go#L487-L572)) returns `(*AddressOutpoints, map[uint8]int64, error)`. The per-coin map populates `addrData.NumUnconfirmedByCoin` ([pgblockchain.go:2701](db/dcrpg/pgblockchain.go#L2701)); `addrData.NumUnconfirmed` is the sum (2693-2697).
- Frontend: `address_controller.js:791-802` decrements that single count when a mempool tx confirms. Per-coin decrement is not implemented.
- The backend has the per-coin breakdown ready; whether the UI shows it is a UX decision (§7).

### 5.6 Stake spending / Stake income (`FromStake`, `ToStake`)

- `address.tmpl:93-95` — `if .Balance.HasStakeOutputs` and `printf "%.1f" (x100 .Balance.FromStake)`.
- `address.tmpl:98-100` — symmetric for `HasStakeInputs` / `ToStake`.
- Backend: `FromStake`/`ToStake` are computed from VAR rows only at [types.go:2541-2547](db/dbtypes/types.go#L2541-L2547) (`fromStakeVAR / receivedVAR` and `toStakeVAR / sentVAR`). For an address with mixed VAR + SKA activity, these ratios reflect VAR-only stake activity — meaningful only for the VAR coin.
- UX question: should these rows render at all when the user has filtered to a non-VAR coin via `?coin=`? Currently the backend returns the same fractions regardless of `?coin=`.

### 5.7 Address type line

- `address.tmpl:40` — `{{.Type}}` is `txhelpers.AddressType`. Independent of coin type.
- No multi-coin gap; informational only.

### 5.8 Helpers that should replace single-coin helpers

For each VAR-only helper used today, the multi-coin replacement already exists in `cmd/dcrdata/internal/explorer/templates.go`:

| Today (VAR-only)                                        | Multi-coin replacement                                                                | Pattern reference        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `amountAsDecimalParts` (VAR int64 → DCR float)          | `formatAtomsAsCoinString` or `skaDecimalParts` for SKA branches                       | `views/tx.tmpl`          |
| `toFloat64Amount` (VAR int64 → DCR float)               | `varAtomsToFloat64` for VAR; for SKA, no float bridge — pass atom strings              | `views/home_supply.tmpl` |
| Hard-coded `DCR` text                                   | `{{coinSymbol .CoinType}}`                                                            | `views/tx.tmpl`          |

## 6. Cross-surface dependencies

- **Container element shared with table.** `<div class="container main">` at `address.tmpl:10-16` carries summary-card state (`data-address-balance`) **and** table state (`data-address-offset`, `data-address-txn-count`, `data-address-dcraddress`). Renaming any of these attrs requires updating both regions and `address_controller.js:225-230`.
- **`$TxnCount` derivation crosses surfaces.** Defined at `address.tmpl:8` from `.TxnCount + .NumUnconfirmed`, used at line 14 (container attr — summary input), line 149 (chart `data-txcount`), line 192 (table header span — `data-address-target="txnCount"` + `data-txn-count`), and lines 196, 208, 245 (pagination gating). Same value is also returned over the wire as `tx_count` from the `/addresstable` XHR ([explorerroutes.go:1678](cmd/dcrdata/internal/explorer/explorerroutes.go#L1678)) and overwrites `paginationParams.count` ([address_controller.js:370](cmd/dcrdata/public/js/controllers/address_controller.js#L370)). Any change in how unconfirmed count is computed (e.g. per-coin) propagates into all three regions.
- **`numUnconfirmed` drives both summary text and table-row decoration.** `_confirmMempoolTxs` (`address_controller.js:774-806`) walks ALL `numUnconfirmed` targets — currently only the summary-card row at `address.tmpl:89` is annotated, but the controller iterates `numUnconfirmedTargets` as if multiple rows existed. If a multi-coin design adds per-coin unconfirmed rows, each one needs the same target name and `data-count` attribute for the existing controller logic to work.
- **`txnCount` cross-write.** `_confirmMempoolTxs` increments `txnCountTarget.dataset.txnCount` (table region) on confirmation. The summary card's container attr `data-address-txn-count` is **not** updated to match. Invisible today because nothing in `address_controller.js` re-reads `data-address-txn-count` after `connect()`.
- **Dummy address branch suppresses the table** but **not** the summary card (`address.tmpl:185` gates the table). Any reorganization of `AddressInfo`/`AddressBalance` for multi-coin must keep the dummy short-circuit at [explorerroutes.go:1593-1603](cmd/dcrdata/internal/explorer/explorerroutes.go#L1593-L1603) producing a renderable empty `Balance` (note: today the dummy `Balance` has `Coins: nil`; converting the template to read `Coins[*]` requires either a nil-safe iteration or initializing `Coins: make(map[uint8]*CoinBalance)` here).
- **Three sync points for legacy flat fields** (§2.4) — converting the summary card to read `Coins[*]` is not enough; the flat-field sync code can only be removed once the template no longer references `.Balance.TotalUnspent`/`.Balance.TotalSpent`/etc.
- **`data-address-balance` is dead-but-wired.** Decide whether to drop the attribute or repurpose it as a JSON-serialized per-coin map for future client-side live updates.

## 7. Open product/UX questions

These cannot be decided from code alone. Each blocks a structural decision.

1. **Per-coin balances on a single address.** With `ActiveCoins []uint8` already populated, the summary card has the data to render per-coin rows. Choices:
   - List/expandable of one row per coin type held (like `views/home_supply.tmpl`), or
   - A single "default" coin (VAR) with a tab/dropdown for SKA{n}, or
   - Coin selector tied to `?coin=` URL filter (so the card reflects whatever the user selected for the table/charts).
2. **Default sort/order of coin rows.** `ActiveCoins` is already sorted ascending by coin_type (VAR=0 first, then SKA1..SKA255). Sort by balance descending instead? Hide zero balances?
3. **Received / Spent semantics in the multi-coin world.** Both have per-coin truth via `CoinBalance.TotalReceived`/`TotalReceivedSKA` and `TotalSpent`/`TotalSpentSKA`. With per-coin display: each coin row carries its own Received and Spent, or only Balance with Received/Spent collapsed into a transactions count? Note that the outputs-count and inputs-count lines (`address.tmpl:70, 83`) are coin-agnostic counts — keep them shared, or split per coin?
4. **Fiat balance.** `FiatBalance: nil` today. Resurrecting fiat requires (a) a multi-coin price model in `exchanges/` (does not exist) and (b) a UX choice: hide entirely, show VAR-equivalent only, list per coin, or sum cross-coin once SKA prices exist.
5. **Stake spending / Stake income for non-VAR coins.** `FromStake`/`ToStake` are VAR-only ratios. Possible answers: (a) only show these rows when VAR activity exists; (b) only show when `?coin=0` (or no filter); (c) drop the rows entirely from the multi-coin design; (d) redefine the metric per coin if SKA acquires its own stake-like flow.
6. **Unconfirmed count: aggregate or per-coin?** `NumUnconfirmedByCoin map[uint8]int64` is delivered but unread. UX call: show "Unconfirmed: 3" total, or "Unconfirmed: 1 VAR, 2 SKA1"? If per-coin, the live-decrement controller needs to learn the coin context.
7. **Address type line vs coin type.** `txhelpers.AddressType` is independent of coin type — confirmed. Keep as a single value.
8. **`data-address-balance` semantics.** Currently dead-but-wired. Drop, or reuse as a JSON-serialized per-coin map for future client behavior?
9. **Live updates.** Today only `numUnconfirmed` and the table-region `txnCount` update on `BLOCK_RECEIVED`. Should Balance/Received/Spent also update live as new mempool txs touch the address? If yes, this is a bigger change (websocket payload + per-coin BigInt math on the JS side per constraint C1).
10. **Empty-state coin labels.** Today the empty branches at `address.tmpl:50, 66, 79` hard-code `DCR`. Even for an address with zero activity, do we still want one row per known coin type, or just a single "No activity" line? Affects whether SSR has to know about coin types up front.
11. **Interaction with `?coin=` URL.** The `?coin=` filter affects the table (counts) and chart endpoints, but the summary card always shows `Balance.Coins` populated for **all** coins (commit `9cb4b8e0` made this explicit — "Balance always uses full DB balance"). Should the card respect `?coin=` and dim/hide non-selected coins, or always show the full picture?

## Evidence index

- Template: [cmd/dcrdata/views/address.tmpl:1-112](cmd/dcrdata/views/address.tmpl#L1-L112).
- Page handler: [cmd/dcrdata/internal/explorer/explorerroutes.go:1535-1648](cmd/dcrdata/internal/explorer/explorerroutes.go#L1535-L1648); payload struct at 1539-1546; FiatBalance set to nil at 1633; dummy branch at 1593-1603; `middleware.GetCoinCtx(r)` at 1605.
- Shared params: [cmd/dcrdata/internal/explorer/explorerroutes.go:1772-1789](cmd/dcrdata/internal/explorer/explorerroutes.go#L1772-L1789).
- DB AddressData / AddressHistory / per-coin balance: [db/dcrpg/pgblockchain.go:2533-2917](db/dcrpg/pgblockchain.go#L2533-L2917), 2419-2531, 2389 (`CountTransactions`); SQL [db/dcrpg/internal/addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247) (`SelectAddressSpentUnspentCountAndValue` — both VAR `SUM(value)` and SKA `SUM(NULLIF(ska_value,'')::numeric)::text`); balance aggregation [db/dcrpg/queries.go:1472-1610](db/dcrpg/queries.go#L1472-L1610).
- Types: [db/dbtypes/types.go:2322-2406](db/dbtypes/types.go#L2322-L2406); `CoinBalance` 2375-2389; `ReduceAddressHistory` 2456-2613.
- Three flat-field sync points: [types.go:2557-2562](db/dbtypes/types.go#L2557-L2562), [pgblockchain.go:2512-2519](db/dcrpg/pgblockchain.go#L2512-L2519), [pgblockchain.go:2610-2615](db/dcrpg/pgblockchain.go#L2610-L2615).
- Helpers: `cmd/dcrdata/internal/explorer/templates.go` (`coinSymbol`, `amountAsDecimalParts*`, `threeSigFigs`, SKA helpers).
- FiatBalance source (no longer called from address handler): `exchanges/bot.go`.
- Frontend: [cmd/dcrdata/public/js/controllers/address_controller.js](cmd/dcrdata/public/js/controllers/address_controller.js):153-192 (targets), 194-254 (connect / data-attr reads at 225-230), 285 (BLOCK_RECEIVED bind), 293-317 (QR), 774-806 (`_confirmMempoolTxs`).
- newblock controller (no summary-card touch): `cmd/dcrdata/public/js/controllers/newblock_controller.js`.
- Mocks: `cmd/dcrdata/internal/explorer/explorer_test.go`, [cmd/dcrdata/internal/api/noop_ds_test.go:40,53](cmd/dcrdata/internal/api/noop_ds_test.go#L40-L53), [address_api_test.go:15](cmd/dcrdata/internal/api/address_api_test.go#L15), [apiroutes_test.go:337,359,383](cmd/dcrdata/internal/api/apiroutes_test.go#L337-L383).
- CoinCtx middleware: [cmd/dcrdata/internal/middleware/apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842).
- `CoinTypeAll = 255`: [db/dbtypes/types.go:47-49](db/dbtypes/types.go#L47-L49).

See also:

- [flow.compact.md](flow.compact.md), [flow.full.md](flow.full.md) — the broader page flow this card is one piece of.
- [patterns.md](patterns.md) — dual-field migration shim, `CoinCtx` URL/middleware contract.
- [transactions.impact.md](transactions.impact.md) — `AddressTx.SKAValue`/`SentTotalSKA` plumbing already populated, unread.
- [charts.impact.md](charts.impact.md) — chart `?coin=` URL wiring + SKA SQL precision fix (PR #263).
- /wiki/core/constraints.md C1 (precision), C3 (template + websocket parity — relevant if live summary updates are added), C7 (centralized coin-type label rendering — `coinSymbol`).
- `views/tx.tmpl` — established multi-coin display pattern (`{{if eq .CoinType 0}}…{{else}}…{{end}}` + `coinSymbol`) to mirror in the summary card.
