# Address page — transactions table — mutation impact

Scope of this note: the bottom section of `/address/{address}` (header range / pagination, the `addressTable` rendering, merged-view footnote, numbered pagination, CSV download link, type & page-size selects) plus the `/addresstable/{address}` XHR refresh path. Summary card and charts card are explicitly out of scope.

## 1. Scope

### Server-rendered ranges

- **`cmd/dcrdata/views/address.tmpl`** — the entire transactions block.
  - `cmd/dcrdata/views/address.tmpl:185` — `{{if not .IsDummyAddress}}` — surface gate. Dummy addresses skip this section entirely.
  - `cmd/dcrdata/views/address.tmpl:186` — `data-address-target="listbox"` wrapper.
  - `cmd/dcrdata/views/address.tmpl:188` — `<h4>Transactions</h4>`.
  - `cmd/dcrdata/views/address.tmpl:189-219` — `paginationheader`: range string + Previous/Next nav.
    - `:190-193` — `range` text, including `txnCount` span (`data-txn-count="{{$TxnCount}}"`).
    - `:194-218` — `pagebuttons` nav with `pageminus`/`pageplus` `<li>` items.
  - `cmd/dcrdata/views/address.tmpl:221-226` — `listLoader` + `table` target wrapping `{{template "addressTable" .}}` (server-side initial render).
  - `cmd/dcrdata/views/address.tmpl:227-229` — `mergedMsg` footnote ("*No unconfirmed transactions shown in merged views.").
  - `cmd/dcrdata/views/address.tmpl:230-250` — `tablePagination` (numbered pagination + arrow links).
  - `cmd/dcrdata/views/address.tmpl:251-296` — bottom row: CSV download button (252-254), `txntype` select (258-273), `pagesize` select (274-294).
  - `cmd/dcrdata/views/address.tmpl:298` — closes `{{- end}}{{/* if not .IsDummyAddress */}}`.

### Table template + XHR shell

- **`cmd/dcrdata/views/extras.tmpl:210-315`** — `{{define "addressTable"}}` … `{{end}}` — the column layouts per `txntype`. Headers at 213-243, rows at 244-303, empty-state table at 306-313.
- **`cmd/dcrdata/views/addresstable.tmpl:1-3`** — thin `{{define "addresstable"}}` wrapper that calls `{{template "addressTable" .Data}}`. Used by the XHR handler so the server returns just the inner `<table>`.

## 2. Backend touch points

### Routes (chi)

- `cmd/dcrdata/main.go:768` — `GET /address/{address}` → `explore.AddressPage` (initial HTML).
- `cmd/dcrdata/main.go:769` — `GET /addresstable/{address}` → `explore.AddressTable` (XHR JSON-wrapping HTML fragment).
- `cmd/dcrdata/internal/api/apirouter.go:319-320` — `GET /download/address/io/{address}[/win]` → `app.addressIoCsvNoCR` / `app.addressIoCsvCR` (CSV).

Both `/address` and `/addresstable` go through `explorer.AddressPathCtx` (middleware shared with the page itself).

### Handlers

