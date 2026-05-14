# Address page — transactions table — mutation impact

Scope of this note: the bottom section of `/address/{address}` (header range / pagination, the `addressTable` rendering, merged-view footnote, numbered pagination, CSV download link, type & page-size selects) plus the `/addresstable/{address}` XHR refresh path. Summary card and charts card are explicitly out of scope.

## TL;DR

The backend now ships per-row `CoinType uint8`, `SKAValue string`, `ReceivedTotalSKA string`, and `SentTotalSKA string` on `AddressTx`, supports `?coin=N` filtering through `CoinCtx` middleware on both `/address` HTML and `/addresstable` XHR, and has a fully coin-aware CSV pipeline (`coin_type` column + per-row `FormatSKAPerVAR` for SKA). The `addressTable` template (`extras.tmpl:210-315`) still ignores all per-row coin fields, hard-codes `Credit VAR` / `Debit VAR` headers, and renders `float64AsDecimalParts .SentTotal 8 false` / `.ReceivedTotal 8 false` — so SKA rows render `0` in the amount cell. The `if eq .SentTotal 0.0` heuristic at `extras.tmpl:277` mis-classifies every SKA debit as "sstxcommitment". The frontend controller does not declare `coin` in its TurboQuery null-template (`address_controller.js:211-219`) and does not append `?coin=` to `makeTableUrl` (319-323) — so the `?coin=` filter only flows on hard reload, not via XHR refresh today.

## 1. Scope

### Server-rendered ranges

- **`cmd/dcrdata/views/address.tmpl`** — the entire transactions block.
  - `address.tmpl:185` — `{{if not .IsDummyAddress}}` — surface gate. Dummy addresses skip this section entirely.
  - `address.tmpl:186` — `data-address-target="listbox"` wrapper.
  - `address.tmpl:188` — `<h4>Transactions</h4>`.
  - `address.tmpl:189-219` — `paginationheader`: range string + Previous/Next nav.
    - `:190-193` — `range` text, including `txnCount` span (`data-txn-count="{{$TxnCount}}"`).
    - `:194-218` — `pagebuttons` nav with `pageminus`/`pageplus` `<li>` items.
  - `address.tmpl:221-226` — `listLoader` + `table` target wrapping `{{template "addressTable" .}}` (server-side initial render).
  - `address.tmpl:227-229` — `mergedMsg` footnote ("*No unconfirmed transactions shown in merged views.").
  - `address.tmpl:230-250` — `tablePagination` (numbered pagination + arrow links).
  - `address.tmpl:251-296` — bottom row: CSV download button (252-254), `txntype` select (258-273), `pagesize` select (274-294).
  - `address.tmpl:298` — closes `{{- end}}{{/* if not .IsDummyAddress */}}`.

### Table template + XHR shell

- **`cmd/dcrdata/views/extras.tmpl:210-315`** — `{{define "addressTable"}}` … `{{end}}` — the column layouts per `txntype`. Headers at 215-243, rows at 244-303, empty-state table at 306-313.
- **`cmd/dcrdata/views/addresstable.tmpl:1-3`** — thin `{{define "addresstable"}}` wrapper that calls `{{template "addressTable" .Data}}`. Used by the XHR handler so the server returns just the inner `<table>`.

## 2. Backend touch points

### Routes (chi)

