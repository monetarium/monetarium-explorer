# Address summary card — multi-coin mutation impact

## TL;DR

The summary card pulls from `dbtypes.AddressInfo`/`AddressBalance` (single `int64` totals, no coin-type dimension), runs every monetary value through `toFloat64Amount`/`amountAsDecimalParts` (i.e. `dcrutil.Amount.ToCoin()` — VAR-only) at `address.tmpl:15, 48, 64, 77`, and hard-codes the literal `DCR` string at `address.tmpl:48, 50, 64, 66, 77, 79`. The structural origin of the multi-coin gap is in the data layer: SQL `SelectAddressSpentUnspentCountAndValue` already groups by `coin_type` (`db/dcrpg/internal/addrstmts.go:220-232`), but `retrieveAddressBalance` (`queries.go:1484-1513`) and `ReduceAddressHistory` (`db/dbtypes/types.go:2380+`) flatten that dimension into a single `AddressBalance` — so balances from VAR (1e8 scale) and SKA (1e18 scale) are summed into one int64 today, which is silently nonsensical for any mixed address. The frontend exposes summary state via container `data-address-*` attrs at `address.tmpl:10-16` (one of which, `data-address-balance`, is currently set but unread by `address_controller.js`), and only `numUnconfirmed` and the table-region `txnCount` get live updates via `_confirmMempoolTxs`. SKA-aware helpers (`formatAtomsAsCoinString`, `skaDecimalParts`, `coinSymbol`) already exist and are used in `views/tx.tmpl` and `views/home_supply.tmpl` — those are the patterns to mirror. Five product decisions are blocking before a spec can specify structure: per-coin layout shape, row sort order, whether Received/Spent split per coin, fiat-without-SKA-price behavior, what "stake spending/income" means for non-VAR coins.

## 1. Scope

The "summary card" is the **left top card** in `cmd/dcrdata/views/address.tmpl`. The container that owns its data is `<div class="container main">` at line 10–16, which mounts both the `address` and `newblock` Stimulus controllers. The summary card itself is the column at line 21 (`<div class="col-24 col-xl-11 bg-white px-3 py-3 position-relative">`) and ends at line 112.

DOM blocks inside that column, by sub-region:

- **Address heading + clipboard + QR** — `address.tmpl:22-38` (`Address` label, `data-address-target="addr"` clipboard hash-box, QR icon and box targets).
- **Type line** — `address.tmpl:39-41` (`{{.Type}}`).
- **Three summary numbers (Balance / Received / Spent)** — `address.tmpl:42-86`.
  - Balance — `address.tmpl:43-57` (number + fiat).
  - Received — `address.tmpl:58-71` (number + outputs count).
  - Spent — `address.tmpl:72-84` (number + inputs count).
- **Unconfirmed / Stake spending / Stake income row** — `address.tmpl:87-103`.
- **Dummy address notice** — `address.tmpl:107-111`.

Out of scope: charts column (`address.tmpl:113-184`), transactions area (`address.tmpl:185-251`), `addressTable.tmpl`.

The container `<div class="container main">` (lines 10–16) is **shared** with the table region — its `data-address-*` attributes (`offset`, `dcraddress`, `txn-count`, `balance`) are read by `address_controller.js` for both summary and table behavior, see Cross-surface dependencies (§6).

## 2. Backend touch points

### 2.1 Handler entry point

`cmd/dcrdata/internal/explorer/explorerroutes.go:1534` — `AddressPage`.

- Defines an inline payload struct `AddressPageData` at `explorerroutes.go:1538-1545` with fields `*CommonPageData`, `Data *dbtypes.AddressInfo`, `Type`, `CRLFDownload`, `FiatBalance *exchanges.Conversion`, `Pages`. The summary card reads `Data` and `FiatBalance`.
- Calls `parseAddressParams` (`explorerroutes.go:1774`), then either short-circuits the dummy/zero address (`explorerroutes.go:1592-1602`, returns an `AddressInfo` with an empty `AddressBalance`) or calls `AddressListData` (`explorerroutes.go:1877`) which delegates to `dataSource.AddressData` (`explorerroutes.go:1881`).
- Computes `FiatBalance` at `explorerroutes.go:1617`: `exp.xcBot.Conversion(dcrutil.Amount(addrData.Balance.TotalUnspent).ToCoin())` — passes a `float64` of "DCR coins" derived from `Balance.TotalUnspent`.
- Renders via `templates.exec("address", pageData)` at `explorerroutes.go:1637`.

