### Section 1 — Overview

End-to-end trace of how mempool transactions reach the UI in the multi-coin (VAR + SKA{n}) model. Covers the **dual collection paths** (batch full-scan vs. per-tx incremental), the **fan-out to multiple savers** (explorerUI, PubSubHub, DataCache), the derivation of **CoinFills** from **CoinStats**, and the **dual-transport** websocket delivery (root + pubsub) plus the homepage templates and Stimulus controller that consume the data.

---

### Section 2 — End-to-End Data Flow

```
monetarium-node RPC / OnTxAccepted
        │
        ▼
mempool/collector.go ── Collect() ─ ParseTxns() ──► *exptypes.MempoolInfo (batch, block boundary)
        │                                              │
mempool/monitor.go ── TxHandler() ─ addTxToCoinStats ──┤ (incremental, per tx)
        │                                              │
        │  fan-out via []MempoolDataSaver              ▼
        ├──► explorerUI.StoreMPData ─ computeCoinFills ─► exp.invs (CoinFills/TotalFillRatio/ActiveSKACount)
        ├──► PubSubHub.StoreMPData ─► psh.invs
        └──► DataCache.StoreMPData  (skipped when stakeData==nil)

exp.invs / psh.invs
        │
        ├── HTTP: explorerroutes.go Home/Mempool/VisualBlocks ─► views/home_mempool.tmpl, mempool.tmpl
        ├── WS (root):   websockethandlers.go ─► sigMempoolUpdate(MempoolShort), sigNewTxs(Txs+CoinFills+…)
        └── WS (pubsub): pubsubhub.go         ─► sigMempoolUpdate(MempoolShort), sigNewTxs(Txs+CoinFills+…)

views/home_mempool.tmpl  ──► homepage_controller.js (rAF-buffered indicator updates, indicator_fill.js helpers)
```

---

### Section 3 — Per-Layer Breakdown

#### 3.1 Collection — `mempool/collector.go`

- **Data structures:** `DataCollector`, `StakeData`, `exptypes.MempoolTx`, `exptypes.MempoolInput`.
- **`(*DataCollector).Collect()`** — drains `GetRawMempoolVerbose(GRMAll)`, `GRMTickets`, `GRMVotes`, fee info, stake difficulty, and the best-block header. Returns a `*StakeData`, the full `[]exptypes.MempoolTx`, the `MempoolAddressStore`, and the `TxnsStore`.
- **`(*DataCollector).mempoolTxns()`** — for each mempool entry: fetches the raw tx, decodes, sums **VAR-only outputs** into `totalOut` (filters by `v.CoinType == cointype.CoinTypeVAR`), populates `SKATotals` via `txhelpers.SKATotalsFromMsgTx`, calls `populateMempoolInputs` to enrich vin coin types.
  - `mempool/collector.go:107-113` — VAR-only `totalOut` (SKA values are not summed into `TotalOut`).
  - `mempool/collector.go:162` — `SKATotals: txhelpers.SKATotalsFromMsgTx(msgTx)` (returns `nil` for VAR-only txs).
  - `mempool/collector.go:148,163` — the batch path's **fee fields trust the node's GRM verbose result**: `Fees: tx.Fee` (float from `GetRawMempoolVerbose`) and `SKAFeeRates: txhelpers.SKAFeeRateMapFromAtoms(tx.SKAFee, msgTx)`. Only `FeeRate` is recomputed locally via `txhelpers.TxFeeRate(msgTx)` (`collector.go:143,149`). This is a **different upstream source** from the incremental `TxHandler` path — see §3.2 and Pitfall 8.
- **`populateMempoolInputs`** — for `TxTypeRegular` only, resolves `input.CoinType` and `input.SKAValue` from the prev outpoint, either via the mempool's own `TxnsStore` or by an RPC fallback `GetRawTransaction`. Returns `nil` for `SKAValue` outside Regular txs (`mempool/collector.go:169-206`).
- **`ticketStage(vin []MempoolInput, txnsStore TxnsStore)`** (`mempool/collector.go:175-193`) — determines ticket mining readiness for a `TxTypeSStx` tx. Iterates each input's parent tx hash against `txnsStore`; if the parent is **absent from the store** (pessimistic fallback: treated as unconfirmed) or has `BlockHeight == 0` (still in mempool), returns `"Staging"`. Returns `"Ready"` only when all parents are confirmed. Called immediately after the `TxTypeSStx` check in `mempoolTxns` (`collector.go:166-169`): `txs[len(txs)-1].TicketStage = ticketStage(txs[len(txs)-1].Vin, txnsStore)`.
- **`ParseTxns`** — the batch aggregator that builds `MempoolInfo.MempoolShort.CoinStats`. Internally uses a `coinAccum` struct with **native `int64` (VAR) and `*big.Int` (SKA) accumulators** plus per-type accumulators for Regular/Ticket/Vote/Revocation; only at the end does it format `Amount`, `RegularAmount`, `TicketAmount`, `VoteAmount`, `RevokeAmount` to decimal-atom strings (`mempool/collector.go:519-644`).
  - SKA per-type maps `skaRegAmt/skaTixAmt/skaVoteAmt/skaRevAmt` exist but **stay empty in practice** by chain invariant (SKA cannot be ticket/vote/revoke). `skaPerTypeStr` returns `"0"` when missing so the JSON contract is stable (`mempool/collector.go:607-614`).

#### 3.2 Monitor / dispatch — `mempool/monitor.go`

