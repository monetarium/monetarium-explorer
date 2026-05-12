## Risk: SKA precision lost via `float64` coercion

**Trigger:**
Anywhere an SKA atom string (`MempoolCoinStats.Amount`, per-type `*Amount`, `MempoolTx.SKATotals` value, `CoinFillData.Symbol`-keyed value) is parsed into a `float64` or passed through `dcrutil.Amount.ToCoin()`.

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/charts/flow.full.md](../charts/flow.full.md)
- [/wiki/code-analysis/transaction/flow.full.md](../transaction/flow.full.md)

**Failure mode:** silent.

**Description:**
SKA uses 18 decimal places; an 18-decimal value > 10 already exceeds `float64`'s 53-bit significand, so the last digits are truncated/rounded with no error signal. The cooperative arithmetic helper `addAtomStrings(..., isBig=true)` and the batch `coinAccum.skaAmt map[uint8]*big.Int` are the only safe paths. Failure surfaces only when a user spot-checks a large SKA balance — by then the wrong value has been stored, broadcast, and rendered.

---

## Risk: Batch and incremental `CoinStats` paths drift

**Trigger:**
Adding a new aggregated field on `MempoolCoinStats` (or a new tx-type bucket) in only one of `ParseTxns` ([mempool/collector.go:519-644](../../../mempool/collector.go)) or `addTxToCoinStats` ([mempool/monitor.go:545-617](../../../mempool/monitor.go)).

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Failure mode:** silent until the next block boundary, then loud.

**Description:**
Mempool state can come from either path. The incremental path (`TxHandler`) is what produces the snapshot between blocks; the batch path (`CollectAndStore`) overrides it at every new block. A field implemented only in the batch path will appear to "lag by one block": correct at block boundary, drifts back to default during the block window. A field implemented only in the incremental path resets on every new block. Both manifest as flaky data depending on when the user loads the page. Tests in [mempool/monitor_test.go](../../../mempool/monitor_test.go) only cover the incremental path; the batch path is currently uncovered.

---

## Risk: `CoinFills` not recomputed when new SKA coin issued

**Trigger:**
Adding a new SKA coin type via on-chain issuance and skipping/breaking the recompute branch in `(*explorerUI).Store` ([cmd/dcrdata/internal/explorer/explorer.go:596-615](../../../cmd/dcrdata/internal/explorer/explorer.go)).

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/charts/flow.full.md](../charts/flow.full.md)

**Failure mode:** silent.

**Description:**
A newly issued SKA coin enters `HomeInfo.SKACoinSupply` only after `Store` refreshes it. `computeCoinFills` uses this set as `issuedSKA` so coins with no current mempool activity still render a zero-fill bar. If the recompute branch in `Store` is removed or guarded incorrectly, a freshly issued SKA coin will have no bar at all until its first mempool transaction triggers `(*explorerUI).StoreMPData`, which by then has the updated supply already. The window is short (next block), but the UX gap shows up in screenshots and CI fixtures.

---

## Risk: Saver misbehaves when `stakeData == nil`

**Trigger:**
A new `MempoolDataSaver` implementation reads `stakeData.Anything` without nil-checking, OR existing logic before the nil-guard in `DataCache.StoreMPData` is moved out.

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Failure mode:** loud (nil-deref panic) on every new mempool tx.

**Description:**
`TxHandler` calls all registered savers with `stakeData=nil` and `txsCopy=nil`. Only `inv` is non-nil. `DataCache.StoreMPData` explicitly returns at `mempoolcache.go:49-51`; `explorerUI` and `PubSubHub` only read `inv`. A saver that assumes `stakeData != nil` will panic on the first mempool tx after startup.

---

## Risk: `MempoolShort` field added without updating `DeepCopy` / `Trim`

**Trigger:**
Adding a new field on `MempoolShort` (or `MempoolInfo`) and forgetting to update `MempoolShort.DeepCopy` ([explorer/types/explorertypes.go:1174-1248](../../../explorer/types/explorertypes.go)) and/or `MempoolInfo.Trim` ([:905-942](../../../explorer/types/explorertypes.go)).

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/visualblocks/flow.full.md](../visualblocks/flow.full.md)

**Failure mode:** silent.

**Description:**
`DeepCopy` is used by `TxHandler` to hand savers a detached snapshot. A missing field there means the snapshot reverts to its zero value, so the saver/WS encoder sees stale data on the incremental path while batch-path payloads (which use the live inventory directly) look correct. `Trim` is the source for `TrimmedMempoolInfo` consumed by VisualBlocks (`getmempooltrimmed`); a missing field there silently drops it from that page only.

---

## Risk: WebSocket payload schema drift between transports

**Trigger:**
Changing the `sigMempoolUpdate` or `sigNewTxs` payload shape in only one of [cmd/dcrdata/internal/explorer/websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go) or [pubsub/pubsubhub.go](../../../pubsub/pubsubhub.go).

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/visualblocks/flow.full.md](../visualblocks/flow.full.md)

**Failure mode:** silent for one transport, loud for the other if JS parsing is strict.

**Description:**
Both files build the same anonymous payload struct by hand (`{Txs, CoinFills, TotalFillRatio, ActiveSKACount}` for `sigNewTxs`; `inv.MempoolShort` for `sigMempoolUpdate`). There's no shared encoder. A client connected to the root explorer WS receives a different shape than one connected via PubSub, and the divergence may not surface until a specific page or subscription is exercised.

---

## Risk: `CoinFillData` Go ↔ JS drift

**Trigger:**
Modifying `computeCoinFills` output shape (new field, renamed JSON tag, status string change) in Go without updating [public/js/helpers/indicator_fill.js](../../../cmd/dcrdata/public/js/helpers/indicator_fill.js) and the `<template id="fill-bar-template">` in [home_mempool.tmpl](../../../cmd/dcrdata/views/home_mempool.tmpl).

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Failure mode:** silent (indicators stop updating or update with `undefined` widths).

**Description:**
JS reads `entry.symbol`, `entry.gq_fill_ratio`, `entry.pct_of_tc`, etc. directly from the JSON payload; there's no contract enforcement. Renamed tags or new fields don't error — bars simply stop animating, or render with empty widths. Dev fixtures in [dev_indicators.go](../../../cmd/dcrdata/internal/explorer/dev_indicators.go) exercise the Go path only and won't catch JS-side drift.

---

## Risk: Lock-order inversion on inventory

**Trigger:**
Code that takes `MempoolInfo.RWMutex` before `MempoolMonitor.mtx`, OR holds `MempoolInfo.Lock()` and calls a function that internally takes `MempoolInfo.RLock()` (e.g. `DeepCopy`).

**Affected flows:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Failure mode:** loud (deadlock), but only under contention.

**Description:**
The canonical order is `p.mtx` (pointer) → `p.inventory` (contents). `Refresh` swaps the pointer under `p.mtx.Lock()` while readers hold `p.mtx.RLock()`. `DeepCopy` re-locks `mpi.RLock()` internally; calling it while already holding `mpi.Lock()` deadlocks. May go unnoticed in unit tests (no concurrency) and only surface under load.
