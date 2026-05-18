### Section 1 — Overview
Tracing the data flow that drives `/visualblocks` — the latest-N-blocks-plus-mempool tile page rendered as horizontal bars (rewards / votes / tickets / regular txs). The page has **two independent pipelines** that feed the same DOM: an HTTP `GET` handler that server-renders 30 trimmed blocks, and a WebSocket push channel that re-renders individual tiles when new blocks arrive or the mempool changes.

### Section 2 — End-to-End Data Flow
HTTP path (initial render):
`monetarium-node JSON-RPC → blockdata.Collector → ChainDB.GetExplorerFullBlocks → ChainDB.GetExplorerBlock (memoized) → explorerUI.VisualBlocks (trim to *types.TrimmedBlockInfo) + MempoolInventory().Trim() → templates.exec("visualblocks") → visualblocks.tmpl → visualBlocks_controller.js`

WebSocket new-block path:
`blockdata.Collector → explorerUI.Store(blockData,msgBlock) → wsHub.HubRelay←sigNewBlock → websockethandlers.go (encode types.WebsocketBlock{Block:*BlockInfo, Extra:*HomeInfo}) → public/index.js (newblock → publish "BLOCK_RECEIVED") → visualBlocks_controller._handleVisualBlocksUpdate (filters Coinbase client-side) → prepends new DOM tile, trims to 30`

WebSocket mempool path:
`mempool.MempoolMonitor → explorerUI.StoreMPData (recompute CoinFills) → exp.invs ; client sends "getmempooltrimmed" → MempoolInfo.Trim() + inject HomeInfo.NBlockSubsidy → JSON → visualBlocks_controller.handleMempoolUpdate → replaces mempool tile`

### Section 3 — Per-Layer Breakdown
- **Location:** `cmd/dcrdata/main.go:694`
  - **Data Structures:** chi router under `SyncStatusPageIntercept` group.
  - **Transformations:** Registers `r.Get("/visualblocks", explore.VisualBlocks)`. The intercept hides the page during initial DB sync.
- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:320-382` (`VisualBlocks` handler) and `:134` (`homePageBlocksMaxCount = 30`)
  - **Data Structures:** `[]*types.TrimmedBlockInfo`, `*types.TrimmedMempoolInfo`, `*types.HomeInfo`, anonymous struct embedding `*CommonPageData`.
  - **Transformations:** Calls `GetHeight`, then `GetExplorerFullBlocks(ctx, h, h-30)`; for each `*BlockInfo` builds a `TrimmedBlockInfo` keeping only `Time/Height/Total/Fees/Subsidy/Votes/Tickets/Revs/Transactions`. `Transactions` is `FilterRegularTx(block.Tx)` — coinbase removed, **SKA-typed regular txs kept**. Treasury and StakeFees are dropped. Injects `HomeInfo.NBlockSubsidy` onto `mempoolInfo.Subsidy`.
- **Location:** `db/dcrpg/pgblockchain.go:7172-7188` (`GetExplorerFullBlocks`)
  - **Data Structures:** `[]*exptypes.BlockInfo`.
  - **Transformations:** Loops `i := start; i > end; i--`, calls `getBlockVerbose(ctx, i, true)` then `GetExplorerBlock(ctx, data.Hash)`. Sequential — 30 calls per page load.
- **Location:** `db/dcrpg/pgblockchain.go:6366-6633` (`GetExplorerBlock`)
  - **Data Structures:** `*exptypes.BlockInfo` (full), `pgb.lastExplorerBlock` (single-block memo).
  - **Transformations:** Memoizes the last hash and returns the same pointer to concurrent callers (`lastExplorerBlock.Lock`). Builds `BlockBasic`, enriches with `BlockSubsidy`, `GetSummaryByHash` (→ `CoinAmounts`, `CoinRows`, `TotalSentByCoin`, `RegularCoinCounts`, `FeesByCoin`), then parses every `RawSTx`/`RawTx` via `trimmedTxInfoFromMsgTx`. For revocations, looks up `retrieveTicketStatusByHash`. For non-VAR regular txs (lines 6529-6553) recomputes `FeeRaw` from `Σ Vin[i].SKAAmountIn − TotalRaw` because `makeExplorerTxBasic` lacks SKA fee data. `MiningFee` and `TotalSent` are summed via `dcrutil.Amount.ToCoin()` (VAR-precision float64).
- **Location:** `explorer/types/explorertypes.go` (Go types)
  - `TrimmedBlockInfo` at `:695-708` — `Total float64`, `Fees float64`, `Subsidy *chainjson.GetBlockSubsidyResult`, slices of `*TrimmedTxInfo`, plus `CoinRows []CoinRowData` (populated upstream but not consumed by this template).
  - `TrimmedTxInfo` at `:356-365` (note the comment: *"for use with /visualblocks"*).
  - `BlockInfo` at `:710-755` — full, sent over WS.
  - `TrimmedMempoolInfo` at `:840-856` — has `Subsidy BlockSubsidy` (not `chainjson.GetBlockSubsidyResult`).
  - `BlockSubsidy` at `:832-838` — JSON tag `"dev"`.
  - `WebsocketBlock` at `:1354-1358` — `{Block *BlockInfo, Extra *HomeInfo}`.
  - `MempoolInfo.Trim()` at `:897-935` — copies Trim'd tx slices + computes `Fees` via `dcrutil.Amount` summation.
  - `FilterRegularTx` at `:1014-1023` — only filters `Coinbase`.
- **Location:** `cmd/dcrdata/internal/explorer/explorer.go`
  - **Data Structures:** `pageData{BlockInfo, BlockchainInfo, HomeInfo}` at `:209-216`, `exp.invs *types.MempoolInfo` guarded by `invsMtx`.
  - **Transformations:** `Store()` at `:514-934` is the `BlockDataSaver` hook — rewrites `pageData.BlockInfo = GetExplorerBlock(...)`, updates `HomeInfo` (hashrate, supply, subsidy, rewards), then fires `sigNewBlock` and `sigMempoolUpdate` on the hub. `StoreMPData()` at `:483-512` is the `MempoolDataSaver` hook — derives issued SKA list from `HomeInfo.SKACoinSupply`, recomputes `CoinFills` via `computeCoinFills`, swaps `exp.invs`. See §4 for the full lock map.
- **Location:** `cmd/dcrdata/internal/explorer/websockethandlers.go`
  - **Data Structures:** `types.WebsocketBlock`, `types.MempoolShort`, `types.TrimmedMempoolInfo`.
  - **Transformations:** `sigNewBlock` case at `:271-282` encodes `WebsocketBlock` (full `BlockInfo` + `HomeInfo`). Client-initiated `getmempooltrimmed` at `:150-167` returns `inv.Trim()` with `Subsidy` patched from `pageData.HomeInfo.NBlockSubsidy`.
- **Location:** `cmd/dcrdata/public/index.js:46-64`
  - **Transformations:** Registers `ws.registerEvtHandler('newblock', ...)` → parses JSON, sets `newBlock.block.unixStamp`, publishes `BLOCK_RECEIVED` on `globalEventBus`. Also registers `'exchange'`.
- **Location:** `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:1-371`
  - **Data Structures:** DOM only; reads JSON shapes — `block.Tx`, `block.Votes`, `block.Revs`, `block.MiningFee`, `block.TotalSent`, `block.time`, `block.height`, `block.Subsidy` from the WS, and trimmed shape from `getmempooltrimmedResp`.
  - **Transformations:** `_handleVisualBlocksUpdate` (`:235-260`) does the JS-side equivalent of `FilterRegularTx`: `block.Tx.filter(!Coinbase)`. Inserts a new `.block.visible` node, removes the last sibling to maintain 30 in DOM. `handleMempoolUpdate` (`:262-267`) replaces the first child. `_refreshBlocksDisplay` toggles `.visible` to fill the viewport.
- **Location:** `cmd/dcrdata/views/visualblocks.tmpl`
  - **Data Structures:** `.Info` (`*types.HomeInfo`), `.Mempool` (`*types.TrimmedMempoolInfo`), `.Blocks` (`[]*types.TrimmedBlockInfo`).
  - **Transformations:** Renders mempool tile + 30 block tiles. Uses `toFloat64Amount .Subsidy.PoW`/`.PoS`/`.Dev` for mempool (custom `BlockSubsidy`), `.Subsidy.Developer` for blocks (`chainjson.GetBlockSubsidyResult`). Hard caps via `clipSlice 30` when `> 50` (lines 89, 117, 197, 225). `flex-grow` driven by `.Total` / `.Fees` floats. Hardcoded label `DCR`.
- **Location:** `cmd/dcrdata/public/scss/visualblocks.scss` (imported by `application.scss:49`).

### Section 4 — Cross-Layer Dependencies
- **Two transport shapes for "one block."** HTTP renders `TrimmedBlockInfo` (already filtered, `Transactions` field name). WebSocket pushes the full `BlockInfo` (`Tx` field name, includes coinbase). JS does the trim equivalent client-side. Rename anything on `BlockInfo`'s JSON and you must touch *both* the template and `visualBlocks_controller.js`.
- **`Subsidy` is two different Go types depending on path.** Mempool tile gets `BlockSubsidy{Dev int64, …}` (JSON: `dev`). Block tiles get `chainjson.GetBlockSubsidyResult{Developer …}` (JSON: `developer`). Template uses both names; JS uses `subsidy.developer || subsidy.dev`. Any normalization attempt must update all three.
- **Shared mutable state:** `exp.pageData` and `exp.invs` are read by Home, Mempool, `/visualblocks`, and `/ws`. Three distinct locks: `pageData.RWMutex`, `invsMtx` (the pointer guard on `explorerUI`), and `MempoolInfo.RWMutex` (embedded in the struct). `Store` (block saver) is the only path that nests two locks: `pageData.Lock()` then `invsMtx.Lock()` (see [explorer.go:547,608-614](../../../cmd/dcrdata/internal/explorer/explorer.go#L547-L614)). `StoreMPData` takes `pageData.RLock` then releases it before taking `invsMtx.Lock` — not nested. Readers acquire `invsMtx.RLock` briefly via `MempoolInventory()`, then `MempoolInfo.RLock` via `Trim()`, then `pageData.RLock` — sequential, not nested. The deadlock-relevant rule is therefore narrow: new code that holds `invsMtx` and then waits on `pageData.Lock` deadlocks against `Store`. Current code paths cannot deadlock among themselves.
- **Memoized DB block pointer:** `pgb.lastExplorerBlock.blockInfo` is shared by every consumer of the most-recent block. Mutating the returned `*BlockInfo` in any handler (visualblocks, block page, `/ws`) corrupts everyone else's view.
- **`pubsub/pubsubhub.go` duplicates the home subsidy/reward math** (per CLAUDE.md). `HomeInfo.NBlockSubsidy` reaches the visualblocks mempool tile via the WS subsidy patch — keep both updaters in sync.
- **`homePageBlocksMaxCount = 30` enforced in three places:** Go constant, template `clipSlice 30` (per-tile internals), JS `splice(30)` / removeChild loop. Mismatches lead to off-by-one visual glitches and stuck DOM nodes.

### Section 5 — Critical Constraints
- **Float64 VAR-only amount path.** `TrimmedBlockInfo.Total`/`.Fees` and `TrimmedTxInfo.Total` (via `dcrutil.Amount.ToCoin()`) are `float64`. Per `core/constraints.md` C1, SKA atoms (18 decimals) exceed float64's significand and must stay as `big.Int`-derived strings end-to-end. Today's `/visualblocks` aggregate bars are **lossy for SKA**: `block.TotalSent` sums SKA tx amounts via `ToCoin()` (`pgblockchain.go:6594-6605`); SKA tx tiles size their `flex-grow` from `tx.Total float64`. Surfacing SKA precisely requires widening `TrimmedBlockInfo`/`TrimmedTxInfo` with atom-string fields, not adding more float64 fields.
- **Coin-type single-tx invariant.** Per CLAUDE.md, every tx is single-coin and pays fees in its own coin. `MiningFee` here is summed only over VAR-counted fees through `dcrutil.Amount`. SKA SSFee distributions live in `BlockInfo.FeesByCoin`/`SSFeeTotalsByCoin` — *not* surfaced on this page.
- **Memo non-mutation invariant.** `pgb.lastExplorerBlock` returns a shared pointer; handlers must treat it read-only after build.
- **Empty-slot constants.** Template + JS both pad to `5` votes and `20` tickets+revs per tile. These mirror staking parameters; they are hardcoded, not chain-param-derived.
- **CSS unit label.** `DCR` is hardcoded in `visualblocks.tmpl` (lines 34, 142) and `visualBlocks_controller.js` (lines 24, 61). It is decoupled from the chain symbol.
- **`Tx` (WS) vs `Transactions` (HTTP).** Same logical slice, two names. Renaming requires touching both surfaces.

### Section 6 — Mutation Impact
When modifying `/visualblocks` data:
- **Direct dependencies:**
  - `explorerroutes.go:VisualBlocks` (handler / trim) and `views/visualblocks.tmpl` (template).
  - `db/dcrpg/pgblockchain.go:GetExplorerBlock` and `GetExplorerFullBlocks` (DB layer + memo).
  - `explorer/types/explorertypes.go` (`TrimmedBlockInfo`, `TrimmedTxInfo`, `TrimmedMempoolInfo`, `BlockSubsidy`, `WebsocketBlock`).
  - `explorer.go:Store`/`StoreMPData` (background updaters of `pageData`/`invs`).
  - `websockethandlers.go` `sigNewBlock` + `getmempooltrimmed` cases.
  - `public/index.js` (WS → event bus) and `public/js/controllers/visualBlocks_controller.js` (DOM render).
- **Indirect dependencies:**
  - `pubsub/pubsubhub.go` — duplicates home-page subsidy/reward calc; changes to `HomeInfo.NBlockSubsidy` must mirror.
  - Home page (`home_latest_blocks_controller.js`), block page, mempool page — all consume the same `BlockInfo`/`MempoolInfo` shapes via the same WS frames.
  - `status_controller.js`, `blocks_controller.js`, `time_controller.js`, `address_controller.js` — all subscribe to `BLOCK_RECEIVED`.
- **Serialization boundaries:**
  - HTTP: Go template rendering of `TrimmedBlockInfo`/`TrimmedMempoolInfo`.
  - WS new-block: `json.Encode(WebsocketBlock{Block:*BlockInfo, Extra:*HomeInfo})`.
  - WS mempool: `json.Encode(*TrimmedMempoolInfo)` with patched `Subsidy`.
- **Rendering layers:** `visualblocks.tmpl` (initial 30 tiles + mempool) and `visualBlocks_controller.js` (incremental updates).

**Silent failures:**
- A SKA-only tx renders with float64 `Total` from `ToCoin()` of 18-dp atoms → garbage `flex-grow`, the tile becomes the dominant bar in its block.
- WS path mutates a field on the memoized `BlockInfo` pointer → subsequent HTTP visitors see corrupted state.
- New `TrimmedBlockInfo` field added to template only → newer WS-pushed tiles silently miss the field while older server-rendered tiles show it.
- Renaming `Subsidy.Developer` ↔ `Dev` on either side without touching all three (Go struct, template, JS) → the "fund" bar silently collapses to 0 width.
- Setting a non-JSON `title` attribute → `setupTooltips` JSON.parse fails silently and that tile loses its tooltip.

**Hard failures:**
- Removing `block.Tx` from `BlockInfo` JSON: Go handler still calls `FilterRegularTx(block.Tx)` (`*TrimmedTxInfo` slice) → nil deref. JS calls `block.Tx.filter(...)` → runtime error.
- Removing `HomeInfo.NBlockSubsidy`: `mempoolInfo.Subsidy = exp.pageData.HomeInfo.NBlockSubsidy` (explorerroutes.go:358 and websockethandlers.go:157) fails to compile.
- Removing `MempoolInfo.Trim()`: handler at `:355` and WS case at `:154` fail to compile.

### Section 7 — Common Pitfalls
1. Assuming the WebSocket frame goes through the same trim as the HTTP handler. It does not — the WS sends a full `BlockInfo` and the JS controller re-implements `FilterRegularTx` (`block.Tx.filter(!Coinbase)`). Backend-only changes look correct on first page load and break on the next block.
2. Treating SKA amounts as safe through `float64`. `flex-grow: {{.Total}}` will produce nonsense for SKA-precision values; surfacing SKA needs new atom-string fields and parallel template + JS handling.
3. Conflating `block.Tx` (WS, full BlockInfo) with `block.Transactions` (HTTP, TrimmedBlockInfo). Same data, different names; both are used in this page alone.
4. Mixing up `Subsidy.Developer` (chainjson) and `Subsidy.Dev` (BlockSubsidy). Both appear in the same `visualblocks.tmpl`.
5. Expecting `Treasury` or `StakeFees` slices to appear — the handler drops them when building `TrimmedBlockInfo`.
6. Changing `homePageBlocksMaxCount` without updating the JS `removeChild` trim that assumes 30, or the template's `clipSlice 30` per-tile.
7. Mutating the `*BlockInfo` returned by `GetExplorerBlock` — it's a shared memoized pointer.
8. Forgetting that `pubsub/pubsubhub.go` duplicates the subsidy/reward calc on the home path; a one-sided fix drifts the visualblocks mempool tile out of sync.

### Section 8 — Evidence
- `cmd/dcrdata/main.go:694` — route registration `r.Get("/visualblocks", explore.VisualBlocks)`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:134` — `homePageBlocksMaxCount = 30`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:320-382` — `VisualBlocks` handler (height → 30 full blocks → trim → mempool trim → template).
- `cmd/dcrdata/internal/explorer/explorerroutes.go:336-351` — explicit field projection into `TrimmedBlockInfo` (Treasury/StakeFees dropped, `FilterRegularTx(block.Tx)` for `Transactions`).
- `db/dcrpg/pgblockchain.go:7172-7188` — `GetExplorerFullBlocks` sequential loop.
- `db/dcrpg/pgblockchain.go:6366-6633` — `GetExplorerBlock`; memo at `:6371-6376` and `:6626-6630`; per-coin SKA fee recompute at `:6529-6553`; VAR `ToCoin()` summation at `:6594-6605`.
- `explorer/types/explorertypes.go:356-365` — `TrimmedTxInfo` comment `// TrimmedTxInfo for use with /visualblocks`.
- `explorer/types/explorertypes.go:695-708` — `TrimmedBlockInfo` shape (float64 `Total`/`Fees`).
- `explorer/types/explorertypes.go:710-755` — `BlockInfo` (what WS actually sends).
- `explorer/types/explorertypes.go:840-856` — `TrimmedMempoolInfo`.
- `explorer/types/explorertypes.go:897-935` — `MempoolInfo.Trim()` (Fees summed via `dcrutil.Amount.ToCoin()`).
- `explorer/types/explorertypes.go:1014-1023` — `FilterRegularTx` (only coinbase filtered).
- `explorer/types/explorertypes.go:1354-1358` — `WebsocketBlock{Block:*BlockInfo, Extra:*HomeInfo}`.
- `cmd/dcrdata/internal/explorer/explorer.go:209-216, 361-374` — `pageData` definition and init.
- `cmd/dcrdata/internal/explorer/explorer.go:460-465` — `MempoolInventory()`.
- `cmd/dcrdata/internal/explorer/explorer.go:480-512` — `StoreMPData` (see §4 for lock map; `Store` is the only path that nests `pageData.Lock` + `invsMtx.Lock`).
- `cmd/dcrdata/internal/explorer/explorer.go:514-934` — `Store` (BlockDataSaver); `sigNewBlock`/`sigMempoolUpdate` fired at `:880`/`:890`.
- `cmd/dcrdata/internal/explorer/websockethandlers.go:150-167` — `getmempooltrimmed` (Trim + patch `Subsidy = HomeInfo.NBlockSubsidy`).
- `cmd/dcrdata/internal/explorer/websockethandlers.go:271-282` — `sigNewBlock` encodes `WebsocketBlock` (full `BlockInfo`).
- `cmd/dcrdata/public/index.js:46-64` — `ws.registerEvtHandler('newblock', ...)` → `globalEventBus.publish('BLOCK_RECEIVED', newBlock)`.
- `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:14-36` — `makeMempoolBlock` (reads `subsidy.dev`/`developer`).
- `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:235-260` — `_handleVisualBlocksUpdate` (filters Coinbase, prepends DOM, trims to 30).
- `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:262-267` — `handleMempoolUpdate`.
- `cmd/dcrdata/views/visualblocks.tmpl` — full template (mempool tile + 30 blocks; subsidy field-name asymmetry; `clipSlice 30` when `>50`).
- `cmd/dcrdata/public/scss/visualblocks.scss` and `cmd/dcrdata/public/scss/application.scss:49`.