- [cmd/dcrdata/main.go:768](cmd/dcrdata/main.go#L768) — `GET /address/{address}` → `explore.AddressPage` (initial HTML).
- [cmd/dcrdata/main.go:769](cmd/dcrdata/main.go#L769) — `GET /addresstable/{address}` → `explore.AddressTable` (XHR JSON-wrapping HTML fragment).
- [cmd/dcrdata/internal/api/apirouter.go:313-320](cmd/dcrdata/internal/api/apirouter.go#L313-L320) — `GET /download/address/io/{address}[/win]` → `app.addressIoCsvNoCR` / `app.addressIoCsvCR` (CSV). The route group is wrapped with `m.CoinCtx` (line 318).

Both `/address` and `/addresstable` go through `explorer.AddressPathCtx` (middleware shared with the page itself), then read `?coin=` via `middleware.GetCoinCtx(r)` directly (no chi-router-level CoinCtx wrapping — the explorer routes do not register `m.CoinCtx`).

### Handlers

- **[cmd/dcrdata/internal/explorer/explorerroutes.go:1535-1648](cmd/dcrdata/internal/explorer/explorerroutes.go#L1535-L1648)** — `AddressPage`. Inline `AddressPageData{*CommonPageData, Data: *dbtypes.AddressInfo, Type, CRLFDownload, Pages, FiatBalance interface{}}` at 1539-1546. Calls `parseAddressParams` (1549) → `AddressListData(ctx, addr, txnType, N, offset, middleware.GetCoinCtx(r))` (1605) → `calcPages` (1632) → `templates.exec("address", pageData)` (1635). `FiatBalance: nil` at 1633.
- **[cmd/dcrdata/internal/explorer/explorerroutes.go:1652-1704](cmd/dcrdata/internal/explorer/explorerroutes.go#L1652-L1704)** — `AddressTable` (XHR refresh). Calls `parseAddressParams` (1656) → `AddressListData(... middleware.GetCoinCtx(r))` (1663) → `calcPages` (1679) → `templates.exec("addresstable", { Data: addrData })` (1682). Returns JSON `{ tx_count: int64, html: string, pages: []pageNumber }` (1673-1680).
- **[cmd/dcrdata/internal/explorer/explorerroutes.go:1772-1873](cmd/dcrdata/internal/explorer/explorerroutes.go#L1772-L1873)** — `parseAddressParams` (1772), `parsePaginationParams` (1830). Recognised query keys: `n`, `start`, `txntype`. Defaults: `n = defaultAddressRows = 20`, `start = 0`, `txntype = "all"`. Hard cap at `MaxAddressRows = 160` (`explorer.go:65`). Unknown `txntype` → `dbtypes.AddrTxnUnknown` → 400 from `AddressTable`, error page from `AddressPage`. **`coin` is NOT parsed here** — it comes from the `CoinCtx` middleware via `?coin=`.
- **[cmd/dcrdata/internal/explorer/explorerroutes.go:1875-1889](cmd/dcrdata/internal/explorer/explorerroutes.go#L1875-L1889)** — `AddressListData(ctx, addr, txnType, N, offset, coinType uint8) (*dbtypes.AddressInfo, error)`. Pure pass-through to `dataSource.AddressData` with the coin filter.
- **`cmd/dcrdata/internal/explorer/explorerroutes.go:2574+`** — `pageNumber{Active, Link, Str}` and `calcPages(rows, pageSize, offset, link)`. `link` is a `fmt.Sprintf` template like `/address/{addr}?start=%d&n=20&txntype=all` (no `coin=` segment today).
- **[cmd/dcrdata/internal/api/apiroutes.go:1728-1825](cmd/dcrdata/internal/api/apiroutes.go#L1728-L1825)** — `addressIoCsvNoCR` / `addressIoCsvCR` → `addressIoCsv(crlf, …)`. Streams CSV from `c.DataSource.AddressRowsCompact(ctx, address, coinType)` (1761) — `coinType` from `m.GetCoinCtx(r)` at 1760.

### DB layer

- **[db/dcrpg/pgblockchain.go:2533-2917](db/dcrpg/pgblockchain.go#L2533-L2917)** — `(*ChainDB).AddressData(ctx, addr, N, offset, txnType, coinType uint8)`. Pulls confirmed history (`AddressHistory` 2547), generates skeleton via `dbtypes.ReduceAddressHistory` (2581) — but **overwrites** `addrData.Balance` with the full balance from `AddressHistory` (2601, commit `961bbb0c`). Computes `KnownTransactions/KnownFundingTxns/KnownSpendingTxns` from `Balance.Coins[coinType]` (or summed when `CoinTypeAll`) at 2618-2630. Counts rows for the chosen view: merged → `mergedTxnCount(ctx, addr, txnType, coinType)` (2642); `AddrTxnAll` → `CountTransactions(ctx, addr, txnType, coinType)` real DB count with fallback (2649-2658, commit `7a08c3d3`); credit/debit/unspent → derived from `KnownFundingTxns`/`KnownSpendingTxns`/`knownUnspent`. Back-fills metadata via `FillAddressTransactions` (2677), then overlays unconfirmed txs from `pgb.mp.UnconfirmedTxnsForAddress` returning per-coin counts (2687). Mempool overlay is per-coin aware: each branch reads `coinType` from `fundingTx.CoinInfo[f.Index]` / `f.CoinType`, accumulates SKA via per-coin `*big.Int` maps, and writes back to `Balance.Coins[ct].Total*SKA` (2738-2911).
- **[db/dcrpg/pgblockchain.go:2419-2531](db/dcrpg/pgblockchain.go#L2419-L2531)** — `AddressHistory`. Cache-first; falls back to `updateAddressRows` + `dbtypes.SliceAddressRows`. Now syncs legacy flat fields from `Coins[0]` at 2512-2519 (cache-miss path).
- **[db/dcrpg/pgblockchain.go:2312-2343](db/dcrpg/pgblockchain.go#L2312-L2343)** — `retrieveMergedTxnCount(ctx, addr, txnView, coinType)` and `mergedTxnCount(...)` (cache-aware count for `merged` / `merged_credit` / `merged_debit`). Both take `coinType uint8`.
- **[db/dcrpg/pgblockchain.go:2345-2412](db/dcrpg/pgblockchain.go#L2345-L2412)** — `nonMergedTxnCount(...)` and `CountTransactions(...)`. When `coinType == CoinTypeAll`, dispatches to all-coin SQL variants (`SelectAddressAllCountByAddress`, `SelectAddressesMergedCountAll`); otherwise the coin-filtered variant.
- **[db/dcrpg/pgblockchain.go:2947-3005](db/dcrpg/pgblockchain.go#L2947-L3005)** — `FillAddressTransactions`. Fills `Size`, `FormattedSize`, `Total`, `Time`, `Confirmations`, and (for matched txns) `MatchedTxIndex`. **`txn.Total = dcrutil.Amount(dbTx.Sent).ToCoin()` (2964) is still VAR-only** — fine for non-amount columns but worth noting.
- **[db/dcrpg/pgblockchain.go:2266-2310](db/dcrpg/pgblockchain.go#L2266-L2310)** — `AddressRowsCompact(ctx, address, coinType uint8)`. CSV download source; returns `[]*dbtypes.AddressRowCompact`. When `coinType != CoinTypeAll`, filters in-memory after cache hit at 2303 (`if r.CoinType == coinType`).

### Mocks (four files)

- [cmd/dcrdata/internal/api/noop_ds_test.go:40,53](cmd/dcrdata/internal/api/noop_ds_test.go#L40-L53) — `noopDS.TxHistoryData(_, _, _, _, _ uint8)`, `noopDS.AddressRowsCompact(_, _, _ uint8)`.
- [cmd/dcrdata/internal/api/address_api_test.go:15,33](cmd/dcrdata/internal/api/address_api_test.go#L15-L33) — `addressDS.AddressData(... coinType uint8)`; `TestAddressDataCoinFiltering`.
- [cmd/dcrdata/internal/api/apiroutes_test.go:337,359,383](cmd/dcrdata/internal/api/apiroutes_test.go#L337-L383) — `addressChartDS.AddressData/TxHistoryData/AddressRowsCompact`.
- `cmd/dcrdata/internal/explorer/explorer_test.go` — `mockDataSource.AddressData` must match the `coinType` signature.

### Types referenced by the table

- **[db/dbtypes/types.go:2252-2273](db/dbtypes/types.go#L2252-L2273)** — `AddressTx`. Fields actually rendered in `addressTable`:
  - `TxID` (`ChainHash`) — column 2 hash.
  - `TxType` (`string`) — column 1.
  - `InOutID` (`uint32`) — used by `Link()` for merged views (`/tx/{hash}/in|out/{idx}`).
  - `FormattedSize` (`string`) — last column.
  - `ReceivedTotal` (**`float64`** — VAR coins via `dcrutil.Amount.ToCoin()`).
  - `SentTotal` (**`float64`** — same path).
  - `IsFunding` (`bool`) — controls credit/debit cell layout in `merged` and `all`.
  - `MatchedTx` (`*ChainHash`), `MatchedTxIndex` (`uint32`) — drive "spent" vs "unspent" / "source" vs "N/A" links.
  - `MergedTxnCount` (`uint64`) — count cell in merged views.
  - `BlockHeight` (`uint32`), `Confirmations` (`uint64`), `Time` (`TimeDef`) — last three columns.
  - **New per-coin fields populated but unread by template:** `ReceivedTotalSKA string` (2264), `SentTotalSKA string` (2265), `CoinType uint8` (2271), `SKAValue string` (2272). Set in `dbtypes.ReduceAddressHistory` at [types.go:2493-2536](db/dbtypes/types.go#L2493-L2536) and in the mempool overlay at [pgblockchain.go:2752-2852](db/dcrpg/pgblockchain.go#L2752-L2852).
- **[db/dbtypes/types.go:2322-2373](db/dbtypes/types.go#L2322-L2373)** — `AddressInfo`. Container for the table; the template reads `.Transactions`, `.TxnType`, `.IsMerged`, `.NumTransactions`, `.TxnCount`, `.NumUnconfirmed`, `.Offset`, `.Limit`, `.Path`, `.Address`, `.IsDummyAddress`. New fields available: `.ActiveCoins []uint8`, `.NumUnconfirmedByCoin map[uint8]int64`, `.KnownTransactions/.KnownFundingTxns/.KnownSpendingTxns int64`.
- **[db/dbtypes/types.go:2456-2613](db/dbtypes/types.go#L2456-L2613)** — `ReduceAddressHistory`. The funnel where atom values become their template-ready forms. **The SKA branches now write `tx.ReceivedTotalSKA`/`tx.SentTotalSKA` and accumulate into per-coin `*big.Int` maps. The legacy `tx.ReceivedTotal`/`tx.SentTotal float64` fields stay at `0.0` for SKA rows** — and that's what the template prints today.

### What `ReceivedTotal` / `SentTotal` actually are

**`float64` representing VAR coins**, computed via `dcrutil.Amount(addrOut.Value).ToCoin()` at [db/dbtypes/types.go:2506,2523](db/dbtypes/types.go#L2506-L2523) and the mempool overlay at [db/dcrpg/pgblockchain.go:2751,2834](db/dcrpg/pgblockchain.go#L2751-L2834) — but **only for VAR rows** now (the SKA branch sets `ReceivedTotalSKA = addrOut.SKAValue` instead). For any `addrOut.CoinType != 0` row the float values are `0.0`, and the template prints `0` in the Credit/Debit column. The `ReceivedTotalSKA`/`SentTotalSKA` SKA atom strings are populated and JSON-serialized in API responses but are not yet read by the template.

## 3. Per-`txntype` column layout

Reference: `cmd/dcrdata/views/extras.tmpl:215-302`. Columns common to all views (in order): **Tx Type** (`{{.TxType}}`), **Input/Output ID** (`hashElide` of `{{.TxID}}`/`Link()`), then 1-3 amount/count columns (varies), then **Time (UTC)** (`{{.Time.DatetimeWithoutTZ}}` or "Unconfirmed"), **Age** (Stimulus `time` controller), **Confirms** (live-updated by `newblock`), **Size** (`{{.FormattedSize}}`).

| `txntype`         | Variable columns (in order)                                                                                 | Driven by                                                             | Notes                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `all`             | Credit VAR / Debit VAR                                                                                      | `IsFunding` chooses which cell shows: `ReceivedTotal` or `SentTotal`. | Funding row → credit cell + (matched) "spent"/"unspent" link in debit cell (`extras.tmpl:266-275`). Non-funding → mirror image (`:276-285`). |
| `unspent`         | Credit VAR (single column)                                                                                  | `ReceivedTotal`                                                       | Header literal `Credit VAR` (`:233`). Cell `:264-265`.                                                                        |
| `credit`          | Credit VAR / (spent-link)                                                                                   | `ReceivedTotal` + `MatchedTx`                                         | Same as `all` funding branch (`:266-275`).                                                                                    |
| `debit`           | (source-link / "N/A" / "sstxcommitment") / Debit VAR                                                        | `SentTotal == 0` → "sstxcommitment" cell (`:277-278`); `MatchedTx` → "source" link; otherwise "N/A". | `:276-285`.                                                                                                                   |
| `merged`          | I/O Count / Credit VAR / Debit VAR                                                                          | `MergedTxnCount`; then `IsFunding` decides which side shows the amount, the other is `&mdash;` | `:228-231`, `:255-263`.                                                                                                       |
| `merged_credit`   | Outputs (count) / Credit VAR                                                                                | `MergedTxnCount`, `ReceivedTotal`                                     | `:223-227`, `:252-254`.                                                                                                       |
| `merged_debit`    | Inputs (count) / Debit VAR                                                                                  | `MergedTxnCount`, `SentTotal`                                         | `:218-222`, `:249-251`.                                                                                                       |

Empty state (no transactions for this filter): `extras.tmpl:306-313` renders a single-cell table with `No "{{$txType}}" transactions found for this address.`

`IsFunding` semantics — set in `dbtypes.ReduceAddressHistory:2491` from `addrOut.IsFunding`. For unconfirmed entries, the mempool overlay sets `IsFunding: true` for outpoints ([pgblockchain.go:2762](db/dcrpg/pgblockchain.go#L2762)) and leaves it `false` for spending entries.

`MatchedTx` is `nil` for credit rows whose UTXO is still unspent. The link path is `/tx/{hash}/in|out/{matchedTxIndex}` (`:269` for credit-side; `:280` for debit-side).

## 4. Template touch points

### Fields referenced under `addressTable` (`extras.tmpl:210-315`)

`.TxnType`, `.Transactions`, and per-row: `.Confirmations`, `.TxID`, `.Link` (method), `.TxType`, `.MergedTxnCount`, `.SentTotal`, `.ReceivedTotal`, `.IsFunding`, `.MatchedTx`, `.MatchedTxIndex`, `.Time.DatetimeWithoutTZ`, `.Time.T.Unix`, `.Time.UNIX`, `.BlockHeight`, `.FormattedSize`. **None of these read `.CoinType`, `.SKAValue`, `.ReceivedTotalSKA`, or `.SentTotalSKA`.**

### Fields referenced under the `address.tmpl` table block (`:185-298`)

`.IsDummyAddress`, `.Offset`, `.NumTransactions`, `.TxnCount` (calculated as `add .TxnCount .NumUnconfirmed` at line 8), `.NumUnconfirmed`, `.Limit`, `.Path`, `.Address`, `.IsMerged`, `.TxnType`, `.Transactions` (only `len`, for selecting the `pagesize` `<option>` at line 284), `$.Pages`, `$.CRLFDownload`.

### Helper functions used in this surface

- `add`, `subtract` — pagination math.
- `intComma` — `range`, `txnCount`.
- `hashlink`, `hashElide` template, `hashStart` / `hashEnd` — TxID rendering.
- **`float64AsDecimalParts`** — used at `extras.tmpl:251, 254, 258, 262, 265, 267, 284`. Wraps `float64Formatting`. Always called with `8` decimal places (the VAR scale).
- `decimalParts` template — renders the `[]string` produced by `float64AsDecimalParts` / `amountAsDecimalParts`.

### Hard-coded coin labels

- **`Credit VAR`** literals: `extras.tmpl:227, 230, 233, 235`.
- **`Debit VAR`** literals: `extras.tmpl:222, 231, 236`.

Headers were renamed to `VAR` ahead of multi-coin work; they remain inline string literals, in violation of constraint **C7** (centralised coin-type label rendering).

## 5. Frontend touch points (URL contract + XHR refresh)

### Stimulus controller

`cmd/dcrdata/public/js/controllers/address_controller.js`. The transactions surface is co-mounted with `newblock` (`address.tmpl:11` — `data-controller="address newblock"`).

### Targets used by this surface (declared at `:153-191`)

- Input wiring: `txntype` (163), `pagesize` (162), `paginator` (168), `pageminus` (170), `pageplus` (169).
- Display wiring: `range` (173), `txnCount` (164), `paginationheader` (190), `pagebuttons` (177), `tablePagination` (189), `mergedMsg` (182), `listLoader` (184), `table` (172), `pending` (per-row, `extras.tmpl:246`), `numUnconfirmed` (`address.tmpl:89` — also referenced from the summary card).

### Actions (Stimulus)

- `change->address#changeTxType` (`address.tmpl:262`) → `:329` `fetchTable(this.txnType, this.pageSize, 0)`.
- `change->address#changePageSize` (`:280`) → `:325` `fetchTable(this.txnType, this.pageSize, this.paginationParams.offset)`.
- `address#prevPage` / `address#nextPage` (`:205, :214`) → `:333, :337` → `toPage(±1)` → `fetchTable`.
- `click->address#pageNumberLink` (`:233, :241, :247`) → `:341` parses the anchor's `href` for `start`, `n`, `txntype` and calls `fetchTable`.
- `mouseover->address#hashOver mouseout->address#hashOut` (`extras.tmpl:271, 280`) → `:808, :820` highlight the matching link in the same row.

### URL query keys

`address_controller.js:211-219` declares the persisted set: `chart`, `zoom`, `bin`, `flow`, **`n`**, **`start`**, **`txntype`**. **`coin` is NOT declared.** `pagesize` is **not** a persisted key — page size flows in via the table fetch as `n=`. The select's `name="pagesize"` is never written to the URL; only the resulting `n=` is.

### `fetchTable` URL construction

`address_controller.js:319-323` `makeTableUrl(txType, count, offset)`:

```
/addresstable/{address}?txntype=${txType}&n=${count}&start=${offset}
```

(or `/treasurytable?...` for the treasury page, same controller.) `:363` `requestCount = count > 20 ? count : 20` — page sizes < 20 are silently bumped. **No `?coin=` is appended**, so XHR refreshes lose any coin filter that was set on the initial page load.

### Server response shape

`AddressTable` returns JSON: `{ tx_count: int64, html: string, pages: []pageNumber }` ([explorerroutes.go:1673-1680](cmd/dcrdata/internal/explorer/explorerroutes.go#L1673-L1680)). `pageNumber` JSON tags: `active`, `link`, `str`. The `html` is the rendered `addresstable` template — the inner `<table>` plus its empty-state. The XHR path therefore re-renders the **entire table inner HTML** on every fetch (full HTML fragment, not a JSON row schema). `fetchTable` (`:361`) uses `dompurify.sanitize(tableResponse.html)` and assigns to `tableTarget.innerHTML`, then rebuilds the numbered pagination via `setTablePaginationLinks` (`:437`) using `tableResponse.pages` plus arrow links built from `paginationParams.offset`/`pagesize`.

### State write-through

`fetchTable:366-372` writes `n`, `start`, `txntype` back to `this.settings` and calls `this.query.replace(this.settings)` — the address bar updates via TurboQuery (history-replace) without a full nav. `coin` is not part of this round-trip.

### Other DOM that responds to events

- `data-newblock-target="confirmations"` cells (`extras.tmpl:294-300`) are updated by `newblock_controller.js:36-43` on every `BLOCK_RECEIVED` event. The `data-confirmation-block-height` attribute is the integer block height the row was confirmed at; `-1` means unconfirmed.
- `data-address-target="pending"` rows (`extras.tmpl:246`) are converted to confirmed by `address_controller.js:_confirmMempoolTxs` (`:774-806`) when the new block contains the row's `data-txid`. That handler also touches `tx.addr-tx-confirms`, `tx.addr-tx-time`, `tx.addr-tx-age > span`, and the global `txnCount` and `numUnconfirmed` count cells in the summary card. **No coin context** — the live decrement is a single-counter, even though the backend has per-coin breakdown via `NumUnconfirmedByCoin`.

## 6. Multi-coin gaps (current state)

Backend status: complete plumbing. Template + controller status: VAR-only.

### 6.1 Per-row coin fields populated but unread

- `AddressTx.CoinType uint8`, `AddressTx.SKAValue string`, `AddressTx.ReceivedTotalSKA string`, `AddressTx.SentTotalSKA string` are set by `ReduceAddressHistory` ([types.go:2493-2536](db/dbtypes/types.go#L2493-L2536)) and the mempool overlay ([pgblockchain.go:2738-2871](db/dcrpg/pgblockchain.go#L2738-L2871)).
- `extras.tmpl:251, 254, 258, 262, 265, 267, 277, 284` reads only `.SentTotal`/`.ReceivedTotal` (float64). For a SKA row, the float fields are zero — display is `0`.

### 6.2 Hard-coded coin labels

- `extras.tmpl:222, 231, 236` (`Debit VAR`) and `:227, 230, 233, 235` (`Credit VAR`) are inline string literals. Per-row `coinSymbol(.CoinType)` would replace them once headers go per-row instead of per-column.

### 6.3 `if eq .SentTotal 0.0` heuristic — false-positive for SKA

`extras.tmpl:277` classifies any row with `SentTotal == 0` as "sstxcommitment". For SKA debit rows, `SentTotal` is always `0.0` (the float field was never populated for SKA in `ReduceAddressHistory`), so every SKA debit renders as "sstxcommitment". Right fix: replace the heuristic with an explicit flag on `AddressTx` (e.g. `IsSstxCommitment bool`) or special-case by `CoinType != 0`.

### 6.4 CSV download (multi-coin status: complete)

CSV header now includes `coin_type` ([apiroutes.go:1776-1777](cmd/dcrdata/internal/api/apiroutes.go#L1776-L1777)):

```
tx_hash, direction, io_index, valid_mainchain, coin_type, amount, time_stamp, tx_type, matching_tx_hash
```

Per-row population ([apiroutes.go:1785-1823](cmd/dcrdata/internal/api/apiroutes.go#L1785-L1823)):

- `tx_hash` — `r.TxHash.String()`.
- `direction` — `"1"` if `r.IsFunding`, else `"-1"`.
- `io_index` — `r.TxVinVoutIndex` (uint32 → string).
- `valid_mainchain` — `"1"` / `"0"`.
- **`coin_type`** — `strconv.FormatUint(uint64(r.CoinType), 10)`. New column.
- **`amount`** (renamed from `value`):
  - VAR (`r.CoinType == 0`): `strconv.FormatFloat(dcrutil.Amount(r.Value).ToCoin(), 'f', 8, 64)` — `1.23456789`.
  - SKA: `dbtypes.FormatSKAPerVAR(r.SKAValue, r.CoinType)` ([types.go:2428-2442](db/dbtypes/types.go#L2428-L2442)) — human-readable string like `"1.23 SKA1"`. **Note:** SKA renders as a labeled coin string, NOT raw atoms. Consumers parsing the CSV for SKA atoms need to know this.
- `time_stamp` — Unix integer (`r.TxBlockTime`).
- `tx_type` — `txhelpers.TxTypeToString(int(r.TxType))`.
- `matching_tx_hash` — empty when nil.

Route is wrapped with `m.CoinCtx` ([apirouter.go:318](cmd/dcrdata/internal/api/apirouter.go#L318)) so `?coin=N` filters server-side. `AddressRowsCompact(ctx, address, coinType)` filters in-memory after cache hit ([pgblockchain.go:2266-2310](db/dcrpg/pgblockchain.go#L2266-L2310)). `AddressRowCompact.CoinType` field added at [types.go:1314](db/dbtypes/types.go#L1314).

Filename format: `address-io-{address}-{height}-{unixNow}.csv` (no coin suffix today; possible future ambiguity for repeat downloads).

Cached for 180 seconds via `m.CacheControl` middleware. Cache key includes the URL — `?coin=N` variations cache separately by virtue of the URL difference, but the explicit cache invalidation does not consider coin.

### 6.5 CSV column rename — backwards-incompatible

The `value` column was **renamed** to `amount` in the same change. Any external consumer of the old CSV format breaks. Worth documenting if the explorer's CSV is referenced by external tools.

### 6.6 Frontend (controller)

- `address_controller.js:211-219` — `coin` not declared in TurboQuery null-template. Even if `?coin=` lands in the URL on initial load, the controller does not persist it across `query.replace` calls.
- `address_controller.js:319-323` `makeTableUrl` — does not append `?coin=`. XHR refreshes drop the filter.
- `address_controller.js:84` — `${series.y} DCR` in chart legend formatter (charts surface, but reachable via the same controller).
- `address_controller.js:130, 140` — `ylabel: 'Total (DCR)'` / `'Balance (DCR)'`.
- `address_controller.js:447, 451, 466` — `setTablePaginationLinks` constructs URLs like `/address/{addr}?start=...&n=...&txntype=...` — no `coin` segment.

## 7. Pagination + filter contract (server vs XHR parity)

Both the initial render and the XHR refresh share `parseAddressParams` ([explorerroutes.go:1549,1656](cmd/dcrdata/internal/explorer/explorerroutes.go#L1549-L1656)) and `AddressListData` (passing `middleware.GetCoinCtx(r)` at 1605/1663). Both call `calcPages(int(addrData.TxnCount), int(limitN), int(offsetAddrOuts), linkTemplate)` — `addrData.TxnCount` is the **confirmed-only** count from `pgblockchain.go` (`mergedTxnCount` for merged views, `CountTransactions` for `AddrTxnAll`, balance-derived for credit/debit/unspent — see §2 DB layer).

### Subtle parity points

1. **`linkTemplate` differs between handlers**:
   - `AddressPage:1625` — `fmt.Sprintf("/address/%s?start=%%d&n=%d&txntype=%v", addrData.Address, limitN, txnType)`.
   - `AddressTable:1671` — `"/address/" + addrData.Address + "?start=%d&n=" + strconv.FormatInt(limitN, 10) + "&txntype=" + fmt.Sprintf("%v", txnType)`. Both produce identical link patterns. Anchors coming back through XHR therefore navigate to `/address/{addr}?...` — never `/addresstable/...`. Neither template includes `coin=`.
2. **`limitN == 0` defaulting** is only applied in `AddressPage:1621-1623`, **not** in `AddressTable`. In practice the controller always sends `n` ≥ 20 (`:363`), but a hand-crafted XHR with `n=0` would compute a divide-by-zero / no-pagination response. `calcPages` guards against it.
3. **XHR `tx_count` includes mempool, server-rendered range does too**: `AddressTable:1678` returns `addrData.TxnCount + addrData.NumUnconfirmed`; `address.tmpl:8` computes `$TxnCount := add .TxnCount .NumUnconfirmed`. Aligned.
4. **`Pages` values share the same `link` template**, so the numbered pagination produced by SSR (`address.tmpl:236-244`) and by `setTablePaginationLinks` ([address_controller.js:437-471](cmd/dcrdata/public/js/controllers/address_controller.js#L437-L471)) point at the same URLs.
5. **`pagesize` selector is server-rendered only**: there is no `<select>` rebuild on XHR refresh. The controller's `setPageability` (`:388`) toggles `option.disabled` based on `paginationParams.count`, but the option set was decided at SSR time (`address.tmpl:284-292`) using `Txlen := len .Transactions` — a non-merged page might land on a `pagesize` that no longer maps to a server option after the user changes `txntype` to `merged`.
6. **`numUnconfirmed` block (`address.tmpl:88-92`)** lives in the summary card but is mutated by the table-pending logic ([address_controller.js:791-802](cmd/dcrdata/public/js/controllers/address_controller.js#L791-L802)). Cross-surface coupling.
7. **`?coin=` propagation gap**: backend respects the filter on both HTML and XHR; frontend doesn't write it through `fetchTable`. Result: the user sets `?coin=1`, navigates pagination via XHR, and the **filter persists in the URL** (because the browser bar isn't touched until `query.replace` runs without the key) — but if `query.replace` writes only `n`/`start`/`txntype`, the URL keeps `?coin=`. Worth verifying: open question whether `query.replace` strips undeclared keys; reading the helper would resolve it. Either way, declaring `coin` in the null-template is the right path.

## 8. CSV download (see §6.4 above)

Current state is multi-coin complete on the backend; the only CSV-side open question is the SKA-as-string-vs-atoms encoding choice and the missing coin suffix in the filename.

## 9. Cross-surface dependencies

- **`txnCount` span** (`address.tmpl:192`, `data-address-target="txnCount"`, `data-txn-count`): displayed in the table header but mutated by `_confirmMempoolTxs` (`:789-790`) when a pending tx confirms. The summary card's "Received" outputs count (`address.tmpl:70`) is **not** the same — it's recomputed from `Balance.NumSpent + Balance.NumUnspent` (the legacy flat fields).
- **`numUnconfirmed`** (summary card, `address.tmpl:89-91`): also touched by `_confirmMempoolTxs` (`:791-802`), even though it lives outside this surface. Decreasing `numUnconfirmed` while increasing `txnCount` keeps the page consistent across pending-confirmation events. Backend has per-coin `NumUnconfirmedByCoin` map ready but JS uses the single counter.
- **`data-newblock-target="confirmations"`** cells (`extras.tmpl:294-300`): updated en masse by the `newblock` controller on `BLOCK_RECEIVED`. Re-rendered table rows (after XHR) need to re-attach via Stimulus' MutationObserver — happens automatically because the new HTML still carries the `data-newblock-target` attribute.
- **`mergedMsg`** (`address.tmpl:227-229`, `data-address-target="mergedMsg"`): driven by `IsMerged` server-side and toggled client-side from `fetchTable` ([address_controller.js:377-382](cmd/dcrdata/public/js/controllers/address_controller.js#L377-L382)) based on whether `txType.indexOf('merged') === -1`. Two sources of truth — keep them in sync.
- **`pending` rows** (`extras.tmpl:246`, `data-address-target="pending"`): only present for `Confirmations == 0`; consumed by `_confirmMempoolTxs` (`:774-806`).
- **`hashOver` / `hashOut`** highlights (`extras.tmpl:271, 280` → `:808, :820`): the controller iterates `this.hashTargets`, but no element in `extras.tmpl` carries `data-address-target="hash"`. The targets are declared but unused on this page today — likely vestigial. The hover handlers do still work for the visual `blue-row` toggle on the link itself.
- **Charts card vs table**: chart endpoints now respect `?coin=` ([apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186) wrap with `m.CoinCtx`); the table also respects `?coin=`. Both sides need the frontend to write `?coin=` consistently — currently neither does.
- **`tx.tmpl` SKA gap** (/wiki/code-analysis/transaction): the per-tx page that this table links to also still renders SKA imperfectly — fixing the table without fixing `tx.tmpl` leaves users one click away from precision loss.
- **CSV column rename `value` → `amount`** breaks any external script consuming the old format. Worth flagging for users.

## 10. Open product/UX questions

These questions cannot be answered from code alone and must be decided before a feature spec lands.

1. **Coin column or coin filter (or both)?** The `?coin=` filter shipped backend-only; the per-row `Coin` column has not. Both could coexist now. Choices:
   - Add a `Coin` column to every view? Per-row `coinSymbol(.CoinType)` (constraint **C7**), so each row is self-describing.
   - Add a coin-type filter `<select>` next to `txntype`, wired to the existing `?coin=` URL contract.
   - Or split into per-coin tables stacked vertically.
2. **`Credit VAR` / `Debit VAR` header — per-row or per-column?**
   - Drop `VAR` from the header and render the symbol per row (next to the amount)?
   - Keep one header per coin and render per-coin columns (`Credit VAR`, `Credit SKA1`, …)? With 256 possible coin types this scales badly.
   - Or rename to a generic `Credit` / `Debit` and rely on the `Coin` column?
3. **Merged view across coins** — what does "merged" mean when an address has txs in multiple coins?
   - Merge across coins (single rolled-up amount per merged-bucket — invalid because amounts in different coins can't sum)?
   - Merge per coin (each merged row has a single `CoinType`)? Backend SQL already filters by `coin_type`, so this is the natural answer.
   - Disallow merged views when the address has multi-coin history?
4. **CSV column schema decisions** — the choices already shipped:
   - Added `coin_type` column.
   - Renamed `value` → `amount`.
   - SKA encoded as labeled human string `"1.23 SKA1"` via `FormatSKAPerVAR`, NOT raw atoms.
   - Should be revisited if external tools want raw SKA atoms (which fit in a string but not float).
5. **`SentTotal == 0.0` sstxcommitment heuristic** (`extras.tmpl:277`) — float-compare to a magic value. For SKA, the value is always `0.0` because the ReduceAddressHistory branch leaves it zero. Either replace the heuristic with an explicit flag on `AddressTx`, or special-case by `CoinType`.
6. **Per-coin balance summary** — out of scope for this note (see `summary.impact.md`), but a coin filter without per-coin balance numbers in the summary card will feel inconsistent.
7. **Fiat conversion** — handler now sets `FiatBalance: nil`; no longer relevant on this surface.
8. **Pagination semantics across coins** — `?txntype=` keeps its current values (which are about credit/debit/merged, not about coin), with an orthogonal `?coin=` key already supported by middleware. **Frontend wiring needed**: declare `coin` in `address_controller.js:211-219` and add it to `makeTableUrl` (319-323) + `setTablePaginationLinks` (437+).
9. **Page-size `<option>` rebuild on filter change** — already a latent issue (§7 #5); the multi-coin work makes it worse if a coin filter further reduces row counts. Decide whether to rebuild `<select>` options on every XHR.
10. **CSV cache key / cache invalidation** — the route is cached for 180s by middleware. Different `?coin=` values produce different URLs and therefore different cache entries (good), but the explicit cache invalidation does not consider coin (a reorg invalidates VAR but might leave SKA caches stale, or vice versa).
11. **Real-time `pending` rows for SKA mempool txs** — `_confirmMempoolTxs` ([address_controller.js:774-806](cmd/dcrdata/public/js/controllers/address_controller.js#L774-L806)) doesn't carry coin context today. Decide whether the per-row template needs `data-coin-type` and how the controller propagates it (especially for the per-coin `numUnconfirmed` decrement).
12. **Footnote text** — "*No unconfirmed transactions shown in merged views." — does this still hold when merged is per-coin?

---

References used in this note:
- [cmd/dcrdata/views/address.tmpl:1-304](cmd/dcrdata/views/address.tmpl)
- [cmd/dcrdata/views/extras.tmpl:176-315](cmd/dcrdata/views/extras.tmpl)
- [cmd/dcrdata/views/addresstable.tmpl:1-3](cmd/dcrdata/views/addresstable.tmpl)
- [cmd/dcrdata/internal/explorer/explorerroutes.go:1535-1704, 1772-1889, 2574+](cmd/dcrdata/internal/explorer/explorerroutes.go#L1535-L1889)
- [cmd/dcrdata/internal/explorer/explorer.go:59-65, 105-106](cmd/dcrdata/internal/explorer/explorer.go#L59-L106)
- `cmd/dcrdata/internal/explorer/templates.go` (helpers)
- [cmd/dcrdata/internal/api/apirouter.go:178-200, 313-320](cmd/dcrdata/internal/api/apirouter.go#L178-L320)
- [cmd/dcrdata/internal/api/apiroutes.go:64-71, 1728-1825](cmd/dcrdata/internal/api/apiroutes.go#L64-L1825)
- [cmd/dcrdata/internal/middleware/apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842)
- [cmd/dcrdata/main.go:768-769](cmd/dcrdata/main.go#L768-L769)
- [cmd/dcrdata/public/js/controllers/address_controller.js:152-471, 774-828, 895-902](cmd/dcrdata/public/js/controllers/address_controller.js)
- `cmd/dcrdata/public/js/controllers/newblock_controller.js:1-44`
- [db/dbtypes/types.go:47-49, 1267-1320, 2252-2406, 2456-2613](db/dbtypes/types.go)
- [db/dcrpg/pgblockchain.go:2266-2917](db/dcrpg/pgblockchain.go#L2266-L2917)
- [db/dcrpg/queries.go:1450-1610, 2266-2290](db/dcrpg/queries.go#L1450-L2290)
- [db/dcrpg/internal/addrstmts.go:190-249, 270-279](db/dcrpg/internal/addrstmts.go#L190-L279)
- Mocks: [explorer_test.go](cmd/dcrdata/internal/explorer/explorer_test.go), [noop_ds_test.go:40,53](cmd/dcrdata/internal/api/noop_ds_test.go#L40-L53), [address_api_test.go:15](cmd/dcrdata/internal/api/address_api_test.go#L15), [apiroutes_test.go:337,359,383](cmd/dcrdata/internal/api/apiroutes_test.go#L337-L383)

See also:
- [flow.compact.md](flow.compact.md), [flow.full.md](flow.full.md) — page flow this surface is part of.
- [patterns.md](patterns.md) — `CoinCtx` URL/middleware contract, dual-field shim.
- [summary.impact.md](summary.impact.md) — companion surface, also still VAR-only.
- [charts.impact.md](charts.impact.md) — charts now coin-aware on backend; SKA SQL precision fix (PR #263) covered there.