The XHR sibling `AddressTable` (`explorerroutes.go:1654`) does **not** render the summary card, but it shares `parseAddressParams` and `AddressListData`, and it returns `tx_count = addrData.TxnCount + addrData.NumUnconfirmed` (line 1680). That value drives `paginationParams.count` in JS — see §6.

### 2.2 Struct fields read by the summary card

`db/dbtypes/types.go:2304-2346` — `AddressInfo`:

- `.Address` — `address.tmpl:5,13,25` (page title, controller attr, displayed string).
- `.Type` — `address.tmpl:40` (typed as `txhelpers.AddressType`, stringer used).
- `.Offset` — `address.tmpl:12` (controller attr).
- `.TxnCount` — combined with `.NumUnconfirmed` at `address.tmpl:8` into `$TxnCount`, then onto `data-address-txn-count` (line 14).
- `.NumUnconfirmed` — `address.tmpl:8,88,90`.
- `.IsDummyAddress` — `address.tmpl:108` (notice + suppresses table block at line 185).
- `.Balance` — pointer to `AddressBalance`; the rest of the summary card lives in this sub-struct.

`db/dbtypes/types.go:2350-2370` — `AddressBalance`:

- `TotalUnspent int64` — Balance number (line 48), `data-address-balance` attr (line 15), fiat input (`explorerroutes.go:1617`).
- `TotalSpent int64` — Spent number (line 77) and part of Received (line 63).
- `NumSpent int64` — Spent inputs count (line 83) and part of Received outputs count (line 70).
- `NumUnspent int64` — part of Received outputs count (line 70).
- `FromStake float64` — Stake spending % (line 95) via `HasStakeOutputs()` gate (line 93).
- `ToStake float64` — Stake income % (line 100) via `HasStakeInputs()` gate (line 98).
- Methods `HasStakeOutputs` (line 2362) and `HasStakeInputs` (line 2368) used as gating conditions.

### 2.3 DB query that fills `AddressBalance`

`db/dcrpg/pgblockchain.go:2484` — `AddressData` invokes `AddressHistory` at line 2496, which produces `*AddressBalance` either through:

- Shortcut path: `dbtypes.ReduceAddressHistory(addressRows)` at `pgblockchain.go:2445` + manual struct fill at `pgblockchain.go:2452-2460`.
- Cache miss path: `pgb.AddressBalance(ctx, address)` at `pgblockchain.go:2468`, which delegates to `retrieveAddressBalance` (`db/dcrpg/queries.go:1453`), which runs SQL `SelectAddressSpentUnspentCountAndValue` (`db/dcrpg/internal/addrstmts.go:220`).

**The SQL groups by `coin_type` (`addrstmts.go:222,230`), but `retrieveAddressBalance` discards that dimension** (`queries.go:1484-1513` — it sums `count` and `totalValue` into the single `balance.NumUnspent`/`balance.TotalUnspent`/etc. fields without keying by coin_type). Same flattening happens in `ReduceAddressHistory` (`db/dbtypes/types.go:2380` onwards): the function loops over `addrHist`, switches on `addrOut.CoinType` for VAR vs SKA but feeds them into a **single** `received`/`sent` running total (line 2392 calls `dcrutil.Amount(addrOut.Value).ToCoin()` regardless of coin type). This is the structural origin of the multi-coin gap — see §5.

There is no per-coin balance map anywhere in the address pipeline. `dbtypes.AddressRow.CoinType` and `AddressRow.SKAValue` (referenced in `queries.go:1392, 1831, 2725, 2791`) carry the coin info into the rows, but it is dropped before reaching the summary card.

### 2.4 `xcBot.Conversion` (FiatBalance)

`exchanges/bot.go:1043-1058` — `(*ExchangeBot).Conversion(dcrVal float64) *Conversion` multiplies `xcState.Price * dcrVal` and returns `Conversion{Value, Index}`. Single price source. Today VAR-only — no SKA price model. Caller (`explorerroutes.go:1617`) passes `dcrutil.Amount(addrData.Balance.TotalUnspent).ToCoin()` — a single VAR-scale float.