- **`cmd/dcrdata/internal/explorer/explorerroutes.go:1534-1651`** — `AddressPage`. Inline `AddressPageData{*CommonPageData, Data: *dbtypes.AddressInfo, Type, CRLFDownload, FiatBalance, Pages}` at 1538-1545. Calls `parseAddressParams` (1548) → `AddressListData` (1604) → `xcBot.Conversion` (1617) → `calcPages` (1635) → `templates.exec("address", pageData)` (1637).
- **`cmd/dcrdata/internal/explorer/explorerroutes.go:1654-1706`** — `AddressTable` (XHR refresh). Calls `parseAddressParams` (1658) → `AddressListData` (1665) → `calcPages` (1681) → `templates.exec("addresstable", { Data: addrData })` (1684). Returns JSON `{ tx_count: int64, html: string, pages: []pageNumber }` (1675-1682).
- **`cmd/dcrdata/internal/explorer/explorerroutes.go:1772-1873`** — `parseAddressParams` (1774), `parsePaginationParams` (1832). Recognised query keys: `n`, `start`, `txntype`. Defaults: `n = defaultAddressRows = 20`, `start = 0`, `txntype = "all"`. Hard cap at `MaxAddressRows = 160` (`explorer.go:65`). Unknown `txntype` → `dbtypes.AddrTxnUnknown` → 400 from `AddressTable`, error page from `AddressPage`.
- **`cmd/dcrdata/internal/explorer/explorerroutes.go:1875-1891`** — `AddressListData`. Pure pass-through to `dataSource.AddressData`.
- **`cmd/dcrdata/internal/explorer/explorerroutes.go:2574-2587, 2646+`** — `pageNumber{Active, Link, Str}` and `calcPages(rows, pageSize, offset, link)`. `link` is a `fmt.Sprintf` template like `/address/{addr}?start=%d&n=20&txntype=all`.
- **`cmd/dcrdata/internal/api/apiroutes.go:1682-1687, 1689-1775`** — `addressIoCsvNoCR` / `addressIoCsvCR` → `addressIoCsv(crlf, …)`. Streams CSV from `c.DataSource.AddressRowsCompact(ctx, address)`.

### DB layer

- **`db/dcrpg/pgblockchain.go:2484-2716`** — `(*ChainDB).AddressData`. Pulls confirmed history (`AddressHistory` 2496), generates skeleton via `dbtypes.ReduceAddressHistory` (2522), counts rows for the chosen view (merged → `mergedTxnCount` 2549; non-merged → from `balance.NumSpent`/`NumUnspent` 2556-2567), back-fills metadata via `FillAddressTransactions` (2577), then overlays unconfirmed txs from `pgb.mp.UnconfirmedTxnsForAddress` (2587). Mempool overlay is skipped for merged views (2602, 2646).
- **`db/dcrpg/pgblockchain.go:2382-2481`** — `AddressHistory`. Cache-first; falls back to `updateAddressRows` + `dbtypes.SliceAddressRows`.
- **`db/dcrpg/pgblockchain.go:2300-2331`** — `retrieveMergedTxnCount` and `mergedTxnCount` (cache-aware count for `merged` / `merged_credit` / `merged_debit`).
- **`db/dcrpg/pgblockchain.go:2746-2804`** — `FillAddressTransactions`. Fills `Size`, `FormattedSize`, `Total`, `Time`, `Confirmations`, and (for matched txns) `MatchedTxIndex`.
- **`db/dcrpg/pgblockchain.go:2259-2298`** — `AddressRowsCompact`. CSV download source; returns `[]*dbtypes.AddressRowCompact`.

### Mocks

- `cmd/dcrdata/internal/api/noop_ds_test.go:29` — `(noopDS).AddressHistory` (only `AddressHistory`, not `AddressData`).
- `cmd/dcrdata/internal/explorer/explorer_test.go:53` — `(*mockDataSource).AddressData(ctx, address, N, offset, txnType) (*dbtypes.AddressInfo, error)` — must match the interface in `explorer.go:85`.

### Types referenced by the table

- **`db/dbtypes/types.go:2235-2254`** — `AddressTx`. Fields actually rendered in `addressTable`:
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
  - `CoinType` (`uint8`), `SKAValue` (`string`) — **populated by `dbtypes.ReduceAddressHistory:2412-2414, 2425-2427` but never read by any template today**.
- **`db/dbtypes/types.go:2303-2346`** — `AddressInfo`. Container for the table; the template reads `.Transactions`, `.TxnType`, `.IsMerged`, `.NumTransactions`, `.TxnCount`, `.NumUnconfirmed`, `.Offset`, `.Limit`, `.Path`, `.Address`, `.IsDummyAddress`.
- **`db/dbtypes/types.go:2380-2455`** — `ReduceAddressHistory`. The single funnel where atom values become `float64`. **Critical: the SKA branches (`addrOut.CoinType != 0`) leave `tx.ReceivedTotal` / `tx.SentTotal` at their zero value (`0.0`)** — they only stash the atoms-as-string in `tx.SKAValue`. The current template renders the float, which is `0`.

