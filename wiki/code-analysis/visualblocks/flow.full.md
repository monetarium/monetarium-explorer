### Section 1 — Overview
Tracing the data flow that drives `/visualblocks` — the latest-N-blocks-plus-mempool tile page rendered as horizontal bars (rewards / votes / tickets / regular txs). The page has **two independent pipelines** that feed the same DOM: an HTTP `GET` handler that server-renders 30 trimmed blocks, and a WebSocket push channel that re-renders individual tiles when new blocks arrive or the mempool changes.

**Revision tag:** `HEAD=386f2e12`. PR #284 (`feat/visualblocks-data-contract`) introduced an explicit cross-transport data contract: `CoinFills`, `ActiveSKACount`, `RegularCoinCounts`, `MaxBlockSize` (block side) and `MaxBlockSize`, `TotalSize` (mempool side) are now wire-symmetric across HTTP and `/ws`, asserted by [`visualblocks_contract_test.go`](../../../cmd/dcrdata/internal/explorer/visualblocks_contract_test.go). **The new contract fields are populated by the backend but not yet consumed by `visualblocks.tmpl` / `visualBlocks_controller.js`** — the page renders identically pre/post-PR; the frontend rewrite is staged separately.

### Section 2 — End-to-End Data Flow
HTTP path (initial render):
`monetarium-node JSON-RPC → blockdata.Collector → ChainDB.GetExplorerFullBlocks → ChainDB.GetExplorerBlock (memoized) → explorerUI.VisualBlocks (per-block (*BlockInfo).Trim(maxBlockSize, issuedSKA) → *TrimmedBlockInfo) + MempoolInventory().Trim(maxBlockSize) → templates.exec("visualblocks") → visualblocks.tmpl → visualBlocks_controller.js`

WebSocket new-block path:
`blockdata.Collector → explorerUI.Store(blockData,msgBlock) → wsHub.HubRelay ← sigNewBlock → websockethandlers.go (shallow-copy *BlockInfo, patch CoinFills/ActiveSKACount/MaxBlockSize from block.Trim(...) onto the copy, encode types.WebsocketBlock{Block:&blockCopy, Extra:*HomeInfo}) → public/index.js (newblock → publish "BLOCK_RECEIVED") → visualBlocks_controller._handleVisualBlocksUpdate (filters Coinbase client-side) → prepends new DOM tile, trims to 30`

WebSocket mempool path:
`mempool.MempoolMonitor → explorerUI.StoreMPData (recompute CoinFills via types.ComputeCoinFills) → exp.invs ; client sends "getmempooltrimmed" → snapshot maxBlockSize+subsidy under pageData.RLock → release → inv.Trim(maxBlockSize) → patch Subsidy → JSON → visualBlocks_controller.handleMempoolUpdate → replaces mempool tile`

### Section 3 — Per-Layer Breakdown
- **Location:** `cmd/dcrdata/main.go:694`
  - **Data Structures:** chi router under `SyncStatusPageIntercept` group.
  - **Transformations:** Registers `r.Get("/visualblocks", explore.VisualBlocks)`. The intercept hides the page during initial DB sync.
- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:320-381` (`VisualBlocks` handler) and `:135` (`homePageBlocksMaxCount = 30`)
  - **Data Structures:** `[]*types.TrimmedBlockInfo`, `*types.TrimmedMempoolInfo`, `*types.HomeInfo`, anonymous struct embedding `*CommonPageData`.
  - **Transformations:** Calls `GetHeight`, then `GetExplorerFullBlocks(ctx, h, h-30)`. **Snapshots `maxBlockSize` and `issuedSKA` from `pageData.HomeInfo.SKACoinSupply` under `pageData.RLock` first, then releases** ([:339-345](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L339-L345)). For each `*BlockInfo` calls `block.Trim(maxBlockSize, issuedSKA)` — the trim logic moved into `explorertypes.go`. Mempool: `inv.Trim(maxBlockSize)` then re-acquires `pageData.RLock` to patch `Subsidy = HomeInfo.NBlockSubsidy` and execute template inside that hold ([:354-371](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L354-L371)).
- **Location:** `db/dcrpg/pgblockchain.go:7172-7188` (`GetExplorerFullBlocks`)
  - **Data Structures:** `[]*exptypes.BlockInfo`.
  - **Transformations:** Loops `i := start; i > end; i--`, calls `getBlockVerbose(ctx, i, true)` then `GetExplorerBlock(ctx, data.Hash)`. Sequential — 30 calls per page load.
- **Location:** `db/dcrpg/pgblockchain.go:6366-6633` (`GetExplorerBlock`)
  - **Data Structures:** `*exptypes.BlockInfo` (full), `pgb.lastExplorerBlock` (single-block memo).
  - **Transformations:** Memoizes the last hash and returns the same pointer to concurrent callers (`lastExplorerBlock.Lock`). Builds `BlockBasic`, enriches with `BlockSubsidy`, `GetSummaryByHash` (→ `CoinAmounts`, `CoinRows`, `TotalSentByCoin`, `RegularCoinCounts`, `FeesByCoin`), then parses every `RawSTx`/`RawTx` via `trimmedTxInfoFromMsgTx`. **PR #284 adds `Voted: txBasic.VoteInfo != nil` to `TrimmedTxInfo`** ([:6561](../../../db/dcrpg/pgblockchain.go#L6561)) — populated for every parsed tx, used in the new contract test, not yet read by `.tmpl`/JS. For revocations, looks up `retrieveTicketStatusByHash`. For non-VAR regular txs (lines 6529-6553) recomputes `FeeRaw` from `Σ Vin[i].SKAAmountIn − TotalRaw`. `MiningFee` and `TotalSent` are summed via `dcrutil.Amount.ToCoin()` (VAR-precision float64).
- **Location:** `explorer/types/explorertypes.go` (Go types — substantially reshaped by PR #284)
  - `TrimmedTxInfo` at [`:357-367`](../../../explorer/types/explorertypes.go#L357-L367) — **now carries explicit `json:` snake_case tags** (`fees`, `vote_valid`, `voted`, `vin_count`, `vout_count`, `coin_type,omitempty`, `ticket_status,omitempty`). Field added: `Voted bool` (`json:"voted"`). **Wire-format break for any external consumer reading the old Go-name-keyed JSON.**
  - `TrimmedBlockInfo` at [`:704-722`](../../../explorer/types/explorertypes.go#L704-L722) — widened with `Size int32`, `FormattedBytes string`, `CoinFills []CoinFillData`, `ActiveSKACount int`, `RegularCoinCounts []CoinCount`, `MaxBlockSize float64`. All fields have snake_case JSON tags.
  - `(*BlockInfo).Trim(maxBlockSize, issuedSKA)` at [`:725-754`](../../../explorer/types/explorertypes.go#L725-L754) — **new method that replaces the inline trim block in `VisualBlocks`**. Internally: scans `bi.Tx` for the coinbase to extract `coinbaseSize`, calls `StatsFromCoinRows(bi.BlockBasic.CoinRows, coinbaseSize)` → `ComputeCoinFills(stats, maxBlockSize, issuedSKA)` to fill `CoinFills` + `ActiveSKACount`; pulls `RegularCoinCounts` from `RegularCoinCountsFromCoinRows(rows, Voters, FreshStake, Revocations)`; carries through `Size`/`FormattedBytes` from `BlockBasic`; still applies `FilterRegularTx(bi.Tx)` for `Transactions`.
  - `BlockInfo` at [`:757-804`](../../../explorer/types/explorertypes.go#L757-L804) — was already on the WS wire as the full struct. **PR #284 promoted three fields from `json:"-"` to wire-visible:** `RegularCoinCounts` → `regular_coin_counts,omitempty`; added new `CoinFills`, `ActiveSKACount`, `MaxBlockSize` (all `omitempty`). `FeesByCoin` stays `json:"-"`. **These fields are zero-valued on the struct itself**; the WS handler patches them onto a shallow copy at encode time (see below).
  - `TrimmedMempoolInfo` at [`:899-905`](../../../explorer/types/explorertypes.go#L899-L905) — added `MaxBlockSize float64` (`max_block_size`), `TotalSize int32` (`total_size`).
  - `MempoolInfo.Trim(maxBlockSize)` at [`:949-987`](../../../explorer/types/explorertypes.go#L949-L987) — **signature change.** Switched to `defer mpi.RUnlock()` (lock held throughout, including fee summation — previously released before fee loop). Populates `MaxBlockSize` and `TotalSize` from the embedded `MempoolShort`.
  - `(*BlockInfo).Trim` and `MempoolInfo.Trim` both call `types.ComputeCoinFills` — **moved from unexported `computeCoinFills` in `cmd/dcrdata/internal/explorer` to exported `types.ComputeCoinFills`** at [`:1735-1822`](../../../explorer/types/explorertypes.go#L1735-L1822). `StatsFromCoinRows` at [`:1720-1733`](../../../explorer/types/explorertypes.go#L1720-L1733) is the bridge from per-block `CoinRowData` to the mempool-shaped `MempoolCoinStats` map; subtracts `coinbaseSize` from VAR's row so the coinbase doesn't inflate the VAR fill bar.
  - `BlockSubsidy` at [`:832-838`](../../../explorer/types/explorertypes.go#L832-L838) — unchanged (JSON tag `"dev"`).
  - `WebsocketBlock` at [`:1354-1358`](../../../explorer/types/explorertypes.go#L1354-L1358) — unchanged (`{Block *BlockInfo, Extra *HomeInfo}`).
  - `FilterRegularTx` at [`:1014-1023`](../../../explorer/types/explorertypes.go#L1014-L1023) — unchanged (still filters only `Coinbase`); the JS-side mirror still has to re-apply it because WS sends the full `BlockInfo`.
- **Location:** `cmd/dcrdata/internal/explorer/explorer.go`
  - **Data Structures:** `pageData{BlockInfo, BlockchainInfo, HomeInfo}` at `:209-216`, `exp.invs *types.MempoolInfo` guarded by `invsMtx`.
  - **Transformations:** `Store()` at `:514-934` is the `BlockDataSaver` hook — rewrites `pageData.BlockInfo = GetExplorerBlock(...)`, updates `HomeInfo`, recomputes `exp.invs.CoinFills` via **`types.ComputeCoinFills`** (was the unexported in-package `computeCoinFills` pre-PR), fires `sigNewBlock` and `sigMempoolUpdate`. `StoreMPData()` at `:483-512` is the `MempoolDataSaver` hook — derives issued SKA list from `HomeInfo.SKACoinSupply`, recomputes `CoinFills` via `types.ComputeCoinFills`, swaps `exp.invs`. See §4 for the full lock map.
- **Location:** `cmd/dcrdata/internal/explorer/websockethandlers.go`
  - **Data Structures:** `types.WebsocketBlock`, `types.MempoolShort`, `types.TrimmedMempoolInfo`.
  - **Transformations:** `sigNewBlock` case at [`:272-300`](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L272-L300) **was rewritten by PR #284** to shallow-copy `*pageData.BlockInfo` (`blockCopy := *block`), compute `trimmed := block.Trim(maxBlockSize, issuedSKA)`, then patch `blockCopy.CoinFills = trimmed.CoinFills; blockCopy.ActiveSKACount = trimmed.ActiveSKACount; blockCopy.MaxBlockSize = trimmed.MaxBlockSize` and encode `&blockCopy`. **This is load-bearing — without the shallow copy, writing those three fields onto the shared memoized `*BlockInfo` (from `pgb.lastExplorerBlock`) would corrupt every other consumer.** Client-initiated `getmempooltrimmed` at [`:189-209`](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L189-L209) was **lock-order-reshuffled**: snapshots `maxBlockSize` + `subsidy` under `pageData.RLock`, releases, *then* calls `inv.Trim(maxBlockSize)` (which acquires `MempoolInfo.RLock`), then patches `Subsidy`. Previously: `Trim` (took `MempoolInfo.RLock`) → then `pageData.RLock` (nested). New ordering eliminates that overlap.
- **Location:** `pubsub/pubsubhub.go`
  - **Transformations:** `getmempooltxs` case at [`:319-340`](../../../pubsub/pubsubhub.go#L319-L340) got the same lock-order refactor — snapshot `maxBlockSize` + `subsidy` under `state.mtx.RLock`, release, then `inv.Trim(maxBlockSize)`. **`sigNewBlock` broadcast at [`:459-472`](../../../pubsub/pubsubhub.go#L459-L472) was NOT updated** — it still encodes `psh.state.BlockInfo` directly, so `/ps` clients receive a `BlockInfo` with `CoinFills` / `ActiveSKACount` / `MaxBlockSize` zero/nil. The explorer's `/ws` is the only path that populates the new contract fields on the block frame.
- **Location:** `cmd/dcrdata/public/index.js:46-64`
  - **Transformations:** Registers `ws.registerEvtHandler('newblock', ...)` → parses JSON, sets `newBlock.block.unixStamp`, publishes `BLOCK_RECEIVED` on `globalEventBus`. Also registers `'exchange'`.
- **Location:** `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:1-371`
  - **Data Structures:** DOM only; reads JSON shapes — `block.Tx`, `block.Votes`, `block.Revs`, `block.MiningFee`, `block.TotalSent`, `block.time`, `block.height`, `block.Subsidy` from the WS, and trimmed shape from `getmempooltrimmedResp`.
  - **Transformations:** `_handleVisualBlocksUpdate` (`:235-260`) does the JS-side equivalent of `FilterRegularTx`: `block.Tx.filter(!Coinbase)`. **The new contract fields `block.CoinFills`/`active_ska_count`/`max_block_size`/`regular_coin_counts` and `tx.voted` are present on the wire but are not yet read by this controller** — they are reserved for the staged frontend rewrite. The contract test enforces that the fields are there; if a future controller change starts reading them, the test guarantees both transports deliver identical shapes.
- **Location:** `cmd/dcrdata/views/visualblocks.tmpl`
  - **Data Structures:** `.Info` (`*types.HomeInfo`), `.Mempool` (`*types.TrimmedMempoolInfo`), `.Blocks` (`[]*types.TrimmedBlockInfo`).
  - **Transformations:** Renders mempool tile + 30 block tiles. Uses `toFloat64Amount .Subsidy.PoW`/`.PoS`/`.Dev` for mempool (custom `BlockSubsidy`), `.Subsidy.Developer` for blocks (`chainjson.GetBlockSubsidyResult`). Hard caps via `clipSlice 30` when `> 50` (lines 89, 117, 197, 225). `flex-grow` driven by `.Total` / `.Fees` floats. Hardcoded label `DCR`. **The new fields on `TrimmedBlockInfo`/`TrimmedMempoolInfo` are not read here yet.**
- **Location:** `cmd/dcrdata/internal/explorer/visualblocks_contract_test.go` (new)
  - **Transformations:** Asserts wire-format equivalence: `regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size` produce identical JSON when serialized from a `TrimmedBlockInfo` (HTTP path) vs. a shallow-copy `BlockInfo` with the same three fields patched (WS path). Also asserts the coinbase is filtered out of `transactions` and that `voted=true` is present for vote-bearing txs. Also asserts `TrimmedMempoolInfo.max_block_size` / `total_size` round-trip correctly.
- **Location:** `cmd/dcrdata/internal/explorer/dev_indicators.go` and `templates_test.go`
  - Both updated to call `types.ComputeCoinFills(...)` (was the unexported in-package version). No behavior change.
- **Location:** `cmd/dcrdata/public/scss/visualblocks.scss` (imported by `application.scss:49`).

### Section 4 — Cross-Layer Dependencies
- **Two transport shapes for "one block."** HTTP renders `TrimmedBlockInfo` (already filtered, `Transactions` field name). WebSocket pushes the full `BlockInfo` (`Tx` field name, includes coinbase). JS does the trim equivalent client-side. **PR #284 narrows the asymmetry for four fields** (`regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size`) by patching them onto a shallow-copy `BlockInfo` at WS-encode time. `Transactions` ↔ `Tx`, `Coinbase` filtering, and the `Subsidy` struct names remain asymmetric.
- **WS shallow-copy is load-bearing.** The `*BlockInfo` returned by `GetExplorerBlock` is a memoized shared pointer (`pgb.lastExplorerBlock`). The WS handler builds `blockCopy := *block` before patching `CoinFills`/`ActiveSKACount`/`MaxBlockSize` precisely because the source struct is shared with `/visualblocks`'s next HTTP visitor, the block page, the mempool page, and `/ws` `sigNewBlock` itself. Removing the shallow copy reintroduces the cross-page corruption risk this PR was designed to prevent.
- **`Subsidy` is still two different Go types depending on path.** Mempool tile gets `BlockSubsidy{Dev int64, …}` (JSON: `dev`). Block tiles get `chainjson.GetBlockSubsidyResult{Developer …}` (JSON: `developer`). Template uses both names; JS uses `subsidy.developer || subsidy.dev`. Unchanged by PR #284.
- **Shared mutable state:** `exp.pageData` and `exp.invs` are read by Home, Mempool, `/visualblocks`, and `/ws`. Three distinct locks: `pageData.RWMutex`, `invsMtx` (the pointer guard on `explorerUI`), and `MempoolInfo.RWMutex` (embedded in the struct). `Store` (block saver) is the only path that nests two locks: `pageData.Lock()` then `invsMtx.Lock()` (see [explorer.go:547,608-614](../../../cmd/dcrdata/internal/explorer/explorer.go#L547-L614)). `StoreMPData` takes `pageData.RLock` then releases it before taking `invsMtx.Lock` — not nested. **PR #284 also unwound a `MempoolInfo.RLock` ⊃ `pageData.RLock` overlap in `getmempooltrimmed` and `pubsub.getmempooltxs`** (snapshot `pageData` first, release, then `Trim`). `MempoolInfo.Trim` itself now holds its RLock via `defer` for the whole function — slightly longer hold but no new acquisition inside.
- **Memoized DB block pointer:** `pgb.lastExplorerBlock.blockInfo` is shared by every consumer of the most-recent block. Mutating the returned `*BlockInfo` in any handler still corrupts everyone else's view. The new shallow-copy step in `sigNewBlock` is the textbook fix.
- **`pubsub/pubsubhub.go` duplicates the home subsidy/reward math** (per CLAUDE.md). `HomeInfo.NBlockSubsidy` reaches the visualblocks mempool tile via the WS subsidy patch — keep both updaters in sync. **PR #284 introduced a new pubsub divergence**: `/ws` `sigNewBlock` patches `CoinFills`/`ActiveSKACount`/`MaxBlockSize` onto a shallow-copy `BlockInfo` before encoding, but `/ps` `sigNewBlock` encodes `psh.state.BlockInfo` directly. A `/ps` subscriber that starts reading those fields would see them zero/nil.
- **Contract test as enforcement.** Future changes to the four contract fields are guarded by `TestVisualBlocksDataContract`. If you rename one of them or add a fifth, update the test in the same change or the cross-transport equivalence claim regresses silently.
- **`homePageBlocksMaxCount = 30` enforced in three places:** Go constant, template `clipSlice 30` (per-tile internals), JS `splice(30)` / removeChild loop. Mismatches lead to off-by-one visual glitches and stuck DOM nodes. Unchanged.

### Section 5 — Critical Constraints
- **C1 (float64 VAR-only amount path).** `TrimmedBlockInfo.Total`/`.Fees` and `TrimmedTxInfo.Total` (via `dcrutil.Amount.ToCoin()`) remain `float64`. Per [core/constraints.md C1](../../core/constraints.md#C1), SKA atoms (18 decimals) exceed float64's significand and must stay as `big.Int`-derived strings end-to-end. The aggregate bars (`flex-grow: {{.Total}}`) are **still lossy for SKA**. **PR #284 does not fix this**; it surfaces `CoinFills` (per-coin fill ratios computed from `Size`, not `Amount`, so precision-safe), `ActiveSKACount`, and `MaxBlockSize`, all of which are size-domain (`int32`/`float64` on bytes — safe). To make SKA amount bars precise the next step must add atom-string fields, not new float64s.
- **C2 (dual-pipeline mutation).** The HTTP + WS pipelines are now contract-aligned for four fields by the WS-side shallow-copy patch. Any field added to `TrimmedBlockInfo` must also be patched onto `blockCopy` in `sigNewBlock` to keep parity — adding to one side only re-creates the silent-drift bug class.
- **C7 (centralized coin-type labels).** `CoinFillData.Symbol` is filled from `CoinTypeSymbol(ct)`/`fmt.Sprintf("SKA%d", ct)` inside `ComputeCoinFills` — server-produced, not built in JS. `RegularCoinCountsFromCoinRows` also uses `CoinTypeSymbol(ct)`. If the canonical label changes, this is one of the call sites to audit.
- **C8 (dual-transport shape asymmetry).** PR #284 collapses four of the previously asymmetric fields. The remaining asymmetries are: `Transactions` (HTTP) vs `Tx` (WS); HTTP-side `FilterRegularTx` vs JS-side `block.Tx.filter(!Coinbase)`; `Subsidy.Developer` vs `Subsidy.Dev`; the WS still carries the full `BlockInfo` (treasury, stake fees, all of `Tx`) where the HTTP trim drops most of that. These remain load-bearing.
- **Coin-type single-tx invariant.** Per CLAUDE.md, every tx is single-coin and pays fees in its own coin. `MiningFee` here is summed only over VAR-counted fees through `dcrutil.Amount`. SKA SSFee distributions live in `BlockInfo.FeesByCoin`/`SSFeeTotalsByCoin` (still `json:"-"`) — *not* surfaced on this page.
- **Memo non-mutation invariant.** `pgb.lastExplorerBlock` returns a shared pointer; handlers must treat it read-only after build. The new `sigNewBlock` shallow-copy is the canonical pattern for safely augmenting it with per-encode fields.
- **Empty-slot constants.** Template + JS both pad to `5` votes and `20` tickets+revs per tile. Hardcoded, not chain-param-derived.
- **CSS unit label.** `DCR` is still hardcoded in `visualblocks.tmpl` (lines 34, 142) and `visualBlocks_controller.js` (lines 24, 61). Decoupled from the chain symbol.

### Section 6 — Mutation Impact
When modifying `/visualblocks` data:
- **Direct dependencies:**
  - `explorerroutes.go:VisualBlocks` (handler — now thin: snapshot pageData, loop `block.Trim`, mempool `inv.Trim`, render).
  - `views/visualblocks.tmpl` (template).
  - `explorer/types/explorertypes.go`:
    - `TrimmedBlockInfo`, `TrimmedTxInfo`, `TrimmedMempoolInfo`, `BlockSubsidy`, `WebsocketBlock`
    - `(*BlockInfo).Trim`, `(*MempoolInfo).Trim` — **changing either signature ripples to every caller (handler, WS handler, pubsubhub, viewmodel tests, dev_indicators)**.
    - `types.ComputeCoinFills`, `StatsFromCoinRows`, `RegularCoinCountsFromCoinRows`.
  - `db/dcrpg/pgblockchain.go`: `GetExplorerBlock`, `GetExplorerFullBlocks`, `trimmedTxInfoFromMsgTx` (now sets `Voted`).
  - `explorer.go:Store`/`StoreMPData` (background updaters; both call `types.ComputeCoinFills`).
  - `websockethandlers.go` `sigNewBlock` (shallow-copy + patch sequence) + `getmempooltrimmed` case (lock-order-restructured).
  - `public/index.js` (WS → event bus) and `public/js/controllers/visualBlocks_controller.js` (DOM render — does not yet read new fields).
  - `visualblocks_contract_test.go` (cross-transport contract assertions).
- **Indirect dependencies:**
  - `pubsub/pubsubhub.go` — duplicates home-page subsidy/reward calc; **and now broadcasts `psh.state.BlockInfo` over `sigNewBlock` without the contract-field patch the explorer `/ws` applies.** Changes to `HomeInfo.NBlockSubsidy` must mirror; any `/ps` subscriber that consumes `CoinFills`/`ActiveSKACount`/`MaxBlockSize` needs a parallel patch added there.
  - Home page (`home_latest_blocks_controller.js`), block page, mempool page — all consume the same `BlockInfo`/`MempoolInfo` shapes via the same WS frames. **`RegularCoinCounts` is now wire-visible on `BlockInfo`** (previously `json:"-"`); any controller that does `JSON.stringify(block)` or hashes the payload will see a bigger object.
  - `status_controller.js`, `blocks_controller.js`, `time_controller.js`, `address_controller.js` — all subscribe to `BLOCK_RECEIVED`.
- **Serialization boundaries:**
  - HTTP: Go template rendering of `TrimmedBlockInfo`/`TrimmedMempoolInfo`.
  - WS new-block: `json.Encode(WebsocketBlock{Block:&blockCopy, Extra:*HomeInfo})` — shallow-copy then patch.
  - WS mempool: `json.Encode(*TrimmedMempoolInfo)` with `MaxBlockSize`/`TotalSize` carried through `Trim`, plus patched `Subsidy`.
- **Rendering layers:** `visualblocks.tmpl` (initial 30 tiles + mempool) and `visualBlocks_controller.js` (incremental updates).

**Silent failures:**
- A SKA-only tx renders with float64 `Total` from `ToCoin()` of 18-dp atoms → garbage `flex-grow`, the tile becomes the dominant bar in its block. **Unchanged by PR #284.**
- Forgetting to patch a new contract field onto the WS shallow-copy → newly-pushed tiles silently miss the field while initial-render tiles show it. The contract test catches this *only* for the four fields it asserts; any new field needs a new assertion.
- Removing the WS shallow-copy and writing fields directly to `pageData.BlockInfo` → corrupts the memoized pointer cross-page.
- `/ps` consumer added that reads `CoinFills`/`ActiveSKACount`/`MaxBlockSize` from a `sigNewBlock` frame → fields are zero/nil because pubsub's `sigNewBlock` is not patched.
- Renaming `Subsidy.Developer` ↔ `Dev` on either side without touching all three (Go struct, template, JS) → the "fund" bar silently collapses to 0 width.
- Setting a non-JSON `title` attribute → `setupTooltips` JSON.parse fails silently and that tile loses its tooltip.
- **Wire-format break for external consumers** of `TrimmedTxInfo` — fields now serialize as `vote_valid`/`vin_count`/`vout_count`/etc. instead of Go-name keys. The contract test does not cover external clients.

**Hard failures:**
- Removing `block.Tx` from `BlockInfo`: `(*BlockInfo).Trim` scans `bi.Tx` for the coinbase and applies `FilterRegularTx(bi.Tx)` → nil deref. JS calls `block.Tx.filter(...)` → runtime error.
- Removing `HomeInfo.NBlockSubsidy`: `mempoolInfo.Subsidy = exp.pageData.HomeInfo.NBlockSubsidy` (explorerroutes.go:357, websockethandlers.go:196, pubsubhub.go:323) fails to compile.
- Removing `MempoolInfo.Trim`: handler at `:354` and WS case at `:199`, pubsub case fail to compile.
- Changing `(*MempoolInfo).Trim` signature (e.g. drop the `maxBlockSize` arg): all four call sites (handler, WS handler, pubsubhub, viewmodel tests) fail to compile — that is the safe-by-default property of this PR.
- Changing `(*BlockInfo).Trim` signature: the handler loop and the WS shallow-copy patch both fail to compile.

### Section 7 — Common Pitfalls
1. Assuming the WebSocket frame goes through the same trim as the HTTP handler. It still does not — the WS sends a full `BlockInfo` and the JS controller re-implements `FilterRegularTx` (`block.Tx.filter(!Coinbase)`). PR #284 patches four contract fields onto the WS shape but does not collapse the broader asymmetry.
2. Treating SKA amounts as safe through `float64`. `flex-grow: {{.Total}}` will still produce nonsense for SKA-precision values; surfacing SKA needs new atom-string fields and parallel template + JS handling.
3. Conflating `block.Tx` (WS, full BlockInfo) with `block.Transactions` (HTTP, TrimmedBlockInfo). Same data, different names.
4. Mixing up `Subsidy.Developer` (chainjson) and `Subsidy.Dev` (BlockSubsidy). Both appear in the same `visualblocks.tmpl`.
5. Expecting `Treasury` or `StakeFees` slices to appear — `(*BlockInfo).Trim` drops them when building `TrimmedBlockInfo`.
6. **Mutating `pageData.BlockInfo` directly when adding new contract fields.** The WS handler must continue to shallow-copy and patch — the source pointer is shared with the memo. Adding `MaxBlockSize = ...` directly to `block` writes through to every other reader.
7. Adding a new contract field to `TrimmedBlockInfo` but forgetting to patch it onto the WS shallow-copy → C8 silent-drift returns. Mirror in `pubsub/pubsubhub.go` `sigNewBlock` too if pubsub clients need it.
8. Changing the outer 30 cap without updating the JS `removeChild` trim that assumes 30, or the template's per-tile `clipSlice 30`.
9. Forgetting that `pubsub/pubsubhub.go` duplicates the subsidy/reward calc on the home path; a one-sided fix drifts the visualblocks mempool tile out of sync.
10. **Holding `MempoolInfo.Lock` (writer) while another goroutine holds `pageData.RLock`.** PR #284's lock-order refactor of `getmempooltrimmed` deliberately reads pageData first, then takes the mempool lock — reverting to the old "Trim then pageData.RLock" order recreates a (narrow) lock-overlap risk.
11. Assuming the new JSON tags on `TrimmedTxInfo` are inconsequential — external callers reading the raw struct as JSON now see snake_case keys (`fees`, `vote_valid`, `vin_count`, …). The contract test does not cover backward compatibility of the wire format.

### Section 8 — Evidence
- `cmd/dcrdata/main.go:694` — route registration `r.Get("/visualblocks", explore.VisualBlocks)`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:135` — `homePageBlocksMaxCount = 30`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:320-381` — `VisualBlocks` handler. Pre-snapshot pageData (`:339-345`), trim loop (`:347-350`), mempool trim (`:354`), Subsidy patch + template exec under `pageData.RLock` (`:356-371`).
- `db/dcrpg/pgblockchain.go:6558-6562` — `trimmedTxInfoFromMsgTx` populates `Voted: txBasic.VoteInfo != nil`.
- `db/dcrpg/pgblockchain.go:7172-7188` — `GetExplorerFullBlocks` sequential loop.
- `db/dcrpg/pgblockchain.go:6366-6633` — `GetExplorerBlock`; memo at `:6371-6376` and `:6626-6630`; per-coin SKA fee recompute at `:6529-6553`; VAR `ToCoin()` summation at `:6594-6605`.
- `explorer/types/explorertypes.go:357-367` — `TrimmedTxInfo` with explicit JSON tags + `Voted bool`.
- `explorer/types/explorertypes.go:239-282` — `RegularCoinCountsFromCoinRows`.
- `explorer/types/explorertypes.go:667-684` — `CoinFillData`.
- `explorer/types/explorertypes.go:704-722` — `TrimmedBlockInfo` widened shape with JSON tags.
- `explorer/types/explorertypes.go:725-754` — `(*BlockInfo).Trim(maxBlockSize, issuedSKA)`.
- `explorer/types/explorertypes.go:795,801-803` — `BlockInfo.RegularCoinCounts` promoted to wire; new `CoinFills`/`ActiveSKACount`/`MaxBlockSize`.
- `explorer/types/explorertypes.go:899-905` — `TrimmedMempoolInfo` with `MaxBlockSize`/`TotalSize`.
- `explorer/types/explorertypes.go:949-987` — `MempoolInfo.Trim(maxBlockSize)` with deferred unlock.
- `explorer/types/explorertypes.go:1720-1733` — `StatsFromCoinRows` (coinbase-size subtraction for VAR).
- `explorer/types/explorertypes.go:1735-1822` — `types.ComputeCoinFills`.
- `cmd/dcrdata/internal/explorer/explorer.go:498,609` — call sites updated to `types.ComputeCoinFills`.
- `cmd/dcrdata/internal/explorer/dev_indicators.go:58` — test helper updated to `types.ComputeCoinFills`.
- `cmd/dcrdata/internal/explorer/templates_test.go:339-590` — all `TestComputeCoinFills` cases updated to `types.ComputeCoinFills`.
- `cmd/dcrdata/internal/explorer/home_viewmodel_test.go:377,389,406` — `m.Trim(1e6)` signature update.
- `cmd/dcrdata/internal/explorer/websockethandlers.go:189-209` — `getmempooltrimmed` (pageData snapshot → release → Trim → Subsidy patch).
- `cmd/dcrdata/internal/explorer/websockethandlers.go:272-300` — `sigNewBlock` (shallow-copy `BlockInfo` + patch `CoinFills`/`ActiveSKACount`/`MaxBlockSize` from `block.Trim(...)`).
- `pubsub/pubsubhub.go:319-340` — `getmempooltxs` (same lock-order refactor as `/ws`).
- `pubsub/pubsubhub.go:459-472` — `sigNewBlock` (NOT patched; pubsub broadcasts the un-augmented `state.BlockInfo`).
- `cmd/dcrdata/internal/explorer/visualblocks_contract_test.go:1-146` — `TestVisualBlocksDataContract`: `BlockContractWireFormat`, `BlockWSWireFormatEquivalence`, `MempoolContractWireFormat`.
- `cmd/dcrdata/public/index.js:46-64` — `ws.registerEvtHandler('newblock', ...)` → `globalEventBus.publish('BLOCK_RECEIVED', newBlock)`.
- `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:14-36, 235-260, 262-267` — controller; does NOT yet consume `coin_fills`/`active_ska_count`/`max_block_size`/`regular_coin_counts`/`voted`.
- `cmd/dcrdata/views/visualblocks.tmpl` — full template (mempool tile + 30 blocks; subsidy field-name asymmetry; `clipSlice 30` when `>50`); does NOT yet consume the new fields.
- `cmd/dcrdata/public/scss/visualblocks.scss` and `cmd/dcrdata/public/scss/application.scss:49`.

See also:
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: out-of-band shared page state; shared-state lock discipline; `*CommonPageData` embedding)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: saver writer/reader drift; lock-order inversion against `Store`; `commonData` nil render crash)
- /wiki/code-analysis/visualblocks/patterns.md — domain patterns (cross-pipeline tile rendering, JS-side server-filter mirror, Subsidy struct asymmetry, triple-enforced 30-cap, memoized BlockInfo, shared page state, WS subsidy patch, **cross-transport contract via WS shallow-copy + Trim patch**).
- /wiki/code-analysis/visualblocks/impact.md — mutation impact, loud/silent failure modes, safe-change checklist.
- /wiki/code-analysis/block/flow.full.md (shares-pattern-with: fan-out BlockDataSaver, dual transport shape REST vs WebSocket, multi-coin big.Int→string precision)
- /wiki/code-analysis/transaction/flow.full.md (shares-pattern-with: mempool aggregation vs confirmed Vout-array — the same C8 dual-transport class)
- /wiki/code-analysis/mempool/flow.full.md (depends-on: `MempoolInfo` aggregation, `CoinFills` derivation in `StoreMPData`; shares the trim/transport asymmetry)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA; C2 dual pipeline; shares-pattern-with: C8 dual-transport shape asymmetry — **PR #284 narrows it for four fields but does not eliminate it**)
- /wiki/specs/homepage-metrics/spec.md (shares-pattern-with: home-page latest-blocks tiles consume the same `BlockInfo` over the same WS frames)
