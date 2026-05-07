### One-line Flow
chi `/address/{addr}` → `AddressPage` → `AddressListData` → PG (`AddressHistory` + mempool overlay) → `templates.exec("address", AddressPageData{Data:*AddressInfo,...})` → `address` Stimulus controller (TurboQuery URL state; charts via `/api/address/{addr}/{types|amountflow}/{bin}`; table via `/addresstable/{addr}?...`).

### Key Architectural Patterns
- **Inline page-payload struct:** `AddressPageData{*CommonPageData, Data, FiatBalance, Pages, ...}` — the project's standard wrapper around a `dbtypes.*Info` core.
- **Shared params parser:** `parseAddressParams` is reused by HTML (`AddressPage`) and XHR (`AddressTable`) handlers; both must stay aligned.
- **TurboQuery URL ownership:** every UI write (chart, bin, zoom, pagination, type filter) goes through `this.query.replace(this.settings)` (history-replace, no full nav). All persisted keys must be declared with null values in `connect()`.
- **Zoom encoding:** base-36 ms timestamps `"<start>-<end>"`; `Zoom.validate` clamps silently to current data range — stale values never error.

### Critical Constraints
- **Single-coin assumption (SKA precision loss):** `AddressInfo.Balance` is one `AddressBalance`; template uses `toFloat64Amount`/`amountAsDecimalParts` and labels everything `DCR`. Valid for VAR (8 decimals); silently lossy for SKA (18 decimals).
- **Chart endpoints are coin-agnostic:** `TxHistoryData` takes no `CoinType`; aggregates across all coins.
- **Dummy/zero address branch is required:** prevents DB timeouts on the unspendable ticket-change address.
- **Stale `?zoom=` across chart-type changes:** `changeGraph`/`changeBin` call `setGraphQuery` without resetting `settings.zoom`; URL keeps the prior chart's window, `validateZoom` silently clamps it. (Bug origin for `bugfix/stale-zoom-param`.)

### Mutation Checklist
When modifying the address page:
- [ ] Renaming `AddressInfo`/`AddressBalance` fields? Grep both `address.tmpl` and `addressTable.tmpl`, plus handlers at `explorerroutes.go:1604,1665,1681` and DB mocks.
- [ ] New URL query key? Add a null entry in `address_controller.js:connect()` settings template (211-219).
- [ ] New chart kind or group-by bin? Match `<select>`/`<button>` `name`/`value` ↔ `apirouter.go:185` segments ↔ `fetchGraphData` URL construction (517-521).
- [ ] Touching zoom-relevant code? Decide explicitly what `settings.zoom` means after the change (drop / project / keep) before `setGraphQuery` writes it to the URL.
- [ ] Multi-coin work? `AddressInfo.Balance` is single-coin today — extending it is structural, not cosmetic; format SKA atoms as strings at the template boundary, never via `ToCoin()`.

See also:
- /wiki/code-analysis/charts/flow.compact.md (shares-pattern-with: TurboQuery + Zoom validation)
- /wiki/code-analysis/transaction/flow.compact.md (depends-on: address tx list rendering)
- /wiki/core/constraints.md#C1 (depends-on: float64-vs-string precision — **currently violated** for SKA addresses)
