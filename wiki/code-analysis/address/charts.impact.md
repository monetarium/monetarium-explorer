### Mutation Impact: Address Page Charts Card

Change-surface reference for the right-top "charts" card on `/address/{address}`. Companion to `wiki/code-analysis/address/flow.compact.md` and `flow.full.md`; covers only the chart UI, its API endpoints, the DB query path, and URL state. Summary card and transactions table are out of scope.

---

## 1. Scope

Template region (the right-top card):
- `cmd/dcrdata/views/address.tmpl:113-183` — the `<div class="col-24 col-xl-13 secondary-card p-2">` block.
  - Fullscreen mount: `address.tmpl:17-19` (`fullscreen` + `bigchart` targets) — outside the card but driven by `toggleExpand` on the card's `expando`.
  - Container `data-controller="address newblock"` and the per-page payload attributes are at `address.tmpl:10-16` (read by `connect()`).

Frontend controller sections (`cmd/dcrdata/public/js/controllers/address_controller.js`):
- Module-level chart helpers: `txTypesFunc` (18-28), `amountFlowProcessor` (30-53), `formatter` / `customizedFormatter` (55-87), `createOptions` / `commonOptions` / `typesGraphOptions` / `amountFlowGraphOptions` / `balanceGraphOptions` (97-148).
- Targets used on this card: `options`, `flow`, `zoom`, `interval`, `chartbox`, `noconfirms`, `chart`, `chartLoader`, `expando`, `littlechart`, `bigchart`, `fullscreen` (declared in the `targets` list at 153-191).
- Lifecycle: `connect` (194-254), `disconnect` (256-262), `bindElements` (274-282), `initializeChart` (265-272).
- Chart state machine: `drawGraph` (473-494), `fetchGraphData` (496-527), `processData` (529-546), `popChartCache` (548-589), `noDataAvailable` (591-595).
- Validation/state writes: `validChartType` (597-599), `validGraphInterval` (601-608), `validateZoom` (610-618), `setChartType` (721-726), `setIntervalButton` (702-709), `setSelectedZoom` (728-736), `setButtonVisibility` (758-772).
- UI event handlers: `changeGraph` (620-624), `changeBin` (626-633), `setGraphQuery` (635-637), `updateFlow` (639-657), `setFlowChecks` (659-664), `onZoom` (666-681), `setZoom` (683-692), Dygraph callbacks `_drawCallback` (738-747) and `_zoomCallback` (749-756), fullscreen `toggleExpand` (830-841), `putChartBack` (843-850), `exitFullscreen` (852-855).
- Getters: `chartType` (857-859), `activeZoomDuration` (869-871), `activeZoomKey` (873-877), `chartDuration` (879-881), `activeBin` (883-885), `flow` (887-893), `getBin` (694-700).
- Dygraph wrapper: `createGraph` (433-435).
- Dygraph lazy load: `Dygraph = await getDefault(import('../vendor/dygraphs.min.js'))` at 248-250.

Backend chart routes and handlers (chart side only):
- `cmd/dcrdata/internal/api/apirouter.go:185-186` — `/api/address/{address}/types/{chartgrouping}` and `/api/address/{address}/amountflow/{chartgrouping}`.
- `cmd/dcrdata/internal/api/apiroutes.go:1777-1811` (`getAddressTxTypesData`), `:1813-1846` (`getAddressTxAmountFlowData`).
- `DataSource.TxHistoryData` interface entry: `apiroutes.go:65-66`.
- Mock: `cmd/dcrdata/internal/api/noop_ds_test.go:40-42`.

Backend DB path:
- `db/dcrpg/pgblockchain.go:3112-3182` (`(*ChainDB).TxHistoryData` — cache lookup + dispatch).
- `db/dcrpg/queries.go:1909-1939` (`retrieveTxHistoryByType`), `:1946-1952` (`retrieveTxHistoryByAmountFlow`), `:4139-4164` (`parseRowsSentReceived`), `:4135-4137` (`toCoin` helper).
- `db/dcrpg/internal/addrstmts.go:312-329` (raw SQL for both kinds), `:417-425` (`MakeSelectAddressTxTypesByAddress`, `MakeSelectAddressAmountFlowByAddress`).
- Cache: `db/cache/addresscache.go:460-482` (`(*AddressCacheItem).HistoryChart`), `:854-868` (`(*AddressCache).HistoryChart`), `:1120-1166` (`StoreHistoryChart`). Cache buckets keyed by `dbtypes.HistoryChart` × `dbtypes.TimeBasedGrouping`.
- Types: `db/dbtypes/types.go:855-862` (`HistoryChart`/`TxsType`/`AmountFlow`), `:745-770` (`TimeBasedGrouping` + `TimeIntervals`), `:822-862` (`TimeBasedGroupings`/`TimeGroupingFromStr`), `:2030-2040` (`ChartsData`).