`exchanges/bot.go:1025-1029` — `Conversion struct { Value float64; Index string }`. Template reads `$.FiatBalance.Value` and `$.FiatBalance.Index` at `address.tmpl:55`.

### 2.5 DataSource interface and mocks

- Interface declaration: `cmd/dcrdata/internal/explorer/explorer.go:84-86`
  - `AddressHistory(...) ([]*dbtypes.AddressRow, *dbtypes.AddressBalance, error)`
  - `AddressData(...) (*dbtypes.AddressInfo, error)`
  - `DevBalance(...) (*dbtypes.AddressBalance, error)`
- Test mocks that must stay in sync:
  - `cmd/dcrdata/internal/explorer/explorer_test.go:50-58` — `mockDataSource.AddressHistory`, `AddressData`, `DevBalance` (all return zero values).
  - `cmd/dcrdata/internal/api/noop_ds_test.go:29-31` — `noopDS.AddressHistory` (different DataSource interface for the API layer; relevant if `AddressBalance` shape changes).

Renaming or extending `AddressInfo`/`AddressBalance` requires updating both mocks plus the production type.

## 3. Template touch points

All paths are `cmd/dcrdata/views/address.tmpl`. `.Data` is `*dbtypes.AddressInfo`; under `with .Data`, `.Balance` is `*dbtypes.AddressBalance`; `$.FiatBalance` is the page-level `*exchanges.Conversion`.

| Line | Reference                                                          | Helper(s) used                                | Notes                                                              |
| ---- | ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------ |
| 5    | `.Data.Address`                                                    | —                                             | Page title via `headData`.                                         |
| 8    | `.TxnCount`, `.NumUnconfirmed`                                     | `add`                                         | Derived `$TxnCount`.                                               |
| 9    | `.TxnType`                                                         | —                                             | `$txType`.                                                         |
| 12   | `.Offset`                                                          | —                                             | `data-address-offset`.                                             |
| 13   | `.Address`                                                         | —                                             | `data-address-dcraddress`.                                         |
| 14   | `$TxnCount`                                                        | —                                             | `data-address-txn-count`.                                          |
| 15   | `.Balance.TotalUnspent`                                            | `toFloat64Amount`                             | `data-address-balance` — **VAR-only float**.                       |
| 25   | `.Address`                                                         | `template "copyTextIcon"`                     | Visible address text.                                              |
| 40   | `.Type`                                                            | —                                             | Stringer of `txhelpers.AddressType`.                               |
| 47-48| `.Balance`, `.Balance.TotalUnspent`                                | `amountAsDecimalParts`, `template decimalParts` | **Hard-coded `DCR`** label at line 48.                             |
| 50   | static "0" + "DCR"                                                 | —                                             | Empty-balance branch — **hard-coded `DCR`**.                       |
| 54-55| `$.FiatBalance.Value`, `$.FiatBalance.Index`                       | `threeSigFigs`                                | Single fiat number.                                                |
| 62-64| `.Balance.TotalSpent`, `.Balance.TotalUnspent`                     | `add`, `amountAsDecimalParts`                 | Received = spent + unspent. **Hard-coded `DCR`** at line 64.       |
| 66   | static "0" + "DCR"                                                 | —                                             | Empty-balance branch.                                              |
| 70   | `.Balance.NumSpent`, `.Balance.NumUnspent`                         | `add`, `intComma`                             | "outputs" count.                                                   |
| 76-77| `.Balance.TotalSpent`                                              | `amountAsDecimalParts`, `template decimalParts` | **Hard-coded `DCR`** at line 77.                                   |
| 79   | static "0" + "DCR"                                                 | —                                             | Empty-balance branch.                                              |
| 83   | `.Balance.NumSpent`                                                | `intComma`                                    | "inputs" count.                                                    |
| 88-90| `.NumUnconfirmed`                                                  | `ne`                                          | Conditional row + raw count.                                       |
| 93-95| `.Balance.HasStakeOutputs`, `.Balance.FromStake`                   | `printf "%.1f"`, `x100`                       | Stake spending %.                                                  |
| 98-100| `.Balance.HasStakeInputs`, `.Balance.ToStake`                     | `printf "%.1f"`, `x100`                       | Stake income %.                                                    |
| 108  | `.IsDummyAddress`                                                  | —                                             | Notice text.                                                       |

