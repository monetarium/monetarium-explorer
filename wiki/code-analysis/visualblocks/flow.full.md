### Section 1 — Overview
Tracing the data flow that drives `/visualblocks` — the latest-N-blocks-plus-mempool tile page rendered as a 3-row block-tile (votes / tickets / indicator-fill bars) plus a mempool tile of identical shape. The page has **two independent pipelines** that feed the same DOM: an HTTP `GET` handler that server-renders 30 trimmed blocks plus a mempool tile, and a WebSocket push channel that re-renders individual tiles when new blocks arrive or the mempool changes.

**Revision tag:** `HEAD=38636d52`. This is the post-rewrite snapshot for issue #270 on top of PR #284's data contract. The 386f2e12 revision documented the contract as "populated but not yet consumed by the UI"; commit `38636d52` is that UI rewrite plus one additional contract field (`TotalFillRatio`). Net page-surface changes vs the legacy state:

- The hard-coded `DCR` label and aggregate amount are gone everywhere. The tile header now shows block size (humanize.Bytes) + an optional `% of maxBlockSize` next to it. The mempool tile shows the current mempool size with the same `%` semantics.
- The rewards row (`block-rewards` with `.pow/.pos/.fund/.fees` segments) is deleted from both tile types in template + controller + SCSS. Project Fund/Treasury share is absent in Monetarium; PoW/PoS is fixed 50/50, so the bar carried no information.
- The vote row supports three states: `vote-yes` (blue), `vote-no` (red), `vote-skip` (grey), derived from `(Voted, VoteValid)`. Empty slots up to 5 stay transparent.
- The per-tx grey transactions row is deleted. In its place: an `.indicator-fill .block-indicator-fill` block containing one `.total-bar` (block-fill ratio) and one `.fill-bar` per `CoinFillData` entry (VAR + each active SKAn) — the same component used on the homepage, with compact-tile sizing overrides.
- `TrimmedBlockInfo` gained `TotalFillRatio float64 \`json:"total_fill_ratio"\`` and the WS shallow-copy patch now copies five fields onto `blockCopy`: `CoinFills`, `ActiveSKACount`, `MaxBlockSize`, `RegularCoinCounts`, `TotalFillRatio`. The contract test (`TestVisualBlocksDataContract`) asserts all five.
- A new vitest file `visualBlocks_controller.test.js` pins the new DOM shape (vote states, indicator-fill structure, ticket coin label, tooltip JSON, header layout, WS-shape regression).

### Section 2 — End-to-End Data Flow
HTTP path (initial render):
`monetarium-node JSON-RPC → blockdata.Collector → ChainDB.GetExplorerFullBlocks → ChainDB.GetExplorerBlock (memoized) → explorerUI.VisualBlocks (per-block (*BlockInfo).Trim(maxBlockSize, issuedSKA) → *TrimmedBlockInfo) + MempoolInventory().Trim(maxBlockSize) → templates.exec("visualblocks") → visualblocks.tmpl (three-row tile + indicator-fill bars) → visualBlocks_controller.js (Stimulus hydration)`

WebSocket new-block path:
`blockdata.Collector → explorerUI.Store(blockData,msgBlock) → wsHub.HubRelay ← sigNewBlock → websockethandlers.go (shallow-copy *BlockInfo, patch CoinFills / ActiveSKACount / MaxBlockSize / RegularCoinCounts / TotalFillRatio from block.Trim(...) onto the copy, encode types.WebsocketBlock{Block:&blockCopy, Extra:*HomeInfo}) → public/index.js (newblock → publish "BLOCK_RECEIVED") → visualBlocks_controller._handleVisualBlocksUpdate → normaliseWsBlock (mixed wire-shape → PascalCase tile) → newBlockHtmlElement → prepend tile, removeChild(lastChild) to keep ≤30`

WebSocket mempool path:
`mempool.MempoolMonitor → explorerUI.StoreMPData (recompute CoinFills via types.ComputeCoinFills) → exp.invs ; client sends "getmempooltrimmed" → snapshot maxBlockSize+subsidy under pageData.RLock → release → inv.Trim(maxBlockSize) → patch Subsidy → JSON → visualBlocks_controller.handleMempoolUpdate → normaliseMempool → makeMempoolBlock → replaces mempool tile`

### Section 3 — Per-Layer Breakdown
- **Location:** `cmd/dcrdata/main.go:694`
  - **Data Structures:** chi router under `SyncStatusPageIntercept` group.
  - **Transformations:** Registers `r.Get("/visualblocks", explore.VisualBlocks)`.

- **Location:** `cmd/dcrdata/internal/explorer/explorerroutes.go:320-381` (`VisualBlocks` handler) and `:135` (`homePageBlocksMaxCount = 30`)
  - **Data Structures:** `[]*types.TrimmedBlockInfo`, `*types.TrimmedMempoolInfo`, `*types.HomeInfo`, anonymous struct embedding `*CommonPageData`.
  - **Transformations:** Calls `GetHeight`, then `GetExplorerFullBlocks(ctx, h, h-30)`. Snapshots `maxBlockSize` and `issuedSKA` from `pageData.HomeInfo.SKACoinSupply` under `pageData.RLock` first, then releases ([:339-345](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L339-L345)). For each `*BlockInfo` calls `block.Trim(maxBlockSize, issuedSKA)`. Mempool: `inv.Trim(maxBlockSize)` then re-acquires `pageData.RLock` to patch `Subsidy = HomeInfo.NBlockSubsidy` and execute the template inside that hold ([:354-371](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L354-L371)). **Note:** `Subsidy` is patched onto the mempool tile so the WS path keeps the same shape, but the template no longer renders subsidy anywhere (rewards row gone). The patch is currently kept for shape stability; it could be retired once the WS encoder is also confirmed to ignore it.

