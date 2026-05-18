# VisualBlocks Domain — Mutation Impact

## When modifying: the `/visualblocks` page or its backing data

You MUST verify all of the following layers, because the page has **two transport paths** that carry different shapes of the same logical entity (see [patterns.md#1](patterns.md) and [core/constraints.md#C8](../../core/constraints.md#C8)).

---

## 1. Direct Consumers

### HTTP handler

- File: [cmd/dcrdata/internal/explorer/explorerroutes.go:320-382](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L320-L382) (`VisualBlocks`)
- Reads: `dataSource.GetHeight`, `GetExplorerFullBlocks`, `MempoolInventory().Trim()`, `pageData.HomeInfo.NBlockSubsidy`.
- Risk: compile-time break if any field projected into `TrimmedBlockInfo` is renamed.

### Template

- File: [cmd/dcrdata/views/visualblocks.tmpl](../../../cmd/dcrdata/views/visualblocks.tmpl)
- Reads: `.Info` (HomeInfo), `.Mempool` (TrimmedMempoolInfo with patched `Subsidy`), `.Blocks` (`[]*TrimmedBlockInfo`).
- Risk: template-execution error (visible at request time, not compile time) if a `.Field` reference loses its backing field.

### JS Controller

- File: [cmd/dcrdata/public/js/controllers/visualBlocks_controller.js](../../../cmd/dcrdata/public/js/controllers/visualBlocks_controller.js)
- Reads (from WS `newblock`): `block.Tx`, `block.Votes`, `block.Revs`, `block.MiningFee`, `block.TotalSent`, `block.time`, `block.height`, `block.Subsidy.{pow,pos,developer,dev}`.
- Reads (from WS `getmempooltrimmedResp`): `mempool.{Transactions, Votes, Tickets, Revocations, Subsidy.pow/pos/dev, Total, Time}`.

---

## 2. Indirect Consumers (Same WebSocket Frames)

`sigNewBlock` emits the **full** `BlockInfo` over `/ws`. Many controllers subscribe to `BLOCK_RECEIVED`:

- `home_latest_blocks_controller.js`
- `status_controller.js`
- `blocks_controller.js`
- `time_controller.js`
- `address_controller.js`

If you rename a field on `BlockInfo` (Go struct tag), every one of these must be checked. A breaking change here is **silent on `/visualblocks` until the next block arrives**.

---

## 3. Serialization Boundaries

### HTTP (server-rendered)

- Format: HTML via Go templates, fed by `TrimmedBlockInfo` (Go struct, drops Treasury / StakeFees, applies `FilterRegularTx`).

### WebSocket — new block

- Format: `json.Encode(types.WebsocketBlock{Block:*BlockInfo, Extra:*HomeInfo})` at [websockethandlers.go:271-282](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L271-L282).
- **Full** `BlockInfo`, not trimmed. Client re-implements `FilterRegularTx`.

### WebSocket — mempool

- Format: `json.Encode(*TrimmedMempoolInfo)` at [websockethandlers.go:150-167](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L150-L167), with `Subsidy` patched from `HomeInfo.NBlockSubsidy`.

Risk: breaking one boundary without the other → page renders correctly until the next push, then silently drifts.

---

## 4. Background Updaters (Shared State)

### `Store` (BlockDataSaver)

- File: [cmd/dcrdata/internal/explorer/explorer.go:514-934](../../../cmd/dcrdata/internal/explorer/explorer.go#L514-L934)
- Mutates `pageData.BlockInfo`, `pageData.HomeInfo`, `exp.invs.CoinFills`.
- Fires `sigNewBlock` + `sigMempoolUpdate`.

### `StoreMPData` (MempoolDataSaver)

- File: [cmd/dcrdata/internal/explorer/explorer.go:480-512](../../../cmd/dcrdata/internal/explorer/explorer.go#L480-L512)
- Mutates `exp.invs`; computes `CoinFills` against `HomeInfo.SKACoinSupply`.

### Duplicate calc in PubSub

- File: `pubsub/pubsubhub.go` (per CLAUDE.md, home subsidy/reward math is duplicated). Any change to `HomeInfo.NBlockSubsidy` must mirror.

---

## 5. Database Layer

### `GetExplorerFullBlocks` + `GetExplorerBlock`

- Files: [db/dcrpg/pgblockchain.go:7172-7188](../../../db/dcrpg/pgblockchain.go#L7172-L7188), [:6366-6633](../../../db/dcrpg/pgblockchain.go#L6366-L6633).
- `lastExplorerBlock` memo at `:6371-6376` returns a **shared pointer** to multiple page consumers.

Risk: mutating the returned `*BlockInfo` in any handler corrupts all downstream consumers (see [patterns.md#5](patterns.md)).

---

## 6. Loud Failures (Compile / Runtime Errors)

| Change                                                          | Effect                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Remove `block.Tx` from `BlockInfo`                              | Go: `FilterRegularTx(block.Tx)` nil-deref at `explorerroutes.go:347`. JS: `block.Tx.filter(...)` runtime error. |
| Remove `HomeInfo.NBlockSubsidy`                                 | Compile failure at `explorerroutes.go:358` and `websockethandlers.go:157`.    |
| Remove `MempoolInfo.Trim()`                                     | Compile failure at `explorerroutes.go:355` and `websockethandlers.go:154`.    |
| Rename `TrimmedBlockInfo.Total` / `.Fees`                       | Template parse error at request time.                                          |
| Change `WebsocketBlock` JSON tag for `block` or `extra`         | JS sees `undefined` → first `block.Tx.filter` crashes immediately on next push. |

---

## 7. Silent Failures (High Risk)

### Precision corruption

- A SKA-only regular tx flows through `dcrutil.Amount.ToCoin() float64` ([pgblockchain.go:6594-6605](../../../db/dcrpg/pgblockchain.go#L6594-L6605)).
- Its `tx.Total` (float64) becomes the `flex-grow` of the tile — the SKA tile silently dominates its row.
- See [core/constraints.md#C1](../../core/constraints.md#C1).

### Subsidy field-name one-sided rename

- Rename `BlockSubsidy.Dev → Developer` without touching the chainjson side OR the JS `||` fallback → the mempool tile's "fund" bar silently collapses to 0 width.

### New `TrimmedBlockInfo` field added to template only

- Initial 30 tiles show the field. Newly-pushed WS tiles miss it because the JS controller hasn't been updated. Page looks correct on reload, silently drifts.
- This is the canonical [core/constraints.md#C8](../../core/constraints.md#C8) failure mode for this domain.

### Mutated memoized `*BlockInfo`

- Any handler that mutates `block.Tx`/`block.Votes` post-`GetExplorerBlock` will corrupt the block-page view and subsequent visualblocks page loads until the next block invalidates the memo.

### `pubsub/pubsubhub.go` divergence

- One-sided fix to home-page subsidy calc → visualblocks mempool tile's PoW/PoS/Dev bars silently disagree with what `/ps` clients see.

### Tooltip `title` attribute drift

- The JS `setupTooltips` does `JSON.parse(tooltipElement.title)`. A non-JSON `title` silently disables the tooltip on that element (the `catch {}` block at lines 343-345 swallows the error).

### Lock-order inversion (narrow)

- `Store` is the only path that holds two `explorerUI` locks concurrently: `pageData.Lock()` first, then `invsMtx.Lock()` nested. Any new code that holds `invsMtx` and then waits on `pageData.Lock` would deadlock against `Store`. Current readers and `StoreMPData` acquire sequentially without nesting and cannot deadlock. See [patterns.md#6](patterns.md) for the full lock map.

---

## 8. Out-of-Scope Drops (Known Silent Filtering)

The handler **does not** project the following BlockInfo fields onto `TrimmedBlockInfo`:

- `Treasury` (treasury txs)
- `StakeFees` (SSFee distribution)
- `CoinAmounts`, `TotalSentByCoin`, `RegularCoinCounts`, `FeesByCoin` (multi-coin per-block aggregates)
- `SKAPoWRewards` (per-coin PoW reward)

`/visualblocks` is intentionally VAR-centric. Surfacing any of these requires widening `TrimmedBlockInfo` with atom-string fields **and** matching JS work — not adding more float64.

---

## 9. Safe-Change Checklist

Before committing changes that touch the visualblocks data path:

- [ ] HTTP handler updated AND `visualblocks.tmpl` renders the change correctly.
- [ ] JS controller (`visualBlocks_controller.js`) renders the change identically on the next WS push.
- [ ] If touching `BlockInfo`: every other `BLOCK_RECEIVED` subscriber (home, blocks, status, time, address) verified.
- [ ] If touching `HomeInfo.NBlockSubsidy`: mirrored in `pubsub/pubsubhub.go`.
- [ ] If touching the 30-cap: Go const AND JS `removeChild`/`splice` updated.
- [ ] No mutation of the `*BlockInfo` returned by `GetExplorerBlock`.
- [ ] No new code path holds `invsMtx` while waiting on `pageData.Lock` (would deadlock against `Store`, the only path that nests these two locks).
- [ ] No SKA atom-string routed through `float64` / `dcrutil.Amount.ToCoin()` before the template/JS boundary.
- [ ] `Subsidy` field-name asymmetry (`Dev` vs `Developer`) accounted for on every touched surface.

---

See also:

- [code-analysis/visualblocks/patterns.md](patterns.md) — the patterns these risks emerge from.
- [code-analysis/block/impact.md](../block/impact.md) — the upstream `BlockData` mutation impact; `/visualblocks` inherits it via `GetExplorerBlock` + WS `sigNewBlock`.
- [core/constraints.md#C8](../../core/constraints.md#C8) — dual-transport shape asymmetry, the umbrella for the silent-drift risks above.