Helpers, with their definitions in `cmd/dcrdata/internal/explorer/templates.go`:

- `amountAsDecimalParts` (line 652) — `dcrutil.Amount(v).ToCoin()` then `float64Formatting`. **VAR-only by construction.**
- `toFloat64Amount` (line 655) — `dcrutil.Amount(intAmount).ToCoin()`. **VAR-only.**
- `intComma` (line 637) — `humanize.Comma(toInt64(v))`. Coin-agnostic (counts).
- `x100` (line 630) — float multiply. Coin-agnostic.
- `threeSigFigs` (line 339) — formats the fiat float. Coin-agnostic but operates on the lossy fiat product.
- `add` (line 576) — int64 sum.
- `template "decimalParts"` — `views/extras.tmpl:176-188`, layout-only (no math).

Helpers **available but unused** on this surface (already SKA-aware, declared in `templates.go`): `formatCoinAtoms` (line 661), `formatAtomsAsCoinString` (line 662), `skaDecimalParts` / `skaDecimalPartsNoTrailing` (lines 663, 666), `coinSymbol` (line 899). Multi-coin work for the summary card will route through these. Reference for the established pattern: `views/tx.tmpl:60, 101, 500, 573` shows the `{{if eq .CoinType 0}}…{{else}}…{{end}}` + `{{coinSymbol .CoinType}}` idiom that this card needs to follow.

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
- `data-address-balance` — read at line 230 (`ctrl.balance`). **Currently set but never used elsewhere in the controller** (no further reference). Live-inert (would be silently inert if the value were SKA atoms today).

### 4.3 Actions wired to the summary card

- `data-action="click->address#showQRCode"` — `address.tmpl:28` → `showQRCode` (line 293). Lazy-imports `qrcode`, paints `qrimgTarget`, hides `qriconTarget`. Also calls `this.graph.resize()` (line 306) — implicit dependency on the chart column.
- `data-action="click->address#hideQRCode"` — `address.tmpl:33` → `hideQRCode` (line 311). Symmetric reverse, also calls `this.graph.resize()`.

There are **no actions** on Balance/Received/Spent/Stake-percent values — they are static after server render.

### 4.4 Live updates (`newblock` controller and BLOCK_RECEIVED)

- The container mounts both controllers: `data-controller="address newblock"` (`address.tmpl:11`).
- The `newblock` controller (`public/js/controllers/newblock_controller.js`) only operates on elements with `data-newblock-target="confirmations"`. The summary card has **no** such target — so `newblock` does not touch this surface directly.
- The `address` controller listens to `BLOCK_RECEIVED` via `globalEventBus.on('BLOCK_RECEIVED', this.confirmMempoolTxs)` at line 285. `_confirmMempoolTxs` (line 774) is the **only** path that updates summary-card DOM live:
  - Line 788-790: increments `data-address-target="txnCount"` (table region, line 192) and re-renders its text. Note this also re-renders `$TxnCount` semantics, but only in that span — the container's `data-address-txn-count` attr is **not** updated.
  - Line 791-802: walks `numUnconfirmed` targets, decrements the count, and hides the row when it reaches 0.
- **Balance / Received / Spent / Stake % / FiatBalance are never updated live.** They reflect the state at SSR time and only change on a hard reload.

## 5. Multi-coin gaps (most important)

### 5.1 Balance number (`Balance.TotalUnspent`)

- `address.tmpl:15` — `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` — runs through `dcrutil.Amount.ToCoin()`. Lossy for SKA; nonsensical when the address holds both VAR and SKA atoms summed into one int64.
- `address.tmpl:48` — `{{template "decimalParts" (amountAsDecimalParts .Balance.TotalUnspent true)}}<span ...>DCR</span>` — same lossy float64 path; **hard-coded `DCR`** label.
- `address.tmpl:50` — empty-branch `<span ...>DCR</span>` — hard-coded label.
- Backend cause: `db/dbtypes/types.go:2350` — `AddressBalance.TotalUnspent` is single `int64`, not a per-coin map. Filled by:
  - `db/dcrpg/queries.go:1488-1497` — `retrieveAddressBalance` reads `coin_type` from the SQL row but discards it before summation.
  - `db/dbtypes/types.go:2406-2407` — `ReduceAddressHistory` takes the `IsFunding && CoinType == 0` branch but still feeds `received += int64(addrOut.Value)` without segregating by coin type.

