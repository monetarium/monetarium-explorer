# VisualBlocks Domain Patterns

Recurring patterns and invariants for the `/visualblocks` page. Most are domain-specific; cross-cutting concerns link out to `core/constraints.md`.

## 1. Cross-Pipeline Tile Rendering

The same DOM is produced two ways and then mutated in place:

- **Initial render (HTTP):** server-side template walks `[]*TrimmedBlockInfo` and emits 30 `<div class="block">` tiles plus one mempool tile.
- **Live update (WebSocket):** `visualBlocks_controller` consumes `newblock` and `mempool` events, builds new `<div class="block">` nodes in JS (`makeNode` + `dompurify`), and surgically `insertBefore`/`replaceChild` to mutate the same DOM.

Implications:

- Two render code paths must produce structurally identical DOM (class names, attribute shapes, `data-*` hooks).
- DOM trim is also dual: template clips per-tile internals at `clipSlice 30` when `> 50`; JS trims total tile count via `removeChild` to keep ≤ 30.
- See [core/constraints.md#C3](../../core/constraints.md#C3) (template + WebSocket parity) and [core/constraints.md#C8](../../core/constraints.md#C8) (dual-transport shape asymmetry — the *underlying data* shapes differ even though the *DOM output* must not).

---

## 2. JS-Side Equivalent of a Server Filter

`FilterRegularTx` (Go, drops coinbase only) is the server's projection from `BlockInfo.Tx` to `TrimmedBlockInfo.Transactions`. The same filter is re-implemented client-side as `block.Tx.filter((tx) => !tx.Coinbase)` in `visualBlocks_controller._handleVisualBlocksUpdate` because the WebSocket sends the *unfiltered* `BlockInfo`.

Implications:

- The filter is **load-bearing duplicate code**. If the server filter changes (e.g. drop treasurybase too), the JS must change in the same commit.
- This is the visualblocks-specific manifestation of [core/constraints.md#C8](../../core/constraints.md#C8).

---

## 3. Asymmetric `Subsidy` Struct (Domain Gotcha)

Two different Go types reach the page under the same `.Subsidy` template field:

| Tile           | Go type                                  | Source              | JSON tag for the "fund" field | Template / JS path           |
| -------------- | ---------------------------------------- | ------------------- | ----------------------------- | ---------------------------- |
| Mempool tile   | `BlockSubsidy` (explorertypes.go)        | `HomeInfo.NBlockSubsidy` | `Dev` → `"dev"`             | `{{.Subsidy.Dev}}`           |
| Block tiles    | `chainjson.GetBlockSubsidyResult`        | `BlockInfo.Subsidy` | `Developer` → `"developer"` | `{{.Subsidy.Developer}}`     |
| Live JS tile   | (same as block tile, via WebSocket JSON) | `BlockInfo.Subsidy` | `Developer` → `"developer"` | `subsidy.developer || subsidy.dev` |

Both names appear in `visualblocks.tmpl`. JS uses the `||` fallback. Don't unify by renaming one side only — every consumer (template, JS, both Go structs, the WS encoder, and `pubsub/pubsubhub.go` which duplicates the home subsidy calc) must move together.

---

## 4. Triple-Enforced Display Cap

The 30-tile limit is enforced in three places that all reference the same logical N:

1. **Go:** `homePageBlocksMaxCount = 30` ([cmd/dcrdata/internal/explorer/explorerroutes.go:134](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L134)) — passed to `GetExplorerFullBlocks(ctx, h, h-30)`.
2. **Template:** `clipSlice 30` applied **per-tile-internals** (tickets, txs) when `> 50`. Distinct from the outer 30-tile cap.
3. **JS:** `box.removeChild(box.lastChild)` after each insert (controller line ~258) plus `splice(30)` for per-tile internals.

Implications:

- Changing the outer N requires updating the Go const AND the JS trim. The template `clipSlice 30` governs per-tile detail truncation and is logically distinct (governed by `> 50` threshold).
- Empty-slot constants (`5` votes per tile, `20` tickets+revs per tile) are also hardcoded in both template and JS and reflect stake parameters.

---

## 5. Memoized Single-Block Pointer Share

`pgb.lastExplorerBlock` ([db/dcrpg/pgblockchain.go:6366-6633](../../../db/dcrpg/pgblockchain.go#L6366-L6633)) caches the most recently built `*BlockInfo` keyed by hash. Every caller that requests the same hash gets the *same pointer*. Visualblocks, block page, mempool page, and `/ws` `sigNewBlock` all consume this.

Implications:

- Treat the returned `*BlockInfo` as **read-only** after `GetExplorerBlock` returns. Any handler-side mutation corrupts subsequent callers' views.
- The memo only covers a single hash; calling `GetExplorerFullBlocks(h, h-30)` is still 30 sequential DB+RPC builds — the memo only helps when the most-recent block is fetched repeatedly across pages.

---

## 6. Background-Updated Shared Page State

`exp.pageData` (RWMutex-guarded, BlockInfo + BlockchainInfo + HomeInfo) and `exp.invs` (`invsMtx`-guarded pointer to a `MempoolInfo`, which has its own embedded RWMutex) are mutated only by the background savers (`Store`, `StoreMPData`) and read by every page handler. **Three distinct locks** are in play:

- `pageData.RWMutex` — guards `BlockInfo`/`HomeInfo`/`BlockchainInfo`.
- `invsMtx` (on `explorerUI`) — guards the `*MempoolInfo` pointer itself.
- `MempoolInfo.RWMutex` (embedded in the struct) — guards the mempool data.

Observed acquisition patterns:

- **`Store` (block saver, [explorer.go:547,608](../../../cmd/dcrdata/internal/explorer/explorer.go#L547-L614)):** holds `pageData.Lock()` (write) and **nests** `invsMtx.Lock()` inside it (lines 608-614). Both held simultaneously.
- **`StoreMPData` ([explorer.go:484-507](../../../cmd/dcrdata/internal/explorer/explorer.go#L484-L507)):** takes `pageData.RLock()` (line 484), releases at line 492, *then* takes `invsMtx.Lock()` (line 505). **Not nested.**
- **Readers** (e.g. `VisualBlocks`): take `invsMtx.RLock()` briefly via `MempoolInventory()` (to read the pointer), then `MempoolInfo.RLock()` via `Trim()`, then `pageData.RLock()`. Sequential, not nested.

Implication: the only place two `explorerUI` locks are held concurrently is `Store` (pageData.Lock + invsMtx.Lock, in that order). New code that holds `invsMtx` and then waits on `pageData.Lock` would deadlock against `Store`. Readers as currently written cannot deadlock with the writers.

---

## 7. WebSocket Subsidy Patch

The mempool tile on `/visualblocks` doesn't have its own subsidy data — both the HTTP handler ([explorerroutes.go:358](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L358)) and the WS `getmempooltrimmed` case ([websockethandlers.go:157](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L157)) copy `exp.pageData.HomeInfo.NBlockSubsidy` onto `mempoolInfo.Subsidy` just before serializing.

Implication: Any change to `HomeInfo.NBlockSubsidy` shape (including the duplicated calc in `pubsub/pubsubhub.go`) must keep this patch valid on both paths.

---

See also:

- [core/constraints.md#C8](../../core/constraints.md#C8) — dual-transport shape asymmetry (the umbrella for patterns 1, 2, 3 here).
- [code-analysis/block/patterns.md](../block/patterns.md) — the same fan-out / dual-pipeline pattern at the BlockData layer.
