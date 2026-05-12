## Dual collection path: batch (block boundary) + incremental (per tx)

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Description:**
`MempoolMonitor` maintains the canonical `*exptypes.MempoolInfo` via two parallel update paths that must produce equivalent state:

- **Batch:** `CollectAndStore` → `Refresh` → `ParseTxns` runs at every new block and on startup; iterates `[]MempoolTx` and builds aggregates from scratch using internal `coinAccum` structs with native `int64` / `*big.Int` accumulators, formatting to atom strings only at the end.
- **Incremental:** `TxHandler` runs on every new tx; appends to the appropriate slice and updates `MempoolInfo.CoinStats` in place via `addTxToCoinStats`, using `addAtomStrings(..., isBig)` to keep VAR/SKA precision separated.

Both paths normalise per-type `*Amount` fields to `"0"` when no tx of that type has contributed, so the JSON contract is identical regardless of which path produced the snapshot.

**Constraints:**
- Any new aggregated field on `MempoolCoinStats` (or any other batch output) MUST be added in both `ParseTxns` and `addTxToCoinStats`.
- The incremental path uses `addAtomStrings` with explicit `isBig` flag; the batch path uses native accumulators. Mixing the two within one path (e.g. adding a string-based accumulator inside `ParseTxns`) risks precision loss.
- Unit tests covering the incremental path live in [mempool/monitor_test.go](../../../mempool/monitor_test.go); add new field assertions there when extending `MempoolCoinStats`.

---

## Multi-saver fan-out via `MempoolDataSaver`

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Description:**
`MempoolMonitor` holds `[]MempoolDataSaver` and dispatches mempool snapshots to each (in a goroutine per saver). The interface is `StoreMPData(*StakeData, []exptypes.MempoolTx, *exptypes.MempoolInfo)`. Three implementations coexist:

| Saver | Block boundary (CollectAndStore) | Per-tx (TxHandler, `stakeData == nil`) |
|---|---|---|
| `mempool.DataCache` | Stores stake-related fields | **Early-returns** (nil guard at `mempoolcache.go:49-51`) |
| `explorer.explorerUI` | Recomputes `CoinFills` + assigns `exp.invs` | Same (drives indicator update without waiting for next block) |
| `pubsub.PubSubHub` | Assigns `psh.invs` | Same |

The incremental path is the reason `TxHandler` exists: live `CoinFills` indicators must update on every tx, not just on block boundaries.

**Constraints:**
- Every new saver MUST tolerate `stakeData == nil` without corrupting state.
- `TxHandler` passes a `DeepCopy` to savers; `CollectAndStore` shares one `*MempoolInfo` between savers (slice is deep-copied per saver, but the struct pointer is shared). Mutating the inventory inside a saver is unsafe in the block path.
- Only `explorerUI` computes `CoinFills`. `PubSubHub` consumes them. There's no ordering enforcement between saver goroutines — currently safe because `PubSubHub` reads `CoinFills` only on the next WS tick.

---

## Dual-transport WebSocket mempool delivery

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/visualblocks/flow.full.md](../visualblocks/flow.full.md)

**Description:**
Mempool updates are emitted on **two parallel WebSocket pipelines** that serve identical JSON shapes:

- **Root explorer WS:** [cmd/dcrdata/internal/explorer/websockethandlers.go](../../../cmd/dcrdata/internal/explorer/websockethandlers.go) — handles `getmempooltxs` (full `MempoolInfo`), `getmempooltrimmed` (`TrimmedMempoolInfo` for VisualBlocks), and push events `sigMempoolUpdate(MempoolShort)` / `sigNewTxs({Txs, CoinFills, TotalFillRatio, ActiveSKACount})`.
- **PubSub WS:** [pubsub/pubsubhub.go](../../../pubsub/pubsubhub.go) — emits the same `sigMempoolUpdate(MempoolShort)` / `sigNewTxs({…})` payloads. Subscription-aware via `client.isSubscribed`.

Each transport owns its own `invs` pointer + mutex; both implement `MempoolDataSaver` and read the `CoinFills` previously written by `explorerUI`.

**Constraints:**
- Any change to the mempool WS payload schema MUST be applied in **both** files. They have no shared encoder.
- The `sigNewTxs` payload snapshots `MempoolShort.CoinFills` at the moment of encoding, so the client sees fills consistent with the tx that triggered the broadcast.
- Shares the broader **dual-transport** pattern with VisualBlocks; see [/wiki/code-analysis/visualblocks/patterns.md](../visualblocks/patterns.md).

---

