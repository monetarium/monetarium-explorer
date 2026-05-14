### Mutation Impact: Address Page Charts Card

Change-surface reference for the right-top "charts" card on `/address/{address}`. Companion to `wiki/code-analysis/address/flow.compact.md` and `flow.full.md`; covers only the chart UI, its API endpoints, the DB query path, and URL state. Summary card and transactions table are out of scope.

## TL;DR

The chart endpoints are now per-coin: `TxHistoryData(... coinType uint8)` flows from route → handler → DB → cache, with `?coin=N` parsed by `m.CoinCtx` middleware on `/api/address/{addr}/{types|amountflow}/{chartgrouping}`. Cache key includes coin type. `ChartsData` ships parallel `BalanceAtoms`/`ReceivedAtoms`/`SentAtoms`/`NetAtoms` SKA-string series alongside the existing VAR float series, and `parseRowsSentReceived` populates both via `*big.Int`. The SKA precision bug in `selectAddressAmountFlowByAddress` (formerly summing `addresses.value INT8` for SKA, truncating 1e18-scale atoms to ~zero) was **fixed in PR #263 (commit `49953185`)**: the SQL now also emits `COALESCE(SUM(NULLIF(ska_value,'')::numeric), 0)::text` columns and `parseRowsSentReceived` scans them as strings for `coinType > 0`. SKA `amountflow`/`balance` series are now correct end-to-end on the backend. The frontend has not adopted any of the new fields: `address_controller.js` does not declare `coin` in its TurboQuery null-template, does not append `?coin=` to chart URLs, and `amountFlowProcessor` (line 30-53) still integrates `d.net[i]` as a float64 JS `Number`. Legend/ylabels still say `DCR`.

---

## 1. Scope