---

## 2. Backend touch points

**Chart route registration** — `cmd/dcrdata/internal/api/apirouter.go:185-186`:
```
re.With(m.ChartGroupingCtx).Get("/types/{chartgrouping}", app.getAddressTxTypesData)
re.With(m.ChartGroupingCtx).Get("/amountflow/{chartgrouping}", app.getAddressTxAmountFlowData)
```
Both inherit `m.AddressPathCtxN(1)` from the enclosing group (apirouter.go:181-198) so they accept exactly one address (rejects multi-address `,`-separated input). `m.ChartGroupingCtx` (`internal/middleware/apimiddleware.go:817+`) extracts `chartgrouping` URL segment.

There is **no `balance` route**. The "balance" chart kind is a frontend-only derivation: `address_controller.js:519` rewrites `chart === 'balance'` to URL key `amountflow` before fetching, then `amountFlowProcessor` (30-53) runs both `flow` and `balance` series from a single response.

**Handler entry points**:
- `getAddressTxTypesData` (apiroutes.go:1777) — calls `TxHistoryData(ctx, addr, dbtypes.TxsType, interval)`.
- `getAddressTxAmountFlowData` (apiroutes.go:1813) — calls `TxHistoryData(ctx, addr, dbtypes.AmountFlow, interval)`.

Both pin the address parameter at index 0 (`addresses[0]`) after the `len(addresses) > 1` reject (lines 1781-1785 / 1817-1821), translate `chartgrouping` to `dbtypes.TimeBasedGrouping` via `TimeGroupingFromStr` (1793/1828), reject `UnknownGrouping`, and pass `dbtypes.IsTimeoutErr` failures through as HTTP 503. JSON serialization is plain `writeJSON(w, data, m.GetIndentCtx(r))`.

**`TxHistoryData` signature** — `db/dcrpg/pgblockchain.go:3114-3115`:
```
func (pgb *ChainDB) TxHistoryData(ctx context.Context, address string,
    addrChart dbtypes.HistoryChart,
    chartGroupings dbtypes.TimeBasedGrouping) (cd *dbtypes.ChartsData, err error)
```
**No `CoinType` parameter.** This is the central multi-coin gap (see §6).

Call sites:
- `cmd/dcrdata/internal/api/apiroutes.go:1798` (`TxsType`), `:1833` (`AmountFlow`).
- Recursive self-call inside the `CacheLocks.bal.TryLock` busy-wait: `pgblockchain.go:3150`.

Interface declaration: `apiroutes.go:65-66` (`DataSource.TxHistoryData`).

Mock: `noop_ds_test.go:40-42` (returns `nil, nil`). Any signature change here cascades.

**`db/cache` interaction** (`db/cache/addresscache.go`):
- Pre-DB lookup at `pgblockchain.go:3128`: `pgb.AddressCache.HistoryChart(address, addrChart, chartGroupings)`. If cache hit and `validBlock != nil`, returns immediately.
- Per-address singleflight: `pgb.CacheLocks.bal.TryLock(address)` (3139). Concurrent callers wait on a channel; the winner runs the query.
- Post-query store: `pgb.AddressCache.StoreHistoryChart(...)` (3179).
- Cache shape: `AddressCacheItem.history` holds `TypeByInterval[grouping]` and `AmtFlowByInterval[grouping]` slots — two `[NumIntervals]*ChartsData` arrays per address. (`addresscache.go:471-481`, `:1156-1163`.)
- **No coin-type dimension** in the cache key. Adding per-coin data requires either a new dimension (e.g. `[NumIntervals]*ChartsData[CoinType]`) or a separate cache map.

**SQL queries** — `db/dcrpg/internal/addrstmts.go`:
- `selectAddressTxTypesByAddress` (312-321) — `COUNT(...)` of regular-tx funding/spending and `tx_type = 1/2/3` (SSTx/SSGen/SSRtx) over `addresses` rows for the given address. **Does not filter by `coin_type`** and **does not reference `ska_value`**. Counts are coin-agnostic; tickets/votes/revocations are inherently VAR-only on Decred-derived consensus, so this row is structurally a count of "all txs (mostly VAR)".
- `selectAddressAmountFlowByAddress` (323-329) — `SUM(value)` from the `addresses` table partitioned by `is_funding`. **`addresses.value` is `INT8` and stores VAR atoms only** (`addrstmts.go:21`). The `ska_value TEXT` column at line 23 exists in the schema but is **not summed** here.