See also:
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: out-of-band shared page state; shared-state lock discipline; `*CommonPageData` embedding)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: saver writer/reader drift; lock-order inversion against `Store`; `commonData` nil render crash)
- /wiki/code-analysis/visualblocks/patterns.md — domain patterns (cross-pipeline tile rendering, JS-side server-filter mirror, Subsidy struct asymmetry, triple-enforced 30-cap, memoized BlockInfo, shared page state, WS subsidy patch).
- /wiki/code-analysis/visualblocks/impact.md — mutation impact, loud/silent failure modes, safe-change checklist.
- /wiki/code-analysis/block/flow.full.md (shares-pattern-with: fan-out BlockDataSaver, dual transport shape REST vs WebSocket, multi-coin big.Int→string precision)
- /wiki/code-analysis/transaction/flow.full.md (shares-pattern-with: mempool aggregation vs confirmed Vout-array — the same C8 dual-transport class)
- /wiki/code-analysis/mempool/flow.full.md (depends-on: `MempoolInfo` aggregation, `CoinFills` derivation in `StoreMPData`; shares the trim/transport asymmetry)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — float64 VAR vs big.Int SKA; C2 dual pipeline; shares-pattern-with: C8 dual-transport shape asymmetry — HTTP `TrimmedBlockInfo` vs WebSocket full `BlockInfo`, with JS-side coinbase filter)
- /wiki/specs/homepage-metrics/spec.md (shares-pattern-with: home-page latest-blocks tiles consume the same `BlockInfo` over the same WS frames)