Template region (the right-top card):
- [cmd/dcrdata/views/address.tmpl:113-183](cmd/dcrdata/views/address.tmpl#L113-L183) — the `<div class="col-24 col-xl-13 secondary-card p-2">` block.
  - Fullscreen mount: `address.tmpl:17-19` (`fullscreen` + `bigchart` targets) — outside the card but driven by `toggleExpand` on the card's `expando`.
  - Container `data-controller="address newblock"` and the per-page payload attributes are at `address.tmpl:10-16` (read by `connect()`).

Frontend controller sections ([cmd/dcrdata/public/js/controllers/address_controller.js](cmd/dcrdata/public/js/controllers/address_controller.js)):
- Module-level chart helpers: `txTypesFunc` (18-28), `amountFlowProcessor` (30-53), `formatter` / `customizedFormatter` (55-87), `createOptions` / `commonOptions` / `typesGraphOptions` / `amountFlowGraphOptions` / `balanceGraphOptions` (97-148).
- Targets used on this card: `options`, `flow`, `zoom`, `interval`, `chartbox`, `noconfirms`, `chart`, `chartLoader`, `expando`, `littlechart`, `bigchart`, `fullscreen` (declared in the `targets` list at 153-191).
- Lifecycle: `connect` (194-254), `disconnect` (256-262), `bindElements` (274-282), `initializeChart` (265-272).
- Chart state machine: `drawGraph` (473-494), `fetchGraphData` (496-527), `processData` (529-546), `popChartCache` (548-589), `noDataAvailable` (591-595).
- Validation/state writes: `validChartType` (597-599), `validGraphInterval` (601-608), `validateZoom` (610-618), `setChartType` (721-726), `setIntervalButton` (702-709), `setSelectedZoom` (728-736), `setButtonVisibility` (758-772).
- UI event handlers: `changeGraph` (620-624), `changeBin` (626-633), `setGraphQuery` (635-637), `updateFlow` (639-657), `setFlowChecks` (659-664), `onZoom` (666-681), `setZoom` (683-692), Dygraph callbacks `_drawCallback` (738-747) and `_zoomCallback` (749-756), fullscreen `toggleExpand` (830-841), `putChartBack` (843-850), `exitFullscreen` (852-855).
- Getters: `chartType` (857-859), `activeZoomDuration` (869-871), `activeZoomKey` (873-877), `chartDuration` (879-881), `activeBin` (883-885), `flow` (887-893), `getBin` (694-700).
- Dygraph wrapper: `createGraph` (433-435).
- Dygraph lazy load: `Dygraph = await getDefault(import('../vendor/dygraphs.min.js'))` at 248-250.

Backend chart routes and handlers:
- [cmd/dcrdata/internal/api/apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186) — routes wrapped with `m.ChartGroupingCtx, m.CoinCtx`:
  - `/api/address/{address}/types/{chartgrouping}`
  - `/api/address/{address}/amountflow/{chartgrouping}`
- [cmd/dcrdata/internal/api/apiroutes.go:1827-1862](cmd/dcrdata/internal/api/apiroutes.go#L1827-L1862) — `getAddressTxTypesData`. Reads `coinType := m.GetCoinCtx(r)` (1848), calls `TxHistoryData(ctx, address, dbtypes.TxsType, interval, coinType)`.
- [cmd/dcrdata/internal/api/apiroutes.go:1864-1896](cmd/dcrdata/internal/api/apiroutes.go#L1864-L1896) — `getAddressTxAmountFlowData`. Same shape with `dbtypes.AmountFlow`.
- DataSource interface: [cmd/dcrdata/internal/api/apiroutes.go:64-66](cmd/dcrdata/internal/api/apiroutes.go#L64-L66) — `TxHistoryData(... coinType uint8)`.
- Mocks: [noop_ds_test.go:40](cmd/dcrdata/internal/api/noop_ds_test.go#L40), [apiroutes_test.go:359](cmd/dcrdata/internal/api/apiroutes_test.go#L359).

Backend DB path:
- [db/dcrpg/pgblockchain.go:3323-3397](db/dcrpg/pgblockchain.go#L3323-L3397) (`(*ChainDB).TxHistoryData(... coinType uint8)`).
- [db/dcrpg/queries.go:2054-2089](db/dcrpg/queries.go#L2054-L2089) (`retrieveTxHistoryByType(... coinType uint8)`).
- [db/dcrpg/queries.go:2091-2102](db/dcrpg/queries.go#L2091-L2102) (`retrieveTxHistoryByAmountFlow(... coinType uint8)`).
- [db/dcrpg/queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331) (`parseRowsSentReceived(rows, coinType uint8)`).
- [db/dcrpg/internal/addrstmts.go:338-359](db/dcrpg/internal/addrstmts.go#L338-L359) (`selectAddressTxTypesByAddress` and `selectAddressAmountFlowByAddress` — both filter `WHERE address=$1 AND coin_type=$2 AND valid_mainchain`).
- Cache: [db/cache/addresscache.go:378-379](db/cache/addresscache.go#L378-L379) (`TxHistory{TypeByInterval [NumIntervals]map[uint8]*ChartsData, AmtFlowByInterval [NumIntervals]map[uint8]*ChartsData}`); accessor [`HistoryChart(... coinType uint8)`:461,866](db/cache/addresscache.go#L461); writer [`StoreHistoryChart(... coinType uint8, ...)`:1143](db/cache/addresscache.go#L1143).
- Types: [db/dbtypes/types.go:855+](db/dbtypes/types.go) (`HistoryChart`/`TxsType`/`AmountFlow`), 745+ (`TimeBasedGrouping` + `TimeIntervals`), 822+ (`TimeBasedGroupings`/`TimeGroupingFromStr`), [2041-2057](db/dbtypes/types.go#L2041-L2057) (`ChartsData` with new `*Atoms` SKA fields).

---

## 2. Backend touch points

**Chart route registration** — [cmd/dcrdata/internal/api/apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186):
```
re.With(m.ChartGroupingCtx, m.CoinCtx).Get("/types/{chartgrouping}", app.getAddressTxTypesData)
re.With(m.ChartGroupingCtx, m.CoinCtx).Get("/amountflow/{chartgrouping}", app.getAddressTxAmountFlowData)
```
Both inherit `m.AddressPathCtxN(1)` from the enclosing group (apirouter.go:181-198) so they accept exactly one address (rejects multi-address `,`-separated input). `m.ChartGroupingCtx` ([apimiddleware.go:810](cmd/dcrdata/internal/middleware/apimiddleware.go#L810)) extracts the `chartgrouping` URL segment. `m.CoinCtx` ([apimiddleware.go:818-842](cmd/dcrdata/internal/middleware/apimiddleware.go#L818-L842)) parses `?coin=N` (1-255) into the request context; missing/invalid → `dbtypes.CoinTypeAll = 255`.

There is **no `balance` route**. The "balance" chart kind is a frontend-only derivation: `address_controller.js:519` rewrites `chart === 'balance'` to URL key `amountflow` before fetching, then `amountFlowProcessor` (30-53) runs both `flow` and `balance` series from a single response.

**Handler entry points**:
- `getAddressTxTypesData` ([apiroutes.go:1827](cmd/dcrdata/internal/api/apiroutes.go#L1827)) — calls `TxHistoryData(ctx, addr, dbtypes.TxsType, interval, coinType)`.
- `getAddressTxAmountFlowData` ([apiroutes.go:1864](cmd/dcrdata/internal/api/apiroutes.go#L1864)) — calls `TxHistoryData(ctx, addr, dbtypes.AmountFlow, interval, coinType)`.

Both pin the address parameter at index 0 (`addresses[0]`) after the `len(addresses) > 1` reject, translate `chartgrouping` to `dbtypes.TimeBasedGrouping` via `TimeGroupingFromStr`, reject `UnknownGrouping`, and pass `dbtypes.IsTimeoutErr` failures through as HTTP 503. JSON serialization is plain `writeJSON(w, data, m.GetIndentCtx(r))`.

**`TxHistoryData` signature** — [db/dcrpg/pgblockchain.go:3325-3326](db/dcrpg/pgblockchain.go#L3325-L3326):
```
func (pgb *ChainDB) TxHistoryData(ctx context.Context, address string,
    addrChart dbtypes.HistoryChart,
    chartGroupings dbtypes.TimeBasedGrouping, coinType uint8) (cd *dbtypes.ChartsData, err error)
```

**`CoinTypeAll → 0` collapse**: at the top of `TxHistoryData` (3327-3330):
```
if coinType == dbtypes.CoinTypeAll {
    coinType = 0
}
```
This is a chart-specific semantic: `255` ("no filter") is not meaningful for charts, so the default coin (VAR) is used. Different from table/CSV pipelines where `255` means "all coins".

**`db/cache` interaction** ([db/cache/addresscache.go](db/cache/addresscache.go)):
- Pre-DB lookup at `pgblockchain.go:3343`: `pgb.AddressCache.HistoryChart(address, addrChart, chartGroupings, coinType)`. If cache hit and `validBlock != nil`, returns immediately.
- Per-address singleflight: `pgb.CacheLocks.bal.TryLock(address)` (3354). Concurrent callers wait on a channel; the winner runs the query.
- Post-query store: `pgb.AddressCache.StoreHistoryChart(...)` (3394) keyed by `(address, HistoryChart, TimeBasedGrouping, coinType)`.
- Cache shape: `AddressCacheItem.history` holds `TypeByInterval[grouping]` and `AmtFlowByInterval[grouping]` slots — two `[NumIntervals]map[uint8]*ChartsData` arrays per address (the inner map is keyed by `coinType`). [addresscache.go:378-379](db/cache/addresscache.go#L378-L379).
- **Cache key now includes coin type** — different `?coin=` values cache independently. Cache invalidation (`FreshenAddressCaches`) is still per-address (whole address, all coins together).

**SQL queries** — [db/dcrpg/internal/addrstmts.go](db/dcrpg/internal/addrstmts.go):
- `selectAddressTxTypesByAddress` (338-347) — `COUNT(...)` of regular-tx funding/spending and `tx_type = 1/2/3` (SSTx/SSGen/SSRtx) over `addresses` rows for the given address. **Filters by `coin_type=$2`**. Counts are coin-agnostic by nature; tickets/votes/revocations are inherently VAR-only on consensus, so the `Tickets/Votes/RevokeTx` series are zero for `coinType > 0`.
- `selectAddressAmountFlowByAddress` (348-359) — partitioned `SUM`s from the `addresses` table. **Filters by `coin_type=$2`**. Emits **four** columns (PR #263): VAR `received`/`sent` from `value INT8` guarded by `coin_type = 0`, plus SKA `received_ska`/`sent_ska` from `COALESCE(SUM(NULLIF(ska_value,'')::numeric), 0)::text` guarded by `coin_type > 0`. The `CASE` guards are belt-and-braces — the `WHERE coin_type=$2` filter already restricts rows to one coin family, so the other pair sums to zero.

**`ChartsData` struct** — [db/dbtypes/types.go:2041-2057](db/dbtypes/types.go#L2041-L2057):
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
    // Per-coin running balances (computed server-side via *big.Int for SKA)
    Balance       []float64 `json:"balance,omitempty"`       // VAR running balance (float64, 8 decimals)
    BalanceAtoms  []string  `json:"balance_atoms,omitempty"` // SKA running balance (string, 18 decimals)
    ReceivedAtoms []string  `json:"received_atoms,omitempty"`
    SentAtoms     []string  `json:"sent_atoms,omitempty"`
    NetAtoms      []string  `json:"net_atoms,omitempty"`
}
```
- **`types`**: populates `Time`, `SentRtx`, `ReceivedRtx`, `Tickets`, `Votes`, `RevokeTx` ([queries.go:2067-2089](db/dcrpg/queries.go#L2067-L2089)). Counts are `uint64` / `uint32`, no atomic precision concern — but stake counts are zero for non-VAR coins.
- **`amountflow`**: populates `Time`, `Received`, `Sent`, `Net`, `Balance` (VAR float64 fields) AND `ReceivedAtoms`, `SentAtoms`, `NetAtoms`, `BalanceAtoms` (SKA string fields) via `parseRowsSentReceived` ([queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331)). Server-side cumulative balance computed via running `int64` (VAR) or `*big.Int` (SKA) — frontend doesn't have to integrate.

---

## 3. Per-chart-kind behavior

### 3.1 `balance`
- **Wire**: not a backend kind. `address_controller.js:519` rewrites the URL chart segment to `amountflow` before calling `/api/address/{addr}/amountflow/{bin}`.
- **Data source**: same response as `amountflow` (now includes `Balance []float64` and `BalanceAtoms []string` server-side).
- **Frontend transform**: `amountFlowProcessor` (30-53) walks `d.net[i]` and accumulates a running JS `Number` `balance += v` (line 42). **Ignores `d.balance`/`d.balance_atoms` from the server.** Both flow and balance series are cached in `retrievedData` (line 540-541).
- **Coin-type assumption**: implicitly VAR-only on the frontend. The accumulator is a JS `Number` and the source is `d.net[i]` (float64, already lossy at the API boundary for VAR). For SKA: backend produces `BalanceAtoms` (correct), but the frontend never reads it, so the chart line uses the broken `d.net[i]` SKA values (see §6).
- **Status**: backend can produce a precise SKA balance series; frontend does not consume it.

### 3.2 `types` (Tx Type)
- **Wire**: `GET /api/address/{addr}/types/{bin}?coin=N` → `TxHistoryData(.., TxsType, .., coinType)` → `retrieveTxHistoryByType` → JSON with `time`, `sentRtx`, `receivedRtx`, `tickets`, `votes`, `revokeTx`.
- **DB query**: `selectAddressTxTypesByAddress` ([addrstmts.go:338-347](db/dcrpg/internal/addrstmts.go#L338-L347)) — counts only, partitioned by `tx_type`, **filtered by `coin_type=$2`**.
- **Fields populated**: see §2 above.
- **Frontend transform**: `txTypesFunc` (`address_controller.js:18-28`) maps to a Dygraph 6-column row (`Date`, `sentRtx`, `receivedRtx`, `tickets`, `votes`, `revokeTx`).
- **Coin-type assumption**: tickets / votes / revocations are stake-tree primitives that exist only in VAR. So `Tickets`/`Votes`/`RevokeTx` series are **structurally VAR-only**. For `coinType > 0` they are always zero. Now that the SQL filters by coin, `SentRtx`/`ReceivedRtx` no longer mix VAR/SKA — they show only the selected coin's regular-tx counts.
- **Status**: per-coin counts are correct; the frontend has no way to set `?coin=` today.

### 3.3 `amountflow` (Sent/Received)
- **Wire**: `GET /api/address/{addr}/amountflow/{bin}?coin=N` → `TxHistoryData(.., AmountFlow, .., coinType)` → `retrieveTxHistoryByAmountFlow` → `parseRowsSentReceived` → JSON with `time`, `received`, `sent`, `net`, `balance`, `received_atoms`, `sent_atoms`, `net_atoms`, `balance_atoms`.
- **DB query**: `selectAddressAmountFlowByAddress` ([addrstmts.go:348-359](db/dcrpg/internal/addrstmts.go#L348-L359)) — partitioned `SUM`s. VAR (`coin_type = 0`) sums `value INT8`; SKA (`coin_type > 0`) sums `NULLIF(ska_value,'')::numeric` and casts to `text`. Filtered by `coin_type=$2`.
- **Fields populated**: VAR float series + SKA string atom series (when `coinType > 0`).
- **Frontend transform**: `amountFlowProcessor` (30-53) emits `[Date, received, sent, netReceived, netSent]` rows (line 41) and the parallel balance series (43). Reads only `d.net[i]` / `d.received[i]` / `d.sent[i]` (VAR float fields).
- **Coin-type assumption**: backend SKA precision is correct as of PR #263 (see §6.3); frontend still consumes VAR float fields only.

---

## 4. Template touch points

[cmd/dcrdata/views/address.tmpl](cmd/dcrdata/views/address.tmpl) — every Stimulus target / button / option on this card:

Container payload (read by controller `connect`):
- `address.tmpl:11` `data-controller="address newblock"` (co-mounted; `newblock` may mutate `txnCount` outside the chart card).
- `:13` `data-address-dcraddress="{{.Address}}"` — used in `fetchGraphData` URL (`/api/address/${ctrl.dcrAddress}/...`).
- `:14` `data-address-txn-count="{{$TxnCount}}"` — read in `connect()` for `paginationParams.count` (228); not used for chart logic.
- `:15` `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` — read into `ctrl.balance` (230) but **not actually used by chart code**. VAR-only float; will silently mislead if reused for SKA.

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

---

## 5. Frontend touch points (URL contract + zoom)

**TurboQuery null-template (must declare every persisted key)** — [address_controller.js:211-219](cmd/dcrdata/public/js/controllers/address_controller.js#L211-L219):
```
ctrl.settings = TurboQuery.nullTemplate([
  'chart', 'zoom', 'bin', 'flow', 'n', 'start', 'txntype'
])
```
This card owns `chart`, `zoom`, `bin`, `flow`. (`n`, `start`, `txntype` belong to the table.) **`coin` is NOT declared.** Per the rule in `flow.compact.md` mutation checklist, adding a coin selector requires a new entry here.

**URL key flow (UI → settings → URL → fetch)**:

| Key      | UI source                                                      | Settings write                             | URL emit                              | Fetch use                                                                         |
|----------|----------------------------------------------------------------|--------------------------------------------|---------------------------------------|-----------------------------------------------------------------------------------|
| `chart`  | `<select data-address-target="options">` change                | `changeGraph` (620) → `settings.chart = chartType` | `setGraphQuery` → `query.replace(settings)` (635) | `fetchGraphData` (519): `chart === 'balance' ? 'amountflow' : chart`             |
| `bin`    | `<button>` click in `interval` set                              | `changeBin` (626): `settings.bin = target.name`   | `setGraphQuery` → `query.replace`     | `fetchGraphData` (520): `/api/address/${addr}/${chartKey}/${bin}`                |
| `zoom`   | `onZoom` button (666), `_zoomCallback` Dygraph drag (749), `_drawCallback` Dygraph slide (738) | `setZoom` (683) writes `settings.zoom = Zoom.encode(start, end)`; callbacks at 744 / 753 do the same | `query.replace(settings)` (690 / 745 / 754) | `drawGraph` short-circuit (482-488): if only zoom changed, decode and re-apply without refetch |
| `flow`   | `<input type=checkbox>` change in `flow`                       | `updateFlow` (639): `settings.flow = bitmap` (646) | `setGraphQuery` (647)                 | not used in fetch URL; consumed only by `setFlowChecks`/`updateFlow` for visibility bitmap |
| `coin`   | (not implemented)                                              | (not implemented)                          | (not in URL)                          | (not in URL — backend only sees it on initial page load if user typed `?coin=` manually) |

**Initial load** (`connect()`): `query.update(settings)` (233) populates from URL; `setChartType()` (234) syncs `<select>`; `setFlowChecks()` (235) syncs flow checkboxes; if `bin == null`, `getBin()` (242) reads `bin` from URL again or falls back to `activeBin` (the currently-selected interval button, default `month`).

**Validation**:
- `validChartType` (597-599) — `optionsTarget.namedItem(chart)`. Treats the option `name` attribute as the validity oracle. URL `chart` outside the three known names is silently overridden to `ctrl.chartType` (244-246).
- `validGraphInterval` (601-608) — looks for a button with `name === bin`. Unknown `bin` falls back through `getBin()` → `activeBin` → default `month`.
- `validateZoom` (610-618) — `Zoom.validate(activeZoomKey || settings.zoom, ctrl.xRange, binSize)`. **Clamps silently** to the new chart's `xRange` (no error). This is what hides the stale-zoom failure mode.

**Stale-`?zoom=` failure mode** (per `flow.full.md`):
- `changeGraph` (620-624) writes the new `chart` to settings then calls `setGraphQuery` → `query.replace(this.settings)` **without resetting `settings.zoom`**.
- Same in `changeBin` (626-633).
- Result: when switching from a long-history chart kind to a shorter one, `?zoom=` in the URL still encodes the prior chart's window; on the next refresh, `validateZoom` clamps it silently to the new range. The user sees a "different" zoom than they last set.
- Decision: any change to `setGraphQuery` (635) or to `changeGraph`/`changeBin` must explicitly choose **drop / project / keep** for `settings.zoom`. The `charts_controller.js` (charts page) calls `Zoom.project(...)` for this; the address controller does not.

**Group-by visibility** — `setButtonVisibility` (758-772) hides bins coarser than the current `chartDuration` (`xRange[1] - xRange[0]`) **per data range, not per tx count**. The `data-fixed="1"` attribute on `all` zoom and on `day` / `all` (Block) interval buttons exempts them. The `data-txcount="{{$TxnCount}}"` on `interval` (`address.tmpl:149`) is unread (template residue).

**Cache** — `ctrl.retrievedData` (196) keyed by `${chart}-${bin}` (497). `popChartCache` (548) replays cached data without re-fetching when both keys match. Note the `processData` quirk at 538-542: an `amountflow` fetch fills both `amountflow-${bin}` and `balance-${bin}` cache entries, but a separate `balance` request still hits the URL on first switch. **Cache key does not include coin** — switching `?coin=` would not clear `retrievedData` (a multi-coin frontend will need to refactor this key).

---

## 6. Multi-coin gaps + the SKA SQL precision fix (PR #263)

### 6.1 Backend per-coin plumbing — **complete**

- ✅ Route: `m.CoinCtx` middleware on both chart endpoints ([apirouter.go:185-186](cmd/dcrdata/internal/api/apirouter.go#L185-L186)).
- ✅ Handler: reads `coinType := m.GetCoinCtx(r)` and threads through to `TxHistoryData` ([apiroutes.go:1848,1885](cmd/dcrdata/internal/api/apiroutes.go#L1848-L1885)).
- ✅ DB layer signature: `TxHistoryData(... coinType uint8)` ([pgblockchain.go:3325-3326](db/dcrpg/pgblockchain.go#L3325-L3326)).
- ✅ Cache key: `(address, HistoryChart, TimeBasedGrouping, coinType)` ([addresscache.go:461,1143](db/cache/addresscache.go#L461-L1143)).
- ✅ Mock: [noop_ds_test.go:40](cmd/dcrdata/internal/api/noop_ds_test.go#L40), [apiroutes_test.go:359](cmd/dcrdata/internal/api/apiroutes_test.go#L359).
- ✅ SQL: `selectAddressTxTypesByAddress` and `selectAddressAmountFlowByAddress` filter by `coin_type=$2` ([addrstmts.go:345,357](db/dcrpg/internal/addrstmts.go#L345-L357)). SKA precision in `selectAddressAmountFlowByAddress` was fixed in PR #263 (see §6.3).

**The remaining gap is the frontend URL builder + TurboQuery null-template + chart cache key.**

### 6.2 Float64 precision — partially fixed at backend; frontend still drops it

**Backend** now produces dual fields ([db/dbtypes/types.go:2052-2056](db/dbtypes/types.go#L2052-L2056)):
- `Balance []float64` (VAR running balance, float64, 8 decimals).
- `BalanceAtoms []string` (SKA running balance, big.Int-derived decimal string, 18 decimals).
- `ReceivedAtoms []string`, `SentAtoms []string`, `NetAtoms []string` — parallel SKA series for the per-bin deltas.

`parseRowsSentReceived` ([queries.go:4289-4331](db/dcrpg/queries.go#L4289-L4331)) populates VAR fields for `coinType == 0` and SKA fields for `coinType > 0`, using a `*big.Int` running balance for SKA. The legacy float fields (`Received`/`Sent`/`Net`) stay empty for SKA responses. As of PR #263, the SKA inputs to the `*big.Int` accumulator come from the SQL's new `received_ska`/`sent_ska` text columns (correct 1e18 atoms), not from the truncated `value INT8` SUM.

**Frontend** still uses the float fields exclusively:
- [address_controller.js:30-53](cmd/dcrdata/public/js/controllers/address_controller.js#L30-L53) (`amountFlowProcessor`) — `d.net[i]` accumulator on JS `Number`. Ignores `d.balance_atoms`/`d.received_atoms`/`d.sent_atoms`/`d.net_atoms`.
- `digitsAfterDecimal: 8` (commonOptions, line 101).
- `customizedFormatter` (84): `${series.y} DCR`.
- `amountFlowGraphOptions.ylabel = 'Total (DCR)'` (130).
- `balanceGraphOptions.ylabel = 'Balance (DCR)'` (140).

For SKA: the new atom-string fields would render correctly via `ska_helper.js` (`splitSkaAtomsNoTrailing`, `renderCoinType`). None are used here.

### 6.3 ✅ Fixed in PR #263: SKA `amountflow` SQL precision

**Status: fixed** — merged in PR #263 (commit `49953185`, "db/dcrpg: fix SKA precision in address amountflow query").

**The bug (historical):** `selectAddressAmountFlowByAddress` used to sum `addresses.value INT8` regardless of coin type. For SKA rows, that column contains the truncated INT8 representation of `vout.Value` (commonly `0`), not the 1e18-scale atoms — those live in the parallel `ska_value TEXT` column. So `parseRowsSentReceived` faithfully fed truncated/zero `uint64`s into its `*big.Int` accumulator, and `/api/address/{addr}/amountflow/{bin}?coin=N` shipped zeroed `Received`/`Sent`/`Net`/`Balance` series for every SKA coin. The chart was invisible because no frontend exercised the SKA path — `address_controller.js` still hard-codes VAR scale (`toCoin / 1e8`, `DCR` legend), so SKA-holding addresses silently rendered as VAR-only.

**The fix:** mirror the dual-column pattern already used by `SelectAddressSpentUnspentCountAndValue` ([addrstmts.go:234-247](db/dcrpg/internal/addrstmts.go#L234-L247)). The SQL now emits four `SUM` columns, with `CASE` guards on `coin_type` as belt-and-braces (the `WHERE coin_type=$2` filter already restricts rows to one coin family):

`selectAddressAmountFlowByAddress` ([addrstmts.go:351-359](db/dcrpg/internal/addrstmts.go#L351-L359)):
```sql
SELECT %s as timestamp,
    SUM(CASE WHEN is_funding = TRUE  AND coin_type = 0 THEN value ELSE 0 END) as received,
    SUM(CASE WHEN is_funding = FALSE AND coin_type = 0 THEN value ELSE 0 END) as sent,
    COALESCE(SUM(CASE WHEN is_funding = TRUE  AND coin_type > 0 THEN NULLIF(ska_value, '')::numeric ELSE 0 END), 0)::text as received_ska,
    COALESCE(SUM(CASE WHEN is_funding = FALSE AND coin_type > 0 THEN NULLIF(ska_value, '')::numeric ELSE 0 END), 0)::text as sent_ska
FROM addresses
WHERE address=$1 AND coin_type=$2 AND valid_mainchain
GROUP BY timestamp
ORDER BY timestamp;
```

`parseRowsSentReceived` ([queries.go:4296-4324](db/dcrpg/queries.go#L4296-L4324)) now scans both pairs — `receivedVAR, sentVAR uint64` and `receivedSKAStr, sentSKAStr string` — and, for `coinType > 0`, builds the `big.Int` from the text columns instead of converting the truncated `uint64`:

```go
var receivedVAR, sentVAR uint64
var receivedSKAStr, sentSKAStr string
err := rows.Scan(&blockTime, &receivedVAR, &sentVAR, &receivedSKAStr, &sentSKAStr)
...
// SKA branch:
r, _ := new(big.Int).SetString(receivedSKAStr, 10)
s, _ := new(big.Int).SetString(sentSKAStr, 10)
```

The `COALESCE(..., 0)::text` cast guarantees a valid decimal string for `SetString` even on empty result sets.

**Safety of the wider scan signature:** `parseRowsSentReceived` is also called by `binnedTreasuryIO`, but the treasury subsystem was removed and `MakeSelectTreasuryIOStatement` returns an empty string — `db.QueryContext` errors before `Scan` is reached, so adding the two extra scan targets is safe.

**Historical note** on probable cause: the SKA `*big.Int` plumbing in `parseRowsSentReceived` was added in commit `944a20ee` ("address chart API endpoints, Tasks 15, 16 partial") on the assumption that the existing `value` column carried the right number, mirroring how `selectAddressTxTypesByAddress` (counts only) works. The schema reality wasn't checked against the SQL. PR #263 lands the SQL fix before the frontend coin selector (#249) ships, so the SKA chart pipeline is correct from day one when the dropdown becomes visible.

### 6.4 Hard-coded `DCR` / VAR-implying labels in chart options

Within the chart card and its controller (template currency labels in the summary card are out of scope here):
- `address_controller.js:84` — `customizedFormatter` legend: `${series.y} DCR`. Used by `amountFlowGraphOptions` (line 132) and `balanceGraphOptions` (line 142).
- `address_controller.js:130` — `amountFlowGraphOptions.ylabel = 'Total (DCR)'`.
- `address_controller.js:140` — `balanceGraphOptions.ylabel = 'Balance (DCR)'`.
- `address_controller.js:120` — `typesGraphOptions.ylabel = 'Tx Count'` (no coin label; OK).
- **No use of `helpers/ska_helper.js`** anywhere in `address_controller.js`. `renderCoinType`, `splitSkaAtoms`, `splitSkaAtomsNoTrailing` are unused on this surface.

### 6.5 `data-address-balance` is VAR-only

- `address.tmpl:15` `data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"` (lossy for SKA per `flow.compact.md` C1 violation note).
- Read into `ctrl.balance` ([address_controller.js:230](cmd/dcrdata/public/js/controllers/address_controller.js#L230)) but currently unused by chart logic — still a hidden contract that breaks if the template ever stops syncing the legacy flat fields.

### 6.6 `flow` bitmap is single-coin-aware only

- The flow checkboxes (`address.tmpl:160-174`, controller `updateFlow` 639) toggle Dygraph series visibility on a single dataset. There is no per-coin filtering concept; if the response carried multiple coin series, the bitmap couldn't address them.

### 6.7 `?coin=` propagation through chart cache (frontend)

`ctrl.retrievedData` is keyed by `${chart}-${bin}` ([address_controller.js:497](cmd/dcrdata/public/js/controllers/address_controller.js#L497)). When a coin selector is added, this key needs to become `${chart}-${bin}-${coin}` or the controller needs to clear `retrievedData` on coin change. Without this, switching coins would replay stale cached data.

---

## 7. Mirror pattern: SKA coin-supply

Reference: `wiki/code-analysis/charts/flow.compact.md` and `flow.full.md`. Summary of the precedent for adding per-coin chart endpoints, and what would map vs. diverge.

**Reuses** (the address charts can adopt directly):
- **URL prefix namespace**. `coin-supply/{N}` (1≤N≤255) is parsed by `db/cache/charts.go` (`IsSKASupplyChart`, `SkaCoinType`) and JS `skaCoinTypeFromChart` (`charts_controller.js:60`). The address-chart equivalent has chosen the **`?coin=N` query path** instead (via `m.CoinCtx`); URL-segment per-coin route would also work but does not match the existing chart-controller convention.
- **String-only SKA pipeline**. SQL `::text` → Go `[]string` + `*big.Int.Add` → JSON `"supply": []string` → JS `Number(s) * 1e-18` for the line, `splitSkaAtomsNoTrailing` for the legend (`charts_controller.js:661-687`). The address `amountflow` SKA equivalent now follows the same string discipline at the SQL boundary as of PR #263 (see §6.3): `SUM(ska_value::numeric)::text` columns scanned as strings, `*big.Int` accumulator end-to-end.
- **`ActiveCoins` projection**. `AddressInfo.ActiveCoins []uint8` is already populated from `retrieveAddressCoinTypes` ([queries.go:1450-1469](db/dcrpg/queries.go#L1450-L1469)). The chart card can use this for a coin selector dropdown without a new query.
- **`renderCoinType(coinType)` for labels** (`ska_helper.js:16`). Replaces hard-coded `DCR` / `VAR` in the controller.
- **`Zoom.project` across data-range changes** (`charts_controller.js`). The address controller does not currently call this; adopting it would resolve the stale-zoom failure mode at the same time.
- **Mock co-update pattern**. `noop_ds_test.go` is the precedent for keeping interface-method mocks in sync.

**Divergences** for address charts:
- **Per-coin display UX**: coin-supply is one chart per coin (selector); address `amountflow`/`balance` could be **per-coin selector** (mirror coin-supply), **stacked across coins** (bad — different scales), or **side-by-side small multiples**. UX choice (§9).
- **Cache shape diverges**. Coin-supply uses a single `ChartData.SKASupply[uint8]SKASupplyChartData` keyed only by coin type. The address cache is keyed by `(address, HistoryChart, TimeBasedGrouping, coinType)` — already a 4-tuple. Adding per-coin in the JS-side `retrievedData` is a separate change.
- **Cumulative-vs-per-block invariants**. SKA coin supply is cumulative per-height. Address `amountflow` is per-bin (delta) with the cumulative balance now computed **server-side** (via `Balance []float64` for VAR or `BalanceAtoms []string` for SKA). The JS `amountFlowProcessor` (line 42) duplicates this in a lossy way for VAR and ignores the precise SKA version. **Recommendation**: switch the JS to consume the server-side balance, making `Balance`/`BalanceAtoms` the single source of truth.
- **`h` (height) field convention**: coin-supply responses include `h` for block-aligned cumulation. Address charts use time bins, so `h` does not naturally apply.

---

## 8. Cross-surface dependencies

**Summary card** (`address.tmpl:21-112`, out of scope but adjacent):
- Container attributes shared with this card via the same `data-controller="address"` element:
  - `data-address-balance` (`:15`) — read by controller (`:230`) but not used in chart code today.
  - `data-address-txn-count` (`:14`) — read at `connect():228` for table pagination, also stamped on `txnCount` target in the table footer (`:192`).
- The summary card uses `toFloat64Amount` / `amountAsDecimalParts` for `Balance.TotalUnspent`/`TotalSpent` (`:48,50,64,66,77,79`). When the address page goes multi-coin frontend, both surfaces must change together — but the chart card itself doesn't read these template fields.

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

1. **Per-coin lines on one chart, separate chart per coin, or coin selector?** With `?coin=N` already wired in middleware/handler/DB, the cheapest UX is a coin selector dropdown that emits `?coin=N` and refetches. Alternatives:
   - Stacked Dygraph with N series — bad for mixed-magnitude coins (one VAR series at 1e8 + one SKA series at 1e18).
   - Selector dropdown (mirroring `coin-supply/{N}` UX, but using `?coin=` query rather than path segment) — clean precedent, doubles fetches for users comparing coins.
   - Always-stacked + a "show coins" multi-select — heaviest, but most consistent with the chart card's existing flow checkbox pattern.

2. **Should `types` be VAR-only by definition?** Tickets/votes/revocations are stake-tree primitives that don't exist for SKA. Options:
   - Hide the `Tx Type` chart for non-VAR coin selection.
   - Show only `SentRtx` / `ReceivedRtx` series (reduce to a 2-series chart) for SKA.
   - Show all 5 with the stake series always-zero (current implicit behavior).

3. **What does `amountflow` look like for an address that holds both VAR and SKA?**
   - "All coins" aggregated is meaningless (different scales).
   - Default-to-VAR (`coinType = 0` when `?coin=` is missing) is the current backend behavior.
   - Or default-to-the-address's-primary-coin (whatever that means) requires a backend "primary coin" inference.

4. **Use `?coin=` query or `/coin-supply/N`-style path segment?** The decision was **already made**: `?coin=` query via `m.CoinCtx` middleware, divergent from `coin-supply`'s URL-segment convention. Worth being explicit in any chart-controller refactor to avoid accidentally introducing a parallel URL shape.

5. **Where does the `balance` chart get its precision from?** Backend now produces a precise per-coin balance series (`Balance []float64` or `BalanceAtoms []string`); as of PR #263 the SKA series is correctly populated from `ska_value` atoms. Options:
   - Switch JS to consume the server-side balance (recommended — eliminates JS-side accumulator drift, picks up correct SKA precision automatically).
   - Keep the JS-side accumulator and only use the server series for SKA.
   - Stay with current JS-only behavior (loses precision for both VAR and SKA at high-balance addresses).

6. **Should `data-address-balance` (`address.tmpl:15`) become per-coin?** Currently dead-but-wired to `ctrl.balance`. If multi-coin, a `data-address-balances='{"0":"...","1":"...","2":"..."}'` JSON-stringified attribute is one path; another is to drop the attribute and have the chart card read balances from a server-side payload.

7. **Stale-`?zoom=` fix concurrent with multi-coin work?** A multi-coin chart refactor will touch `setGraphQuery` / `changeGraph` / `changeBin`. Decide order: a per-coin URL param will inevitably re-enter `setGraphQuery`, so it's natural to fix the stale-zoom invariant in the same pass (drop or `Zoom.project` `settings.zoom` on chart-kind change).

8. **Coin selector should source from `ActiveCoins` or all known coin types?** `AddressInfo.ActiveCoins []uint8` lists only coins this address has touched. The home-page list shows all known SKA coins. UX: probably restrict to `ActiveCoins` (no point letting users select a coin the address has no activity in).

9. **Should the Tx Type chart distinguish VAR-vs-SKA regular txs?** Now that the SQL filters by coin, this is handled by the coin selector — `?coin=0` shows VAR `SentRtx`/`ReceivedRtx`, `?coin=1` shows SKA1 versions, etc. No per-chart-series split needed.

10. ~~**Fix the SKA `amountflow` SQL bug (§6.3) before or after the frontend lands?**~~ **Resolved**: fixed before the frontend (PR #263, merged 2026-05-14). Frontend coin selector (#249) will consume the correct SKA `received_atoms`/`sent_atoms`/`net_atoms`/`balance_atoms` series from day one.

---

### See also

- [flow.compact.md](flow.compact.md) — TurboQuery URL ownership; stale-zoom failure mode summary; backend per-coin status.
- [flow.full.md](flow.full.md) — detailed per-layer breakdown that this note builds on; PR #263 SKA SQL fix also covered there.
- [patterns.md](patterns.md) — `CoinCtx` URL/middleware contract; `CoinTypeAll → 0` chart-collapse semantics.
- [summary.impact.md](summary.impact.md) — companion surface (also still VAR-only at the template level).
- [transactions.impact.md](transactions.impact.md) — per-row coin fields populated but unread; CSV is multi-coin complete.
- /wiki/code-analysis/charts/flow.compact.md and flow.full.md — `coin-supply/{N}` precedent for per-coin chart endpoints; SKA string-pipeline rules; `Zoom.project` pattern.
- /wiki/core/constraints.md#C1 — numeric precision & bifurcation. The backend `selectAddressAmountFlowByAddress` / `parseRowsSentReceived` path is now C1-compliant for SKA (PR #263). The JS-side `Number` accumulator in `amountFlowProcessor` still violates C1 — it ignores the precise `*_atoms` fields and re-integrates `d.net[i]` as a JS `Number`.
- /wiki/core/constraints.md#C7 — centralized coin-type label rendering (`renderCoinType`); currently *not* applied on this surface (`DCR`-string in `customizedFormatter` and ylabels).