**`ChartsData` struct fields populated per kind** — `db/dbtypes/types.go:2030-2040`:
```
type ChartsData struct {
    Time        []TimeDef `json:"time,omitempty"`
    SentRtx     []uint64  `json:"sentRtx,omitempty"`
    ReceivedRtx []uint64  `json:"receivedRtx,omitempty"`
    Tickets     []uint32  `json:"tickets,omitempty"`
    Votes       []uint32  `json:"votes,omitempty"`
    RevokeTx    []uint32  `json:"revokeTx,omitempty"`
    Received    []float64 `json:"received,omitempty"`
    Sent        []float64 `json:"sent,omitempty"`
    Net         []float64 `json:"net,omitempty"`
}
```
- **`types`**: populates `Time`, `SentRtx`, `ReceivedRtx`, `Tickets`, `Votes`, `RevokeTx` (queries.go:1927-1932). Counts are `uint64` / `uint32`, no atomic precision concern.
- **`amountflow`**: populates `Time`, `Received`, `Sent`, `Net` via `parseRowsSentReceived` (queries.go:4139-4163). `received`/`sent` come back as `uint64` then run through `toCoin = float64(amt) / 1e8` (queries.go:4135-4137). `Net = toCoin(received - sent)`. **Float64 boundary, hard-coded `1e-8` (VAR scale).**
- **No `Balance` field on the wire.** The frontend computes balance by integrating `amountflow` (`amountFlowProcessor` lines 30-53).

---

## 3. Per-chart-kind behavior

### 3.1 `balance`
- **Wire**: not a backend kind. `address_controller.js:519` rewrites the URL chart segment to `amountflow` before calling `/api/address/{addr}/amountflow/{bin}`.
- **Data source**: same response as `amountflow` (`Received`, `Sent`, `Net` `[]float64`).
- **Frontend transform**: `amountFlowProcessor` (30-53) walks `d.net[i]` and accumulates a running JS `Number` `balance += v` (line 42). Both flow and balance series are cached in `retrievedData` (line 540-541).
- **Coin-type assumption**: implicitly VAR-only. The accumulator is a JS `Number` and the source is float64 already lossy at the API boundary. SKA cannot pass through this without precision loss.
- **Status**: implicitly VAR-only end-to-end. The float64-everywhere assumption (`1e-8` scaling, `Number` accumulator, `digitsAfterDecimal: 8`) makes this incompatible with SKA without a parallel pipeline.

### 3.2 `types` (Tx Type)
- **Wire**: `GET /api/address/{addr}/types/{bin}` → `TxHistoryData(.., TxsType, ..)` → `retrieveTxHistoryByType` → JSON with `time`, `sentRtx`, `receivedRtx`, `tickets`, `votes`, `revokeTx`.
- **DB query**: `selectAddressTxTypesByAddress` (`addrstmts.go:312-321`) — counts only, partitioned by `tx_type`. **Not filtered by `coin_type`.**
- **Fields populated**: see §2 above.
- **Frontend transform**: `txTypesFunc` (`address_controller.js:18-28`) maps to a Dygraph 6-column row (`Date`, `sentRtx`, `receivedRtx`, `tickets`, `votes`, `revokeTx`).
- **Coin-type assumption**: tickets / votes / revocations are stake-tree primitives that exist only in VAR (per `CLAUDE.md` — SKA txs are pure value transfers, no ticket purchases). So `Tickets`/`Votes`/`RevokeTx` series are **structurally VAR-only**. `SentRtx`/`ReceivedRtx` are the only series that could meaningfully aggregate across coin types — and currently they do, silently mixing VAR and SKA tx counts when the same address holds both.
- **Status**: coin-agnostic for regular-tx counts (VAR + SKA mixed); structurally VAR-only for stake-tree counts. With the multi-coin model, when interpreting "Tx Type" for a non-VAR coin, three of the five series are always zero.

### 3.3 `amountflow` (Sent/Received)
- **Wire**: `GET /api/address/{addr}/amountflow/{bin}` → `TxHistoryData(.., AmountFlow, ..)` → `retrieveTxHistoryByAmountFlow` → `parseRowsSentReceived` → JSON with `time`, `received`, `sent`, `net`.
- **DB query**: `selectAddressAmountFlowByAddress` (`addrstmts.go:323-329`) — sums `addresses.value` partitioned by `is_funding`.
- **Fields populated**: `Time`, `Received`, `Sent`, `Net` `[]float64`.
- **Frontend transform**: `amountFlowProcessor` (30-53) emits `[Date, received, sent, netReceived, netSent]` rows (lines 41) and the parallel balance series (43).
- **Coin-type assumption**: **implicitly VAR-only** at three layers:
  1. `addresses.value INT8` is the VAR atom column; `ska_value TEXT` is ignored by the SUM.
  2. `parseRowsSentReceived` scans into `uint64`, divides by `1e8` (`toCoin`).
  3. JSON shape uses `[]float64`.
  Result: for a SKA address, the sums are 0 (no VAR rows) regardless of how many SKA atoms moved. There is no "mixed coin" failure mode for `amountflow` because it only ever reads VAR; it just silently shows all-zero for SKA.