- **Location:** `db/dcrpg/pgblockchain.go:7172-7188` (`GetExplorerFullBlocks`)
  - **Data Structures:** `[]*exptypes.BlockInfo`.
  - **Transformations:** Loops `i := start; i > end; i--`, calls `getBlockVerbose(ctx, i, true)` then `GetExplorerBlock(ctx, data.Hash)`. Sequential — 30 calls per page load; only the most-recent hit benefits from the memo.

- **Location:** `db/dcrpg/pgblockchain.go:6366-6633` (`GetExplorerBlock`)
  - **Data Structures:** `*exptypes.BlockInfo` (full), `pgb.lastExplorerBlock` (single-block memo).
  - **Transformations:** Memoizes the last hash and returns the same pointer to concurrent callers (`lastExplorerBlock.Lock`). `trimmedTxInfoFromMsgTx` sets `Voted: txBasic.VoteInfo != nil` per tx; this drives the three-state vote rendering in the new template. `MiningFee` and `TotalSent` are summed via `dcrutil.Amount.ToCoin()` (VAR-precision float64) — still surfaced on `BlockInfo`/`TrimmedBlockInfo` but **no longer read by the page** (header now shows size, not amount).

- **Location:** `explorer/types/explorertypes.go` (Go types — extended by commit `38636d52` on top of PR #284 contract)
  - `TrimmedTxInfo` at [`:357-367`](../../../explorer/types/explorertypes.go#L357-L367) — JSON tags from PR #284 unchanged (`fees`, `vote_valid`, `voted`, `vin_count`, `vout_count`, `coin_type,omitempty`, `ticket_status,omitempty`). `Voted bool` (`json:"voted"`) and `VoteValid bool` (`json:"vote_valid"`) drive the three-state class on the vote row.
  - `TrimmedBlockInfo` at [`:704-723`](../../../explorer/types/explorertypes.go#L704-L723) — PR #284 shape plus new `TotalFillRatio float64 \`json:"total_fill_ratio"\`` ([`:722`](../../../explorer/types/explorertypes.go#L722)). All other fields unchanged.
  - `(*BlockInfo).Trim(maxBlockSize, issuedSKA)` at [`:725-758`](../../../explorer/types/explorertypes.go#L725-L758) — extended to compute `totalFillRatio` as `float64(bi.BlockBasic.Size) / maxBlockSize` (guarded for `maxBlockSize > 0`) and populate it on the returned struct.
  - `BlockInfo` at [`:757-805`](../../../explorer/types/explorertypes.go#L757-L805) — added `TotalFillRatio float64 \`json:"total_fill_ratio,omitempty"\`` next to the other contract fields. PR #284's promoted-to-wire fields (`RegularCoinCounts`, `CoinFills`, `ActiveSKACount`, `MaxBlockSize`) unchanged.
  - `TrimmedMempoolInfo` at [`:898-915`](../../../explorer/types/explorertypes.go#L898-L915) — PR #284 shape unchanged; `TotalFillRatio` was already present (from the homepage indicator-fill work) and is now also read by the visualblocks mempool tile.
  - `MempoolInfo.Trim(maxBlockSize)` at [`:957-989`](../../../explorer/types/explorertypes.go#L957-L989) — unchanged from PR #284.

- **Location:** `cmd/dcrdata/internal/explorer/templates.go` (template helpers — five new registrations in `38636d52`)
  - **Data Structures:** `template.FuncMap` extended in `makeTemplateFuncMap`.
  - **Transformations / new helpers:**
    - `formatBytes(size int32) string` — wraps `humanize.Bytes` with a negative-input guard; produces `"15 kB"`-style strings used in the tile header.
    - `regularCountForSymbol(counts []types.CoinCount, symbol string) int` — block-tile lookup of tx count for a given coin symbol (drives the per-coin `.fill-bar` tooltip).
    - `mempoolRegularCountForSymbol(stats map[uint8]types.MempoolCoinStats, symbol string) int` — mempool-tile equivalent; parses `"SKA{n}"` via the new `coinTypeFromSymbol` helper to index the `CoinStats` map.
    - `sumRegularCoinCounts(counts []types.CoinCount) int` — TOTAL bar count on block tiles.
    - `sumMempoolRegularCounts(stats map[uint8]types.MempoolCoinStats) int` — TOTAL bar count on the mempool tile.
  - `coinTypeFromSymbol(symbol string) (uint8, bool)` is the inverse of `coinSymbol(ct)`; declared at file scope ([`:1019-1035`](../../../cmd/dcrdata/internal/explorer/templates.go#L1019-L1035)), used internally by `mempoolRegularCountForSymbol`.

- **Location:** `cmd/dcrdata/internal/explorer/explorer.go`
  - **Data Structures:** `pageData{BlockInfo, BlockchainInfo, HomeInfo}` at `:209-216`, `exp.invs *types.MempoolInfo` guarded by `invsMtx`. Unchanged.
  - **Transformations:** `Store()` and `StoreMPData()` still call `types.ComputeCoinFills`. **Note:** `Store` writes through to the memoized `*BlockInfo` (lastExplorerBlock); see Section 4 for the cross-page implications.

- **Location:** `cmd/dcrdata/internal/explorer/websockethandlers.go`
  - **Data Structures:** `types.WebsocketBlock`, `types.MempoolShort`, `types.TrimmedMempoolInfo`.
  - **Transformations:** `sigNewBlock` case at [`:272-300`](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L272-L300) — shallow-copy + patch sequence extended from three fields (PR #284) to **five fields** (commit `38636d52`):
    ```go
    blockCopy.CoinFills = trimmed.CoinFills
    blockCopy.ActiveSKACount = trimmed.ActiveSKACount
    blockCopy.MaxBlockSize = trimmed.MaxBlockSize
    blockCopy.RegularCoinCounts = trimmed.RegularCoinCounts
    blockCopy.TotalFillRatio = trimmed.TotalFillRatio
    ```
    `RegularCoinCounts` was already populated upstream by `pgblockchain.go` on the production code path, but the patch now explicitly mirrors `Trim`'s output to keep the contract independent of upstream callers. `getmempooltrimmed` at [`:189-209`](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L189-L209) unchanged from PR #284 (lock-order-reshuffled).

- **Location:** `pubsub/pubsubhub.go`
  - **Transformations:** **STILL not patched** — `sigNewBlock` broadcast at [`:459-472`](../../../pubsub/pubsubhub.go#L459-L472) encodes `psh.state.BlockInfo` directly. The PR #284 divergence carries forward unchanged for all five contract fields. `/ps` subscribers see `coin_fills`/`active_ska_count`/`max_block_size`/`regular_coin_counts`/`total_fill_ratio` as zero/nil/empty.

- **Location:** `cmd/dcrdata/views/visualblocks.tmpl` (fully rewritten in `38636d52`)
  - **Data Structures:** `.Info` (`*types.HomeInfo`), `.Mempool` (`*types.TrimmedMempoolInfo`), `.Blocks` (`[]*types.TrimmedBlockInfo`).
  - **Transformations / new structure:**
    - **Tile header** (`block-info`): link + `<span class="size">{{formatBytes .Size}}</span>` + (when `MaxBlockSize > 0`) `<span class="size-pct">{{printf "%.0f" (mulf .TotalFillRatio 100.0)}}%</span>` + age. Mempool variant uses `formatBytes .TotalSize`.
    - **Vote row**: `{{if .Voted}}{{if .VoteValid}}vote-yes{{else}}vote-no{{end}}{{else}}vote-skip{{end}}` for the span class. `title` JSON: `{"object": "Vote", "coin": "VAR", "voted": "<bool>", "voteValid": "<bool>"}`. Empty-slot pad to 5 unchanged.
    - **Tickets row**: structurally unchanged; ticket and revocation `title` JSON now carries `"coin": "VAR"`. Truncation `> 50 → clipSlice 30 + "+N more"` and empty-slot formula `zeroSlice (intSubtract 20 ticketsRevsCount)` unchanged.
    - **Indicator-fill block** (replacing the legacy transactions row): one `.total-bar` driven by `.TotalFillRatio`, then `{{range .CoinFills}}` emitting one `.fill-bar` per entry. Markup identical to `home_mempool.tmpl:16-89` (same `role="meter"`, `aria-*`, `data-coin`, segment classes). Per-bar `title` JSON: `{"object":"FillBar","coin":"<symbol>","txCount":"<n>"}`; TOTAL bar uses `sumRegularCoinCounts` (block) or `sumMempoolRegularCounts` (mempool); per-coin bars use `regularCountForSymbol` (block) or `mempoolRegularCountForSymbol` (mempool).
  - The mempool tile and block tile are written out separately (no shared `{{define}}` partial) but share the same row order: header → votes → tickets → indicator-fill.

- **Location:** `cmd/dcrdata/public/scss/visualblocks.scss` (rewritten in `38636d52`)
  - **Removed:** `.block-rewards`, `.pow`, `.pos`, `.fund`, `.fees`, `.paint`, `.block-transactions`, `.block-tx`.
  - **Added:** `.block-votes .vote-yes` (`#2971ff`), `.vote-no` (`rgba(253 113 74 / 80%)`), `.vote-skip` (`#c4cbd2`). Dark-theme override: `.vote-skip` becomes `#555`. `.size-pct` styling (small grey).
  - **Indicator-fill overrides:** `.block-indicator-fill { flex-grow: 2; flex-basis: 5px; padding: 2px; gap: 2px; border-top: 1px solid white; }` plus shrunken `.fill-bar__label` / `.fill-bar__pct` (~0.65rem font) and `.fill-bar__track` height (`0.75rem`). The base `_indicator-fill.scss` is imported globally via `application.scss:56` — the SCSS partial is shared with the homepage; only the compact-tile sizing lives in `visualblocks.scss`.
  - **Layout:** `.block-rows { height: 90px; }` restored after a brief stint without it (the no-height version made votes/tickets visibly thinner — see the post-rewrite tuning in the same commit). `flex-grow: 1` on `.block-votes` and `.block-tickets`; `flex-grow: 2` on `.block-indicator-fill` to give the 3-bar component the room it needs (~45px for 3 sub-bars at 0.75rem each).
  - Dark-theme `body.darkBG { … }` updated to keep the new vote-skip class legible.

- **Location:** `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js` (full rewrite in `38636d52`)
  - **Data Structures:** Stimulus controller with targets `box, title, showmore, root, tooltip, block, indicator`.
  - **Named exports (for vitest):** `makeMempoolBlock(tile)`, `newBlockHtmlElement(tile)`, `makeVoteElements(votes)`, `makeTicketAndRevocationElements(tickets, revs, blockHref)`, `makeIndicatorBars(totalFillRatio, coinFills, totalTxCount, countForSymbol)`, `normaliseWsBlock(block)`. Default export is the Stimulus Controller class.
  - **Pure helpers (file scope, not exported):** `makeNode`, `coinTypeFromSymbol`, `formatBytes`, `regularCountForSymbol`, `sumRegularCoinCounts`, `mempoolRegularCountForSymbol`, `sumMempoolRegularCounts`, `fillBarHtml`, `totalBarHtml`, `stakeTxSpan`, `blockInfoHtml`. Each helper has an equivalent on the Go side (`templates.go`); future contributors must keep the pair in sync.
  - **Normalisers:**
    - `normaliseWsBlock(block)` translates the WS wire-shape into a canonical PascalCase tile: reads `block.height` / `block.time` / `block.size` / `block.formatted_bytes` (BlockBasic lowercase JSON tags), `block.Votes` / `block.Tickets` / `block.Revs` (BlockInfo PascalCase, no JSON tags), `block.coin_fills` / `block.regular_coin_counts` / `block.total_fill_ratio` / `block.max_block_size` / `block.active_ska_count` (snake_case from the contract patch).
    - `normaliseMempool(mempool)` translates `TrimmedMempoolInfo`: reads `mempool.Votes/Tickets/Revocations/Time` (PascalCase) and `mempool.coin_fills` / `mempool.coin_stats` / `mempool.total_fill_ratio` / `mempool.total_size` / `mempool.max_block_size` (snake_case).
    - `normaliseTxs(txs)` normalises nested `TrimmedTxInfo` records: PascalCase `TxID`/`Total` (TxBasic no JSON tags) + snake-case `voted`/`vote_valid`/`vin_count`/`vout_count` (TrimmedTxInfo JSON tags) → single PascalCase shape.
  - **WS handlers:**
    - `_handleVisualBlocksUpdate(newBlock)` reads `newBlock.block`, normalises it, builds the new tile via `newBlockHtmlElement(tile)`, inserts after the mempool tile (`box.firstChild.nextSibling`), drops the `visible` class from the last visible tile, and `removeChild(lastChild)` to maintain ≤30 DOM tiles. The JS-side coinbase filter (`block.Tx.filter(!Coinbase)`) is gone — no per-tx rendering anymore.
    - `handleMempoolUpdate(evt)` parses, normalises, and `replaceChild` the first child (mempool tile) with the freshly-built tile.
  - **Tooltips (`setupTooltips`)** updated for the new title JSON shapes:
    - `Vote`: `"Voted YES"` / `"Voted NO"` / `"Did not vote"` based on `voted` + `voteValid`.
    - `FillBar`: `"N transactions"` (TOTAL) or `"N <coin>-transactions"` (per-coin).
    - `Ticket` / `Revocation`: `<total> VAR` + inputs/outputs.
    - Legacy `PoW Reward / PoS Reward / Project Fund / Tx Fees / Transaction` cases removed.

- **Location:** `cmd/dcrdata/internal/explorer/visualblocks_contract_test.go` (extended in `38636d52`)
  - **Transformations:** Sub-test `BlockContractWireFormat` adds `total_fill_ratio` assertion (`wantRatio := float64(15000) / maxBlockSize`). Sub-test `BlockWSWireFormatEquivalence` adds `total_fill_ratio` to `contractFields` and patches `RegularCoinCounts` + `TotalFillRatio` onto the test's `blockCopy` to mirror the production handler. **The contract now asserts five fields are wire-identical between HTTP and WS**, not four.

- **Location:** `cmd/dcrdata/public/js/controllers/visualBlocks_controller.test.js` (new in `38636d52`)
  - **Coverage:** 15 tests across `makeMempoolBlock` (6), `newBlockHtmlElement` (5), `normaliseWsBlock` (2), and `visualBlocks reconnect resync` (2, added after `38636d52`). Asserts:
    - Header size + percent, no DCR text.
    - No `.block-rewards`/`.block-transactions`/`.block-tx`/`.fund`/`.pow`/`.pos`/`.fees`.
    - Three vote-state classes by `(Voted, VoteValid)`; empty slots to 5.
    - Indicator-fill: one TOTAL + one fill-bar per CoinFills entry, ordered `VAR, SKA1, …`.
    - FillBar `txCount` derived correctly (block: from `RegularCoinCounts`; mempool: from `CoinStats[ct].regular_count`).
    - Ticket title carries `"coin": "VAR"`.
    - `block-rows > *` order: votes → tickets → indicator-fill.
    - Regression: `normaliseWsBlock` reads BlockBasic's lowercase JSON tags (`height`/`time`/`size`/`formatted_bytes`) instead of PascalCase — locks in the fix for the `/block/undefined` bug observed during in-browser verification.
    - Reconnect resync (`visualBlocks reconnect resync`): re-requests the trimmed mempool on the synthetic `reconnect` event, and removes its own `reconnect` handler on `disconnect`.

### Section 4 — Cross-Layer Dependencies
- **Two transport shapes for "one block."** HTTP renders `TrimmedBlockInfo` (already filtered, `Transactions` field name — still present on the wire but the new template does NOT iterate it). WebSocket pushes the full `BlockInfo` (`Tx` field name, includes coinbase — also no longer iterated by the controller). The five contract fields (`regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size`, `total_fill_ratio`) are patched onto the WS shallow-copy so the contract test can assert byte-identical JSON for them across transports. The remaining asymmetry (Tx/Transactions, coinbase filter, Subsidy struct) no longer reaches the page — every consumer the rewrite added reads only the five contract fields plus the BlockBasic embeds (`Size`/`FormattedBytes`) plus Votes/Tickets/Revs.

- **WS wire-shape mix is now an explicit JS concern.** `normaliseWsBlock` and `normaliseMempool` are load-bearing: they paper over the BlockBasic-vs-BlockInfo JSON-tag inconsistency in one place so the rest of the controller sees PascalCase only. Future contract additions should mirror the existing pattern — populate in `Trim`, patch on `blockCopy`, and *add the field to `normaliseWsBlock`* (the controller will silently miss the field otherwise).

- **WS shallow-copy is load-bearing (unchanged from PR #284).** The `*BlockInfo` returned by `GetExplorerBlock` is a memoized shared pointer (`pgb.lastExplorerBlock`). The WS handler builds `blockCopy := *block` before patching the five contract fields; writing them directly to the memoized pointer corrupts every other consumer.

- **Vote three-state contract.** `(Voted, VoteValid) → class` is now a contract between three locations: `(*BlockInfo).Trim` doesn't synthesise these fields (they come from `trimmedTxInfoFromMsgTx` at `pgblockchain.go:6558-6562`), `visualblocks.tmpl` emits the class via `{{if .Voted}}{{if .VoteValid}}…`, and `visualBlocks_controller.js:makeVoteElements` mirrors the mapping in JS. The contract test asserts `voted=true` on a vote-bearing fixture but does not exhaustively cover the three-state mapping — `visualBlocks_controller.test.js` does.

- **Indicator-fill component sharing.** `_indicator-fill.scss` is imported globally via `application.scss:56`; both `/home` (`home_mempool.tmpl`) and `/visualblocks` use the same `.total-bar` / `.fill-bar` markup. The visualblocks-specific overrides (`.block-indicator-fill` selector) only shrink fonts/heights and adjust flex weights for the compact tile context. Changing the base partial affects both pages; changing the override affects only `/visualblocks`. The homepage controller (`homepage_controller.js`) has its own dynamic injection logic for new SKA bars (`injectFillBar` in `public/js/helpers/indicator_fill.js`); the visualblocks controller does NOT use this — it rebuilds the entire tile from a string template on every WS push. C6 (template cloning) is still violated by both controllers via dompurify + string templates; this is a pre-existing pattern.

- **Template helper ↔ JS helper symmetry.** Five template helpers (`formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts`) all have JS-side equivalents declared at file scope in `visualBlocks_controller.js`. Behaviour must match byte-for-byte (especially `formatBytes` which mirrors `humanize.Bytes` SI conversion). No test currently asserts cross-language equivalence; first-render vs live-update divergence is the silent-drift class to watch for.

- **Coin symbol parsing.** `coinTypeFromSymbol("SKA{n}") → n` is the inverse of `coinSymbol(ct)` and exists in two places: `templates.go:1019` (Go, used by `mempoolRegularCountForSymbol`) and `visualBlocks_controller.js` (used by the JS mempool tooltip path). If `coinSymbol` ever stops producing the `SKA{n}` pattern, both inverses must update.

- **Subsidy struct asymmetry is now dead code on this page.** The Subsidy patch in `getmempooltrimmed` is still in place at `websockethandlers.go:200` (mempool tile `Subsidy = HomeInfo.NBlockSubsidy`), but no template field reads `.Subsidy` anymore. The patch is harmless but retired in practice — leave it in place to keep the WS shape stable for now.

- **Shared mutable state (unchanged).** `exp.pageData` and `exp.invs` are read by Home, Mempool, `/visualblocks`, and `/ws`. Lock map unchanged from PR #284: `pageData.RWMutex`, `invsMtx`, `MempoolInfo.RWMutex`. Only `Store` nests two (`pageData.Lock` then `invsMtx.Lock`). `getmempooltrimmed`/`getmempooltxs` still snapshot pageData first, release, then `Trim`.

- **Memoized DB block pointer (unchanged).** `pgb.lastExplorerBlock.blockInfo` is still shared by every consumer of the most-recent block. Treat read-only after `GetExplorerBlock` returns. WS shallow-copy is the canonical safe-augmentation pattern.

- **Contract test as enforcement.** `TestVisualBlocksDataContract` is the de facto spec for cross-transport equivalence. It now asserts five fields. Renames or additions must touch this test in the same change.

- **Outer 30-tile cap (unchanged).** Go const `homePageBlocksMaxCount = 30` + JS `box.removeChild(box.lastChild)`. Per-tile internals cap for tickets (`> 50 → clipSlice 30`) preserved. Transactions-row truncation is gone with the transactions row.

### Section 5 — Critical Constraints
- **C1 (numeric precision) — dormant on this page in v1.** The page no longer displays coin amounts. Bar widths are byte-domain (`Size / MaxBlockSize`), counts are integers. Per spec §0.2 the precision rule sits idle until a future iteration brings amounts back. The aggregate `BlockInfo.TotalSent` / `MiningFee` / `TrimmedTxInfo.Total` still travel through `dcrutil.Amount.ToCoin()` (float64) and remain VAR-precision-only — they're carried over the wire but not rendered. Surfacing SKA amounts in a future iteration must add atom-string fields, not new float64.

- **C2 (dual-pipeline mutation).** Five contract fields are now pinned across HTTP and WS by the shallow-copy patch + contract test. Adding a sixth re-applies the rule: populate in `Trim`, patch on `blockCopy`, assert in `visualblocks_contract_test.go`, **and** extend `normaliseWsBlock` so the JS side picks it up. Skip any step and the silent-drift bug class returns.

- **C3 (template + WebSocket parity).** Now harder, not easier: the JS controller builds a much larger DOM string per tile (header + 3 rows including an indicator-fill block with TOTAL + N per-coin bars). Class names, `data-*` hooks, `title` JSON shapes, and the `data-visualBlocks-target="tooltip"` attribute must match the template byte-for-byte. The contract test does not cover DOM shape; `visualBlocks_controller.test.js` covers most of the JS side but the template is unverified at this level — manual or Playwright verification is still required for template-only changes.

- **C5 (CSS styling).** The new SCSS pulls colours from inline values (`#2971ff` for vote-yes, `#fd714a` for vote-rev, etc.) — these are pre-existing literals carried over from the legacy code. If you touch them, prefer to add an SCSS variable in `_variables.scss` and reference it; do not invent new inline hexes.

- **C6 (in-DOM template cloning).** The controller still uses `dompurify.sanitize` + template literals to build tiles, not `<template>` cloning. This violates C6 but matches the legacy controller's idiom; it has not been reworked because the entire tile is rebuilt per WS event (not a small sub-element). A future refactor could introduce a `<template id="visual-blocks-tile">` element to satisfy C6 cleanly; this would also collapse the C3 risk by guaranteeing identical markup with the server-rendered tile.

- **C7 (centralized coin-type labels).** `CoinFillData.Symbol` is server-set via `coinSymbol(ct)` inside `ComputeCoinFills`/`RegularCoinCountsFromCoinRows`. The controller never constructs SKA labels — it consumes `entry.symbol` directly. The new `coinTypeFromSymbol` parser exists only to map symbol strings back to coin-type indices for the mempool `CoinStats` map lookup; if `coinSymbol` ever stops producing `SKA{n}`, both inverses must update.

- **C8 (dual-transport shape asymmetry).** Narrowed materially on this page:
  - Five fields are wire-identical across HTTP and WS (was four under PR #284).
  - The `Subsidy.Dev` vs `Subsidy.Developer` asymmetry no longer reaches the page (rewards row gone).
  - The `Tx` vs `Transactions` field-name asymmetry no longer matters (neither tile reads per-tx).
  - WS still carries the full `BlockInfo` (treasury, stake fees, all of `Tx`) but nothing on this page reads those.
  - Wire-shape mix (BlockBasic lowercase JSON tags vs BlockInfo PascalCase vs TrimmedTxInfo snake-case) is still there; `normaliseWsBlock` is the load-bearing reconciliation.
  - `/ps` (pubsub) divergence unchanged — `pubsubhub.go:sigNewBlock` does not patch any of the five contract fields.

- **Single-tx single-coin / fee follows coin.** Unchanged from PR #284: per-coin counts and fill ratios live on `CoinFills`/`CoinStats`/`RegularCoinCounts`. The page no longer surfaces SSFee distribution (it never did meaningfully) or per-coin amounts.

- **Hardcoded literals preserved.** `5` votes per tile, `20` tickets+revs per tile, `> 50 → clipSlice 30 + "+N more"` for tickets, `30` outer tile cap. All stake/render parameters.

### Section 6 — Mutation Impact
When modifying `/visualblocks` data:

- **Direct dependencies:**
  - `explorerroutes.go:VisualBlocks` (handler — thin: snapshot pageData, loop `block.Trim`, mempool `inv.Trim`, render).
  - `views/visualblocks.tmpl` (template — 3-row tile + indicator-fill).
  - `templates.go` template helpers (`formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts`, plus `coinTypeFromSymbol` internal).
  - `explorer/types/explorertypes.go`: `TrimmedBlockInfo`, `TrimmedTxInfo`, `TrimmedMempoolInfo`, `WebsocketBlock`, `(*BlockInfo).Trim`, `(*MempoolInfo).Trim`, `types.ComputeCoinFills`, `StatsFromCoinRows`, `RegularCoinCountsFromCoinRows`.
  - `db/dcrpg/pgblockchain.go`: `GetExplorerBlock`, `GetExplorerFullBlocks`, `trimmedTxInfoFromMsgTx` (Voted source).
  - `explorer.go:Store`/`StoreMPData` (background updaters; both call `types.ComputeCoinFills`).
  - `websockethandlers.go:sigNewBlock` (shallow-copy + 5-field patch) + `getmempooltrimmed`.
  - `public/index.js` (WS → event bus) and `public/js/controllers/visualBlocks_controller.js` (DOM render + normalisation).
  - `public/scss/visualblocks.scss` (compact-tile overrides for indicator-fill + vote classes).
  - `public/scss/_indicator-fill.scss` (shared with homepage).
  - `visualblocks_contract_test.go` (5-field cross-transport assertions).
  - `visualBlocks_controller.test.js` (vitest pinning the new DOM shape).

- **Indirect dependencies:**
  - `pubsub/pubsubhub.go` — duplicates home-page subsidy/reward calc; broadcasts `psh.state.BlockInfo` over `sigNewBlock` WITHOUT the 5-field contract patch.
  - Home page (`home_latest_blocks_controller.js`, `home_mempool.tmpl`), block page, mempool page — all consume the same `BlockInfo`/`MempoolInfo` shapes via WS frames. `TotalFillRatio` is the new wire-visible field; consumers that stringify or hash the payload will see a slightly larger object.
  - `status_controller.js`, `blocks_controller.js`, `time_controller.js`, `address_controller.js` — all subscribe to `BLOCK_RECEIVED`.

- **Serialization boundaries:**
  - HTTP: Go template rendering of `TrimmedBlockInfo`/`TrimmedMempoolInfo` (now with `TotalFillRatio` on the block side).
  - WS new-block: `json.Encode(WebsocketBlock{Block:&blockCopy, Extra:*HomeInfo})` — five fields patched.
  - WS mempool: `json.Encode(*TrimmedMempoolInfo)` with `MaxBlockSize`/`TotalSize`/`TotalFillRatio`/`CoinFills`/`CoinStats` already populated by `Trim` plus `Subsidy` patched from `HomeInfo.NBlockSubsidy` (still patched even though the template no longer reads it).

- **Rendering layers:** `visualblocks.tmpl` (initial 30 tiles + mempool tile) and `visualBlocks_controller.js` (incremental updates).

**Silent failures:**

- WS-shape regression (lowercase JSON tag fields read as PascalCase) → `/block/undefined`, `NaNs ago`. Locked by `normaliseWsBlock` test.
- New contract field added to `TrimmedBlockInfo` + `Trim` but not to `blockCopy` patch → first 30 tiles correct, WS-pushed tiles silently miss the field. Contract test catches only the five currently asserted.
- New contract field patched but not added to `normaliseWsBlock` → WS shape carries it but the JS tile builder reads `undefined`.
- Template helper diverges from JS equivalent → header/tooltip mismatch between first-render and live-update tiles. Not currently locked.
- Vote three-state mapping out of sync between template + JS → wrong colour class on the JS-built tile only.
- `coinTypeFromSymbol` divergence → mempool-tile bar tooltip looks up wrong coin.
- C3 drift: adding a `data-*` hook or class to the template but not to `newBlockHtmlElement`/`makeMempoolBlock` → CSS or tippy.js fails on live-updated tiles only.
- `/ps` consumer reading `total_fill_ratio` (or any of the five) from pubsub `sigNewBlock` → zero/nil because pubsub is still unpatched.
- Subsidy field-name one-sided rename — now harmless on this page (no template field reads `.Subsidy`) but still hot on the homepage. Be careful about cleanup.
- Non-JSON `title` attribute → tooltip silently disabled (the `setupTooltips` `catch {}` block swallows the parse error).

**Hard failures:**

- Removing `block.Tx` from `BlockInfo` → `(*BlockInfo).Trim` nil deref (still scans `bi.Tx` for the coinbase).
- Removing or renaming any of `formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts` → template parse error at first request.
- Removing `(*BlockInfo).Trim` / `(*MempoolInfo).Trim` → compile failure across handler, websockethandlers, pubsubhub, viewmodel tests, dev_indicators.
- Changing `Trim` signatures → fan-out compile error (safe-by-default).

### Section 7 — Common Pitfalls
1. **Reading PascalCase Go fields from the WS wire-shape.** `BlockBasic` fields have lowercase JSON tags (`height`, `time`, `size`, `formatted_bytes`); `BlockInfo`'s non-embedded fields have no JSON tags and serialise as PascalCase (`Votes`, `Tickets`, `Revs`, `Tx`). The mixing is real and intentional, and `normaliseWsBlock` is the single place that resolves it. New WS-shape code outside this normaliser will reintroduce the `/block/undefined` bug class.

2. **Adding a contract field without updating the JS normaliser.** Five steps per addition: (a) `TrimmedBlockInfo` struct + JSON tag; (b) `BlockInfo` struct + JSON tag; (c) `(*BlockInfo).Trim` populates it; (d) `websockethandlers.go:sigNewBlock` patches it onto `blockCopy`; (e) `visualBlocks_controller.js:normaliseWsBlock` reads it. Skip (e) and the JS tile silently misses the field on live updates.

3. **Template helper drift.** `formatBytes` mirrors `humanize.Bytes`; if you change the Go formatter you must mirror in the JS implementation. Same for the count-lookup helpers. There is no automated cross-language equivalence test.

4. **Mutating `pageData.BlockInfo` directly when adding new contract fields.** The WS handler must continue to shallow-copy and patch — the source pointer is shared with the memo.

5. **`pubsub/pubsubhub.go` divergence.** `/ps` `sigNewBlock` still doesn't patch any of the five contract fields. If a `/ps` consumer ever needs them, mirror the patch sequence.

6. **Holding `MempoolInfo.RLock` while waiting on `pageData.RLock`.** The PR #284 lock-order refactor is preserved; don't reintroduce the inverted nest.

7. **Forgetting to update the dark theme.** The new `.vote-skip` class needs a dark-theme variant (already in `visualblocks.scss`); future vote-state additions need the same treatment.

8. **C6 still violated.** Don't expand the string-template approach into more places; if you add a new dynamic tile-injection surface, prefer `<template>` cloning per C6.

9. **C7 inverse parser duplication.** `coinTypeFromSymbol` exists in both Go (`templates.go`) and JS (`visualBlocks_controller.js`). Treat as paired code.

10. **Subsidy patch is dead but still wired.** The mempool tile no longer reads `.Subsidy`, but the WS path still writes it onto `mempoolInfo.Subsidy`. Removing the patch is safe only if you also verify no consumer outside this page reads it from the WS payload — currently no one does, but the audit is a chore worth its own commit.

### Section 8 — Evidence
- `cmd/dcrdata/main.go:694` — route registration `r.Get("/visualblocks", explore.VisualBlocks)`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:135` — `homePageBlocksMaxCount = 30`.
- `cmd/dcrdata/internal/explorer/explorerroutes.go:320-381` — `VisualBlocks` handler.
- `db/dcrpg/pgblockchain.go:6558-6562` — `trimmedTxInfoFromMsgTx` populates `Voted: txBasic.VoteInfo != nil`.
- `db/dcrpg/pgblockchain.go:7172-7188` — `GetExplorerFullBlocks` sequential loop.
- `db/dcrpg/pgblockchain.go:6366-6633` — `GetExplorerBlock` with memo at `:6371-6376` / `:6626-6630`.
- `explorer/types/explorertypes.go:357-367` — `TrimmedTxInfo` with PR #284 JSON tags; `Voted bool`.
- `explorer/types/explorertypes.go:704-723` — `TrimmedBlockInfo` extended with `TotalFillRatio` (line 722).
- `explorer/types/explorertypes.go:725-758` — `(*BlockInfo).Trim` extended to populate `TotalFillRatio` (guarded `maxBlockSize > 0`).
- `explorer/types/explorertypes.go:757-805` — `BlockInfo` adds `TotalFillRatio float64 \`json:"total_fill_ratio,omitempty"\``.
- `explorer/types/explorertypes.go:898-915` — `TrimmedMempoolInfo` (PR #284 shape unchanged).
- `explorer/types/explorertypes.go:957-989` — `MempoolInfo.Trim` (unchanged from PR #284).
- `cmd/dcrdata/internal/explorer/templates.go:1019-1075` — five new template helpers + `coinTypeFromSymbol`.
- `cmd/dcrdata/internal/explorer/websockethandlers.go:272-300` — `sigNewBlock` shallow-copy + 5-field patch.
- `cmd/dcrdata/internal/explorer/websockethandlers.go:189-209` — `getmempooltrimmed` (PR #284 lock-order preserved).
- `pubsub/pubsubhub.go:319-340` — `getmempooltxs` (PR #284 lock-order preserved).
- `pubsub/pubsubhub.go:459-472` — `sigNewBlock` (still NOT patched).
- `cmd/dcrdata/internal/explorer/visualblocks_contract_test.go` — `BlockContractWireFormat` asserts `total_fill_ratio`; `BlockWSWireFormatEquivalence` asserts five-field parity; `MempoolContractWireFormat` unchanged.
- `cmd/dcrdata/public/index.js:46-64` — `ws.registerEvtHandler('newblock', ...)` → `globalEventBus.publish('BLOCK_RECEIVED', newBlock)`.
- `cmd/dcrdata/public/js/controllers/visualBlocks_controller.js:1-420` — full rewrite: helpers, normalisers, exported builders, Stimulus controller.
- `cmd/dcrdata/public/js/controllers/visualBlocks_controller.test.js:1-356` — 15 tests (vote states, indicator-fill structure, FillBar tooltip JSON, ticket coin label, block-rows order, WS-shape regression, reconnect resync).
- `cmd/dcrdata/views/visualblocks.tmpl` — full rewrite: 3-row tile (votes / tickets / indicator-fill), three vote states, formatBytes header, indicator-fill markup mirroring `home_mempool.tmpl`.
- `cmd/dcrdata/public/scss/visualblocks.scss` — vote-state classes, compact indicator-fill overrides, dark-theme update.
- `cmd/dcrdata/public/scss/_indicator-fill.scss` — base partial (shared with homepage), imported globally via `application.scss:56`.

See also:
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: out-of-band shared page state; shared-state lock discipline; `*CommonPageData` embedding)
- /wiki/code-analysis/page-rendering/impact.md (depends-on: saver writer/reader drift; lock-order inversion against `Store`; `commonData` nil render crash)
- /wiki/code-analysis/visualblocks/patterns.md — domain patterns (cross-pipeline tile rendering, wire-shape normalisation, indicator-fill component reuse, three-state vote rendering, cross-transport contract via WS shallow-copy + Trim patch, memoized BlockInfo, lock order).
- /wiki/code-analysis/visualblocks/impact.md — mutation impact, loud/silent failure modes, safe-change checklist.
- /wiki/code-analysis/mempool/flow.full.md (shares-pattern-with: `MempoolInfo` aggregation, `CoinFills` derivation in `StoreMPData`; indicator-fill component is shared with `/home` mempool card)
- /wiki/code-analysis/block/flow.full.md (shares-pattern-with: fan-out BlockDataSaver, dual transport shape REST vs WebSocket)
- /wiki/code-analysis/transaction/flow.full.md (shares-pattern-with: mempool aggregation vs confirmed Vout-array — the same C8 dual-transport class)
- /wiki/core/constraints.md (depends-on: C1 numeric precision — dormant on this page in v1; C2 dual pipeline; C3 template + WS parity — more critical post-rewrite; C6 in-DOM template cloning — still violated; C7 centralized coin-type labels; C8 dual-transport shape asymmetry — narrowed to wire-shape mixing only)
- /wiki/specs/homepage-metrics/spec.md (shares-pattern-with: home-page indicator-fill component reused by `/visualblocks`)
- /wiki/specs/visualblocks/spec.md (depends-on: the spec this rewrite implements; §13 acceptance checklist verified in `38636d52`)