## Atom-string arithmetic for multi-precision aggregation

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)
- [/wiki/code-analysis/charts/flow.full.md](../charts/flow.full.md)

**Description:**
Per-coin aggregate amounts (`MempoolCoinStats.Amount`, `RegularAmount`, etc.) are stored as **decimal-atom strings**, not numeric types, so the same field can losslessly carry VAR (8-decimal `int64`) or SKA (18-decimal `*big.Int`) values. Arithmetic uses `addAtomStrings(a, b, isBig bool)`:

- `isBig == true` → parse both with `big.Int.SetString` and add; on parse failure, return `a` unchanged (silent skip).
- `isBig == false` → `fmt.Sscan` into `int64` and sum.
- Empty `a` returns `b` as-is.

Per-type fields default to `"0"` (not `""`) so the JSON contract is stable regardless of which tx types have appeared in the mempool.

**Constraints:**
- Pass `isBig=true` for any SKA coin-type key; passing `false` silently truncates to `int64`.
- Don't introduce a path that converts an SKA atom string to `float64` for arithmetic — precision loss past ~17 sig figs.
- Empty fields must be normalised to `"0"` before serialisation (incremental: `normalizeCoinStatsAmounts`; batch: `skaPerTypeStr` / `fmt.Sprintf("%d", 0)`).

---

## Derived view written into two places

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Description:**
`CoinFills` is a **derived** view computed from `CoinStats` and the `issuedSKA` set. It is written into the same `MempoolInfo` from **two different triggers**:

1. `(*explorerUI).StoreMPData` — runs on every mempool change (per-tx or block-boundary fan-out from `MempoolMonitor`).
2. `(*explorerUI).Store` — runs on every new block, after `HomeInfo.SKACoinSupply` is refreshed from the DB. This is the only path where newly issued SKA coins enter the `issuedSKA` set, so it's the only path that can attach a zero-fill bar for a brand-new coin type before its first mempool tx.

Both call sites also write to **two struct fields**: `inv.CoinFills` (legacy, for in-memory readers) and `inv.MempoolShort.CoinFills` (JSON-serialised).

**Constraints:**
- Changes to `computeCoinFills` inputs or outputs need both call sites updated.
- Changes to the field set need both `inv.CoinFills` and `inv.MempoolShort.CoinFills` written; otherwise HTTP-rendered pages drift from JSON snapshots.
- The JS mirror in [public/js/helpers/indicator_fill.js](../../../cmd/dcrdata/public/js/helpers/indicator_fill.js) must track the Go output shape; divergence is silent.

---

## Inventory locking: pointer mutex + contents mutex

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Description:**
Mempool state uses two locks:

- `MempoolMonitor.mtx sync.RWMutex` — guards the **pointer** `p.inventory *MempoolInfo`. `Refresh()` takes the write lock to swap in a new inventory.
- `MempoolInfo.RWMutex` (embedded) — guards the **contents** of the inventory struct (slices, maps, counters).

Standard access pattern in `TxHandler`: `p.mtx.RLock()` (pin the pointer) → `p.inventory.Lock()` (mutate contents) → release in reverse order. `DeepCopy` takes only the contents `RLock`. Replacing the pointer takes only `p.mtx.Lock()`.

**Constraints:**
- Always take `p.mtx` before `p.inventory`. Reversing risks deadlock with `Refresh`.
- `DeepCopy` already locks; don't wrap calls to it in another `RLock`/`Lock` of the same instance.
- After `Refresh` swaps the pointer, in-flight readers holding the old pointer still see consistent state (Go GC retains the old struct until they release).

---

## rAF-batched live indicator updates

**Appears in:**
- [/wiki/code-analysis/mempool/flow.full.md](flow.full.md)

**Description:**
`homepage_controller.js` funnels all indicator DOM writes through `updateIndicators(payload)` which schedules a single `requestAnimationFrame` flush. If multiple WS payloads arrive within the same frame, only the latest is rendered (older payloads are dropped, not queued). Bars for coins no longer present in the payload are zeroed via `zeroFillEntry`, **not removed** — so transient absence (e.g. mempool draining) doesn't cause DOM churn.

**Constraints:**
- New indicator update paths must go through `updateIndicators`, not write DOM directly.
- The `[data-coin="SKA{n}"]` attribute is the identity key; rename and you break re-targeting.
- The `<template id="fill-bar-template">` element in [home_mempool.tmpl](../../../cmd/dcrdata/views/home_mempool.tmpl) is the source of truth for new SKA bar markup. Editing the inline `<div class="fill-bar">` without also editing the template causes dynamically-injected bars to differ from server-rendered ones.