### What `ReceivedTotal` / `SentTotal` actually are

Today: **`float64` representing VAR coins**, computed via `dcrutil.Amount(addrOut.Value).ToCoin()` at `db/dbtypes/types.go:2392, 2408, 2421` and the mempool overlay at `db/dcrpg/pgblockchain.go:2633, 2695`. They are not coin-type-aware — for any `addrOut.CoinType != 0` row they are silently zero, and the template prints `0` in the Credit/Debit column.

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

`IsFunding` semantics — set in `dbtypes.ReduceAddressHistory:2400` from `addrOut.IsFunding`. For unconfirmed entries, the mempool overlay sets `IsFunding: true` for outpoints (`pgblockchain.go:2634`) and leaves it `false` for spending entries (`:2688-2698`).

`MatchedTx` is `nil` for credit rows whose UTXO is still unspent. Rendering relies on `{{- if .MatchedTx}}` — `*ChainHash` so a nil pointer renders `<no value>` if used directly, but the template only uses `.MatchedTx` inside an `if`. The link path is `/tx/{hash}/in|out/{matchedTxIndex}` (`:269` for credit-side; `:280` for debit-side).

## 4. Template touch points

### Fields referenced under `addressTable` (`extras.tmpl:210-315`)

`.TxnType`, `.Transactions`, and per-row: `.Confirmations`, `.TxID`, `.Link` (method, line 2258), `.TxType`, `.MergedTxnCount`, `.SentTotal`, `.ReceivedTotal`, `.IsFunding`, `.MatchedTx`, `.MatchedTxIndex`, `.Time.DatetimeWithoutTZ`, `.Time.T.Unix`, `.Time.UNIX`, `.BlockHeight`, `.FormattedSize`. None of these read `.CoinType` or `.SKAValue`.

### Fields referenced under the `address.tmpl` table block (`:185-298`)

`.IsDummyAddress`, `.Offset`, `.NumTransactions`, `.TxnCount` (calculated as `add .TxnCount .NumUnconfirmed` at line 8), `.NumUnconfirmed`, `.Limit`, `.Path`, `.Address`, `.IsMerged`, `.TxnType`, `.Transactions` (only `len`, for selecting the `pagesize` `<option>` at line 284), `$.Pages`, `$.CRLFDownload`.

### Helper functions used in this surface

- `add`, `subtract` (`templates.go` arithmetic helpers) — pagination math.
- `intComma` (`templates.go:637-642`) — `range`, `txnCount`.
- `hashlink` (`templates.go:826`), `hashElide` template (`extras.tmpl:198`), `hashStart` / `hashEnd` (`templates.go:836, 851`) — TxID rendering.
- **`float64AsDecimalParts` (`templates.go:650`)** — used at `extras.tmpl:251, 254, 258, 262, 265, 267, 284`. Wraps `float64Formatting`. Always called with `8` decimal places (the VAR scale).
- `decimalParts` template (`extras.tmpl:176-188`) — renders the `[]string` produced by `float64AsDecimalParts` / `amountAsDecimalParts`.

### Hard-coded coin labels

- **`Credit VAR`** literals: `extras.tmpl:222, 227, 230, 233, 235`.
- **`Debit VAR`** literals: `extras.tmpl:222 (also "Debit VAR"), 231, 236` — actually four occurrences total: lines `222, 231, 236` plus the merged-debit header on `222` is "Debit VAR".

These are uppercase already (the surrounding `address.tmpl` summary card still says `DCR` — see `address.tmpl:48, 50, 64, 66, 77, 79`). The table headers were renamed to `VAR` ahead of the multi-coin work; they remain inline string literals, in violation of constraint **C7** (centralised coin-type label rendering).

## 5. Frontend touch points (URL contract + XHR refresh)

### Stimulus controller

`cmd/dcrdata/public/js/controllers/address_controller.js`. The transactions surface is co-mounted with `newblock` (`address.tmpl:11` — `data-controller="address newblock"`).

