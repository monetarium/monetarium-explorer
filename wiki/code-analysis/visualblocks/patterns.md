# VisualBlocks Domain Patterns

Recurring patterns and invariants for the `/visualblocks` page. Most are domain-specific; cross-cutting concerns link out to `core/constraints.md`.

Revision: `HEAD=717be5a6` (post visualblocks UI rewrite for #270 on top of PR #284 contract; selector-based mempool-tile lookup + reconnect handler added by `793610c8`/`2218b9c`/`fe58506`/`aa356db6`).

## 1. Cross-Pipeline Tile Rendering

The same 3-row tile DOM is produced two ways and then mutated in place:

- **Initial render (HTTP):** server-side template walks `[]*TrimmedBlockInfo` and emits 30 `<div class="block">` tiles plus one mempool tile. Each tile contains `block-info` header + `block-rows > (block-votes, block-tickets, indicator-fill block-indicator-fill)`.
- **Live update (WebSocket):** `visualBlocks_controller` consumes `newblock` and `mempool` events, normalises the wire shape (see pattern 2), builds new `<div class="block">` nodes in JS (`makeNode` + `dompurify`), and surgically `insertBefore`/`replaceChild` to mutate the same DOM.

Implications:

- Two render code paths must produce structurally identical DOM (class names, attribute shapes, `data-*` hooks, `title` JSON shapes). The `38636d52` rewrite materially enlarges the DOM both pipelines emit — the indicator-fill block alone adds one `<div class="total-bar">` plus N `<div class="fill-bar">` per tile, each with its own track + segments + markers.
- **`data-role="mempool-tile"` is now a structural contract.** Both the server-rendered template (`visualblocks.tmpl:27`) and the JS-built tile (`makeMempoolBlock`, `793610c8`) MUST emit this attribute. Both WS event handlers locate the mempool tile via `querySelector('[data-role="mempool-tile"]')`. If either emitter drops the attribute, both handlers silently no-op (null guard returns early) and the page goes stale. HTML comments inside the blocks-holder create `Text` nodes that displace `firstChild`; don't add them.
- DOM trim is dual: template's `clipSlice 30` (per-tile internals, tickets only post-rewrite — the transactions row is gone) + JS `splice(30)` mirror it.
- See [core/constraints.md#C3](../../core/constraints.md#C3) (template + WebSocket parity) and [core/constraints.md#C8](../../core/constraints.md#C8) (dual-transport shape asymmetry — narrowed by the contract).

---

## 2. Wire-Shape Normalisation (WS path)

The WebSocket frame for `BlockInfo` mixes three JSON-tag conventions in one object:

| Source on Go side                | JSON convention             | Example wire keys                                          |
| -------------------------------- | --------------------------- | ---------------------------------------------------------- |
| `BlockBasic` (embedded)          | lowercase (explicit tags)   | `height`, `time`, `size`, `formatted_bytes`                |
| `BlockInfo` (no tag)             | PascalCase (Go name)        | `Votes`, `Tickets`, `Revs`, `TotalSent`, `MiningFee`, `Tx` |
| `BlockInfo` (contract-field tag) | snake_case                  | `coin_fills`, `regular_coin_counts`, `total_fill_ratio`    |
| `TrimmedTxInfo` (explicit tags)  | snake_case + PascalCase mix | `voted`, `vote_valid`, `vin_count`, `vout_count`, `TxID`, `Total` (last two from TxBasic, no tag) |

`visualBlocks_controller.js` resolves this in three normalisers: `normaliseWsBlock(block)`, `normaliseMempool(mempool)`, `normaliseTxs(txs)` (used for Votes / Tickets / Revocations inside both). The tile builders downstream (`newBlockHtmlElement`, `makeMempoolBlock`) consume only the canonical PascalCase shape these produce.

Implications:

- The normaliser is **load-bearing** — replaces the legacy code's habit of reading some fields PascalCase and some lowercase ad-hoc. The first version of the rewrite shipped with `block.Height` (PascalCase) misread from the lowercase wire and produced `/block/undefined` tiles on live updates; the `visualBlocks_controller.test.js` regression test pins this.
- Any new contract field added to `BlockInfo` (5 steps: TrimmedBlockInfo struct → BlockInfo struct → Trim populates → WS patches blockCopy → contract test) MUST also be added to `normaliseWsBlock`. Skip the normaliser and the WS shape carries the field but the JS tile reads `undefined`.
- Skipping `normaliseTxs` for vote/ticket fields means `vote.voted` (snake-case) stays unconsumed and the three-state class collapses to `vote-skip` for every vote.

---

## 3. Three-State Vote Rendering

The vote row is now driven by `(Voted, VoteValid)` instead of `VoteValid` alone:

| (Voted, VoteValid) | Class       | Visual / meaning                                       |
| ------------------ | ----------- | ------------------------------------------------------ |
| `(true, true)`     | `vote-yes`  | Blue. Validator voted to approve the block.            |
| `(true, false)`    | `vote-no`   | Red. Validator voted to disapprove.                    |
| `(false, *)`       | `vote-skip` | Grey. Validator was offline (did not vote).             |

Empty slots up to 5 stay transparent (no class). The class assignment is duplicated in three places:

- Server: `trimmedTxInfoFromMsgTx` ([db/dcrpg/pgblockchain.go:6558-6562](../../../db/dcrpg/pgblockchain.go#L6558-L6562)) sets `Voted = txBasic.VoteInfo != nil` and `VoteValid` from the chain.
- Template: `{{if .Voted}}{{if .VoteValid}}vote-yes{{else}}vote-no{{end}}{{else}}vote-skip{{end}}` in `visualblocks.tmpl`.
- JS: same nested conditional in `visualBlocks_controller.js:makeVoteElements`.
- SCSS: the three classes are declared in `visualblocks.scss` (with a dark-theme override for `.vote-skip`).

Implications:

- Adding a fourth state requires updating all four. The vitest file `visualBlocks_controller.test.js` covers the three-state mapping at the DOM level; the contract test covers only `voted=true` for vote-bearing fixtures.
- Don't unify on a 2-state colour scheme — `vote-skip` is the new information and is the user-visible signal that validators are offline.

---

## 4. Indicator-Fill Component Reuse

The `_indicator-fill.scss` partial (imported globally via `application.scss:56`) defines `.total-bar`, `.fill-bar`, `.fill-bar__track`, `.gq-segment` / `.extra-segment` / `.overflow-segment` / `.gq-marker`. Both `/home` (`home_mempool.tmpl`) and `/visualblocks` (`visualblocks.tmpl`) emit the same markup; only the sizing/spacing is per-page (overrides in `home.scss` and `visualblocks.scss` respectively).

For `/visualblocks` specifically, the override block is `.block-rows .block-indicator-fill { … }` in `visualblocks.scss`. It:

- Sets `flex-grow: 2` on the bar block (votes and tickets each get `flex-grow: 1`) so the 3-bar component gets ~45px in a 90px `.block-rows` (votes/tickets ~22px each — matches the legacy thickness).
- Shrinks `.fill-bar__label` and `.fill-bar__pct` to ~0.65rem font + ~2-2.5rem flex-basis.
- Shrinks `.fill-bar__track` height to `0.75rem`.

Implications:

- The base partial is shared — changes affect both pages. The override only adjusts the compact-tile context.
- The homepage controller has dedicated dynamic-injection helpers (`injectFillBar`, `applyFillBar`, `applyTotalBar`, `repositionSKAMarkers` in `public/js/helpers/indicator_fill.js`). The visualblocks controller does NOT use these — it rebuilds the entire tile from string templates per WS event. The two patterns coexist; future controllers should pick one approach consistently.
- C6 is violated by the visualblocks controller's string-template approach. A refactor to `<template>` cloning would also collapse the C3 risk (template and JS would emit identical markup by construction).

---

## 5. Cross-Transport Contract via WS Shallow-Copy + Trim Patch (5 fields)

Introduced by PR #284 for four fields, extended to five by commit `38636d52`. The pattern selectively aligns specific fields between HTTP and WebSocket without flattening the rest of the asymmetry:

- HTTP path: `(*BlockInfo).Trim(maxBlockSize, issuedSKA)` produces `*TrimmedBlockInfo` with `CoinFills` / `ActiveSKACount` / `MaxBlockSize` / `RegularCoinCounts` / `TotalFillRatio` populated.
- WS path: handler does `blockCopy := *pageData.BlockInfo`, computes `trimmed := block.Trim(...)`, patches all five fields from `trimmed` onto `blockCopy`, then encodes `&blockCopy`.
- `visualblocks_contract_test.go:TestVisualBlocksDataContract.BlockWSWireFormatEquivalence` asserts the five fields are byte-for-byte identical between transports. The `BlockContractWireFormat` sub-test additionally asserts `total_fill_ratio` is present in the HTTP wire and equals `Size / MaxBlockSize`.

The 5-step contract for adding a sixth field:

1. Add to `TrimmedBlockInfo` struct + JSON tag.
2. Add to `BlockInfo` struct + JSON tag.
3. Populate in `(*BlockInfo).Trim`.
4. Patch `blockCopy.<Field> = trimmed.<Field>` in `websockethandlers.go:sigNewBlock`.
5. Add an assertion to `visualblocks_contract_test.go`.
6. *(JS extension)* Add the field to `normaliseWsBlock` so the tile builder can read it.

Implications:

- The shallow copy is **load-bearing**: `pageData.BlockInfo` aliases the memoized `pgb.lastExplorerBlock` pointer (pattern 6 below). Writing the patched fields directly would corrupt every other consumer of that pointer.
- `pubsub/pubsubhub.go:sigNewBlock` is NOT updated to apply the same patch — `/ps` subscribers receive `state.BlockInfo` with all five contract fields zero/nil/empty. This is a known divergence introduced by PR #284 and carried through `38636d52`. If `/ps` consumers ever start reading any of the five, mirror the patch.

---

## 6. Memoized Single-Block Pointer Share

`pgb.lastExplorerBlock` ([db/dcrpg/pgblockchain.go:6366-6633](../../../db/dcrpg/pgblockchain.go#L6366-L6633)) caches the most recently built `*BlockInfo` keyed by hash. Every caller that requests the same hash gets the *same pointer*. Visualblocks, block page, mempool page, and `/ws` `sigNewBlock` all consume this.

Implications:

- Treat the returned `*BlockInfo` as **read-only** after `GetExplorerBlock` returns. Any handler-side mutation corrupts subsequent callers' views.
- The memo only covers a single hash; calling `GetExplorerFullBlocks(h, h-30)` is still 30 sequential DB+RPC builds — the memo only helps when the most-recent block is fetched repeatedly across pages.
- **Canonical safe-augmentation pattern:** shallow-copy the struct (`blockCopy := *block`), patch the additional fields on the copy, encode the copy. This pattern is active in `websockethandlers.go:sigNewBlock` for the five contract fields and is the reference for any future contract-field addition.

---

## 7. Trim Methods on the Types Package (PR #284, extended in `38636d52`)

PR #284 moved the trim logic into `explorer/types/explorertypes.go`:

- `(*BlockInfo).Trim(maxBlockSize, issuedSKA) *TrimmedBlockInfo` — extracts coinbase size, calls `StatsFromCoinRows` → `ComputeCoinFills`, returns a fully populated `TrimmedBlockInfo`. **Commit `38636d52` extends it** to also compute `totalFillRatio = float64(bi.BlockBasic.Size) / maxBlockSize` (guarded for `maxBlockSize > 0`) and set it on the returned struct.
- `(*MempoolInfo).Trim(maxBlockSize) *TrimmedMempoolInfo` — signature/body unchanged from PR #284.
- `ComputeCoinFills` and `StatsFromCoinRows` are exported helpers on the types package.

Implications:

- Signature changes propagate to every caller — safe-by-default. Callers updated by `38636d52`: `explorerroutes.go:VisualBlocks`, `websockethandlers.go:sigNewBlock` + `getmempooltrimmed`, `pubsub/pubsubhub.go:getmempooltxs`, `home_viewmodel_test.go`, `dev_indicators.go`, `templates_test.go`, `visualblocks_contract_test.go`.
- `(*BlockInfo).Trim` is now reusable by other handlers — no longer baked into `/visualblocks`.
- `StatsFromCoinRows` subtracts coinbase size from VAR's row so the coinbase doesn't inflate the VAR fill bar — this asymmetry between "block-level fill" and "mempool fill" lives there, not in `ComputeCoinFills`.

---

## 8. Background-Updated Shared Page State (unchanged from PR #284)

`exp.pageData` (RWMutex-guarded, BlockInfo + BlockchainInfo + HomeInfo) and `exp.invs` (`invsMtx`-guarded pointer to a `MempoolInfo`, which has its own embedded RWMutex) are mutated only by the background savers (`Store`, `StoreMPData`) and read by every page handler. **Three distinct locks:**

- `pageData.RWMutex` — guards `BlockInfo`/`HomeInfo`/`BlockchainInfo`.
- `invsMtx` (on `explorerUI`) — guards the `*MempoolInfo` pointer itself.
- `MempoolInfo.RWMutex` (embedded in the struct) — guards the mempool data.

Acquisition patterns:

- **`Store` (block saver):** holds `pageData.Lock()` and **nests** `invsMtx.Lock()` inside it. Only place two locks are concurrently held.
- **`StoreMPData`:** takes `pageData.RLock()`, releases, *then* takes `invsMtx.Lock()`. Not nested.
- **`VisualBlocks` handler:** takes `pageData.RLock` to snapshot `maxBlockSize` + `issuedSKA` (`:339-345`), releases; then `invsMtx.RLock` briefly via `MempoolInventory()`, then `MempoolInfo.RLock` via `Trim()`; then re-acquires `pageData.RLock` to patch `Subsidy` and execute the template (`:356-371`).
- **`websockethandlers.go:getmempooltrimmed`** ([:189-209](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L189-L209)): `pageData.RLock` snapshot first, release, then `inv.Trim` (takes `MempoolInfo.RLock`), then patch `Subsidy`. Order set by PR #284, preserved.
- **`pubsub/pubsubhub.go:getmempooltxs`** ([:319-340](../../../pubsub/pubsubhub.go#L319-L340)): same refactor — `psh.state.mtx.RLock` snapshot first, then `inv.Trim`.
- **`MempoolInfo.Trim`** ([explorertypes.go:957](../../../explorer/types/explorertypes.go#L957)): `defer mpi.RUnlock()` — RLock held for the entire function body.

Implication: only `Store` nests two `explorerUI` locks (`pageData.Lock` + `invsMtx.Lock`, in that order). Any new code that holds `invsMtx` (or `MempoolInfo.RLock`) and then waits on `pageData.Lock` would deadlock against `Store`. Don't reintroduce the prior `MempoolInfo.RLock ⊃ pageData.RLock` overlap unwound by PR #284.

---

## 9. WebSocket Subsidy Patch (dead-but-wired)

The mempool tile path still copies `exp.pageData.HomeInfo.NBlockSubsidy` onto `mempoolInfo.Subsidy` just before serializing ([explorerroutes.go:357](../../../cmd/dcrdata/internal/explorer/explorerroutes.go#L357) and [websockethandlers.go:200](../../../cmd/dcrdata/internal/explorer/websockethandlers.go#L200)).

**Note:** the new template (`38636d52`) no longer reads `.Subsidy` anywhere (rewards row deleted). The patch is harmless but effectively dead code on this page. Don't rely on it for anything new; do not remove it without an audit of the WS frame's other consumers (currently no external consumer reads the mempool-tile `Subsidy`).

---

## 10. Cross-Transport Contract Test (PR #284, extended in `38636d52`)

`cmd/dcrdata/internal/explorer/visualblocks_contract_test.go:TestVisualBlocksDataContract` is the de facto contract spec. After `38636d52` it:

- Builds a `*BlockInfo` fixture with `BlockBasic` + `CoinRows` + a coinbase + a vote-bearing tx + `RegularCoinCounts`.
- Serializes both transports' wire format (`(*BlockInfo).Trim` → JSON for HTTP, shallow-copy `BlockInfo` with five fields patched → JSON for WS).
- **Asserts JSON equality on five contract fields:** `regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size`, `total_fill_ratio` (was four pre-rewrite).
- Asserts the coinbase is filtered from `transactions` and `voted=true` for the vote-bearing tx.
- Asserts `total_fill_ratio == Size / MaxBlockSize` in the HTTP wire.
- For mempool: asserts `max_block_size` and `total_size` round-trip through `(*MempoolInfo).Trim`.

Implication: this is the contract-enforcement floor. The test does NOT cover DOM shape (the vitest file does); it does NOT cover the wire shape's JS-side normalisation (also vitest); it does NOT cover `/ps` pubsub divergence (no test covers that).

---

## 11. Vitest DOM-Shape Pin (new in `38636d52`; extended in `aa356db6`, `793610c8`, `e72ee50c`)

`cmd/dcrdata/public/js/controllers/visualBlocks_controller.test.js` is the frontend contract for this domain. 19 tests across five describe blocks:

- `makeMempoolBlock` (6 tests): header size + pct + no DCR; no legacy rewards / transactions / fund classes; three vote states + coin:VAR title; indicator-fill with one TOTAL + one fill-bar per CoinFills entry; tooltip JSON carries coin + txCount from `CoinStats.regular_count`; ticket title carries `coin:"VAR"`.
- `newBlockHtmlElement` (5 tests): same surface for block tiles; FillBar `txCount` derived from `RegularCoinCounts`; block-rows order is votes → tickets → indicator-fill.
- `normaliseWsBlock` (2 tests): reads `height`/`time`/`size`/`formatted_bytes` from BlockBasic's lowercase JSON tags; normalises nested votes from `voted`/`vote_valid` to `Voted`/`VoteValid` PascalCase.
- `visualBlocks reconnect resync` (2 tests, `aa356db6`): re-requests the trimmed mempool on the synthetic `'reconnect'` event; removes its own `'reconnect'` handler on `disconnect`.
- `controller mempool-tile lifecycle` (4 tests, `793610c8`/`e72ee50c`): `handleMempoolUpdate` replaces the mempool tile in place; `_handleVisualBlocksUpdate` inserts after the mempool tile and trims the last; mempool tile remains singular after both update types; empty-box null guard (no throw, no insertion).

Implication: every future tile-DOM change must run this file and either confirm assertions pass or update them. The WS-shape regression test guards the `/block/undefined` bug class; the lifecycle suite guards the `data-role="mempool-tile"` DOM contract.

---

## 12. Template Helper / JS Helper Symmetry

Five template helpers in `templates.go` have equivalent JS implementations in `visualBlocks_controller.js`:

| Concern              | Go (template)                      | JS (controller)                  |
| -------------------- | ---------------------------------- | -------------------------------- |
| Byte formatting      | `formatBytes(size int32)`          | `formatBytes(bytes)`             |
| Block-tile lookup    | `regularCountForSymbol(counts, s)` | `regularCountForSymbol(counts, s)` |
| Mempool-tile lookup  | `mempoolRegularCountForSymbol(stats, s)` | `mempoolRegularCountForSymbol(stats, s)` |
| Block TOTAL sum      | `sumRegularCoinCounts(counts)`     | `sumRegularCoinCounts(counts)`   |
| Mempool TOTAL sum    | `sumMempoolRegularCounts(stats)`   | `sumMempoolRegularCounts(stats)` |
| Coin-type parsing    | `coinTypeFromSymbol(symbol)`       | `coinTypeFromSymbol(symbol)`     |

Implications:

- The first-render HTTP pipeline goes through the Go helpers; the live-update WS pipeline goes through the JS helpers. They must produce equivalent output (especially `formatBytes` mirroring `humanize.Bytes`'s SI conventions: `"15 kB"`, lowercase `k`).
- No automated cross-language equivalence test exists. Drift is a silent-failure surface.

---

## 13. The Subsidy Struct Asymmetry — Retired On This Page

Pre-rewrite, this domain had a known gotcha: the mempool tile got `BlockSubsidy{Dev}` (JSON `"dev"`) while block tiles got `chainjson.GetBlockSubsidyResult{Developer}` (JSON `"developer"`). Both names appeared in `visualblocks.tmpl`; JS used `subsidy.developer || subsidy.dev`.

Post-`38636d52` the rewards row is gone from both tile types. The template no longer references `.Subsidy.{Pow,PoS,Developer,Dev}` anywhere. The asymmetry is still present in the Go types and the WS payload (mempool path still patches `mempoolInfo.Subsidy` for shape stability) but no longer reaches a renderer on this page.

Implications:

- Renaming `BlockSubsidy.Dev → Developer` no longer breaks `/visualblocks`. It would still break the homepage `home_mempool.tmpl` and possibly other consumers.
- Don't remove `mempoolInfo.Subsidy` from the WS payload yet without auditing other WS consumers.

---

See also:

- [core/constraints.md#C8](../../core/constraints.md#C8) — dual-transport shape asymmetry (umbrella for patterns 1, 2, 5; narrowed by the 5-field contract).
- [code-analysis/block/patterns.md](../block/patterns.md) — the same fan-out / dual-pipeline pattern at the BlockData layer.
- /wiki/code-analysis/page-rendering/patterns.md (shares-pattern-with: shared-state lock discipline / out-of-band `pageData`+`invs`).
- /wiki/code-analysis/page-rendering/impact.md (depends-on: "Saver Writer/Reader Drift" — the visualblocks HTTP vs WS payload divergence is one manifestation; the contract-field patch is the local mitigation).
- /wiki/code-analysis/mempool/patterns.md (shares-pattern-with: indicator-fill component reuse across `/home` and `/visualblocks`).
- /wiki/specs/visualblocks/spec.md (depends-on: §1–§13; §13 acceptance checklist verified in `38636d52`).