- **Data structures:** `MempoolMonitor` (holds `*exptypes.MempoolInfo` inventory under `mtx sync.RWMutex`, plus `mpoolInfo CollectState` — a lightweight 3-field struct in `mempool/mptypes.go:15` tracking `CurrentHeight`, `NumTicketPurchasesInMempool`, `LastCollectTime`), `[]MempoolDataSaver`.
- **`(*MempoolMonitor).BlockHandler(height, _)`** — now propagates the `CollectAndStore()` error to the caller (`monitor.go:111-114`; previously discarded with `_ = p.CollectAndStore()`).
- **`(*MempoolMonitor).TxHandler(rawTx)`** (per-tx, incremental):
  1. Ignores txs older than `LastBlockTime` (`monitor.go:128-131`).
  2. Decodes; computes `tx.SKATotals` via `txhelpers.SKATotalsFromMsgTx(msgTx)` (`monitor.go:261`). **Fee fields are recomputed locally, not taken from a verbose result**: `Fees: fee.ToCoin()` from `txhelpers.TxFeeRate(msgTx)` (after `valsIn` is back-filled onto `msgTx.TxIn` at `monitor.go:252-254`) and `SKAFeeRates: txhelpers.SKAFeeRateMapFromVerboseVin(rawTx.Vin, msgTx)`. `FeeRate` matches the batch path (`TxFeeRate`), but `Fees`/`SKAFeeRates` come from a **different source** than `mempoolTxns` (`tx.Fee` / `SKAFeeRateMapFromAtoms`) — see §3.1 and Pitfall 8.
  3. Appends to the appropriate slice (`Transactions/Tickets/Votes/Revocations/TSpends/TAdds`) under `p.mtx.RLock()` + `p.inventory.Lock()`. For `TxTypeSStx`, also sets `tx.TicketStage = ticketStage(tx.Vin, p.txnsStore)` (`monitor.go:291`) before appending — mirrors the batch path using the same `ticketStage()` function against the in-memory store snapshot.
  4. **Incrementally updates `p.inventory.CoinStats`** via `addTxToCoinStats(...)` (`monitor.go:359-363`).
  5. **DeepCopies inventory and fans out to all savers** with `stakeData == nil` (`monitor.go:386-402`). Each saver goroutine now runs inside a `defer recover()` panic handler so a panicking saver cannot crash the monitor. This is what triggers `computeCoinFills` recomputation on new-tx arrival without waiting for the next block.
  6. Broadcasts `pstypes.SigNewTx` on `signalOuts`.
- **`(*MempoolMonitor).CollectAndStore()`** (block boundary): calls `Refresh()` → `ParseTxns()`, atomically replaces `p.inventory`, fans out to all savers with non-nil `stakeData` and a deep-copied tx slice per saver.
- **`addTxToCoinStats`** — incremental analogue of the `coinAccum` loop in `ParseTxns`. Uses `addAtomStrings(s.Amount, atoms, isBig)` for each `Amount`/per-type field, then `normalizeCoinStatsAmounts(&s)` to coerce any never-touched per-type amount from `""` to `"0"` (`monitor.go:582-654`). The function is the canonical reference for the contract: a regular VAR tx writes only `Amount` and `RegularAmount`; an SKA tx writes only the SKA-key entry's `Amount` and `RegularAmount`; per-type fields untouched by any tx still serialise as `"0"`.
- **`addAtomStrings(a, b, isBig)`** (`monitor.go:654-682`) — adds two decimal-atom strings. `big.Int` path when `isBig==true` (SKA): calls `big.Int.SetString` on each operand; on parse failure logs a warning and returns `a` unchanged. VAR path uses `strconv.ParseInt` (replacing the old `fmt.Sscan`); on parse failure logs a warning and returns `"0"`. Empty `a` returns `b` as-is.

#### 3.3 Savers — three `MempoolDataSaver` implementations

`MempoolDataSaver` is `StoreMPData(*StakeData, []exptypes.MempoolTx, *exptypes.MempoolInfo)`:

- **`mempool/mempoolcache.go::(*DataCache).StoreMPData`** — early-returns when `stakeData == nil` (`mempoolcache.go:46-51`). This is the explicit guard that lets `TxHandler` skip the cache on the incremental path. When called from `CollectAndStore`, stores `txs`, ticket fee info, fee/feeRate slices, ticket details, stake difficulty. The stake-diff update now uses explicit error handling: if `dcrutil.NewAmount(stakeData.StakeDiff)` fails, it logs a warning and leaves the cached value unchanged (`mempoolcache.go:67-72`).
- **`cmd/dcrdata/internal/explorer/explorer.go::(*explorerUI).StoreMPData`** (`explorer.go:483-512`):
  1. Reads `pageData.HomeInfo.SKACoinSupply` to compute `issuedSKA` (the full set of ever-issued SKA coin types).
  2. Reads `pageData.BlockchainInfo.MaxBlockSize` (fallback `393216.0`).
  3. Calls `types.ComputeCoinFills(inv.CoinStats, maxBlockSize, issuedSKA)` (`explorer.go:487`) → writes the results to **both** `inv.CoinFills` (legacy) **and** `inv.MempoolShort.CoinFills` plus `TotalFillRatio` and `ActiveSKACount`.
  4. Replaces `exp.invs` under `exp.invsMtx.Lock`.
  5. Resets the page ETag/Last-Modified.
- **`pubsub/pubsubhub.go::(*PubSubHub).StoreMPData`** (`pubsubhub.go:620-626`) — only assigns `psh.invs = inv`. Does **not** recompute CoinFills (it consumes the values the explorer just wrote).

Additional CoinFills recomputation lives in **`(*explorerUI).Store`** (new-block saver path) at `explorer.go:599-615`: after `HomeInfo.SKACoinSupply` is refreshed from the DB, fills are recomputed using the **new** issued set, so a freshly issued SKA coin gets a zero-fill indicator broadcast before its first mempool tx arrives.