### Targets used by this surface (declared at `:153-192`)

- Input wiring: `txntype` (272), `pagesize` (279), `paginator` (204, 213), `pageminus` (200), `pageplus` (209).
- Display wiring: `range` (190), `txnCount` (192), `paginationheader` (189), `pagebuttons` (197), `tablePagination` (230), `mergedMsg` (227), `listLoader` (222), `table` (223), `pending` (per-row, `extras.tmpl:246`), `numUnconfirmed` (`address.tmpl:89` — also referenced from the summary card).

### Actions (Stimulus)

- `change->address#changeTxType` (`address.tmpl:262`) → `:329` `fetchTable(this.txnType, this.pageSize, 0)`.
- `change->address#changePageSize` (`:280`) → `:325` `fetchTable(this.txnType, this.pageSize, this.paginationParams.offset)`.
- `address#prevPage` / `address#nextPage` (`:205, :214`) → `:333, :337` → `toPage(±1)` → `fetchTable`.
- `click->address#pageNumberLink` (`:233, :241, :247`) → `:341` parses the anchor's `href` for `start`, `n`, `txntype` and calls `fetchTable`.
- `mouseover->address#hashOver mouseout->address#hashOut` (`extras.tmpl:271, 280`) → `:808, :820` highlight the matching link in the same row.

### URL query keys

`address_controller.js:211-219` declares the persisted set: `chart`, `zoom`, `bin`, `flow`, **`n`**, **`start`**, **`txntype`**. (Chart keys are out of scope here.) `pagesize` is **not** a persisted key — page size flows in via the table fetch as `n=`. The select's `name="pagesize"` is never written to the URL; only the resulting `n=` is.

### `fetchTable` URL construction

`address_controller.js:319-323` `makeTableUrl(txType, count, offset)`:

```
/addresstable/{address}?txntype=${txType}&n=${count}&start=${offset}
```

(or `/treasurytable?...` for the treasury page, same controller.) `:363` `requestCount = count > 20 ? count : 20` — page sizes < 20 are silently bumped.

### Server response shape

`AddressTable` returns JSON: `{ tx_count: int64, html: string, pages: []pageNumber }` (`explorerroutes.go:1675-1682`). `pageNumber` JSON tags: `active`, `link`, `str` (`:2574-2578`). The `html` is the rendered `addresstable` template — the inner `<table>` plus its empty-state — never anything else. The XHR path therefore re-renders the **entire table inner HTML** on every fetch (full HTML fragment, not a JSON row schema). `fetchTable` (`:361`) uses `dompurify.sanitize(tableResponse.html)` and assigns to `tableTarget.innerHTML`, then rebuilds the numbered pagination via `setTablePaginationLinks` (`:437`) using `tableResponse.pages` plus arrow links built from `paginationParams.offset`/`pagesize`.

### State write-through

`fetchTable:366-372` writes `n`, `start`, `txntype` back to `this.settings` and calls `this.query.replace(this.settings)` — the address bar updates via TurboQuery (history-replace) without a full nav.

### Other DOM that responds to events

- `data-newblock-target="confirmations"` cells (`extras.tmpl:295-300`) are updated by `newblock_controller.js:36-43` on every `BLOCK_RECEIVED` event. The `data-confirmation-block-height` attribute is the integer block height the row was confirmed at; `-1` means unconfirmed.
- `data-address-target="pending"` rows (`extras.tmpl:246`) are converted to confirmed by `address_controller.js:_confirmMempoolTxs` (`:774-806`) when the new block contains the row's `data-txid`. That handler also touches `tx.addr-tx-confirms`, `tx.addr-tx-time`, `tx.addr-tx-age > span`, and the global `txnCount` and `numUnconfirmed` count cells in the summary card.

## 6. Multi-coin gaps (most critical section)

### Float64 / VAR-only sites that lose SKA precision

All sites below assume amounts fit `float64` (8 decimals, VAR). For SKA atoms (18 decimals), `float64` loses ~3 decimal digits and may render `0`.

