# VisualBlocks Domain Patterns

Recurring patterns and invariants for the `/visualblocks` page. Most are domain-specific; cross-cutting concerns link out to `core/constraints.md`.

Revision: `HEAD=386f2e12` (post PR #284 `feat/visualblocks-data-contract`).

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
- PR #284 did NOT collapse this asymmetry — only the four contract fields below are aligned across HTTP and WS. The transactions slice, the coinbase filter, and the field-name asymmetry (`Tx` vs `Transactions`) remain.

---

## 3. Cross-Transport Contract via WS Shallow-Copy + Trim Patch (PR #284)

Introduced by PR #284 to selectively align four fields between HTTP and WebSocket without flattening the rest of the asymmetry:

- HTTP path: `(*BlockInfo).Trim(maxBlockSize, issuedSKA)` produces `*TrimmedBlockInfo` with `CoinFills` / `ActiveSKACount` / `MaxBlockSize` / `RegularCoinCounts` populated.
- WS path: handler does `blockCopy := *pageData.BlockInfo`, computes `trimmed := block.Trim(...)`, patches `blockCopy.CoinFills = trimmed.CoinFills; blockCopy.ActiveSKACount = trimmed.ActiveSKACount; blockCopy.MaxBlockSize = trimmed.MaxBlockSize`, then encodes `&blockCopy`. The promoted `BlockInfo.RegularCoinCounts` (was `json:"-"`) is already on the struct, so no extra patch needed.
- `visualblocks_contract_test.go:TestVisualBlocksDataContract.BlockWSWireFormatEquivalence` asserts the four fields are byte-for-byte identical between transports.

Implications:

- The shallow copy is **load-bearing**: `pageData.BlockInfo` aliases the memoized `pgb.lastExplorerBlock` pointer (see pattern 5). Writing the patched fields directly would corrupt every other consumer of that pointer.
- To add a fifth contract field: (a) add it to both `TrimmedBlockInfo` and `BlockInfo` JSON, (b) populate it in `(*BlockInfo).Trim`, (c) patch it onto `blockCopy` in the `sigNewBlock` handler, (d) add an assertion to the contract test. Skip any step and C8 silent-drift returns.
- `pubsub/pubsubhub.go`'s `sigNewBlock` was NOT updated to apply the same patch — `/ps` subscribers receive `state.BlockInfo` with the new fields zero/nil. This is a known asymmetry between explorer `/ws` and pubsub `/ps` introduced by PR #284.

---

## 4. Asymmetric `Subsidy` Struct (Domain Gotcha)

Two different Go types reach the page under the same `.Subsidy` template field:

| Tile           | Go type                                  | Source              | JSON tag for the "fund" field | Template / JS path           |
| -------------- | ---------------------------------------- | ------------------- | ----------------------------- | ---------------------------- |
| Mempool tile   | `BlockSubsidy` (explorertypes.go)        | `HomeInfo.NBlockSubsidy` | `Dev` → `"dev"`             | `{{.Subsidy.Dev}}`           |
| Block tiles    | `chainjson.GetBlockSubsidyResult`        | `BlockInfo.Subsidy` | `Developer` → `"developer"` | `{{.Subsidy.Developer}}`     |
| Live JS tile   | (same as block tile, via WebSocket JSON) | `BlockInfo.Subsidy` | `Developer` → `"developer"` | `subsidy.developer || subsidy.dev` |

Both names appear in `visualblocks.tmpl`. JS uses the `||` fallback. Don't unify by renaming one side only — every consumer (template, JS, both Go structs, the WS encoder, and `pubsub/pubsubhub.go` which duplicates the home subsidy calc) must move together. Unchanged by PR #284.

---

## 5. Triple-Enforced Display Cap

The 30-tile limit is enforced in three places that all reference the same logical N:

1. **Go:** `homePageBlocksMaxCount = 30` ([cmd/dcrdata/internal/explorer/explorerroutes.go:135](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L135)) — passed to `GetExplorerFullBlocks(ctx, h, h-30)`.
2. **Template:** `clipSlice 30` applied **per-tile-internals** (tickets, txs) when `> 50`. Distinct from the outer 30-tile cap.
3. **JS:** `box.removeChild(box.lastChild)` after each insert (controller line ~258) plus `splice(30)` for per-tile internals.

Implications:

- Changing the outer N requires updating the Go const AND the JS trim. The template `clipSlice 30` governs per-tile detail truncation and is logically distinct (governed by `> 50` threshold).
- Empty-slot constants (`5` votes per tile, `20` tickets+revs per tile) are also hardcoded in both template and JS and reflect stake parameters.

---

## 6. Memoized Single-Block Pointer Share

`pgb.lastExplorerBlock` ([db/dcrpg/pgblockchain.go:6366-6633](../../../db/dcrpg/pgblockchain.go#L6366-L6633)) caches the most recently built `*BlockInfo` keyed by hash. Every caller that requests the same hash gets the *same pointer*. Visualblocks, block page, mempool page, and `/ws` `sigNewBlock` all consume this.

Implications:

- Treat the returned `*BlockInfo` as **read-only** after `GetExplorerBlock` returns. Any handler-side mutation corrupts subsequent callers' views.
- The memo only covers a single hash; calling `GetExplorerFullBlocks(h, h-30)` is still 30 sequential DB+RPC builds — the memo only helps when the most-recent block is fetched repeatedly across pages.
- **Canonical safe-augmentation pattern (PR #284):** shallow-copy the struct (`blockCopy := *block`), patch the additional fields on the copy, encode the copy. This pattern is now active in `websockethandlers.go:sigNewBlock` for `CoinFills`/`ActiveSKACount`/`MaxBlockSize` and is the reference for any future contract-field addition.

---

## 7. Trim Methods on the Types Package (PR #284)

PR #284 moved the trim logic out of the handlers and into `explorer/types/explorertypes.go`:

- `(*BlockInfo).Trim(maxBlockSize, issuedSKA) *TrimmedBlockInfo` — extracts coinbase size, calls `StatsFromCoinRows` → `ComputeCoinFills`, returns a fully populated `TrimmedBlockInfo`. Replaces ~17 lines of inline construction in `VisualBlocks`.
- `(*MempoolInfo).Trim(maxBlockSize) *TrimmedMempoolInfo` — signature changed; `maxBlockSize` is now needed to populate `TrimmedMempoolInfo.MaxBlockSize`. Switched to `defer mpi.RUnlock()` so RLock is held throughout fee summation (previously released before).
- `ComputeCoinFills` and `StatsFromCoinRows` are exported helpers on the types package; previously `computeCoinFills` was unexported in `cmd/dcrdata/internal/explorer`.

Implications:

- Signature changes propagate to every caller. PR #284 already updated: `explorerroutes.go:VisualBlocks`, `websockethandlers.go:getmempooltrimmed` + `sigNewBlock`, `pubsub/pubsubhub.go:getmempooltxs`, `home_viewmodel_test.go`, `dev_indicators.go`, `templates_test.go`. Future signature changes must update all of them.
- Reusing `(*BlockInfo).Trim` from other handlers is now possible — the trim is no longer baked into `/visualblocks`.
- `StatsFromCoinRows` subtracts coinbase size from VAR's row so the coinbase doesn't inflate the VAR fill bar — this asymmetry between "block-level fill" and "mempool fill" lives in `StatsFromCoinRows`, not in `ComputeCoinFills`.

---

## 8. Background-Updated Shared Page State

`exp.pageData` (RWMutex-guarded, BlockInfo + BlockchainInfo + HomeInfo) and `exp.invs` (`invsMtx`-guarded pointer to a `MempoolInfo`, which has its own embedded RWMutex) are mutated only by the background savers (`Store`, `StoreMPData`) and read by every page handler. **Three distinct locks** are in play:

- `pageData.RWMutex` — guards `BlockInfo`/`HomeInfo`/`BlockchainInfo`.
- `invsMtx` (on `explorerUI`) — guards the `*MempoolInfo` pointer itself.
- `MempoolInfo.RWMutex` (embedded in the struct) — guards the mempool data.

Observed acquisition patterns (post PR #284):

- **`Store` (block saver, [explorer.go:547,608](../../../cmd/dcrdata/internal/explorer/explorer.go#L547-L614)):** holds `pageData.Lock()` (write) and **nests** `invsMtx.Lock()` inside it (lines 608-614). Both held simultaneously.
- **`StoreMPData` ([explorer.go:484-507](../../../cmd/dcrdata/internal/explorer/explorer.go#L484-L507)):** takes `pageData.RLock()` (line 484), releases at line 492, *then* takes `invsMtx.Lock()` (line 505). **Not nested.**
- **`VisualBlocks` handler:** takes `pageData.RLock` to snapshot `maxBlockSize` + `issuedSKA` (`:339-345`), releases; then `invsMtx.RLock` briefly via `MempoolInventory()`, then `MempoolInfo.RLock` via `Trim()`; then re-acquires `pageData.RLock` to patch `Subsidy` and execute the template (`:356-371`).
- **`websockethandlers.go:getmempooltrimmed`** ([:189-209](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L189-L209)): **lock-order-reshuffled by PR #284** — `pageData.RLock` snapshot first, release, then `inv.Trim` (takes `MempoolInfo.RLock`), then patch `Subsidy`. Previously: `Trim` then `pageData.RLock` (nested while `MempoolInfo.RLock` was held). The new order avoids overlap.
- **`pubsub/pubsubhub.go:getmempooltxs`** ([:319-340](../../../pubsub/pubsubhub.go#L319-L340)): same refactor — `psh.state.mtx.RLock` snapshot first, then `inv.Trim`.
- **`MempoolInfo.Trim`** ([explorertypes.go:949](../../../explorer/types/explorertypes.go#L949)): now `defer mpi.RUnlock()` — RLock held for the entire function body, including the fee summation loop (was previously released before the loop).

Implication: the only place two `explorerUI` locks are held concurrently is `Store` (pageData.Lock + invsMtx.Lock, in that order). New code that holds `invsMtx` (or `MempoolInfo.RLock`) and then waits on `pageData.Lock` would deadlock against `Store`. The PR #284 refactor of `getmempooltrimmed`/`getmempooltxs` was deliberate prophylaxis against that class.

---

## 9. WebSocket Subsidy Patch

The mempool tile on `/visualblocks` doesn't have its own subsidy data — both the HTTP handler ([explorerroutes.go:357](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L357)) and the WS `getmempooltrimmed` case ([websockethandlers.go:200](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L200)) copy `exp.pageData.HomeInfo.NBlockSubsidy` onto `mempoolInfo.Subsidy` just before serializing.

Implication: Any change to `HomeInfo.NBlockSubsidy` shape (including the duplicated calc in `pubsub/pubsubhub.go`) must keep this patch valid on both paths.

---

## 10. Cross-Transport Contract Test (PR #284)

`cmd/dcrdata/internal/explorer/visualblocks_contract_test.go:TestVisualBlocksDataContract` is the first cross-transport contract test in this codebase. It:

- Builds a `*BlockInfo` fixture with `BlockBasic` + `CoinRows` + a coinbase + a vote-bearing tx + `RegularCoinCounts`.
- Serializes both transports' wire format (`(*BlockInfo).Trim` → JSON for HTTP, shallow-copy `BlockInfo` with the same fields patched → JSON for WS).
- Asserts JSON.stringify equality on the four contract field names: `regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size`.
- Asserts the coinbase is filtered from `transactions` and that the vote-bearing tx surfaces `voted=true`.
- For mempool: asserts `(*MempoolInfo).Trim(maxBlockSize)` carries `max_block_size` and `total_size` through to the wire.

Implication: this is the de facto contract spec. To add a fifth field, add an assertion here in the same change.

---

See also:

- [core/constraints.md#C8](../../core/constraints.md#C8) — dual-transport shape asymmetry (the umbrella for patterns 1, 2, 3, 4 here).
- [code-analysis/block/patterns.md](../block/patterns.md) — the same fan-out / dual-pipeline pattern at the BlockData layer.
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: shared-state lock discipline / out-of-band `pageData`+`invs` — the unified lock map across pages this page's tiles depend on).
- /wiki/code-analysis/page-rendering/impact.md (depends-on: "Saver Writer/Reader Drift" — the `/visualblocks` HTTP vs WS payload divergence is one manifestation; the contract-field patch is the local mitigation).