---

## 4. Template touch points

`cmd/dcrdata/views/address.tmpl` — every Stimulus target / button / option on this card:

Container payload (read by controller `connect`):
- `address.tmpl:11` `data-controller="address newblock"` (co-mounted; `newblock` may mutate `txnCount` outside the chart card).
- `:13` `data-address-dcraddress="{{.Address}}"` — used in `fetchGraphData` URL (`/api/address/${ctrl.dcrAddress}/...`).
- `:14` `data-address-txn-count="{{$TxnCount}}"` — read in `connect()` for `paginationParams.count` (228); not used for chart logic.
- `:15` `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` — read into `ctrl.balance` (230) but **not actually used by chart code** (no usages elsewhere in the controller).

Fullscreen mount (driven by chart's `expando`):
- `:17-19` `data-address-target="fullscreen"` and inner `data-address-target="bigchart"`. `toggleExpand` (830) appends/removes `chartbox` to/from these.

Card region:
- `:113` `<div class="col-24 col-xl-13 secondary-card p-2">` — outer card.
- `:117` `data-address-target="littlechart"` — home for `chartbox` when not in fullscreen (used by `putChartBack` line 847).
- `:118` `data-address-target="chartbox"` — the movable chart subtree.
- `:120` `data-address-target="chartLoader"` — loader spinner element.

Chart-kind dropdown:
- `:123-131` `<select data-address-target="options" data-action="change->address#changeGraph">`
  - `:128` `<option name="balance" value="balance">Balance</option>`
  - `:129` `<option name="types" value="types">Tx Type</option>`
  - `:130` `<option name="amountflow" value="amountflow">Sent/Received</option>`
- `<option value>` strings double as TurboQuery `chart=` values **and** must match the URL-segment derivation logic at `address_controller.js:519` (`chart === 'balance' ? 'amountflow' : chart`) and the route registrations at `apirouter.go:185-186`. Adding/renaming any value requires touching all three.
- The `name` attribute is read by `validChartType` via `optionsTarget.namedItem(chart)` (`address_controller.js:598`).

Zoom buttons:
- `:133-145` `<div data-address-target="zoom" data-action="click->address#onZoom">` + label "Zoom".
- Buttons by `name`: `all` (`data-fixed="1"`, default `btn-selected`), `year`, `month`, `week`, `day`. These names key into `zoomMap` in `helpers/zoom_helper.js:4-10`.

Group-By buttons:
- `:146-159` `<div data-address-target="interval" data-action="click->address#changeBin">` with `data-txcount="{{$TxnCount}}"` (`:149`) — note: `data-txcount` is **decorative HTML only**; no JS reads it (group-by visibility comes from `setButtonVisibility` based on `chartDuration` vs `Zoom.mapValue(button.name)`).
- Buttons by `name`: `year`, `month` (default `btn-selected`), `week`, `day` (`data-fixed="1"`), `all` (label "Block", `data-fixed="1"`). Note the **label / value mismatch on the last button**: text is "Block", value is `all`. The `bin` URL value can be `all` and means "Block" axis.

Flow checkboxes (only relevant for `amountflow`):
- `:160-174` `<div data-address-target="flow" data-action="change->address#updateFlow">` — initially `d-hide`-friendly (Bootstrap `d-hide` toggled by `popChartCache`).
- Checkbox values are bitmask flags: `Sent=2`, `Received=1` (default checked), `Net=4`. Encoded as a base-10 bitmap in URL (`?flow=`).
- `updateFlow` (line 639) maps the bitmap to Dygraph series visibility for indices 0/1/2/3.

Chart canvas + loader:
- `:176-180` chart wrapper div with the `address_chart` class.
  - `:177` `data-address-target="expando"` (fullscreen toggle, `monicon-expand` class).
  - `:178` `data-address-target="noconfirms"` (no-data placeholder).
  - `:179` `data-address-target="chart"` — Dygraph mount point.

Hard-coded labels on this card / its options:
- `:122` `<label>Chart</label>`.
- `:128` `Balance`, `:129` `Tx Type`, `:130` `Sent/Received` — coin-agnostic strings; no `DCR`/`VAR` tokens.
- `:139` `<label>Zoom</label>`.
- `:153` `<label>Group By </label>`.
- `:158` button label `Block` (vs `name="all"`).
- `:162-173` checkbox labels `Sent` / `Received` / `Net`.
- **No coin labels in the template.** Coin labels live in the controller (next section).

Currency labels in the *summary* card (out of scope but easy to confuse): `:48`, `:50`, `:64`, `:66`, `:77`, `:79` all hard-code `DCR`. The chart card itself has no `DCR`/`VAR` tokens.

---

## 5. Frontend touch points (URL contract + zoom)

**TurboQuery null-template (must declare every persisted key)** — `address_controller.js:211-219`:
```
ctrl.settings = TurboQuery.nullTemplate([
  'chart', 'zoom', 'bin', 'flow', 'n', 'start', 'txntype'
])
```
This card owns `chart`, `zoom`, `bin`, `flow`. (`n`, `start`, `txntype` belong to the table.) New URL keys (e.g. `coin`) require a new entry here per the rule in `flow.compact.md` mutation checklist.

**URL key flow (UI → settings → URL → fetch)**:

| Key      | UI source                                                      | Settings write                             | URL emit                              | Fetch use                                                                         |
|----------|----------------------------------------------------------------|--------------------------------------------|---------------------------------------|-----------------------------------------------------------------------------------|
| `chart`  | `<select data-address-target="options">` change                | `changeGraph` (620) → `settings.chart = chartType` | `setGraphQuery` → `query.replace(settings)` (635) | `fetchGraphData` (519): `chart === 'balance' ? 'amountflow' : chart`             |
| `bin`    | `<button>` click in `interval` set                              | `changeBin` (626): `settings.bin = target.name`   | `setGraphQuery` → `query.replace`     | `fetchGraphData` (520): `/api/address/${addr}/${chartKey}/${bin}`                |
| `zoom`   | `onZoom` button (666), `_zoomCallback` Dygraph drag (749), `_drawCallback` Dygraph slide (738) | `setZoom` (683) writes `settings.zoom = Zoom.encode(start, end)`; callbacks at 744 / 753 do the same | `query.replace(settings)` (690 / 745 / 754) | `drawGraph` short-circuit (482-488): if only zoom changed, decode and re-apply without refetch |
| `flow`   | `<input type=checkbox>` change in `flow`                       | `updateFlow` (639): `settings.flow = bitmap` (646) | `setGraphQuery` (647)                 | not used in fetch URL; consumed only by `setFlowChecks`/`updateFlow` for visibility bitmap |

**Initial load** (`connect()`): `query.update(settings)` (233) populates from URL; `setChartType()` (234) syncs `<select>`; `setFlowChecks()` (235) syncs flow checkboxes; if `bin == null`, `getBin()` (242) reads `bin` from URL again or falls back to `activeBin` (the currently-selected interval button, default `month`).

**Validation**:
- `validChartType` (597-599) — `optionsTarget.namedItem(chart)`. Treats the option `name` attribute as the validity oracle. URL `chart` outside the three known names is silently overridden to `ctrl.chartType` (244-246).
- `validGraphInterval` (601-608) — looks for a button with `name === bin`. Unknown `bin` falls back through `getBin()` → `activeBin` → default `month`.
- `validateZoom` (610-618) — `Zoom.validate(activeZoomKey || settings.zoom, ctrl.xRange, binSize)`. **Clamps silently** to the new chart's `xRange` (no error). This is what hides the stale-zoom failure mode.

**Stale-`?zoom=` failure mode** (per `flow.full.md §6`):
- `changeGraph` (620-624) writes the new `chart` to settings then calls `setGraphQuery` → `query.replace(this.settings)` **without resetting `settings.zoom`**.
- Same in `changeBin` (626-633).
- Result: when switching from a long-history chart kind to a shorter one, `?zoom=` in the URL still encodes the prior chart's window; on the next refresh, `validateZoom` clamps it silently to the new range. The user sees a "different" zoom than they last set.
- Decision: any change to `setGraphQuery` (635) or to `changeGraph`/`changeBin` must explicitly choose **drop / project / keep** for `settings.zoom`. The `charts_controller.js` (charts page) calls `Zoom.project(...)` for this; the address controller does not.

**Group-by visibility** — `setButtonVisibility` (758-772) hides bins coarser than the current `chartDuration` (`xRange[1] - xRange[0]`) **per data range, not per tx count**. The `data-fixed="1"` attribute on `all` zoom and on `day` / `all` (Block) interval buttons exempts them. The `data-txcount="{{$TxnCount}}"` on `interval` (`address.tmpl:149`) is unread (template residue).

**Cache** — `ctrl.retrievedData` (196) keyed by `${chart}-${bin}` (497). `popChartCache` (548) replays cached data without re-fetching when both keys match. Note the `processData` quirk at 538-542: an `amountflow` fetch fills both `amountflow-${bin}` and `balance-${bin}` cache entries, but a separate `balance` request still hits the URL on first switch.

---

## 6. Multi-coin gaps

The most important section. Each gap is a precise file:line where the current pipeline assumes coin-agnostic-aggregating or single-coin-VAR.

### 6.1 No `CoinType` parameter on chart endpoints

- **Route**: `cmd/dcrdata/internal/api/apirouter.go:185-186` — only `{address}` and `{chartgrouping}` URL params; no coin-type segment.
- **Handler**: `apiroutes.go:1798`, `:1833` — both call `TxHistoryData(ctx, address, dbtypes.TxsType, interval)` / `(.., AmountFlow, ..)` without coin type.
- **DB layer signature**: `db/dcrpg/pgblockchain.go:3114-3115` — no `CoinType` argument.
- **Cache key**: `db/cache/addresscache.go:471-481`, `:1156-1163` — keyed by (address, `HistoryChart`, `TimeBasedGrouping`); no coin-type dimension.
- **Mock**: `cmd/dcrdata/internal/api/noop_ds_test.go:40-42` — must be updated together with the interface (`apiroutes.go:65-66`).
- **Frontend URL builder**: `address_controller.js:519-521` — emits `/api/address/${addr}/${chartKey}/${bin}`; no coin segment.

### 6.2 Float64 / `1e-8` precision on `amountflow`

- **`parseRowsSentReceived`** at `db/dcrpg/queries.go:4139-4163`:
  - Line 4144 — `var received, sent uint64` (overflows for SKA atoms).
  - Line 4151-4157 — `items.Received = append(.., toCoin(received))`, `items.Sent = .., items.Net = toCoin(received-sent)`.
  - `toCoin` (queries.go:4135-4137): `float64(amt) / 1e8` — VAR scale only.
- **JSON shape**: `db/dbtypes/types.go:2037-2039` — `Received`, `Sent`, `Net` are `[]float64`.
- **Frontend**: `address_controller.js:30-53` (`amountFlowProcessor`) — accumulates `balance` via `+=` on JS `Number`; `digitsAfterDecimal: 8` on Dygraph (commonOptions, line 101); legend format `${series.y} DCR` (line 84).
- **Schema source**: `db/dcrpg/internal/addrstmts.go:21,23` — `value INT8` (VAR atoms) is what `selectAddressAmountFlowByAddress` sums; `ska_value TEXT` is ignored.

### 6.3 Hard-coded `DCR` / VAR-implying labels in chart options

Within the chart card and its controller (template currency labels in the summary card are out of scope here):
- `address_controller.js:84` — `customizedFormatter` legend: `${series.y} DCR`. Used by `amountFlowGraphOptions` (line 132) and `balanceGraphOptions` (line 142).
- `address_controller.js:130` — `amountFlowGraphOptions.ylabel = 'Total (DCR)'`.
- `address_controller.js:140` — `balanceGraphOptions.ylabel = 'Balance (DCR)'`.
- `address_controller.js:120` — `typesGraphOptions.ylabel = 'Tx Count'` (no coin label; OK).
- **No use of `helpers/ska_helper.js`** anywhere in `address_controller.js`. `renderCoinType`, `splitSkaAtoms`, `splitSkaAtomsNoTrailing` are unused on this surface.

### 6.4 Implicit aggregation across coins

- `selectAddressTxTypesByAddress` (`db/dcrpg/internal/addrstmts.go:312-321`) does not filter by `coin_type`; counts mix VAR and SKA regular-tx rows. Tickets/votes/revocations are inherently VAR-only on consensus, so they remain VAR-only in aggregate but the regular-tx counts silently mix.
- `selectAddressAmountFlowByAddress` (323-329) sums only `value` (VAR). It is *not* aggregating across coins; it is **silently dropping all SKA**. This is a different gap shape from `types`.

### 6.5 `data-address-balance` is VAR-only

- `address.tmpl:15` `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` (lossy for SKA per `flow.compact.md C1` violation note).
- Read into `ctrl.balance` (`address_controller.js:230`) but currently unused by chart logic — still a hidden contract that breaks if `AddressInfo.Balance` becomes per-coin.

### 6.6 `flow` bitmap is single-coin-aware only

- The flow checkboxes (`address.tmpl:160-174`, controller `updateFlow` 639) toggle Dygraph series visibility on a single dataset. There is no per-coin filtering concept; if the response carried multiple coin series, the bitmap couldn't address them.

---

## 7. Mirror pattern: SKA coin-supply

Reference: `wiki/code-analysis/charts/flow.compact.md` and `flow.full.md`. Summary of the precedent for adding per-coin chart endpoints, and what would map vs. diverge.

**Reuses** (the address charts can adopt directly):
- **URL prefix namespace**. `coin-supply/{N}` (1≤N≤255) is parsed by `db/cache/charts.go:92-109` (`IsSKASupplyChart`, `SkaCoinType`) and JS `skaCoinTypeFromChart` (`charts_controller.js:60`). An address-chart equivalent could mirror this with e.g. `/api/address/{addr}/amountflow/{N}/{bin}` or `?coin=N` (see open questions §9).
- **String-only SKA pipeline**. SQL `::text` → Go `[]string` + `*big.Int.Add` → JSON `"supply": []string` → JS `Number(s) * 1e-18` for the line, `splitSkaAtomsNoTrailing` for the legend (`charts_controller.js:661-687`). The address `amountflow` SKA equivalent must adopt the same string discipline (do not reuse `parseRowsSentReceived`'s `uint64` + `toCoin` path).
- **`ActiveSKATypes` projection from `HomeInfo.SKACoinSupply`**. `cmd/dcrdata/internal/explorer/explorerroutes.go:1911-1932` populates `ActiveSKATypes []uint8` for the charts page. `AddressPage` (`explorerroutes.go:1534-1651`) does **not** currently project this; adding a coin selector would require it (or a per-address active-coin set, which is a different question).
- **`renderCoinType(coinType)` for labels** (`ska_helper.js:16`). Replaces hard-coded `DCR` / `VAR` in the controller.
- **`Zoom.project` across data-range changes** (`charts_controller.js` line 901, per `flow.full.md`). The address controller does not currently call this; adopting it would resolve the stale-zoom failure mode at the same time.
- **Mock co-update pattern**. `noop_ds_test.go:131` is the SKA precedent for keeping an interface-method mock in sync.

**Divergences** expected for address charts:
- The coin-supply pipeline is **per-coin-type** at the chart level (one chart, one coin). `amountflow` for an address could be **per-coin** or **per-coin-stacked** or **per-coin-line** — that's a UX choice (§9). Either way the *backend* signature change is the same: add `coinType uint8` to `TxHistoryData` and pass through to a coin-aware SQL query.
- **Cache shape diverges**. Coin-supply uses a single `ChartData.SKASupply[uint8]SKASupplyChartData` keyed only by coin type. The address cache is keyed by `(address, HistoryChart, TimeBasedGrouping)`; adding coin type produces a 4-tuple key. The cache data structure (`AddressCacheItem.history`) needs a per-coin slice or per-coin map; not a drop-in.
- **Cumulative-vs-per-block invariants don't carry over**. SKA coin supply is cumulative per-height; address `amountflow` is per-bin (delta) with the cumulative balance computed client-side in `amountFlowProcessor`. There is **no equivalent of the "`accumulate()` for VAR / pre-cumulated for SKA" split**; both flow charts on the address page are per-bin deltas. **However**: the `balance` derived chart is a JS-side cumulative sum (`address_controller.js:42`), and that's where SKA precision will silently break — running `balance += BigDecimalString` requires `BigInt` in JS or string-arith helpers, mirroring the lesson from `splitSkaAtomsNoTrailing`.
- **`h` field convention** for time-axis SKA responses (`charts/flow.full.md §4`) does not naturally apply: `ChartsData` uses `time` only, no block height. If the new endpoint is height-aligned (e.g., per-block bin), include `h` for parity; otherwise drop it.
- **`coin-supply/0` legacy duality** is not relevant — there's no existing bare `amountflow` route to deprecate; the `/api/address/{addr}/amountflow/{bin}` route can either stay as VAR-only or adopt a `0` / default-coin convention.

---

## 8. Cross-surface dependencies

**Summary card** (`address.tmpl:21-112`, out of scope but adjacent):
- Container attributes shared with this card via the same `data-controller="address"` element:
  - `data-address-balance` (`:15`) — read by controller (`:230`) but not used in chart code today.
  - `data-address-txn-count` (`:14`) — read at `connect():228` for table pagination, also stamped on `txnCount` target in the table footer (`:192`).
- The summary card uses `toFloat64Amount` / `amountAsDecimalParts` for `Balance.TotalUnspent`/`TotalSpent` (`:48,50,64,66,77,79`). When the address page goes multi-coin, both surfaces must change together — but the chart card itself doesn't read these template fields.

**Transactions table** (`address.tmpl:185-297`):
- Independent state machine; no zoom/chart dependency.
- One subtle dependency: `data-txcount="{{$TxnCount}}"` on the chart card's `interval` set (`:149`) is the same `$TxnCount` shown on the table's `txnCount` target (`:192`). The chart card attribute is currently dead HTML in JS, but it is wired to the same template value, so renaming `TxnCount` propagates to both.
- `newblock` co-controller (mounted on the same root, `:11`) increments `txnCount.dataset.txnCount` on `BLOCK_RECEIVED`. This affects only the table-side count; the chart card's `data-txcount` is set once at template render and not updated.

**Co-mounted controllers**:
- `data-controller="address newblock"` — `newblock` is unrelated to the chart card directly, but mutating shared `txnCount` DOM means any chart-card refactor that introduces new shared state must avoid stomping on this surface.

**Fullscreen DOM movement**:
- The `chartbox` subtree is moved between `littlechart` (in-card, `address.tmpl:117`) and `bigchart` (top-of-page, `:18`) by `toggleExpand` (830) / `putChartBack` (843). Any DOM identity assumptions across the chart card must survive being detached and re-attached.

---

## 9. Open product/UX questions

These are decisions a spec author cannot answer from the code alone. Ordered roughly by blast radius.

1. **Per-coin lines on one chart, separate chart per coin, or coin selector?**
   - One stacked Dygraph with N series — easy to retrofit `amountflow`/`balance`, hard to label legend (`splitSkaAtomsNoTrailing` per series), bad UX with mixed-magnitude coins (one VAR series at 1e8 + one SKA series at 1e18).
   - Selector dropdown (mirroring `coin-supply/{N}`) — clean precedent, but doubles fetches for users comparing coins.
   - Always-stacked + a "show coins" multi-select — heaviest, but most consistent with the chart card's existing flow checkbox pattern.

2. **Should `types` be VAR-only by definition?** Tickets/votes/revocations are stake-tree primitives that don't exist for SKA. Options:
   - Hide the `Tx Type` chart for non-VAR coin selection.
   - Show only `SentRtx` / `ReceivedRtx` series (reduce to a 2-series chart).
   - Show all 5 with the stake series always-zero (current implicit behavior, just made explicit per coin).

3. **What does `amountflow` look like for an address that holds both VAR and SKA?**
   - "All coins" aggregated is meaningless (different scales).
   - Default-to-VAR with a coin selector is the most direct port of the coin-supply pattern.
   - Default-to-the-address's-primary-coin (whatever that means) requires a backend "primary coin" inference.

4. **Should `?coin=` join the URL contract?** Mirroring `coin-supply/{N}` would put the coin in the path: `/api/address/{addr}/amountflow/{N}/{bin}`. Mirroring the existing flow bitmap pattern would put it in the query: `?coin=1`. The latter is cheaper (no router change) but breaks the precedent set by `apirouter.go:240-243`.

5. **Where does the `balance` chart get its precision from?**
   - The current JS-side accumulator (`balance += v`) on float64 is already lossy for very large VAR addresses (the `1e-8` `toCoin` already burned precision before JS). For SKA it's catastrophic.
   - Options: server-side cumulative sum returned alongside `flow` (one extra column on the `amountflow` JSON), or client-side `BigInt`-based accumulator on the raw atom strings.

6. **Should `data-address-balance` (`address.tmpl:15`) become per-coin?** Currently dead-but-wired to `ctrl.balance`. If multi-coin, a `data-address-balances='{"0":"...","1":"...","2":"..."}'` JSON-stringified attribute is one path; another is to drop the attribute and have the chart card read balances from a server-side payload.

7. **Stale-`?zoom=` fix concurrent with multi-coin work?** The bugfix branch `bugfix/stale-zoom-param` and a multi-coin chart refactor will both touch `setGraphQuery` / `changeGraph` / `changeBin`. Decide order: a per-coin URL param will inevitably re-enter `setGraphQuery`, so it's natural to fix the stale-zoom invariant in the same pass (drop or `Zoom.project` `settings.zoom` on chart-kind change).

8. **Does the chart card need an `ActiveSKATypes` projection?** The `Charts` page (`/charts`) does this from `HomeInfo.SKACoinSupply`. For an address, the more useful projection is "which coin types has *this address* ever held," which requires a new DB query (`SELECT DISTINCT coin_type FROM addresses WHERE address=$1`). Project-wide vs. per-address coin lists is a meaningful UX difference.

9. **Should the Tx Type chart distinguish VAR-vs-SKA regular txs?** A 7-series chart (`SentRtx-VAR`, `ReceivedRtx-VAR`, `SentRtx-SKA`, `ReceivedRtx-SKA`, `Tickets`, `Votes`, `Revocations`) is one option. A coin-segmented dropdown is another. A per-coin-type version of the existing 5-series chart is a third.

---

### See also

- `wiki/code-analysis/address/flow.compact.md` — TurboQuery URL ownership; stale-zoom failure mode summary.
- `wiki/code-analysis/address/flow.full.md` — detailed per-layer breakdown that this note builds on.
- `wiki/code-analysis/charts/flow.compact.md` and `flow.full.md` — `coin-supply/{N}` precedent for per-coin chart endpoints; SKA string-pipeline rules; `Zoom.project` pattern.
- `wiki/core/constraints.md#C1` — numeric precision & bifurcation (currently violated on the chart card's `amountflow`/`balance` paths via `parseRowsSentReceived`'s `uint64` + `toCoin`).
- `wiki/core/constraints.md#C7` — centralized coin-type label rendering (`renderCoinType`); currently *not* applied on this surface (`DCR`-string in `customizedFormatter` and ylabels).