### 5.2 Received (`Balance.TotalSpent + Balance.TotalUnspent`)

- `address.tmpl:63-64` — `{{$received := add .Balance.TotalSpent .Balance.TotalUnspent}}` then `amountAsDecimalParts $received true` plus hard-coded `DCR`.
- `address.tmpl:66` — empty branch hard-coded `DCR`.
- Same root cause as 5.1: both summands are coin-agnostic int64 sums.
- Outputs count line `address.tmpl:70` (`.Balance.NumSpent + .Balance.NumUnspent`) is coin-agnostic (counts only) — no fix needed for precision, but a multi-coin spec must decide whether the count should be per-coin too (cosmetic decision; see §7).

### 5.3 Spent (`Balance.TotalSpent`)

- `address.tmpl:77` — `amountAsDecimalParts .Balance.TotalSpent true` + hard-coded `DCR`.
- `address.tmpl:79` — empty branch hard-coded `DCR`.
- `address.tmpl:83` — `intComma .Balance.NumSpent` (count, coin-agnostic).
- Same root cause as 5.1.

### 5.4 Fiat balance

- `address.tmpl:54-56` — guarded by `if $.FiatBalance`. Renders `$.FiatBalance.Value` (float64).
- `cmd/dcrdata/internal/explorer/explorerroutes.go:1617` — `exp.xcBot.Conversion(dcrutil.Amount(addrData.Balance.TotalUnspent).ToCoin())` — feeds the same single-coin VAR-scaled float into the conversion.
- `exchanges/bot.go:1043-1058` — `Conversion(dcrVal float64)` is hard-wired to the single price feed (`xcState.Price`); no concept of coin-type-specific rates.
- Multi-coin gap: there is no SKA price feed model anywhere in the bot, and the `Conversion` API takes a single float. A multi-coin fiat display requires structural changes upstream (decision needed — see §7).

### 5.5 Unconfirmed count

- `address.tmpl:88-91` — `if ne .NumUnconfirmed 0` and `<span class="addr-unconfirmed-count">{{.NumUnconfirmed}}</span>`.
- Backend: `db/dcrpg/pgblockchain.go:2587-2592` — `pgb.mp.UnconfirmedTxnsForAddress(address)` returns `numUnconfirmed int64`. **No coin-type segregation** — it counts unconfirmed mempool entries against the address regardless of coin.
- Frontend: `address_controller.js:791-802` decrements that single count when a mempool tx confirms.
- Gap is cosmetic-only: the count itself is correct (a count is coin-agnostic), but if the spec wants per-coin breakdown, this needs a new mempool API and a new controller path.

### 5.6 Stake spending / Stake income (`FromStake`, `ToStake`)

- `address.tmpl:93-95` — `if .Balance.HasStakeOutputs` and `printf "%.1f" (x100 .Balance.FromStake)`.
- `address.tmpl:98-100` — symmetric for `HasStakeInputs` / `ToStake`.
- Backend root cause: `db/dbtypes/types.go:2356-2357` — `FromStake`/`ToStake` are float64 fractions computed in `db/dcrpg/queries.go:1518-1524` as `fromStake / totalTransfer` and `toStake / TotalSpent`, using the same coin-flattened sums (`fromStake` is accumulated at `queries.go:1511` from rows of all coin types). For an address with mixed VAR + SKA activity the ratio is meaningless because the numerator and denominator are atom sums on different decimal scales.
- There is also a deeper conceptual gap: "stake" in dcrdata's sense was tied to the original Decred consensus stake mechanism. The Monetarium multi-coin model does not use stake outputs the same way for SKA coin types. A spec decision is needed (see §7) before this row even has a defined meaning for non-VAR coins.

### 5.7 Address type line