#### 3.4 `types.ComputeCoinFills` — `explorer/types/explorertypes.go:1760`

> Refactor note: the fill computation now lives in the **types** package as the exported `types.ComputeCoinFills` ([explorer/types/explorertypes.go:1760](../../../explorer/types/explorertypes.go)), called from `(*explorerUI).StoreMPData` ([explorer.go:487](../../../cmd/dcrdata/internal/explorer/explorer.go)), `(*explorerUI).Store` ([explorer.go:598](../../../cmd/dcrdata/internal/explorer/explorer.go)), and the dev fixtures ([dev_indicators.go:58](../../../cmd/dcrdata/internal/explorer/dev_indicators.go)). The original unexported `computeCoinFills` at [explorer.go:1000](../../../cmd/dcrdata/internal/explorer/explorer.go) still exists but is **dead code** (no callers). The logic below is identical in both.

- `varQuota = maxBlockSize * 0.10`; `skaPool = maxBlockSize * 0.90`; per-SKA quota = `skaPool / numSKA`.
- Seeds the SKA key set from **both** the live `stats` map **and** the `issuedSKA` parameter so coins with no current mempool activity still appear (with zero fill).
- VAR always first in the returned slice; SKA keys are sorted ascending.
- Status logic per coin: `"ok"` (size ≤ quota), `"borrowing"` (over quota but `totalUsed ≤ maxBlockSize`), `"full"` (over total capacity).
- **`PctOfTC` is intentionally NOT clamped** — overflow must surface as text. `IsOverflow = raw > 1.0` (`explorer/types/explorertypes.go:1811-1812`); visual width is clipped via SCSS at 100%. The SCSS clip is required because `coin_fills` JSON carries the raw value.

#### 3.5 Type definitions — `explorer/types/explorertypes.go`

- **`MempoolCoinStats`** (`:684-700`) — `TxCount`, `Size`, `Amount`, plus per-type `RegularCount/Amount`, `TicketCount/Amount`, `VoteCount/Amount`, `RevokeCount/Amount`. All `*Amount` fields are **atom-string** (VAR: `int64` decimal string; SKA: `big.Int` decimal string). For SKA, only `RegularAmount` is ever non-zero by chain invariant.
- **`CoinFillData`** (`:665-682`) — `Symbol`, `GQFillRatio`, `ExtraFillRatio`, `OverflowFillRatio`, `GQPositionRatio`, `Status`, `PctOfTC`, `IsOverflow`.
- **`MempoolShort`** (`:1126-1157`) — embedded in `MempoolInfo`; carries `CoinStats`, `CoinFills`, `TotalFillRatio`, `ActiveSKACount`. **`DeepCopy(MempoolShort)`** (`:1174-1248`) manually copies `CoinStats` (shallow per-entry copy — value type) and `CoinFills` via `CopyCoinFillSlice`.
- **`MempoolInfo`** (`:965-977`) — embeds `MempoolShort`, holds tx slices and `Ident`; has its own embedded `sync.RWMutex` (separate from `MempoolMonitor.mtx`). `DeepCopy` (`:981`) now correctly copies `Ident` and `CoinFills` in addition to the `MempoolShort` deep-copy — previously these two fields were silently dropped in the snapshot, causing WS payloads from the incremental path to show stale/zero fills.
- **`MempoolTx`** (`:1473`) — the `Hash string json:"hash"` field has been **removed**; `TxID string json:"txid"` (`:1474`) is now the sole identifier. All dedup maps (`invStake`, `invRegular`) in `ParseTxns` and `TxHandler` now key on `TxID`. Templates and JS controllers updated accordingly (`{{.TxID}}` in templates, `tx.txid` in JS). **This is a WS JSON contract change** — any client reading `tx.hash` will get `undefined`; must use `tx.txid`.
- **`MempoolTx.SKATotals map[uint8]string`** (`:1492`) — per-coin SKA totals in atom-string form.
- **`MempoolTx.TicketStage string`** (`explorertypes.go:1513`, `json:"ticket_stage,omitempty"`) — `"Ready"` or `"Staging"` for ticket purchase (`TxTypeSStx`) txs; empty string (omitted from JSON) for all other types. Value type — `DeepCopy` propagates it automatically. Not carried through `TrimMempoolTx` → `TrimmedTxInfo` since VisualBlocks/trimmed view does not display the tickets table.
- **`primaryCoinType(tx)`** (`:1148-1153`) — encodes the chain invariant "a mempool tx is single-coin": returns the single key from `SKATotals` or `0` for VAR (empty `SKATotals`).
- **`TrimMempoolTx`** (`:1156-1178`) — propagates `CoinType = primaryCoinType(tx)` and `SKASent = tx.SKATotals` onto `TxBasic`. Uses `humanize.Bytes(uint64(tx.Size))` for `FormattedSize` (`:1167`; the old local `BytesString()` function has been removed from `explorertypes.go`).
- **`HomeInfo`** (`:904`) — two new fields: `WindowRemaining string json:"window_remaining"` (`:911`) and `RewardRemaining string json:"reward_remaining"` (`:913`). Populated in both `(*explorerUI).Store` (`explorer.go:568,570`) and `(*PubSubHub).Store` (`pubsubhub.go:734,736`) via `types.RemainingWindowText()` from `explorer/types/remaining.go:17`.
- **`FeeReward()`** (`:496`) — now returns `0.0` immediately when `t.TxBasic != nil && t.CoinType != 0` (i.e. SKA txs) to prevent float64 precision loss on 18-decimal SKA amounts. VAR coinbase/vote flow is unchanged.
- **`UnspentOutputIndices`** (`:1751`) — now correctly identifies SKA outputs as non-zero: checks `vout.SKAValue != ""` in addition to `vout.Amount != 0.0`. Previously a pure-SKA output with `Amount == 0` (the normal case) was incorrectly treated as spent.
- **`TrimmedMempoolInfo`** (`:847-863`) — for the home page; carries `CoinFills`, `TotalFillRatio`, `ActiveSKACount`, `CoinStats`. Built by `(*MempoolInfo).Trim()` (`:905-942`).