#### Backend

- `db/dbtypes/types.go:2392` — `coin := dcrutil.Amount(addrOut.Value).ToCoin()`. The single funnel in `ReduceAddressHistory`.
- `db/dbtypes/types.go:2408` — `tx.ReceivedTotal = coin` (only when `addrOut.CoinType == 0`).
- `db/dbtypes/types.go:2421` — `tx.SentTotal = coin` (only when `addrOut.CoinType == 0`).
- `db/dbtypes/types.go:2412-2414` and `:2425-2427` — for SKA rows (`CoinType != 0`), only `tx.SKAValue` and `tx.CoinType` are set. **`ReceivedTotal` / `SentTotal` remain at the zero default** — and the template prints those.
- `db/dcrpg/pgblockchain.go:2632-2634` — mempool overlay for funding txs: `Total: txhelpers.TotalOutFromMsgTx(...).ToCoin()`, `ReceivedTotal: dcrutil.Amount(... .Value).ToCoin()`. No coin-type branch — every unconfirmed tx is treated as VAR.
- `db/dcrpg/pgblockchain.go:2693-2695` — mempool overlay for spending txs: `Total`, `SentTotal` ditto. Same gap.
- `db/dcrpg/pgblockchain.go:2763` — `txn.Total = dcrutil.Amount(dbTx.Sent).ToCoin()` in `FillAddressTransactions` (currently unused by `addressTable`, but feeds related surfaces).

#### CSV download

- `cmd/dcrdata/internal/api/apiroutes.go:1764` — `strconv.FormatFloat(dcrutil.Amount(r.Value).ToCoin(), 'f', -1, 64)` — VAR-only float formatting. `AddressRowCompact` (`db/dbtypes/types.go:1299-1309`) does **not** carry `CoinType` or `SKAValue`, so the CSV path can't distinguish coins even structurally.

#### Templates

- `cmd/dcrdata/views/extras.tmpl:251` — `(float64AsDecimalParts .SentTotal 8 false)` — merged_debit Debit cell.
- `cmd/dcrdata/views/extras.tmpl:254` — `.ReceivedTotal` — merged_credit Credit cell.
- `cmd/dcrdata/views/extras.tmpl:258` — `.ReceivedTotal` — merged Credit cell (when `IsFunding`).
- `cmd/dcrdata/views/extras.tmpl:262` — `.SentTotal` — merged Debit cell (when not funding).
- `cmd/dcrdata/views/extras.tmpl:265` — `.ReceivedTotal` — unspent Credit.
- `cmd/dcrdata/views/extras.tmpl:267` — `.ReceivedTotal` — credit / all-funding Credit.
- `cmd/dcrdata/views/extras.tmpl:277` — `if eq .SentTotal 0.0` — float compare to detect sstxcommitment. Will treat any SKA debit as `0.0` and force the "sstxcommitment" branch (incorrect for SKA debits).
- `cmd/dcrdata/views/extras.tmpl:284` — `.SentTotal` — debit / all-spending Debit.

All eight sites pass `8` decimal places, hard-coding the VAR scale. None reads `.CoinType` or `.SKAValue`.

### Hard-coded `VAR` literals

- `cmd/dcrdata/views/extras.tmpl:222` — `Debit VAR` (merged_debit header).
- `cmd/dcrdata/views/extras.tmpl:227` — `Credit VAR` (merged_credit header).
- `cmd/dcrdata/views/extras.tmpl:230` — `Credit VAR` (merged header).
- `cmd/dcrdata/views/extras.tmpl:231` — `Debit VAR` (merged header).
- `cmd/dcrdata/views/extras.tmpl:233` — `Credit VAR` (unspent header).
- `cmd/dcrdata/views/extras.tmpl:235` — `Credit VAR` (default/credit/debit/all header).
- `cmd/dcrdata/views/extras.tmpl:236` — `Debit VAR` (default/credit/debit/all header).

(The summary card still uses `DCR` literals; they are out of scope here but mentioned for cross-check by spec authors.)