- `address.tmpl:40` — `{{.Type}}` is `txhelpers.AddressType`. Independent of coin type.
- No multi-coin gap; informational only.

### 5.8 Helpers that should replace single-coin helpers

For each VAR-only helper used today, the multi-coin replacement already exists in `cmd/dcrdata/internal/explorer/templates.go`:

| Today (VAR-only)                                        | Multi-coin replacement                                                                | Pattern reference        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `amountAsDecimalParts` (line 652)                       | `formatAtomsAsCoinString` (line 662) or `skaDecimalParts` (line 663) for SKA branches | `views/tx.tmpl:60`       |
| `toFloat64Amount` (line 655)                            | `varAtomsToFloat64` (line 658) for VAR-only data; for SKA, no float bridge — pass atom strings | `views/home_supply.tmpl:14` |
| Hard-coded `DCR` text                                   | `{{coinSymbol .CoinType}}` (line 899)                                                 | `views/tx.tmpl:60, 101`  |

## 6. Cross-surface dependencies

- **Container element shared with table.** `<div class="container main">` at `address.tmpl:10-16` carries summary-card state (`data-address-balance`) **and** table state (`data-address-offset`, `data-address-txn-count`, `data-address-dcraddress`). Renaming any of these attrs requires updating both regions and `address_controller.js:225-230`.
- **`$TxnCount` derivation crosses surfaces.** Defined at `address.tmpl:8` from `.TxnCount + .NumUnconfirmed`, used at line 14 (container attr — summary input), line 149 (chart `data-txcount`), line 192 (table header span — `data-address-target="txnCount"` + `data-txn-count`), and lines 196, 208, 245 (pagination gating). The same value is also returned over the wire as `tx_count` from the `/addresstable` XHR (`explorerroutes.go:1680`) and overwrites `paginationParams.count` (`address_controller.js:370`). Any change in how unconfirmed count is computed (e.g. per-coin) propagates into all three regions.
- **`numUnconfirmed` drives both summary text and table-row decoration.** `_confirmMempoolTxs` (`address_controller.js:774-806`) walks ALL `numUnconfirmed` targets — currently only the summary-card row at `address.tmpl:89` is annotated, but the controller iterates `numUnconfirmedTargets` as if multiple rows existed. If a multi-coin design adds per-coin unconfirmed rows, each one needs the same target name and `data-count` attribute for the existing controller logic to work.
- **`txnCount` cross-write.** `_confirmMempoolTxs` (`address_controller.js:788-790`) increments `txnCountTarget.dataset.txnCount` (table region) on confirmation. The summary card's container attr `data-address-txn-count` is **not** updated to match. This mismatch is invisible today because nothing in `address_controller.js` re-reads `data-address-txn-count` after `connect()`. A spec that adds live updates to summary numbers may want to fix this asymmetry.
- **FiatBalance shares state with home page market data, not address state.** `xcBot` is a singleton; if a future per-coin price feed lands, it will affect every page that displays a fiat conversion (home, mempool, tx, address). Out of scope for this card but worth flagging.
- **Dummy address branch suppresses the table** but **not** the summary card (`address.tmpl:185` gates the table). Any reorganization of `AddressInfo`/`AddressBalance` for multi-coin must keep the dummy short-circuit at `explorerroutes.go:1592-1602` producing a renderable empty `Balance`, otherwise the summary card crashes the template.

## 7. Open product/UX questions

These cannot be decided from code alone. Each blocks a structural decision.

1. **Per-coin balances on a single address.** A Monetarium address can receive VAR and any number of SKA{n} outputs (chain invariant: tx is single-coin, but an address sees txs of many coin types). Does the summary card show:
   - a list/expandable of one row per coin type held (like `views/home_supply.tmpl:29-39`), or
   - a single "default" coin (VAR) with a tab/dropdown for SKA{n}, or
   - only coins with non-zero balance?