#### 3.6 HTTP handlers — `cmd/dcrdata/internal/explorer/explorerroutes.go`

- **`Home`** (`:182-...`) — renders `home_mempool.tmpl` via the home viewmodel; reads `exp.MempoolInventory()` and includes the entire `*types.MempoolInfo`.
- **`Mempool`** (`:783-...`) — renders `mempool.tmpl` with the full `MempoolInfo`. Template is multi-coin aware (Total Sent / Transactions cards iterate `CoinStats` via `orderedMempoolCoinStats`; Regular table branches on `.SKATotals`).
- **`VisualBlocks`** (`:353-368`) — calls `inv.Trim()` to render with a `*TrimmedMempoolInfo` (carrying `CoinFills`/`TotalFillRatio`/`ActiveSKACount`/`CoinStats`).

#### 3.7 Websocket transports — **dual** (root + pubsub)

Both transports serve identical JSON shapes for mempool signals. This is part of the project-wide dual-transport pattern documented in [wiki/code-analysis/visualblocks/patterns.md](../visualblocks/patterns.md).

- **`cmd/dcrdata/internal/explorer/websockethandlers.go::RootWebsocket`** (root explorer WS):
  - Client request `"getmempooltxs"` → marshals full `*types.MempoolInfo` (`:124-148`); short-circuits via `MempoolInfo.Ident` if the client already has the same id.
  - Client request `"getmempooltrimmed"` → marshals `inv.Trim()` plus injected `Subsidy` (`:150-167`).
  - `sigMempoolUpdate` → encodes `inv.MempoolShort` (`:284-293`).
  - `sigNewTxs` → encodes an anonymous struct `{Txs, CoinFills, TotalFillRatio, ActiveSKACount, CoinStats}` snapshotted from `inv.MempoolShort` (`:298-324`). `CoinStats` was added so the full-mempool page's per-coin Total Sent / Transactions cards update live without a follow-up `getmempooltxs` round-trip.
- **`pubsub/pubsubhub.go::sendLoop`** (pubsub WS):
  - `sigMempoolUpdate` → encodes `inv.MempoolShort` (`:474-489`).
  - `sigNewTxs` → encodes `{Txs, CoinFills, TotalFillRatio, ActiveSKACount, CoinStats}` (`:495-529`). Schema mirrors the root WS payload — both transports must change together (see [patterns.md "Dual-transport WebSocket"](patterns.md)).

In both pipelines the **CoinFills attached to `sigNewTxs` come from `MempoolShort.CoinFills` (not recomputed)** — the values were last written by `(*explorerUI).StoreMPData` when the new tx triggered the fan-out.

#### 3.8 Templates — `cmd/dcrdata/views/`

- **`home_mempool.tmpl`** — multi-coin aware:
  - Total fill bar driven by `.Mempool.TotalFillRatio` (uses `mulf` and `minf`; visual width clamped at 100%, percentage text shows raw value).
  - `{{range .Mempool.CoinFills}}` renders one bar per coin with `GQFillRatio`, `ExtraFillRatio`, `OverflowFillRatio`, `GQPositionRatio`, `PctOfTC`, `Status`, `IsOverflow`.
  - LatestTransactions table uses `{{if .SKATotals}}` to render `SKA{n}` / `formatCoinAtoms` for SKA txs, else `VAR` / `threeSigFigs .TotalOut`.
  - `<template id="fill-bar-template">` provides the DOM scaffolding used by `injectFillBar` for dynamically-added SKA bars.
