# VisualBlocks Domain — Mutation Impact

Revision: `HEAD=386f2e12` (post PR #284 `feat/visualblocks-data-contract`).

## When modifying: the `/visualblocks` page or its backing data

You MUST verify all of the following layers, because the page has **two transport paths** that carry different shapes of the same logical entity (see [patterns.md#1](patterns.md) and [core/constraints.md#C8](../../core/constraints.md#C8)). PR #284 narrowed the asymmetry for four specific fields but the rest of the C8 surface remains live.

---

## 1. Direct Consumers

### HTTP handler

- File: [cmd/dcrdata/internal/explorer/explorerroutes.go:320-381](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L320-L381) (`VisualBlocks`)
- Reads: `dataSource.GetHeight`, `GetExplorerFullBlocks`, `pageData.BlockchainInfo.MaxBlockSize`, `pageData.HomeInfo.SKACoinSupply`, `MempoolInventory().Trim(maxBlockSize)`, `pageData.HomeInfo.NBlockSubsidy`.
- **Post PR #284**: thin handler — pre-snapshot pageData under RLock, loop `block.Trim(maxBlockSize, issuedSKA)`, mempool `inv.Trim(maxBlockSize)`, render under second pageData.RLock.
- Risk: compile-time break if `(*BlockInfo).Trim` / `(*MempoolInfo).Trim` signatures change.

### Template

- File: [cmd/dcrdata/views/visualblocks.tmpl](../../../cmd/dcrdata/views/visualblocks.tmpl)
- Reads: `.Info` (HomeInfo), `.Mempool` (TrimmedMempoolInfo with patched `Subsidy`), `.Blocks` (`[]*TrimmedBlockInfo`).
- Risk: template-execution error (visible at request time, not compile time) if a `.Field` reference loses its backing field.
- **Does NOT yet read the new contract fields** (`coin_fills`, `active_ska_count`, `max_block_size`, `regular_coin_counts`, `size`, `formatted_bytes`, `voted`) — those are populated for an upcoming rewrite.

### JS Controller

- File: [cmd/dcrdata/public/js/controllers/visualBlocks_controller.js](../../../cmd/dcrdata/public/js/controllers/visualBlocks_controller.js)
- Reads (from WS `newblock`): `block.Tx`, `block.Votes`, `block.Revs`, `block.MiningFee`, `block.TotalSent`, `block.time`, `block.height`, `block.Subsidy.{pow,pos,developer,dev}`.
- Reads (from WS `getmempooltrimmedResp`): `mempool.{Transactions, Votes, Tickets, Revocations, Subsidy.pow/pos/dev, Total, Time}`.
- **Does NOT yet read the new contract fields.** When the frontend rewrite lands, every field it starts to read must be guaranteed to exist on both transports — the contract test enforces this for the four asserted fields only.

### Contract test (new)

- File: [cmd/dcrdata/internal/explorer/visualblocks_contract_test.go](../../../cmd/dcrdata/internal/explorer/visualblocks_contract_test.go)
- Asserts: `regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size` identical across HTTP/WS; `transactions` excludes coinbase; `voted=true` for vote-bearing tx; `max_block_size`/`total_size` on `TrimmedMempoolInfo`.
- Risk: rename one contract field and the test will fail (good); add a fifth field without an assertion and nothing catches drift (bad).

---

## 2. Indirect Consumers (Same WebSocket Frames)

`sigNewBlock` emits the **shallow-copied** `BlockInfo` over `/ws` (full struct, with `CoinFills`/`ActiveSKACount`/`MaxBlockSize` patched onto the copy). Many controllers subscribe to `BLOCK_RECEIVED`:

- `home_latest_blocks_controller.js`
- `status_controller.js`
- `blocks_controller.js`
- `time_controller.js`
- `address_controller.js`

If you rename a field on `BlockInfo` (Go struct tag), every one of these must be checked. A breaking change here is **silent on `/visualblocks` until the next block arrives**.

**New caveat from PR #284**: `BlockInfo.RegularCoinCounts` is now wire-visible (was `json:"-"`). Any controller that hashes the block payload, computes diff, or stringifies the message sees a larger object than pre-PR.

---

## 3. Serialization Boundaries

### HTTP (server-rendered)

- Format: HTML via Go templates, fed by `TrimmedBlockInfo` (Go struct, **widened by PR #284** — drops Treasury/StakeFees, applies `FilterRegularTx`, includes `Size`/`FormattedBytes`/`CoinFills`/`ActiveSKACount`/`RegularCoinCounts`/`MaxBlockSize`).

### WebSocket — new block

- Format: `json.Encode(types.WebsocketBlock{Block:&blockCopy, Extra:*HomeInfo})` at [websockethandlers.go:272-300](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L272-L300).
- **`blockCopy` is a shallow copy of `pageData.BlockInfo`** with `CoinFills`/`ActiveSKACount`/`MaxBlockSize` patched on. The full struct is still encoded; client re-implements `FilterRegularTx`.

### WebSocket — mempool

- Format: `json.Encode(*TrimmedMempoolInfo)` at [websockethandlers.go:189-209](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L189-L209), with `MaxBlockSize`/`TotalSize` already populated by `Trim(maxBlockSize)` and `Subsidy` patched from `HomeInfo.NBlockSubsidy`.

### Pubsub `/ps` — new block

- Format: `json.Encode(exptypes.WebsocketBlock{Block: psh.state.BlockInfo, Extra: ...})` at [pubsub/pubsubhub.go:459-472](../../../pubsub/pubsubhub.go#L459-L472).
- **NOT patched with the contract fields.** `/ps` consumers see `BlockInfo` with `CoinFills`/`ActiveSKACount`/`MaxBlockSize` zero/nil.

### Pubsub `/ps` — mempool trim

- Format: `json.Encode(*TrimmedMempoolInfo)` at [pubsub/pubsubhub.go:319-340](../../../pubsub/pubsubhub.go#L319-L340) — same `MaxBlockSize`/`TotalSize` contract as the explorer `/ws` mempool path.

Risk: breaking one boundary without the other → page renders correctly until the next push, then silently drifts. Contract test covers only the four asserted fields on the block side and the two mempool fields.

---

## 4. Background Updaters (Shared State)

### `Store` (BlockDataSaver)

- File: [cmd/dcrdata/internal/explorer/explorer.go:514-934](../../../cmd/dcrdata/internal/explorer/explorer.go#L514-L934)
- Mutates `pageData.BlockInfo`, `pageData.HomeInfo`, `exp.invs.CoinFills`.
- Calls `types.ComputeCoinFills` (exported post-PR-#284; was unexported `computeCoinFills`).
- Fires `sigNewBlock` + `sigMempoolUpdate`.

### `StoreMPData` (MempoolDataSaver)

- File: [cmd/dcrdata/internal/explorer/explorer.go:480-512](../../../cmd/dcrdata/internal/explorer/explorer.go#L480-L512)
- Mutates `exp.invs`; computes `CoinFills` against `HomeInfo.SKACoinSupply` via `types.ComputeCoinFills`.

### Duplicate calc in PubSub

- File: `pubsub/pubsubhub.go` (per CLAUDE.md, home subsidy/reward math is duplicated). Any change to `HomeInfo.NBlockSubsidy` must mirror.
- **PR #284 additionally introduced a divergence at `sigNewBlock`**: explorer `/ws` patches the contract fields onto a shallow copy; pubsub `/ps` does not. If `/ps` clients ever start consuming `coin_fills`/`active_ska_count`/`max_block_size`, this divergence becomes a live bug.

---

## 5. Database Layer

### `GetExplorerFullBlocks` + `GetExplorerBlock`

- Files: [db/dcrpg/pgblockchain.go:7172-7188](../../../db/dcrpg/pgblockchain.go#L7172-L7188), [:6366-6633](../../../db/dcrpg/pgblockchain.go#L6366-L6633).
- `lastExplorerBlock` memo at `:6371-6376` returns a **shared pointer** to multiple page consumers.

Risk: mutating the returned `*BlockInfo` in any handler corrupts all downstream consumers (see [patterns.md#6](patterns.md)). PR #284's `sigNewBlock` shallow-copy is the canonical safe-augmentation pattern.

### `trimmedTxInfoFromMsgTx`

- File: [db/dcrpg/pgblockchain.go:6558-6562](../../../db/dcrpg/pgblockchain.go#L6558-L6562)
- **PR #284 added `Voted: txBasic.VoteInfo != nil`** to every `TrimmedTxInfo` it builds. The field is on the wire (`json:"voted"`) but not yet read by template/JS.

---

## 6. Loud Failures (Compile / Runtime Errors)

| Change                                                          | Effect                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Remove `block.Tx` from `BlockInfo`                              | Go: `(*BlockInfo).Trim` scans `bi.Tx` for coinbase + applies `FilterRegularTx(bi.Tx)` → nil-deref. JS: `block.Tx.filter(...)` runtime error. |
| Remove `HomeInfo.NBlockSubsidy`                                 | Compile failure at `explorerroutes.go:357`, `websockethandlers.go:196`, `pubsub/pubsubhub.go:323`. |
| Remove `(*MempoolInfo).Trim`                                    | Compile failure at `explorerroutes.go:354`, `websockethandlers.go:199`, `pubsub/pubsubhub.go:329`. |
| Remove `(*BlockInfo).Trim`                                      | Compile failure at `explorerroutes.go:348` and `websockethandlers.go:285`.    |
| Change `(*BlockInfo).Trim` or `(*MempoolInfo).Trim` signature   | Compile failure across all callers above + `home_viewmodel_test.go`, `templates_test.go`, `dev_indicators.go`. **Safe-by-default property.** |
| Remove or rename `types.ComputeCoinFills` / `StatsFromCoinRows` | Compile failure across `explorer.go` (Store/StoreMPData), `(*BlockInfo).Trim`, `dev_indicators.go`, `templates_test.go`. |
| Rename `TrimmedBlockInfo.Total` / `.Fees`                       | Template parse error at request time.                                          |
| Change `WebsocketBlock` JSON tag for `block` or `extra`         | JS sees `undefined` → first `block.Tx.filter` crashes immediately on next push. |

---

## 7. Silent Failures (High Risk)

### Precision corruption

- A SKA-only regular tx flows through `dcrutil.Amount.ToCoin() float64` ([pgblockchain.go:6594-6605](../../../db/dcrpg/pgblockchain.go#L6594-L6605)).
- Its `tx.Total` (float64) becomes the `flex-grow` of the tile — the SKA tile silently dominates its row.
- **PR #284 does NOT fix this.** The new `coin_fills` are size-domain (bytes), precision-safe; aggregate `Total`/`Fees` remain VAR-precision float64.
- See [core/constraints.md#C1](../../core/constraints.md#C1).

### WS shallow-copy regression

- Removing `blockCopy := *block` in `sigNewBlock` and writing `block.CoinFills = ...` directly to the memoized `*BlockInfo` corrupts every other consumer (home page, block page, next visualblocks visitor). The corruption persists until the memo is invalidated by a new block.
- This is the failure mode PR #284 was specifically designed to prevent — don't regress it during refactors.

### New contract field added to template only

- Initial 30 tiles show the field. Newly-pushed WS tiles miss it because `(*BlockInfo).Trim` doesn't populate it OR the `sigNewBlock` patch doesn't copy it. Page looks correct on reload, silently drifts.
- This is the canonical [core/constraints.md#C8](../../core/constraints.md#C8) failure mode for this domain. PR #284 narrows it for four fields; everything else is still exposed.

### `/ps` (pubsub) divergence

- A `/ps` client that starts reading `coin_fills`/`active_ska_count`/`max_block_size` from `sigNewBlock` sees zero/nil because `pubsub/pubsubhub.go:sigNewBlock` does not apply the WS shallow-copy patch.
- To fix: mirror the patch in `pubsubhub.go:sigNewBlock` (snapshot `state.BlockchainInfo.MaxBlockSize` + `state.GeneralInfo.SKACoinSupply`, shallow-copy, call `(*BlockInfo).Trim`, patch the copy).

### Subsidy field-name one-sided rename

- Rename `BlockSubsidy.Dev → Developer` without touching the chainjson side OR the JS `||` fallback → the mempool tile's "fund" bar silently collapses to 0 width.

### Mutated memoized `*BlockInfo`

- Any handler that mutates `block.Tx`/`block.Votes` post-`GetExplorerBlock` will corrupt the block-page view and subsequent visualblocks page loads until the next block invalidates the memo.

### `pubsub/pubsubhub.go` subsidy divergence

- One-sided fix to home-page subsidy calc → visualblocks mempool tile's PoW/PoS/Dev bars silently disagree with what `/ps` clients see.

### Tooltip `title` attribute drift

- The JS `setupTooltips` does `JSON.parse(tooltipElement.title)`. A non-JSON `title` silently disables the tooltip on that element (the `catch {}` block at lines 343-345 swallows the error).

### Lock-order inversion (narrow)

- `Store` is the only path that holds two `explorerUI` locks concurrently: `pageData.Lock()` first, then `invsMtx.Lock()` nested. Any new code that holds `invsMtx` (or `MempoolInfo.RLock`) and then waits on `pageData.Lock` would deadlock against `Store`.
- **PR #284 unwound a narrow overlap** in `getmempooltrimmed` and `pubsub.getmempooltxs` (snapshot pageData first, release, then `Trim`). Don't reintroduce the prior nested order.

### `TrimmedTxInfo` wire-format change

- PR #284 added explicit snake_case JSON tags to `TrimmedTxInfo` (`fees`, `vote_valid`, `vin_count`, `vout_count`, `voted`, `coin_type,omitempty`, `ticket_status,omitempty`). External clients reading the raw struct as JSON see new keys — wire-format break not covered by the contract test.

---

## 8. Out-of-Scope Drops (Known Silent Filtering)

`(*BlockInfo).Trim` **does not** project the following BlockInfo fields onto `TrimmedBlockInfo`:

- `Treasury` (treasury txs)
- `StakeFees` (SSFee distribution)
- `CoinAmounts`, `TotalSentByCoin`, `FeesByCoin` (multi-coin per-block aggregates — `json:"-"` on `BlockInfo`)
- `SKAPoWRewards` (per-coin PoW reward)

`RegularCoinCounts` is now both projected onto `TrimmedBlockInfo` *and* wire-visible on `BlockInfo` (the contract-aligned case).

`/visualblocks` is still VAR-centric for the amount bars. Surfacing real per-coin amounts requires widening `TrimmedBlockInfo` with atom-string fields **and** matching JS work — not adding more float64.

---

## 9. Safe-Change Checklist

Before committing changes that touch the visualblocks data path:

- [ ] HTTP handler updated AND `visualblocks.tmpl` renders the change correctly.
- [ ] JS controller (`visualBlocks_controller.js`) renders the change identically on the next WS push.
- [ ] If adding a new contract field: populated in `(*BlockInfo).Trim`, copied onto `blockCopy` in `websockethandlers.go:sigNewBlock`, AND new assertion in `visualblocks_contract_test.go`.
- [ ] If `/ps` clients consume the new field: mirror the patch in `pubsub/pubsubhub.go:sigNewBlock`.
- [ ] If changing `(*BlockInfo).Trim`/`(*MempoolInfo).Trim` signatures: verify all callers compile (`go build` from `cmd/dcrdata` covers the executable; root `go build ./...` covers `home_viewmodel_test.go`, `dev_indicators.go`, `templates_test.go`).
- [ ] If touching `BlockInfo`: every other `BLOCK_RECEIVED` subscriber (home, blocks, status, time, address) verified.
- [ ] If touching `HomeInfo.NBlockSubsidy`: mirrored in `pubsub/pubsubhub.go`.
- [ ] If touching the 30-cap: Go const AND JS `removeChild`/`splice` updated.
- [ ] No mutation of the `*BlockInfo` returned by `GetExplorerBlock` — use the shallow-copy + patch pattern from `sigNewBlock`.
- [ ] No new code path holds `invsMtx` (or `MempoolInfo.RLock`) while waiting on `pageData.Lock`.
- [ ] No SKA atom-string routed through `float64` / `dcrutil.Amount.ToCoin()` before the template/JS boundary.
- [ ] `Subsidy` field-name asymmetry (`Dev` vs `Developer`) accounted for on every touched surface.
- [ ] `TestVisualBlocksDataContract` passes.

---

See also:

- [code-analysis/visualblocks/patterns.md](patterns.md) — the patterns these risks emerge from (including the new shallow-copy + Trim patch pattern).
- [code-analysis/block/impact.md](../block/impact.md) — the upstream `BlockData` mutation impact; `/visualblocks` inherits it via `GetExplorerBlock` + WS `sigNewBlock`.
- [code-analysis/mempool/impact.md](../mempool/impact.md) — `MempoolInfo.Trim` signature change cascade; the mempool domain also consumes `types.ComputeCoinFills`.
- [core/constraints.md#C8](../../core/constraints.md#C8) — dual-transport shape asymmetry, the umbrella for the silent-drift risks above. PR #284 narrows it for four fields but does not eliminate it.