### Frontend (controller)

- `address_controller.js:84` — `${series.y} DCR` in the chart legend formatter (charts surface, but reachable via the same controller).
- `address_controller.js:130, 140` — `ylabel: 'Total (DCR)'` / `'Balance (DCR)'`.

These labels do not directly affect the table, but anyone touching coin labels on this controller should update them in the same change.

## 7. Pagination + filter contract (server vs XHR parity)

Both the initial render and the XHR refresh share `parseAddressParams` (`explorerroutes.go:1548, 1658` → `:1774`) and `AddressListData` (`:1604, 1665` → `:1881`). Both call `calcPages(int(addrData.TxnCount), int(limitN), int(offsetAddrOuts), linkTemplate)` — `addrData.TxnCount` is the **confirmed-only** count from `pgblockchain.go:2549` / `:2553-2567` (mempool count is added separately as `NumUnconfirmed` to `NumTransactions`, but the page index is computed off `TxnCount`).

### Subtle parity points

1. **`linkTemplate` differs between handlers**:
   - `AddressPage:1627` — `fmt.Sprintf("/address/%s?start=%%d&n=%d&txntype=%v", …)` (note the literal `/address/`).
   - `AddressTable:1673` — same path prefix `"/address/" + addrData.Address + "?start=%d&n=" + …`. Both produce identical link patterns. Anchors coming back through XHR therefore navigate to `/address/{addr}?...` — never `/addresstable/...`.
2. **`limitN == 0` defaulting** is only applied in `AddressPage:1623-1625`, **not** in `AddressTable`. In practice the controller always sends `n` ≥ 20 (`:363`), but a hand-crafted XHR with `n=0` would compute a divide-by-zero / no-pagination response. `calcPages:2647-2649` guards against it.
3. **XHR `tx_count` includes mempool, server-rendered range does too**: `AddressTable:1680` returns `addrData.TxnCount + addrData.NumUnconfirmed`; `address.tmpl:8` computes `$TxnCount := add .TxnCount .NumUnconfirmed`. Aligned.
4. **`Pages` values share the same `link` template**, so the numbered pagination produced by SSR (`address.tmpl:236-244`) and by `setTablePaginationLinks` (`address_controller.js:437-471`) point at the same URLs.
5. **`pagesize` selector is server-rendered only**: there is no `<select>` rebuild on XHR refresh. The controller's `setPageability` (`:388`) toggles `option.disabled` based on `paginationParams.count`, but the option set was decided at SSR time (`address.tmpl:284-292`) using `Txlen := len .Transactions` — a non-merged page might land on a `pagesize` that no longer maps to a server option after the user changes `txntype` to `merged`.
6. **`numUnconfirmed` block (`address.tmpl:88-92`)** lives in the summary card but is mutated by the table-pending logic (`address_controller.js:_confirmMempoolTxs:791-802`). Cross-surface coupling.

## 8. CSV download

### Route

`GET /download/address/io/{address}` (no CRLF) and `GET /download/address/io/{address}/win` (CRLF). `cmd/dcrdata/internal/api/apirouter.go:319-320`. Cached for 180 seconds via `m.CacheControl` middleware.

### Trigger

`address.tmpl:253` —

```
<a class="…" href="/download/address/io/{{.Address}}{{if $.CRLFDownload}}/win{{end}}" type="text/csv" download>
```

`CRLFDownload` is set from `strings.Contains(r.UserAgent(), "Windows")` (`explorerroutes.go:1621`). The `/win` suffix changes **only** the line endings (`writer.UseCRLF = crlf` at `apiroutes.go:1731`); columns and amount formatting are identical.

### Schema

Header row written at `apiroutes.go:1733-1734`:

```
tx_hash, direction, io_index, valid_mainchain, value, time_stamp, tx_type, matching_tx_hash
```

Per-row population (`apiroutes.go:1759-1768`):

