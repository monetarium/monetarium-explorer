Revision: `HEAD=717be5a6` (post visualblocks UI rewrite for #270 on top of PR #284 contract; selector-based mempool-tile lookup + reconnect handler added by `793610c8`/`2218b9c`/`fe58506`/`aa356db6`).

HTTP: `RPC → ChainDB.GetExplorerFullBlocks(30) → GetExplorerBlock (memo) → snapshot pageData.{MaxBlockSize, SKACoinSupply} → for each block: block.Trim(maxBlockSize, issuedSKA) → visualblocks.tmpl (3-row tile: votes / tickets / indicator-fill)`
WS new-block: `Store → wsHub ← sigNewBlock → snapshot pageData under RLock → blockCopy := *BlockInfo → trimmed := block.Trim(...) → patch blockCopy.{CoinFills, ActiveSKACount, MaxBlockSize, RegularCoinCounts, TotalFillRatio} → WebsocketBlock{&blockCopy, HomeInfo} → index.js → BLOCK_RECEIVED → controller._handleVisualBlocksUpdate → normaliseWsBlock (mixed wire-shape → PascalCase tile) → newBlockHtmlElement`
WS mempool: `StoreMPData → exp.invs ; client "getmempooltrimmed" → snapshot pageData.{MaxBlockSize, NBlockSubsidy} → release → inv.Trim(maxBlockSize) → patch Subsidy → controller.handleMempoolUpdate → normaliseMempool → makeMempoolBlock`
WS reconnect: `partysocket 'reconnect' event → controller.reconnectUnsub (registered in connect()) → ws.send('getmempooltrimmed', '') → same mempool path above`

Key Patterns:

- **Dual transport, shared tile builders** — HTTP renders `TrimmedBlockInfo`; WS pushes the full `BlockInfo` (after the contract-field patch). The JS controller's `normaliseWsBlock` translates the WS wire shape (BlockBasic lowercase JSON tags, snake_case TrimmedTxInfo) into a single PascalCase "tile" shape that `newBlockHtmlElement` consumes. The same tile shape is also the test fixture for `visualBlocks_controller.test.js`. JS-side coinbase filter is gone — neither tile renders per-tx anymore. **`data-role="mempool-tile"` is now a DOM contract:** both the template (`visualblocks.tmpl:27`) and `makeMempoolBlock` emit this attribute; both `_handleVisualBlocksUpdate` and `handleMempoolUpdate` locate the mempool tile via `querySelector('[data-role="mempool-tile"]')` rather than DOM position. Do NOT add HTML comments inside the blocks-holder — they create `Text` nodes that displace `firstChild`.
- **Three-row tile structure** — `block-rows` contains exactly `block-votes`, `block-tickets`, `indicator-fill block-indicator-fill` in that order. Rewards row deleted (rewards info no longer surfaced); per-tx transactions row deleted (replaced by aggregate bars). Mempool tile uses the same structure.
- **Three-state vote rendering** — Vote span class is `vote-yes` / `vote-no` / `vote-skip`, derived from `(Voted, VoteValid)` per the spec §4. `Voted=false → vote-skip` (validator offline); `Voted=true, VoteValid=true → vote-yes`; `Voted=true, VoteValid=false → vote-no`. Empty slots up to 5 stay transparent.
- **Indicator-fill component reuse** — the `_indicator-fill.scss` partial used by the homepage is global; `/visualblocks` reuses the same `.total-bar` / `.fill-bar` markup with compact-tile sizing overrides in `visualblocks.scss`. Each tile renders one `.total-bar` plus one `.fill-bar` per `CoinFillData` entry (VAR + active SKAn).
- **Cross-transport contract via WS shallow-copy + Trim patch** — five fields now patched onto `blockCopy` in `sigNewBlock`: `CoinFills`, `ActiveSKACount`, `MaxBlockSize`, `RegularCoinCounts`, `TotalFillRatio`. The shallow copy remains load-bearing because `pageData.BlockInfo` aliases the memoized `pgb.lastExplorerBlock`. Contract test asserts all five fields are byte-identical between HTTP and WS.
- **Template-helper-driven layout** — the template depends on `formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts` registered in `templates.go`. The JS controller carries equivalent implementations so the two pipelines produce identical bar tooltips. `coinTypeFromSymbol` is the shared parser ("VAR" → 0, "SKA{n}" → n) on both sides.
- **WS wire-shape mix (BlockBasic + TrimmedTxInfo)** — BlockBasic fields carry lowercase JSON tags (`height`, `time`, `size`, `formatted_bytes`); TrimmedTxInfo carries snake_case (`voted`, `vote_valid`, `vin_count`, `vout_count`); BlockInfo's own non-embedded fields are PascalCase (`Votes`, `Tickets`, `Revs`, `TotalSent`, `Tx`); the contract-patched fields are snake_case (`coin_fills`, etc.). The controller normalises all four cases.
- **Outer 30-tile cap + per-tile internals cap** — `homePageBlocksMaxCount = 30` (Go) + JS `box.removeChild(box.lastChild)` for the outer cap. Tickets still get template `clipSlice 30` when `> 50` and JS `splice(30)` mirrors it. The transactions truncation is gone with the transactions row.
- **Vitest pin** — `visualBlocks_controller.test.js` (19 tests, 5 suites) locks the DOM shape: three-state vote classes, no `.block-rewards`/`.block-transactions`/`.fund` classes, no literal `DCR` text, indicator-fill TOTAL+per-coin structure, ticket coin:VAR title, a WS-shape regression test for `normaliseWsBlock`, a `reconnect` resync suite (re-request mempool + handler cleanup), and a `controller mempool-tile lifecycle` suite (tile insert/replace via `data-role` selector, empty-box null guard).
- **Lock map unchanged** — three locks (`pageData`, `invsMtx`, `MempoolInfo.RWMutex`); only `Store` nests two (`pageData.Lock` then `invsMtx.Lock`). `getmempooltrimmed` still snapshots `pageData` first, releases, then `Trim` (PR #284 refactor preserved).

Critical Constraints:

- The page no longer displays coin amounts in v1 (spec §0.2), so **C1 (float64 precision) is dormant on this page** — bars are byte-domain (size / maxBlockSize), counts are integers. C1 returns the moment any iteration surfaces SKA amounts.
- **C3 (template + WS parity)** is more critical, not less: the JS controller now builds a much larger DOM string per tile (header + 3 rows including indicator-fill + per-coin bars). Every class name, `data-*` hook, and `title` JSON shape MUST match the template byte-for-byte; otherwise `setupTooltips`/CSS selectors fail silently on live updates.
- **C6 (in-DOM template cloning)** — this controller still uses `dompurify.sanitize` + template literals to build tiles, not `<template>` cloning. This is a pre-existing pattern carried through the rewrite; future controllers should still prefer template cloning per C6.
- **C7 (coin-type labels)** — `CoinFillData.Symbol` is server-set via `coinSymbol(ct)`. JS does NOT re-derive symbols; `coinTypeFromSymbol(symbol)` is the inverse parser used only for the mempool-tile `CoinStats[ct]` map lookup. Adding new SKA labels requires updating `coinSymbol` only.
- **C8 (dual-transport asymmetry)** — narrowed further: with rewards/transactions rows gone, the `Subsidy.Dev` vs `Subsidy.Developer` asymmetry no longer reaches the page. The remaining `Tx` vs `Transactions` field-name asymmetry no longer matters (neither tile reads per-tx). `BlockInfo` is still encoded in full on WS (treasury, stake fees, all of Tx) but nothing on this page reads those; consumers of the WS frame on other pages still do.
- All hard-coded literals (`5` votes, `20` tickets+revs, `> 50 → +N more`, `30` outer cap) preserved as stake/render params.

Mutation Checklist:

- Touching the tile DOM (template) → mirror in `newBlockHtmlElement` / `makeMempoolBlock` (controller) AND verify `visualBlocks_controller.test.js` assertions still hold.
- Ensure `data-role="mempool-tile"` is present on both the server-rendered mempool tile (`visualblocks.tmpl`) AND the JS-built tile (`makeMempoolBlock`). If either is missing, both WS handlers silently no-op. Do NOT add HTML comments inside `data-visualBlocks-target="box"`.
- Reconnect handler lifecycle: `connect()` must register `ws.registerEvtHandler('reconnect', ...)` and store the unsub; `disconnect()` must call it. Omitting the unsub leaks the handler after the controller detaches.
- Adding a sixth contract field: (a) add to `TrimmedBlockInfo` + `BlockInfo` JSON; (b) populate in `(*BlockInfo).Trim`; (c) patch onto `blockCopy` in `websockethandlers.go:sigNewBlock`; (d) add an assertion in `visualblocks_contract_test.go`; (e) update both `flow.full.md` and `patterns.md` cross-transport entries.
- Touching template helpers (`formatBytes`, `regularCountForSymbol`, etc. in `templates.go`) → mirror the same logic in `visualBlocks_controller.js` (helpers near the top of the file).
- Touching `coinTypeFromSymbol` on either side → mirror; the canonical helper lives in `templates.go` (Go) and `visualBlocks_controller.js` (JS).
- Touching the indicator-fill markup → check both `views/visualblocks.tmpl` and `visualBlocks_controller.js:fillBarHtml`/`totalBarHtml`; the SCSS lives in `public/scss/_indicator-fill.scss` (shared with homepage) plus `visualblocks.scss` (compact-tile overrides).
- Touching the three vote states → mirror the `(Voted, VoteValid) → class` mapping in template + JS; SCSS classes live in `visualblocks.scss` (`.vote-yes/.vote-no/.vote-skip`).
- WS wire-shape rules: keep `normaliseWsBlock` reading `block.height` / `block.time` / `block.size` / `block.formatted_bytes` (lowercase JSON tags from BlockBasic) and `block.coin_fills` / `block.regular_coin_counts` / `block.total_fill_ratio` / `block.max_block_size` (snake_case from the contract patch). PascalCase fields (`Votes`, `Tickets`, `Revs`, `TotalSent`) come straight from BlockInfo without JSON tags.
- Changing `(*BlockInfo).Trim` or `(*MempoolInfo).Trim` signatures: every caller (handler, ws, pubsubhub, viewmodel tests, dev_indicators) must update.
- If `/ps` (pubsub) clients consume the new field: also patch `pubsub/pubsubhub.go:sigNewBlock` (currently not patched — known divergence).
- Never mutate the pointer returned by `GetExplorerBlock` — use the shallow-copy + patch pattern.

Silent Risks:

- WS-shape regression: reading `block.Height`/`block.Time` (PascalCase) instead of `block.height`/`block.time` (lowercase JSON tags) → JS-built tile shows `/block/undefined` and `NaNs ago`. Locked by `normaliseWsBlock` test in `visualBlocks_controller.test.js`.
- `data-role="mempool-tile"` missing from template or `makeMempoolBlock` → `querySelector` returns `null`; both WS handlers silently no-op. Page becomes stale (no new-block inserts, no mempool refresh). Covered by `controller mempool-tile lifecycle` vitest suite.
- New contract field not patched onto WS shallow-copy → newer WS-pushed tiles miss the field; contract test catches only the five asserted fields.
- `/ps` consumer reading `coin_fills`/`active_ska_count`/`max_block_size`/`regular_coin_counts`/`total_fill_ratio` from pubsub `sigNewBlock` → zero/nil (pubsub still not patched).
- Template helper diverges from JS equivalent (`formatBytes` / `regularCountForSymbol` / `mempoolRegularCountForSymbol` / `sumRegular*`) → header / tooltip mismatch between first render and live-updated tiles. Not currently locked by a test.
- Non-JSON `title` attribute → tooltip silently disabled (the `setupTooltips` `catch {}` block swallows the parse error).
- `coinTypeFromSymbol` divergence between Go and JS → mempool-tile bar tooltips look up the wrong CoinStats entry.
- C3 drift: adding a class/`data-*` hook to the template but not to `newBlockHtmlElement`/`makeMempoolBlock` → CSS or tippy.js fails on live-updated tiles only.

Loud Failures:

- Remove `block.Tx` from `BlockInfo` → `(*BlockInfo).Trim` nil deref (the trim still scans `bi.Tx` for the coinbase to extract `coinbaseSize`).
- Remove `(*MempoolInfo).Trim` / `(*BlockInfo).Trim` → compile failure across handler, websockethandlers, pubsubhub, viewmodel tests, dev_indicators, templates_test.
- Change `Trim` signatures → fan-out compile error (safe-by-default).
- Remove or rename a template helper used by `visualblocks.tmpl` (`formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts`) → template parse error at first `/visualblocks` request.
- Remove `WebsocketBlock` JSON tag for `block` or `extra` → JS reads `undefined`, normalisation produces a corrupt tile, the `box.insertBefore` chain still works but the tile is visually broken.