2. **Default sort/order of coin rows.** VAR first, then `SKA1..SKA255` ascending? Sort by balance descending? Hide zero balances?
3. **Received / Spent semantics in the multi-coin world.** Both are aggregates today. With per-coin display: does each coin row carry its own Received and Spent, or only Balance, with Received/Spent collapsed into a transactions count? Note that the outputs-count and inputs-count lines (`address.tmpl:70, 83`) are coin-agnostic counts — keep them shared, or split per coin?
4. **Fiat balance with no SKA price feed.** `xcBot.Conversion` only knows the VAR price. For an address with only SKA holdings: hide the fiat row, show "—", or show a "VAR equivalent only" line? Same question once SKA price feeds eventually exist: do we sum across coins for a single fiat number, or list per coin?
5. **Stake spending / Stake income for non-VAR coins.** SKA coins do not participate in the Decred-style stake mechanism the way VAR does. Possible answers: (a) only show these rows when VAR activity exists; (b) drop the rows entirely from the multi-coin design; (c) redefine the metric per coin if SKA acquires its own stake-like flow. Backend currently produces a single ratio across all coin types — meaningless until this is decided.
6. **Unconfirmed count: aggregate or per-coin?** Mempool count is one int64 today. UX call: show "Unconfirmed: 3" total, or "Unconfirmed: 1 VAR, 2 SKA1"? Affects mempool API shape.
7. **Address type line vs coin type.** `txhelpers.AddressType` is independent of coin type. Confirm the type line stays a single value (it should — it's a property of the address script, not its holdings).
8. **`data-address-balance` semantics.** Currently set but unused by JS. Drop it, or reuse it as a JSON-serialized per-coin map for future client behavior (e.g. live updates)? Decision affects whether we treat that attribute as a public contract or remove it.
9. **Live updates.** Today only `numUnconfirmed` and the table-region `txnCount` update on `BLOCK_RECEIVED`. Should Balance/Received/Spent also update live as new mempool txs touch the address? If yes, this is a much bigger change (websocket payload + per-coin BigInt math on the JS side per constraint C1).
10. **Empty-state coin labels.** Today the empty branches at `address.tmpl:50, 66, 79` hard-code `DCR`. Even if the address has zero activity, do we still want one row per known coin type, or just a single "No activity" line? Affects whether SSR has to know about coin types up front.

## Evidence index

- Template: `cmd/dcrdata/views/address.tmpl:1-112`.
- Page handler: `cmd/dcrdata/internal/explorer/explorerroutes.go:1534-1651`; payload struct at 1538-1545; FiatBalance at 1617; dummy branch at 1592-1602.
- Shared params: `cmd/dcrdata/internal/explorer/explorerroutes.go:1774-1789`.
- DB AddressData / AddressHistory / balance flatten: `db/dcrpg/pgblockchain.go:2484-2592`, `2382-2480`; SQL: `db/dcrpg/internal/addrstmts.go:220-232`; balance aggregation drop: `db/dcrpg/queries.go:1453-1529`.
- Types: `db/dbtypes/types.go:2304-2370`; `ReduceAddressHistory` at 2380.
- Helpers: `cmd/dcrdata/internal/explorer/templates.go:31-38` (`coinSymbol`), 297-378 (`amountAsDecimalParts*`, `threeSigFigs`), 380-488 (SKA helpers), 561-708 (FuncMap registrations), 899-901.
- FiatBalance source: `exchanges/bot.go:1025-1058`.
- Frontend: `cmd/dcrdata/public/js/controllers/address_controller.js:153-192` (targets), 194-254 (connect / data-attr reads at 225-230), 285 (BLOCK_RECEIVED bind), 293-317 (QR), 774-806 (`_confirmMempoolTxs`).
- newblock controller (no summary-card touch): `cmd/dcrdata/public/js/controllers/newblock_controller.js`.
- Mocks: `cmd/dcrdata/internal/explorer/explorer_test.go:50-58`, `cmd/dcrdata/internal/api/noop_ds_test.go:29-31`.

See also:

- `wiki/code-analysis/address/flow.compact.md`, `wiki/code-analysis/address/flow.full.md` — the broader page flow this card is one piece of.
- `wiki/core/constraints.md` C1 (precision), C3 (template + websocket parity — relevant if live summary updates are added), C7 (centralized coin-type label rendering — `coinSymbol` / `renderCoinType`).
- `views/tx.tmpl:60, 101, 500, 573` — established multi-coin display pattern (`{{if eq .CoinType 0}}…{{else}}…{{end}}` + `coinSymbol`) to mirror in the summary card.