- `tx_hash` — `r.TxHash.String()`.
- `direction` — `"1"` if `r.IsFunding`, else `"-1"`.
- `io_index` — `r.TxVinVoutIndex` (uint32 → string).
- `valid_mainchain` — `"1"` / `"0"`.
- `value` — `strconv.FormatFloat(dcrutil.Amount(r.Value).ToCoin(), 'f', -1, 64)` — **VAR coin string** with up to 8 decimals (e.g. `1.23456789`). Float, not integer atoms.
- `time_stamp` — Unix integer (`r.TxBlockTime`).
- `tx_type` — `txhelpers.TxTypeToString(int(r.TxType))`.
- `matching_tx_hash` — empty when nil.

### Multi-coin status

`AddressRowCompact` (`db/dbtypes/types.go:1299-1309`) lacks `CoinType` and `SKAValue`. The CSV path is therefore **structurally VAR-only** — there is no plumbing to emit the coin or SKA atoms even if the schema were extended. Adding multi-coin support requires changes to either `AddressRowCompact` (and its cache representation) or routing the CSV through `AddressRow` instead.

Filename format (`apiroutes.go:1725-1726`): `address-io-{address}-{height}-{unixNow}.csv`.

## 9. Cross-surface dependencies

- **`txnCount` span** (`address.tmpl:192`, `data-address-target="txnCount"`, `data-txn-count`): displayed in the table header but mutated by `_confirmMempoolTxs` (`:789-790`) when a pending tx confirms. The summary card's "Received" outputs count (`address.tmpl:70`) is **not** the same — it's recomputed from `Balance.NumSpent + Balance.NumUnspent`.
- **`numUnconfirmed`** (summary card, `address.tmpl:89-91`): also touched by `_confirmMempoolTxs` (`:791-802`), even though it lives outside this surface. Decreasing `numUnconfirmed` while increasing `txnCount` keeps the page consistent across pending-confirmation events.
- **`data-newblock-target="confirmations"`** cells (`extras.tmpl:294-300`): updated en masse by the `newblock` controller on `BLOCK_RECEIVED` (`newblock_controller.js:36-43`). Re-rendered table rows (after XHR) need to re-attach via Stimulus' MutationObserver — happens automatically because the new HTML still carries the `data-newblock-target` attribute.
- **`mergedMsg`** (`address.tmpl:227-229`, `data-address-target="mergedMsg"`): driven by `IsMerged` server-side and toggled client-side from `fetchTable` (`address_controller.js:377-382`) based on whether `txType.indexOf('merged') === -1`. Two sources of truth — keep them in sync.
- **`pending` rows** (`extras.tmpl:246`, `data-address-target="pending"`): only present for `Confirmations == 0`; consumed by `_confirmMempoolTxs` (`:774-806`).
- **`hashOver` / `hashOut`** highlights (`extras.tmpl:271, 280` → `:808, :820`): the controller iterates `this.hashTargets`, but no element in `extras.tmpl` carries `data-address-target="hash"`. The targets are declared (`:179, :180`) but unused on this page today — likely vestigial. The hover handlers do still work for the visual `blue-row` toggle on the link itself.
- **Charts card vs table**: chart endpoints are coin-agnostic (`pgblockchain.go:3114` `TxHistoryData` — see `flow.full.md` §5). If the table grows a coin filter, chart aggregation will silently drift unless updated.
- **`tx.tmpl` SKA gap** (`/wiki/code-analysis/transaction/flow.full.md` §5): the per-tx page that this table links to also currently mishandles SKA outputs — fixing the table without fixing `tx.tmpl` leaves users one click away from the same precision loss.

## 10. Open product/UX questions

These questions cannot be answered from code alone and must be decided before a feature spec lands.

1. **Coin column or coin filter (or both)?**
   - Add a `Coin` column to every view? It would be coin-symbol from `coinSymbol(.CoinType)` (constraint **C7**), so each row is self-describing.
   - Or add a coin-type filter `<select>` next to `txntype` and keep one amount column per page?
   - Or split into per-coin tables stacked vertically?
