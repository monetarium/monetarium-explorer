# VisualBlocks Domain — Mutation Impact

Revision: `HEAD=38636d52` (post visualblocks UI rewrite for #270 on top of PR #284 contract).

## When modifying: the `/visualblocks` page or its backing data

You MUST verify all of the following layers, because the page has **two transport paths** that carry different shapes of the same logical entity (see [patterns.md#1](patterns.md) and [core/constraints.md#C8](../../core/constraints.md#C8)). PR #284 narrowed the asymmetry for four fields; commit `38636d52` extended that to five (added `total_fill_ratio`) and rewrote the renderers to actually consume the contract. The remaining asymmetry (Tx/Transactions, Subsidy struct, full BlockInfo on WS) no longer reaches a renderer on this page.

---

## 1. Direct Consumers

### HTTP handler

- File: [cmd/dcrdata/internal/explorer/explorerroutes.go:320-381](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L320-L381) (`VisualBlocks`).
- Reads: `dataSource.GetHeight`, `GetExplorerFullBlocks`, `pageData.BlockchainInfo.MaxBlockSize`, `pageData.HomeInfo.SKACoinSupply`, `MempoolInventory().Trim(maxBlockSize)`, `pageData.HomeInfo.NBlockSubsidy`.
- Risk: compile-time break if `(*BlockInfo).Trim` / `(*MempoolInfo).Trim` signatures change.

### Template

- File: [cmd/dcrdata/views/visualblocks.tmpl](../../../cmd/dcrdata/views/visualblocks.tmpl) (fully rewritten in `38636d52`).
- Reads (block tile): `.Height`, `.Time.UNIX`, `.Size`, `.FormattedBytes`, `.MaxBlockSize`, `.TotalFillRatio`, `.CoinFills`, `.RegularCoinCounts`, `.Votes[*].{Voted,VoteValid,TxID}`, `.Tickets[*].{TxID,Total,VoutCount,VinCount}`, `.Revocations[*].{...}`. NOT read anymore: `.Total`, `.Fees`, `.Subsidy.*`, `.Transactions`.
- Reads (mempool tile): `.Time`, `.TotalSize`, `.MaxBlockSize`, `.TotalFillRatio`, `.CoinFills`, `.CoinStats`, `.Votes`, `.Tickets`, `.Revocations`.
- Calls template helpers: `formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts`, `mulf`, `minf`, `printf`, `clipSlice`, `zeroSlice`, `intSubtract`, `intAdd`.
- Risk: template-execution error (visible at request time, not compile time) if a `.Field` reference loses its backing field OR if a registered helper is removed from `templates.go`.

### Template helpers (registered in `templates.go`)

- File: [cmd/dcrdata/internal/explorer/templates.go:1019-1075](../../../cmd/dcrdata/internal/explorer/templates.go#L1019-L1075).
- New helpers introduced by `38636d52`:
  - `formatBytes(size int32) string` — wraps `humanize.Bytes` with a negative guard.
  - `regularCountForSymbol(counts []types.CoinCount, symbol string) int`.
  - `mempoolRegularCountForSymbol(stats map[uint8]types.MempoolCoinStats, symbol string) int`.
  - `sumRegularCoinCounts(counts []types.CoinCount) int`.
  - `sumMempoolRegularCounts(stats map[uint8]types.MempoolCoinStats) int`.
  - `coinTypeFromSymbol(symbol string) (uint8, bool)` — file-scoped helper (not registered), used by `mempoolRegularCountForSymbol`.
- Risk: removing any of these breaks `/visualblocks` template parsing at first request.

### JS Controller

- File: [cmd/dcrdata/public/js/controllers/visualBlocks_controller.js](../../../cmd/dcrdata/public/js/controllers/visualBlocks_controller.js) (fully rewritten in `38636d52`).
- Reads (WS `newblock`): the WS frame carries the full `BlockInfo`. The controller's `normaliseWsBlock` reads:
  - From `BlockBasic` (lowercase JSON tags): `block.height`, `block.time`, `block.size`, `block.formatted_bytes`.
  - From `BlockInfo` non-tagged: `block.Votes`, `block.Tickets`, `block.Revs`.
  - From `BlockInfo` snake-case-tagged (contract fields): `block.coin_fills`, `block.regular_coin_counts`, `block.total_fill_ratio`, `block.max_block_size`, `block.active_ska_count`.
  - From nested `TrimmedTxInfo` records: `vote.voted`, `vote.vote_valid`, `vote.vin_count`, `vote.vout_count` (snake-case); `vote.TxID`, `vote.Total` (PascalCase from TxBasic, no tags).
- Reads (WS `getmempooltrimmedResp`): `mempool.Time`, `mempool.total_size`, `mempool.coin_fills`, `mempool.coin_stats`, `mempool.total_fill_ratio`, `mempool.max_block_size`, `mempool.Votes`, `mempool.Tickets`, `mempool.Revocations`.
- Risk: any new contract field added to the WS shape but not added to `normaliseWsBlock` is silently `undefined` in the tile builder. The vitest regression test guards the existing fields, not future additions.

### Contract test (extended in `38636d52`)

- File: [cmd/dcrdata/internal/explorer/visualblocks_contract_test.go](../../../cmd/dcrdata/internal/explorer/visualblocks_contract_test.go).
- Asserts: **5 fields** identical across HTTP/WS — `regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size`, `total_fill_ratio`; `total_fill_ratio == Size / MaxBlockSize` in the HTTP wire; coinbase excluded from `transactions`; `voted=true` for vote-bearing tx; `max_block_size`/`total_size` on `TrimmedMempoolInfo`.
- Risk: rename one contract field and the test will fail (good); add a sixth without an assertion and nothing catches drift (bad).

### Vitest pin (new in `38636d52`)

- File: [cmd/dcrdata/public/js/controllers/visualBlocks_controller.test.js](../../../cmd/dcrdata/public/js/controllers/visualBlocks_controller.test.js).
- 15 tests across `makeMempoolBlock` (6), `newBlockHtmlElement` (5), `normaliseWsBlock` (2), and `visualBlocks reconnect resync` (2, added after `38636d52`).
- Asserts: no DCR; no legacy rewards/transactions/fund classes; vote-state classes by `(Voted, VoteValid)`; indicator-fill structure (1 TOTAL + N fill-bar); FillBar `txCount` from `RegularCoinCounts` (block) or `CoinStats.regular_count` (mempool); ticket title carries `coin:"VAR"`; `block-rows > *` order = votes/tickets/indicator-fill; WS-shape regression for BlockBasic lowercase JSON tags.
- Risk: a tile-shape change that breaks any of these assertions surfaces in `npm test` (vitest), not at `go build`.

### SCSS

- File: [cmd/dcrdata/public/scss/visualblocks.scss](../../../cmd/dcrdata/public/scss/visualblocks.scss) (rewritten in `38636d52`).
- File: [cmd/dcrdata/public/scss/_indicator-fill.scss](../../../cmd/dcrdata/public/scss/_indicator-fill.scss) (shared partial, imported globally via `application.scss:56`).
- Defines: `.block-votes .vote-yes / .vote-no / .vote-skip`, `.block-indicator-fill` overrides (flex-grow, padding, font sizes, track height), `.block-info .size / .size-pct`, dark-theme overrides.
- Risk: changing a class name without updating template + JS triggers C3 drift. Changing the base `_indicator-fill.scss` partial affects the homepage too.

---

## 2. Indirect Consumers (Same WebSocket Frames)

`sigNewBlock` emits the **shallow-copied** `BlockInfo` over `/ws` (full struct, with all five contract fields patched onto the copy). Many controllers subscribe to `BLOCK_RECEIVED`:

- `home_latest_blocks_controller.js`
- `status_controller.js`
- `blocks_controller.js`
- `time_controller.js`
- `address_controller.js`

If you rename a field on `BlockInfo` (Go struct tag), every one of these must be checked. A breaking change here is **silent on `/visualblocks` until the next block arrives**.

**New (post `38636d52`) caveat**: `BlockInfo.TotalFillRatio` is now wire-visible (`json:"total_fill_ratio,omitempty"`). Any controller that hashes the block payload, computes diff, or stringifies the message sees a slightly larger object than pre-rewrite.

---

## 3. Serialization Boundaries

### HTTP (server-rendered)

- Format: HTML via Go templates, fed by `TrimmedBlockInfo` (Go struct with `TotalFillRatio` added by `38636d52` on top of PR #284's widening).

### WebSocket — new block

- Format: `json.Encode(types.WebsocketBlock{Block:&blockCopy, Extra:*HomeInfo})` at [websockethandlers.go:272-300](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L272-L300).
- **`blockCopy` is a shallow copy of `pageData.BlockInfo`** with five fields patched on (`CoinFills`, `ActiveSKACount`, `MaxBlockSize`, `RegularCoinCounts`, `TotalFillRatio`).

### WebSocket — mempool

- Format: `json.Encode(*TrimmedMempoolInfo)` at [websockethandlers.go:189-209](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L189-L209). Populated by `Trim(maxBlockSize)` + `Subsidy` patched from `HomeInfo.NBlockSubsidy` (the Subsidy patch is now dead code on this page but kept for shape stability).

### Pubsub `/ps` — new block

- Format: `json.Encode(exptypes.WebsocketBlock{Block: psh.state.BlockInfo, Extra: ...})` at [pubsub/pubsubhub.go:459-472](../../../pubsub/pubsubhub.go#L459-L472).
- **STILL NOT patched** with the contract fields. `/ps` consumers see `BlockInfo` with `CoinFills`/`ActiveSKACount`/`MaxBlockSize`/`RegularCoinCounts`/`TotalFillRatio` zero/nil/empty.

### Pubsub `/ps` — mempool trim

- Format: `json.Encode(*TrimmedMempoolInfo)` at [pubsub/pubsubhub.go:319-340](../../../pubsub/pubsubhub.go#L319-L340) — same `MaxBlockSize`/`TotalSize` contract as the explorer `/ws` mempool path.

Risk: breaking one boundary without the other → page renders correctly until the next push, then silently drifts. Contract test covers only the five asserted block-side fields and the two mempool fields.

---

## 4. Background Updaters (Shared State)

### `Store` (BlockDataSaver)

- File: [cmd/dcrdata/internal/explorer/explorer.go:514-934](../../../cmd/dcrdata/internal/explorer/explorer.go#L514-L934).
- Mutates `pageData.BlockInfo`, `pageData.HomeInfo`, `exp.invs.CoinFills`.
- Calls `types.ComputeCoinFills` (unchanged from PR #284).
- Fires `sigNewBlock` + `sigMempoolUpdate`.

### `StoreMPData` (MempoolDataSaver)

- File: [cmd/dcrdata/internal/explorer/explorer.go:480-512](../../../cmd/dcrdata/internal/explorer/explorer.go#L480-L512).
- Mutates `exp.invs`; computes `CoinFills` against `HomeInfo.SKACoinSupply` via `types.ComputeCoinFills`.

### Duplicate calc in PubSub

- File: `pubsub/pubsubhub.go` (per CLAUDE.md, home subsidy/reward math is duplicated). Any change to `HomeInfo.NBlockSubsidy` must mirror.
- **Pubsub divergence:** explorer `/ws` patches the five contract fields onto a shallow copy; pubsub `/ps` does not. Unchanged across PR #284 and `38636d52`.

---

## 5. Database Layer

### `GetExplorerFullBlocks` + `GetExplorerBlock`

- Files: [db/dcrpg/pgblockchain.go:7172-7188](../../../db/dcrpg/pgblockchain.go#L7172-L7188), [:6366-6633](../../../db/dcrpg/pgblockchain.go#L6366-L6633).
- `lastExplorerBlock` memo at `:6371-6376` returns a **shared pointer** to multiple page consumers.

Risk: mutating the returned `*BlockInfo` in any handler corrupts all downstream consumers (see [patterns.md#6](patterns.md)). The `sigNewBlock` shallow-copy is the canonical safe-augmentation pattern.

### `trimmedTxInfoFromMsgTx`

- File: [db/dcrpg/pgblockchain.go:6558-6562](../../../db/dcrpg/pgblockchain.go#L6558-L6562).
- PR #284 added `Voted: txBasic.VoteInfo != nil` to every `TrimmedTxInfo` it builds. `38636d52` made this field load-bearing: the template and the JS controller both render the three vote states from `(Voted, VoteValid)`. If `trimmedTxInfoFromMsgTx` ever fails to set `Voted` correctly, every vote on the page silently becomes `vote-skip` (grey) regardless of whether it was cast.

---

## 6. Loud Failures (Compile / Runtime Errors)

| Change                                                          | Effect                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Remove `block.Tx` from `BlockInfo`                              | Go: `(*BlockInfo).Trim` scans `bi.Tx` for coinbase → nil-deref. JS: no longer affects this page (controller doesn't read `block.Tx` post-rewrite). |
| Remove `HomeInfo.NBlockSubsidy`                                 | Compile failure at `explorerroutes.go:357`, `websockethandlers.go:196`, `pubsub/pubsubhub.go:323` (Subsidy patch is now dead on this page but the assignments still exist). |
| Remove `(*MempoolInfo).Trim`                                    | Compile failure at `explorerroutes.go:354`, `websockethandlers.go:199`, `pubsub/pubsubhub.go:329`. |
| Remove `(*BlockInfo).Trim`                                      | Compile failure at `explorerroutes.go:348` and `websockethandlers.go:285`.    |
| Change `(*BlockInfo).Trim` or `(*MempoolInfo).Trim` signature   | Compile failure across all callers + `home_viewmodel_test.go`, `templates_test.go`, `dev_indicators.go`, `visualblocks_contract_test.go`. **Safe-by-default property.** |
| Remove or rename `types.ComputeCoinFills` / `StatsFromCoinRows` | Compile failure across `explorer.go` (Store/StoreMPData), `(*BlockInfo).Trim`, `dev_indicators.go`, `templates_test.go`. |
| Remove or rename any of `formatBytes`, `regularCountForSymbol`, `mempoolRegularCountForSymbol`, `sumRegularCoinCounts`, `sumMempoolRegularCounts` | Template parse error at first `/visualblocks` request (runtime). |
| Rename `TrimmedBlockInfo.Total` / `.Fees`                       | No effect — template no longer reads them post-rewrite.                       |
| Change `WebsocketBlock` JSON tag for `block` or `extra`         | JS sees `undefined`, `normaliseWsBlock` produces a corrupt tile; loud in `visualBlocks_controller.test.js`. |
| Add a new template helper signature                             | Templates must declare matching arg shapes; mismatched call sites yield a runtime parse error. |

---

## 7. Silent Failures (High Risk)

### WS wire-shape regression (the bug `38636d52` shipped and fixed)

- Reading `block.Height` (PascalCase) instead of `block.height` (lowercase JSON tag) → tile renders `/block/undefined` and `NaNs ago`. Locked by `normaliseWsBlock` test in `visualBlocks_controller.test.js`.
- Generalisation: any future field added to `BlockBasic` or to `TrimmedTxInfo` with a JSON tag must be read by its tag name, not the Go name.

### New contract field added to template + struct but not to WS shallow-copy

- Initial 30 tiles show the field. Newly-pushed WS tiles miss it because `sigNewBlock` doesn't patch it.
- Generalisation of the C8 silent-drift class. Contract test catches only the five fields it asserts.

### New contract field patched but not added to `normaliseWsBlock`

- WS frame carries the field but the JS tile builder reads `undefined`. The tile renders but the new feature silently no-ops.

### Template helper diverges from JS equivalent

- `formatBytes`, `regularCountForSymbol`, etc. have parallel implementations in Go and JS. If one is changed (e.g. switch to IEC units `KiB`) without the other, first-render tiles and live-updated tiles disagree.
- No automated cross-language test pins this.

### Vote three-state mapping out of sync between template + JS + SCSS

- Adding `vote-pending` only to JS → live tiles get a class with no CSS rule (transparent slot). Adding only to template → first render has it but live updates don't.

### `coinTypeFromSymbol` divergence

- Go-side and JS-side parsers must agree. If Go ever starts producing `"SKA-1"` instead of `"SKA1"`, both inverses must update.

### `/ps` (pubsub) divergence

- A `/ps` client that starts reading any of `coin_fills`/`active_ska_count`/`max_block_size`/`regular_coin_counts`/`total_fill_ratio` from `sigNewBlock` sees zero/nil. To fix: mirror the 5-field patch in `pubsubhub.go:sigNewBlock`.

### Subsidy patch is dead code

- Removing the patch is safe on this page but might break other WS consumers (none currently). Audit before deletion.

### C3 drift (class/data-* hook added to template only)

- CSS or tippy.js works on first-render tiles, silently breaks on WS-pushed tiles. The vitest file covers most but not all template details.

### Non-JSON `title` attribute

- The JS `setupTooltips` does `JSON.parse(tooltipElement.title)`. A non-JSON `title` silently disables the tooltip (the `catch {}` block swallows the parse error).

### Indicator-fill compact override conflicts with base partial

- Changing `_indicator-fill.scss` to add a new selector that the visualblocks override doesn't account for can mis-size the tile component.

### `TrimmedTxInfo` wire-format break for external consumers

- PR #284's explicit snake-case JSON tags are unchanged by `38636d52`. External clients reading the raw struct as JSON see snake_case keys; not covered by the contract test.

### Lock-order inversion (narrow)

- Unchanged from PR #284. `Store` is the only path that holds two `explorerUI` locks; new code holding `invsMtx` (or `MempoolInfo.RLock`) and then waiting on `pageData.Lock` deadlocks against `Store`.

---

## 8. Out-of-Scope Drops (Known Silent Filtering)

`(*BlockInfo).Trim` **does not** project the following BlockInfo fields onto `TrimmedBlockInfo`:

- `Treasury` (treasury txs).
- `StakeFees` (SSFee distribution).
- `CoinAmounts`, `TotalSentByCoin`, `FeesByCoin` (multi-coin per-block aggregates — `json:"-"` on `BlockInfo`).
- `SKAPoWRewards` (per-coin PoW reward).

`/visualblocks` is now byte-domain only on the bars (Size / MaxBlockSize, no aggregate amounts). Surfacing real per-coin amounts in a future iteration requires widening `TrimmedBlockInfo` with atom-string fields **and** matching JS work — not adding more float64.

---

## 9. Safe-Change Checklist

Before committing changes that touch the visualblocks data path:

- [ ] HTTP handler updated AND `visualblocks.tmpl` renders the change correctly.
- [ ] JS controller (`visualBlocks_controller.js`) renders the change identically on the next WS push.
- [ ] If adding a new contract field: populated in `(*BlockInfo).Trim`, copied onto `blockCopy` in `websockethandlers.go:sigNewBlock`, **and added to `normaliseWsBlock`**, AND new assertion in `visualblocks_contract_test.go`, AND new vitest assertion if it affects the tile DOM.
- [ ] If touching a template helper (`formatBytes`, `regularCountForSymbol`, …): mirror in the JS equivalent in `visualBlocks_controller.js`.
- [ ] If touching `coinTypeFromSymbol`: mirror on both Go and JS sides.
- [ ] If touching the three vote states: update template + JS + SCSS together; verify the dark-theme override.
- [ ] If touching the indicator-fill markup: check both `views/visualblocks.tmpl` AND `visualBlocks_controller.js:fillBarHtml`/`totalBarHtml`. Verify against `home_mempool.tmpl` (shared component).
- [ ] If `/ps` clients consume the new field: mirror the patch in `pubsub/pubsubhub.go:sigNewBlock`.
- [ ] If changing `(*BlockInfo).Trim`/`(*MempoolInfo).Trim` signatures: verify all callers compile.
- [ ] If touching `BlockInfo`: every other `BLOCK_RECEIVED` subscriber (home, blocks, status, time, address) verified.
- [ ] If touching `HomeInfo.NBlockSubsidy`: mirrored in `pubsub/pubsubhub.go`.
- [ ] If touching the 30-cap: Go const AND JS `removeChild`/`splice` updated.
- [ ] No mutation of the `*BlockInfo` returned by `GetExplorerBlock` — use the shallow-copy + patch pattern from `sigNewBlock`.
- [ ] No new code path holds `invsMtx` (or `MempoolInfo.RLock`) while waiting on `pageData.Lock`.
- [ ] No SKA atom-string routed through `float64` / `dcrutil.Amount.ToCoin()` before the template/JS boundary (C1 is dormant on this page but still global).
- [ ] `TestVisualBlocksDataContract` passes.
- [ ] `npm test -- visualBlocks` passes (`visualBlocks_controller.test.js`).
- [ ] Manual / Playwright verification of spec §13 still green: no DCR text, three vote states render, indicator-fill bars match the homepage component, dark theme legible.

---

See also:

- [code-analysis/visualblocks/patterns.md](patterns.md) — the patterns these risks emerge from (cross-pipeline tile rendering, wire-shape normalisation, three-state vote, indicator-fill reuse, shallow-copy + Trim patch).
- [code-analysis/block/impact.md](../block/impact.md) — the upstream `BlockData` mutation impact; `/visualblocks` inherits it via `GetExplorerBlock` + WS `sigNewBlock`.
- [code-analysis/mempool/impact.md](../mempool/impact.md) — `MempoolInfo.Trim` signature change cascade; the mempool domain also consumes `types.ComputeCoinFills` and shares the indicator-fill component.
- [core/constraints.md#C3](../../core/constraints.md#C3) — template + WS parity (more critical post-rewrite).
- [core/constraints.md#C6](../../core/constraints.md#C6) — in-DOM template cloning (still violated by this controller; pre-existing).
- [core/constraints.md#C7](../../core/constraints.md#C7) — centralized coin-type labels (server-set; `coinTypeFromSymbol` is the inverse).
- [core/constraints.md#C8](../../core/constraints.md#C8) — dual-transport shape asymmetry (narrowed to 5-field contract on this page).
