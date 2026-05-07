### 1. Overview
Tracing the data flow that renders the address page (`/address/{address}`), powers its chart endpoints, and persists chart/pagination state in the URL via TurboQuery. Captures the stale-zoom-param failure mode that motivates ongoing fixes in `address_controller.js`.

### 2. End-to-End Data Flow
chi router (`main.go`) → `AddressPathCtx` middleware → `explorerUI.AddressPage` → `parseAddressParams` → `AddressListData` → `dataSource.AddressData` (PG: `AddressHistory` + `mergedTxnCount` + `FillAddressTransactions` + `mempool.UnconfirmedTxnsForAddress`) → `templates.exec("address", AddressPageData)` → `views/address.tmpl` → browser → `address` Stimulus controller (`TurboQuery` for URL state, fetches `/api/address/{addr}/{types|amountflow}/{bin}` for charts and `/addresstable/{addr}?...` for table refresh).

### 3. Per-Layer Breakdown
- **Location:** `cmd/dcrdata/main.go:768-769`
  - **Data Structures Involved:** chi route, `AddressPathCtx` puts address into `ctxAddress`.
  - **Transformations Applied:** Two routes share the same middleware: `/address/{address}` → `AddressPage`, `/addresstable/{address}` → `AddressTable`.
- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1534-1645`
  - **Data Structures Involved:** Inline `AddressPageData{*CommonPageData, Data: *dbtypes.AddressInfo, Type, CRLFDownload, FiatBalance, Pages}` (line 1538).
  - **Transformations Applied:** `parseAddressParams` (1774) extracts `address`, `txntype`, `n`, `start`. Zero/dummy address branch (1592-1602) short-circuits DB reads. `AddressListData` (1877) → `dataSource.AddressData`. `xcBot.Conversion` adds `FiatBalance`. `calcPages` (2646) builds pagination. `templates.exec("address", ...)` (1637).
- **Location:** `db/dcrpg/pgblockchain.go:2484` (`AddressData`)
  - **Data Structures Involved:** `*dbtypes.AddressInfo` (`db/dbtypes/types.go:2304`), `*dbtypes.AddressBalance` (`types.go:2350`).
  - **Transformations Applied:** Calls `AddressHistory` (2382) for paginated rows + balance, `mergedTxnCount` (2322) for merged views, `FillAddressTransactions` (2746) to back-fill block height/time, and `pgb.mp.UnconfirmedTxnsForAddress` (2587) to overlay mempool entries into `NumUnconfirmed`.
- **Location:** `cmd/dcrdata/internal/api/apirouter.go:185` + `apiroutes.go:1777,1813`
  - **Data Structures Involved:** `*dbtypes.ChartsData` (`db/dbtypes/types.go:2030`).
  - **Transformations Applied:** `getAddressTxTypesData` and `getAddressTxAmountFlowData` both call `DataSource.TxHistoryData(ctx, addr, kind, interval)` (`pgblockchain.go:3114`); cache layer (`db/cache`) is consulted before Postgres.
- **Location:** `cmd/dcrdata/views/address.tmpl`
  - **Data Structures Involved:** All `.Data.*` fields are public fields on `dbtypes.AddressInfo`/`AddressBalance`. Pagination links use `?start=`, `?n=`, `?txntype=` (lines 202, 211, 234, 248).
  - **Transformations Applied:** `amountAsDecimalParts` and `toFloat64Amount` (lines 15, 48, 64, 77) format atoms as DCR strings via `dcrutil.Amount.ToCoin() float64`.
- **Location:** `cmd/dcrdata/public/js/controllers/address_controller.js`
  - **Data Structures Involved:** `this.settings` (chart, zoom, bin, flow, n, start, txntype) backed by `TurboQuery`.
  - **Transformations Applied:** `connect()` (194) seeds `settings` from URL via `query.update` (233). `drawGraph()` (473) short-circuits zoom-only changes (482-488); otherwise `fetchGraphData` (496) hits `/api/address/{addr}/{chartKey}/{bin}` (517-521). `popChartCache → validateZoom` (588 → 610) calls `Zoom.validate` (612) and `setZoom` (613). All URL writes flow through `query.replace(this.settings)` from `setGraphQuery` (635), `setZoom` (683), Dygraph callbacks (738, 749), and `fetchTable` (361).

### 4. Cross-Layer Dependencies
- **Template ↔ struct:** every `.Data.*` reference in `views/address.tmpl` is a public field on `dbtypes.AddressInfo`/`AddressBalance`; renames break template parsing at runtime.
- **Pagination URL contract:** `?start=`, `?n=`, `?txntype=` are produced by both server-rendered links (template) and client-side `fetchTable`; both must match `parseAddressParams` keys.
- **Chart URL contract:** `<select>` option `value` (`balance`/`types`/`amountflow`, template lines 128-130) ↔ `apirouter.go:185` URL segment ↔ `address_controller.js:fetchGraphData` (517-521). Renaming silently 404s.
- **Shared params parser:** `AddressPage` (1534) and `AddressTable` (1658) both call `parseAddressParams` and `AddressListData`; drift between server-rendered initial table and XHR-refreshed table is a class of subtle bugs.
- **Co-mounted controllers:** `data-controller="address newblock"` (template line 11) — the `newblock` controller can mutate the same DOM (e.g., `txnCount`) that `address` reads.

### 5. Critical Constraints
- **Multi-coin gap (silent SKA precision loss):** `AddressInfo.Balance` is a single `AddressBalance`, not a per-coin map; the template hard-codes `DCR` and uses `toFloat64Amount`/`amountAsDecimalParts` (`dcrutil.Amount.ToCoin() float64`). VAR (8 decimals) fits float64; SKA (18 decimals) does not — atoms must stay as `big.Int`-derived strings end-to-end. This invariant is violated for SKA addresses today.
- **Chart endpoints are coin-agnostic:** `TxHistoryData(addr, kind, interval)` (`pgblockchain.go:3114`) takes no `CoinType`; series aggregate across all coin types.
- **Dummy/zero address short-circuit (1592-1602):** required because zero addresses have so many outputs that DB queries time out. Removing it is a hard regression.
- **Zoom encoding:** `Zoom.encode` (`helpers/zoom_helper.js`) is base-36 ms timestamps `"<start>-<end>"`. Stale values across chart-type changes parse cleanly but lie outside the new chart's range, so `Zoom.validate` clamps silently — never throws.
- **TurboQuery null-template:** every URL key the controller mutates must be declared with a null value in `connect()` settings (`address_controller.js:211-219`); undeclared keys aren't persisted.

### 6. Mutation Impact
When modifying [the address page or its chart/table state], check:
- **Direct dependencies:** `dbtypes.AddressInfo`/`AddressBalance` field names — referenced by `views/address.tmpl`, `views/addressTable.tmpl`, three handlers in `explorerroutes.go` (1604, 1665, 1681), and DB mocks under `cmd/dcrdata/internal/api/noop_ds_test.go`.
- **Indirect dependencies:** `address_controller.js` URL contract (chart kind, group-by bin, pagination keys), `apirouter.go:185` route segments.
- **Serialization boundaries:** `/api/address/{addr}/{kind}/{bin}` JSON shape (`*dbtypes.ChartsData`); `/addresstable/{addr}` HTML fragment; bookmarked URLs with `?zoom=`/`?chart=`/`?bin=`/`?start=`.
- **Rendering layers:** template precision helpers (DCR-only today) and Dygraph zoom validation (`validateZoom` at 610).
- **Silent failures:**
  - Stale `?zoom=` after chart-type change — `setGraphQuery` (635) writes prior chart's zoom into the URL of the new chart; `Zoom.validate` clamps silently. Refresh re-applies the wrong window.
  - SKA balance precision loss through `toFloat64Amount`/`amountAsDecimalParts`.
  - `db/cache` desync after a reorg — chart series stale while table is fresh.
- **Hard failures:**
  - Template parse error if `.Data.*` field is renamed without updating both `address.tmpl` and `addressTable.tmpl`.
  - 404 on chart fetch if `<option value>` doesn't match an API route segment.
  - `txhelpers.AddressValidation` rejection (1555) renders an error page; template never executes.

### 7. Common Pitfalls
- Adding more `dcrutil.Amount.ToCoin()`/`toFloat64Amount` calls to the address template — locks in SKA precision loss.
- Calling `setGraphQuery` without first deciding whether `settings.zoom` is still meaningful for the new chart — exact mechanism behind the `bugfix/stale-zoom-param` defect (`changeGraph` at 620, `changeBin` at 626).
- Adding a new query param without declaring a null entry in `connect()` lines 211-219 — `TurboQuery` won't persist it.
- Updating `AddressPage` without mirroring the change in `AddressTable` (1658) — XHR refresh diverges from initial render.
- Renaming `<select>` chart option values without updating `apirouter.go` and `fetchGraphData` URL construction.

### 8. Evidence
- **Routes:** `cmd/dcrdata/main.go:768-769`; middleware at `cmd/dcrdata/internal/explorer/explorermiddleware.go:267`.
- **Page handler:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1534` (`AddressPage`), inline struct at line 1538, `parseAddressParams` at 1774, `AddressListData` at 1877, `templates.exec` at 1637.
- **Table XHR handler:** `cmd/dcrdata/internal/explorer/explorerroutes.go:1658` (`AddressTable`).
- **DB layer:** `db/dcrpg/pgblockchain.go:2484` (`AddressData`), 2382 (`AddressHistory`), 2322 (`mergedTxnCount`), 2746 (`FillAddressTransactions`), 2587 (mempool overlay), 3114 (`TxHistoryData`).
- **Types:** `db/dbtypes/types.go:2304` (`AddressInfo`), 2350 (`AddressBalance`), 2030 (`ChartsData`).
- **Chart API:** `cmd/dcrdata/internal/api/apirouter.go:185`; handlers `apiroutes.go:1777,1813`.
- **Template:** `cmd/dcrdata/views/address.tmpl` (DCR labels lines 48,50,64,66,77,79; pagination URLs 202,211,234,248; chart options 128-130; group-by buttons 154-158).
- **Frontend controller:** `cmd/dcrdata/public/js/controllers/address_controller.js` — `connect` 194, settings template 211-219, `query.update` 233, zoom-button-clear 236-240, `drawGraph` 473, `fetchGraphData` 496-521, `popChartCache` 548, `validateZoom` 610, `changeGraph` 620, `changeBin` 626, `setGraphQuery` 635, `onZoom` 666, `setZoom` 683-691, Dygraph callbacks 738/749.
- **Zoom helper:** `cmd/dcrdata/public/js/helpers/zoom_helper.js` — `Zoom.encode/decode/validate/mapValue/mapKey`. Used by `address_controller.js` and `charts_controller.js`; the latter additionally projects zoom across data-range changes — the address controller does not.

See also:
- /wiki/code-analysis/charts/flow.full.md (shares-pattern-with: TurboQuery URL-state persistence; `Zoom` validation; chart-payload serialization)
- /wiki/code-analysis/transaction/flow.full.md (depends-on: address transaction list rendering)
- /wiki/core/constraints.md#C1 (depends-on: numeric precision & bifurcation — **currently violated** on this page; `AddressInfo.Balance` flows through `toFloat64Amount` / `amountAsDecimalParts`, lossy for SKA)
- /wiki/code-analysis/mempool/flow.full.md (depends-on: `NumUnconfirmed` overlay via `UnconfirmedTxnsForAddress`)