2. **`Credit VAR` / `Debit VAR` header — per-row or per-column?**
   - Drop `VAR` from the header and render the symbol per row (next to the amount)?
   - Keep one header per coin and render per-coin columns (`Credit VAR`, `Credit SKA1`, …)? With 256 possible coin types this scales badly.
   - Or rename to a generic `Credit` / `Debit` and rely on the `Coin` column?
3. **Merged view across coins** — what does "merged" mean when an address has txs in multiple coins?
   - Merge across coins (single rolled-up amount per merged-bucket — invalid because amounts in different coins can't sum)?
   - Merge per coin (each merged row has a single `CoinType`)?
   - Disallow merged views when the address has multi-coin history?
4. **CSV column schema.**
   - Add `coin_type` and `ska_value` columns? `value` then encodes VAR atoms (or coin string) and `ska_value` encodes SKA atoms.
   - Or replace `value` with a single `amount_atoms` string column plus `coin_type` column, and let consumers parse the decimals from the coin's known scale?
   - Either choice requires extending `AddressRowCompact` (and its cache representation) or rerouting CSV through `AddressRow`.
5. **`SentTotal == 0.0` sstxcommitment heuristic** (`extras.tmpl:277`) — float-compare to a magic value. For SKA, the value is always `0.0` because the ReduceAddressHistory branch leaves it zero. Either replace the heuristic with an explicit flag on `AddressTx`, or special-case by `CoinType`.
6. **Per-coin balance summary** — out of scope for this note, but a coin filter without per-coin balance numbers in the summary card will feel inconsistent.
7. **Fiat conversion** (`xcBot.Conversion` at `explorerroutes.go:1617`): currently converts `Balance.TotalUnspent` as a VAR amount to fiat. If the address's balance becomes per-coin, what does the fiat number show? VAR-only? Sum of per-coin fiats? Hidden when there are non-VAR coins?
8. **Pagination semantics across coins** — should `?txntype=` keep its current values (which are about credit/debit/merged, not about coin), with an orthogonal `?coin=` key? If yes, declare the key in `address_controller.js:211-219` and add a parser in `parsePaginationParams`.
9. **Page-size `<option>` rebuild on filter change** — already a latent issue (§7 #5); the multi-coin work makes it worse if a coin filter further reduces row counts. Decide whether to rebuild `<select>` options on every XHR.
10. **CSV cache key / cache invalidation** — the route is cached for 180s by middleware. If a `?coin=` filter is added, the cache key needs to include it, or each call must invalidate.
11. **Real-time `pending` rows for SKA mempool txs** — `_confirmMempoolTxs` (`address_controller.js:774-806`) doesn't carry coin context today. Decide whether the per-row template needs `data-coin-type` and how the controller propagates it.
12. **Footnote text** — "*No unconfirmed transactions shown in merged views." — does this still hold when merged is per-coin?

---

References used in this note:
- `cmd/dcrdata/views/address.tmpl:1-304`
- `cmd/dcrdata/views/extras.tmpl:176-315`
- `cmd/dcrdata/views/addresstable.tmpl:1-3`
- `cmd/dcrdata/internal/explorer/explorerroutes.go:1534-1706, 1772-1891, 2574-2700`
- `cmd/dcrdata/internal/explorer/explorer.go:59-65, 85`
- `cmd/dcrdata/internal/explorer/templates.go:31, 220-295, 297-336, 637-672, 826-865, 899-901`
- `cmd/dcrdata/internal/api/apirouter.go:310-324`
- `cmd/dcrdata/internal/api/apiroutes.go:1682-1775`
- `cmd/dcrdata/main.go:768-769`
- `cmd/dcrdata/public/js/controllers/address_controller.js:152-471, 774-828, 895-902`
- `cmd/dcrdata/public/js/controllers/newblock_controller.js:1-44`
- `db/dbtypes/types.go:677-741, 1230-1328, 2235-2358, 2380-2455`
- `db/dcrpg/pgblockchain.go:2259-2716, 2746-2804`
- `cmd/dcrdata/internal/explorer/explorer_test.go:53`
- `cmd/dcrdata/internal/api/noop_ds_test.go:29`