- **`mempool.tmpl`** — full-page mempool listings, multi-coin aware:
  - Current Mempool card: `Total Sent` iterates `orderedMempoolCoinStats .CoinStats` and renders one `{amount, symbol}` line per coin (VAR always; SKA-n only when `TxCount > 0`).
  - Transactions card: VAR section is static (Regular / Tickets / Votes / Revocations from `CoinStats[0]`); SKA sections render Regular-only inside `data-mempool-target="skaSections"` for live JS rebuild.
  - Regular transactions table: `{{if .SKATotals}}` branches per row — SKA txs show `coinSymbol` + `skaDecimalParts $amt false`, VAR txs show `VAR` + `float64AsDecimalParts .TotalOut 8 false`. SKA Fee Rate cell renders `—` (em-dash) because `MempoolTx.FeeRate` is VAR-only float64; a follow-up will add `FeeRateRaw string` for precise SKA display.
  - Tickets table: now includes a `Ticket Stage` column (header `:242-253` with tooltip "Ticket stage: Ready (all inputs confirmed) or Staging (spends an unconfirmed output)") that renders `{{.TicketStage}}` per row (`:270`). The `ticketRowTemplate` (`:222-234`) includes `<td data-slot="ticketStage">` so dynamically inserted rows also show the stage.
  - Votes / Revocations tables stay VAR-only per spec; column headers say `Total VAR` and fee-rate unit is `VAR/kB`.
  - Treasury Spends and Treasury Adds sections both removed — Monetarium has no treasury (cf. `/treasury` → 410 in [core/pages.md](../../core/pages.md)), so neither tx type can occur on-chain. Backend `TAdds` / `NumTAdds` plumbing in `explorertypes.go`, `monitor.go`, `collector.go` is retained as dead code; UI no longer surfaces it.
  - `CoinFills` is not consumed here (it's a homepage indicator-bar concept).

#### 3.9 Frontend — `cmd/dcrdata/public/js/`

- **`controllers/mempool_controller.js`** — the full-page mempool view (`data-controller="mempool time"` in `mempool.tmpl:8`) uses this controller, not `homepage_controller.js`. Changes:
  - All row builders (`cloneTxRow`, `cloneTicketRow`, `cloneRevocationRow`, `cloneVoteRow`) now use `tx.txid` instead of `tx.hash` for hash links (`setHashLink`).
  - `setMempoolFigures()` now diffs `this.lastCoinStats !== this._prevCoinStats` before calling `applyCoinStats` — avoids unnecessary DOM updates when the coin stats reference hasn't changed.
  - `countTargetMap` added in `connect()` and cleared in `disconnect()` for clean lifecycle.
  - `cloneTicketRow(template, tx)` (`:107-116`) reads `tx.ticket_stage` from the `sigNewTxs` payload and sets the `[data-slot="ticketStage"]` cell; **no WS schema change** was required.
- **`controllers/homepage_controller.js`** registers handlers for `newtxs`, `mempool`, `getmempooltxsResp`. Changes:
  - `mempoolTableRow(tx)` now uses `tx.txid` (not `tx.hash`) for link construction and `humanize.hashElide`.
  - All indicator DOM writes funnel through `updateIndicators(payload)` which schedules a single `requestAnimationFrame` flush; multiple payloads inside the same frame collapse into the latest (`:216-226`).
  - `_flushIndicators` reads `coin_fills`, `total_fill_ratio`, `active_ska_count`. For each entry it calls `applyFillBar` (existing `[data-coin=…]`) or `injectFillBar` (new). Bars for coins no longer in the payload are zeroed via `zeroFillEntry`, **never removed**.
  - `mempoolTableRow(tx)` uses `tx.ska_totals` to choose between SKA atom rendering (`humanize.formatCoinAtoms`) and VAR (`threeSigFigs(tx.total)`).
- **`helpers/indicator_fill.js`** — JS mirror of the Go `computeCoinFills` output shape. Comments at `:20` and `:41` explicitly reference the Go function as the source of truth.
- **`helpers/mempool_helper.js`** — maintains the client-side tx list / totals separately from the indicators.

---

### Section 4 — Cross-Layer Dependencies

- **Mempool → Explorer (saver):** `MempoolMonitor` calls `s.StoreMPData(...)` in goroutines after every tx (`TxHandler`) and every block (`CollectAndStore`). Order of saver registration matters: only **`explorerUI` recomputes `CoinFills`**; `PubSubHub` then reads them off the same `inv` pointer it was just handed. If `PubSubHub` ran before `explorerUI`, it would see stale fills — currently safe because savers run as separate goroutines and `PubSubHub` only reads on the next WS tick, but this is **not enforced**. (See impact.md.)
- **Explorer → DB (one-way):** `(*explorerUI).Store` (new block) reads `VARCoinSupply` / `SKACoinSupply` from `dataSource` to refresh `HomeInfo.SKACoinSupply` and the issued-SKA set used for fills.
- **Explorer ↔ pubsub (decoupled):** Each owns its own `invs` field and its own `invsMtx` (explorer in `explorer.go`, pubsub in `pubsubhub.go`). Both subscribe via the saver interface.
- **Backend → Template:** `home_mempool.tmpl` reads `MempoolShort.CoinFills`, `TotalFillRatio`, `ActiveSKACount` directly; `mempool.tmpl` reads only `LikelyMineable` fields.
- **Backend → JS:** The `coin_fills` JSON shape (lowercase snake_case symbol/`gq_fill_ratio`/`pct_of_tc`/...) is defined by struct tags on `CoinFillData`. JS in `indicator_fill.js` is a **mirror** — divergence is silent.
- **Multi-coin invariant boundary:** `primaryCoinType` is the single place that encodes "one mempool tx is single-coin"; both `TrimMempoolTx` (mempool-page rendering) and any per-tx coin display depend on it.

---

### Section 5 — Critical Constraints

1. **Precision bifurcation:** VAR uses 8 decimals and fits in `int64`/`float64`; SKA uses 18 decimals and **must** stay as `*big.Int` or its decimal-atom string. Never call `.ToCoin()` or any `float64` conversion on SKA values. All SKA arithmetic in mempool aggregation goes through `addAtomStrings(..., isBig=true)` or `*big.Int` accumulators (`mempool/monitor.go:625-632`, `mempool/collector.go:580-606`). See [wiki/core/constraints.md](../../core/constraints.md) C1.
2. **Single-coin tx invariant:** Every mempool tx has outputs of exactly one coin type. `primaryCoinType` (`explorertypes.go:1056-1065`) and `SKATotals` size (≤1 in practice) both encode this. Code that iterates `SKATotals` and assumes multiple entries is wrong.
3. **SKA-only-on-Regular invariant:** SKA txs are always `Type=="Regular"`. `MempoolCoinStats` SKA entries' `TicketAmount`/`VoteAmount`/`RevokeAmount` are always `"0"` (never `""` thanks to `normalizeCoinStatsAmounts` / `skaPerTypeStr`). Both incremental and batch paths preserve this.
4. **Empty-string vs `"0"` JSON contract:** Per-type `*Amount` fields must serialise as `"0"` (never `""`) when no tx of that type has contributed. Enforced in both pipelines (incremental: `normalizeCoinStatsAmounts`; batch: `skaPerTypeStr`/`fmt.Sprintf("%d", 0)`).
5. **Batch/incremental equivalence:** `ParseTxns` (block boundary, batch) and `addTxToCoinStats` (per-tx, incremental) must produce identical `MempoolCoinStats` outputs for the same input set. Any new aggregated field must be added in **both** places, plus tested (`mempool/monitor_test.go` covers the incremental path).
6. **CoinFills are computed in two places:**
   - `(*explorerUI).StoreMPData` — driven by mempool changes (tx or block fan-out from `MempoolMonitor`).
   - `(*explorerUI).Store` — driven by new-block updates that refresh `SKACoinSupply` (so newly-issued SKA coins get bars before their first tx).
   Changing the inputs of one without the other causes drift.
7. **Inventory locking:** Two locks protect mempool state: `MempoolMonitor.mtx` (guards the `*MempoolInfo` pointer) and `MempoolInfo.RWMutex` (guards the struct contents). `TxHandler` takes `p.mtx.RLock()` then `p.inventory.Lock()`. `Refresh` swaps the pointer under `p.mtx.Lock()`. `DeepCopy` reads under `mpi.RLock()`. Reversing lock order risks deadlock.
8. **DataCache nil-stakeData guard:** `TxHandler` calls savers with `stakeData == nil`; `DataCache.StoreMPData` must early-return on `nil` (`mempoolcache.go:49-51`). Adding new logic before the guard breaks the incremental path.
9. **`PctOfTC` is unclamped:** Indicators must surface true overflow as text; SCSS handles visual clipping. Don't clamp in Go or JS.
10. **`issuedSKA` semantics:** Passed to `computeCoinFills` so that ever-issued coin types render zero-fill bars even with no current activity. Sourced from `HomeInfo.SKACoinSupply`. If you ever fan-out fills before `Store` has populated `SKACoinSupply`, expect first-time SKA coins to be missing from the bar set until the next mempool tx for that coin.

---

### Section 6 — Mutation Impact

When modifying **`MempoolCoinStats`** (new field, new tx-type bucket, format change):
- Update batch path: `ParseTxns` `coinAccum` struct + final assignment (`mempool/collector.go:519-644`).
- Update incremental path: `addTxToCoinStats` + `normalizeCoinStatsAmounts` (`mempool/monitor.go:545-617`).
- If non-value type or non-shallow-safe: update `MempoolShort.DeepCopy` (`explorertypes.go:1236-1241`).
- Update `mempool/monitor_test.go` (incremental equivalence) and any explorer fixtures.

When modifying **`MempoolShort` / `MempoolInfo`** (new field):
- Update `MempoolShort.DeepCopy` (`explorertypes.go:1174-1248`).
- Update `MempoolInfo.Trim()` if the field should reach `TrimmedMempoolInfo` (`explorertypes.go:905-942`).
- Update both WS encoders (`sigMempoolUpdate`, `sigNewTxs`) in `cmd/dcrdata/internal/explorer/websockethandlers.go` AND `pubsub/pubsubhub.go`.

When modifying **`computeCoinFills`** (new ratio, status, formula):
- The Go function: `cmd/dcrdata/internal/explorer/explorer.go:1108-1217`.
- The JS mirror: `cmd/dcrdata/public/js/helpers/indicator_fill.js` (apply/inject/zero helpers).
- Templates: `views/home_mempool.tmpl` fill-bar markup and the `<template id="fill-bar-template">`.
- The dev fixtures: `cmd/dcrdata/internal/explorer/dev_indicators.go` (visual regression scenarios).
- The dual-recompute call sites: `(*explorerUI).StoreMPData` AND `(*explorerUI).Store` new-block branch.

When changing **`CoinFillData` JSON tags** (e.g. rename `pct_of_tc`):
- Update struct tags in `explorertypes.go`.
- Update JS consumers (`homepage_controller.js`, `indicator_fill.js`).
- Update template references (`home_mempool.tmpl`).

When adding a **new saver**:
- It MUST handle `stakeData == nil` (incremental path) without corrupting state. Cf. `DataCache.StoreMPData`.
- It MUST treat the `*MempoolInfo` it receives as **shared** when called from `CollectAndStore` (slice is deep-copied per saver but the struct pointer is shared from `TxHandler`).

When modifying **`TicketStage` / `ticketStage()` classification logic**:
- Update **both** call sites: `mempoolTxns` batch path (`collector.go:166-169`) and `TxHandler` incremental path (`monitor.go:291`).
- The same `ticketStage(vin, txnsStore)` function is used by both; changing its signature cascades to both callers.
- Template: `mempool.tmpl:270` (static render) + `ticketRowTemplate:232` (dynamic `data-slot="ticketStage"`).
- JS: `mempool_controller.js::cloneTicketRow` reads `tx.ticket_stage` from `sigNewTxs.Txs`.
- No `DeepCopy` or `MempoolShort` update needed (string value type, not on `MempoolShort`).

**Silent failure modes:**
- Converting an SKA `Amount` string to `float64` anywhere in the pipeline → precision loss past ~17 significant digits (an 18-decimal SKA amount > 10 will mis-render).
- Forgetting `isBig=true` for SKA in `addAtomStrings` → silently truncates SKA atoms to `int64`.
- Adding a new per-type `*Amount` without updating `normalizeCoinStatsAmounts` → JSON contract emits `""` instead of `"0"`, frontend `parseFloat("")` returns `NaN`.
- Recomputing CoinFills with an empty `issuedSKA` set (e.g. before `Store` runs) → newly-issued SKA coins missing from fill bars until their first tx.
- Clamping `PctOfTC` in Go or JS → overflow indicator silently disappears.

**Hard failure modes:**
- Writing to `inv.CoinStats` without `inv.Lock()` while another goroutine reads → map concurrent access panic.
- Calling `DeepCopy` while holding `inv.Lock()` (it takes `RLock` internally) → deadlock.
- Reversing the `p.mtx` / `p.inventory` lock order → potential deadlock with the `Refresh` path.

---

### Section 7 — Common Pitfalls

1. **Using `tx.hash` in JS or `{{.Hash}}` in templates for `MempoolTx`.** The `Hash string json:"hash"` field on `MempoolTx` has been **removed** (`explorertypes.go:1473`). The sole identifier is now `TxID string json:"txid"` (`:1474`). Any JS code reading `tx.hash` or template referencing `{{.Hash}}` on a mempool tx gets `undefined`/empty. Use `tx.txid` and `{{.TxID}}`.
2. **Treating `MempoolTx.TotalOut` as the canonical tx amount.** It is **VAR-only atoms** (the collector filters by `CoinType == cointype.CoinTypeVAR` at `collector.go:107-113`). For an SKA tx, `TotalOut == 0`. Use `SKATotals` for SKA amounts. Both `mempool.tmpl` (Regular table) and `home_mempool.tmpl` now branch on `.SKATotals` per row.
3. **Assuming `SKATotals` may contain multiple coin types.** By chain invariant it has at most one entry; code that loops over it is fine, but assumptions like `len(SKATotals) > 1` are dead branches.
4. **Forgetting the incremental path.** Adding a new aggregated field to `ParseTxns` without mirroring in `addTxToCoinStats` makes the field correct only after the next block boundary — appears as "data lags by one block" bug.
5. **Conflating `MempoolInfo.CoinFills` and `MempoolInfo.MempoolShort.CoinFills`.** They are kept in sync by `StoreMPData` and `Store`. JSON marshalling serialises only the embedded one (`MempoolShort.CoinFills`). The outer `MempoolInfo.CoinFills` exists for in-memory readers; if you read one without updating the other you get inconsistent behaviour between HTTP-rendered pages and JSON snapshots.
6. **Adding a saver that mutates `inv` after `CollectAndStore`.** `CollectAndStore` passes one freshly-allocated `inv` to all savers; `TxHandler` passes a `DeepCopy`. A saver that mutates `inv` in the `CollectAndStore` path can be observed by other savers' goroutines.
7. **Updating the SCSS clamp instead of the JS/Go raw value.** Bars visually clipping at 100% with text showing 150% is intentional. Removing the SCSS clamp produces broken layouts; clamping the value at source breaks the overflow signal.
8. **Assuming `MempoolTx.Fees`/`SKAFeeRates` are computed identically on both collection paths.** They are not: the batch path (`mempoolTxns`) trusts the node's GRM verbose result (`tx.Fee`, `SKAFeeRateMapFromAtoms(tx.SKAFee, …)`), while the incremental path (`TxHandler`) recomputes from the decoded `msgTx` (`TxFeeRate`, `SKAFeeRateMapFromVerboseVin(rawTx.Vin, …)`). The incremental computation depends on `valsIn` being correctly back-filled onto `msgTx.TxIn`; if a prev-out value is missing, the locally-computed `Fees` can disagree with the node's. `FeeRate` is *not* affected — both paths use `TxFeeRate(msgTx)`.
9. **Re-deriving `MempoolTx.Fees` for SKA.** The fee field is in VAR even for SKA txs (per CLAUDE.md chain invariant: SKA tx fees are paid in SKA, but the explorer currently surfaces the raw `dcrutil.Amount` from `txhelpers.TxFeeRate` which is VAR-typed — verify in `monitor.go:243-249` and `collector.go:143-149`). This is a known modelling gap.
10. **`TicketStage` accuracy depends on `txnsStore` snapshot timing.** `ticketStage()` reads `txnsStore` at classification time. If a parent tx is inserted by a concurrent `TxHandler` goroutine that runs between the current handler's lock acquisition and its `ticketStage()` call, the stage may read `"Staging"` even though the parent just arrived. The pessimistic absent-parent fallback is intentional. Self-corrects at the next `CollectAndStore`.

---

### Section 8 — Evidence

- `mempool/collector.go:65-167` — `mempoolTxns()`; VAR-only `totalOut` aggregation; `SKATotalsFromMsgTx` integration.
- `mempool/collector.go:169-206` — `populateMempoolInputs`; per-input coin-type enrichment via TxnsStore + RPC fallback; error logged on failed prev-tx fetch.
- `mempool/collector.go:397-690` — `ParseTxns`; `coinAccum` batch aggregator; `skaPerTypeStr` `"0"` default; fail-fast SKA parse error (logs + skips on `SetString` failure).
- `mempool/collector.go:179-197` — `ticketStage()` function; pessimistic absent-parent fallback.
- `mempool/monitor.go:129-403` — `TxHandler`; tx classification, slice append, incremental `addTxToCoinStats`, DeepCopy fan-out with panic recovery on savers.
- `mempool/monitor.go:462-489` — `CollectAndStore`; fan-out with deep-copied tx slices.
- `mempool/monitor.go:582-654` — `addTxToCoinStats`, `normalizeCoinStatsAmounts`.
- `mempool/monitor.go:654-682` — `addAtomStrings`; SKA: `big.Int.SetString` with error log; VAR: `strconv.ParseInt` returning `"0"` on error.
- `mempool/mempoolcache.go:46-75` — `DataCache.StoreMPData` with `stakeData == nil` guard; conditional `stakeDiff` update with error log.
- `mempool/mptypes.go:15` — `CollectState` struct (replaces the old `MempoolInfo` for monitor's internal state tracking).
- `mempool/monitor_test.go:13-103` — incremental equivalence tests including precision boundary (`"123456789012345678901"` atoms); fixtures use `TxID` (not `Hash`).
- `cmd/dcrdata/internal/explorer/explorer.go:477-502` — `(*explorerUI).StoreMPData`; `types.ComputeCoinFills` call (`:492`) + dual write to `inv.CoinFills` and `inv.MempoolShort.CoinFills`.
- `cmd/dcrdata/internal/explorer/explorer.go:628` — new-block CoinFills recomputation after `SKACoinSupply` refresh.
- `cmd/dcrdata/internal/explorer/explorer.go:568,570` — `WindowRemaining` and `RewardRemaining` populated via `types.RemainingWindowText()`.
- `explorer/types/remaining.go:17` — `RemainingWindowText(idx int, max, blockTime int64) string`; single source of truth for window countdown (used by both `explorerUI.Store` and `PubSubHub.Store` so server render and WS payload can never diverge; cf. issue #502).
- `explorer/types/explorertypes.go:729-747` — `MempoolCoinStats`.
- `explorer/types/explorertypes.go:965-1005` — `MempoolInfo` (`:965`), `DeepCopy` (`:981`) — now copies `Ident` and `CoinFills` correctly.
- `explorer/types/explorertypes.go:1007-1032` — `MempoolInfo.Trim`.
- `explorer/types/explorertypes.go:1148-1153` — `primaryCoinType`.
- `explorer/types/explorertypes.go:1156-1178` — `TrimMempoolTx`; uses `humanize.Bytes()` for `FormattedSize` (`:1167`).
- `explorer/types/explorertypes.go:1214-1340` — `MempoolShort` + `DeepCopy`.
- `explorer/types/explorertypes.go:1473-1495` — `MempoolTx`; `Hash` field removed; `TxID string json:"txid"` (`:1474`) is the sole identifier.
- `explorer/types/explorertypes.go:1494` — `MempoolTx.TicketStage` field (`json:"ticket_stage,omitempty"`).
- `explorer/types/explorertypes.go:496-530` — `FeeReward()`; SKA early-return guard (`:498-500`).
- `explorer/types/explorertypes.go:1748-1762` — `UnspentOutputIndices`; SKA fix (`:1755-1757`).
- `explorer/types/explorertypes.go:904-942` — `HomeInfo`; `WindowRemaining` (`:911`) and `RewardRemaining` (`:913`).
- `cmd/dcrdata/internal/explorer/websockethandlers.go:122-167` — `getmempooltxs`, `getmempooltrimmed`.
- `cmd/dcrdata/internal/explorer/websockethandlers.go:284-324` — `sigMempoolUpdate`, `sigNewTxs` (root WS).
- `pubsub/pubsubhub.go:474-529` — `sigMempoolUpdate`, `sigNewTxs` (pubsub WS).
- `pubsub/pubsubhub.go:620-626` — `PubSubHub.StoreMPData` (assignment only).
- `pubsub/pubsubhub.go:734,736` — `WindowRemaining` and `RewardRemaining` populated in `PubSubHub.Store`.
- `cmd/dcrdata/views/home_mempool.tmpl:21-66` — TotalBar + CoinFills bars + `<template id="fill-bar-template">`.
- `cmd/dcrdata/views/home_mempool.tmpl:117-135` — LatestTransactions table; uses `{{.TxID}}` (was `{{.Hash}}`).
- `cmd/dcrdata/views/mempool.tmpl` — full-page mempool listings; all tx hash links use `{{.TxID}}`.
- `cmd/dcrdata/public/js/controllers/homepage_controller.js:25-269` — handler registration, `updateIndicators` rAF batching, `_flushIndicators`; `mempoolTableRow` uses `tx.txid`.
- `cmd/dcrdata/public/js/helpers/indicator_fill.js:20-168` — JS mirror of `types.ComputeCoinFills`.
- `txhelpers/txhelpers.go:1305-1329` — `SKATotalsFromMsgTx`; nil-return for VAR-only txs.
- `mempool/collector.go:166-169` — batch population of `TicketStage` for ticket purchase txs.
- `mempool/monitor.go:291` — incremental population of `TicketStage` in `TxHandler`.
- `cmd/dcrdata/views/mempool.tmpl:222-234` — `ticketRowTemplate` with `data-slot="ticketStage"`.
- `cmd/dcrdata/public/js/controllers/mempool_controller.js:107-116` — `cloneTicketRow`; `tx.ticket_stage`; uses `tx.txid`.

See also:
- [/wiki/code-analysis/page-rendering/patterns.md](../page-rendering/patterns.md) (shares-pattern-with: out-of-band shared page state; shared-state lock discipline; block-scoped ETag cache)
- [/wiki/code-analysis/page-rendering/impact.md](../page-rendering/impact.md) (depends-on: saver writer/reader drift; lock-order inversion against `Store`)
- [/wiki/code-analysis/mempool/patterns.md](patterns.md) — patterns extracted from this flow.
- [/wiki/code-analysis/mempool/impact.md](impact.md) — mutation impact entries.
- [/wiki/code-analysis/visualblocks/patterns.md](../visualblocks/patterns.md) (shares-pattern-with: **dual-transport WS** for mempool signals).
- [/wiki/code-analysis/address/flow.full.md](../address/flow.full.md) (depends-on: address page consumes `pgb.mp.UnconfirmedTxnsForAddress` for `NumUnconfirmed`).
- [/wiki/core/constraints.md](../../core/constraints.md) (depends-on: C1 precision bifurcation; C2 dual pipeline batch vs incremental).
- [/wiki/specs/mempool/spec.md](../../specs/mempool/spec.md) (product spec for the multi-coin mempool page).
