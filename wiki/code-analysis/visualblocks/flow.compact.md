Revision: `HEAD=386f2e12` (post PR #284 `feat/visualblocks-data-contract`).

HTTP: `RPC → ChainDB.GetExplorerFullBlocks(30) → GetExplorerBlock (memo) → snapshot pageData.{MaxBlockSize, SKACoinSupply} → for each block: block.Trim(maxBlockSize, issuedSKA) → visualblocks.tmpl`
WS new-block: `Store → wsHub ← sigNewBlock → snapshot pageData under RLock → blockCopy := *BlockInfo → trimmed := block.Trim(...) → patch blockCopy.{CoinFills, ActiveSKACount, MaxBlockSize} → WebsocketBlock{&blockCopy, HomeInfo} → index.js → BLOCK_RECEIVED → controller._handleVisualBlocksUpdate (still filters Coinbase JS-side)`
WS mempool: `StoreMPData → exp.invs ; client "getmempooltrimmed" → snapshot pageData.{MaxBlockSize, NBlockSubsidy} → release → inv.Trim(maxBlockSize) → patch Subsidy → controller.handleMempoolUpdate`

Key Patterns:

- **Dual transport, two shapes** — HTTP sends `TrimmedBlockInfo` (server-filtered); WS sends full `BlockInfo` (`Tx` not `Transactions`, includes coinbase). JS re-implements `FilterRegularTx`. PR #284 narrows the gap for four fields (`coin_fills`, `active_ska_count`, `max_block_size`, `regular_coin_counts`) by patching them onto a shallow-copy `BlockInfo` at WS-encode time; the broader trim asymmetry remains.
- **Trim methods on the types package** — `(*BlockInfo).Trim(maxBlockSize, issuedSKA)` and `(*MempoolInfo).Trim(maxBlockSize)` replace the inline trim code in `VisualBlocks`. `computeCoinFills` is now exported as `types.ComputeCoinFills`; `StatsFromCoinRows` bridges per-block `CoinRowData` to fill-bar stats (subtracts coinbase size from VAR).
- **WS shallow-copy is load-bearing** — `*BlockInfo` from `GetExplorerBlock` is a memoized shared pointer (`pgb.lastExplorerBlock`); the `sigNewBlock` handler MUST `blockCopy := *block` before patching contract fields, or it corrupts every cross-page consumer.
- **Subsidy struct asymmetry** — unchanged: `BlockSubsidy.Dev` (JSON `dev`, mempool tile) vs `chainjson.GetBlockSubsidyResult.Developer` (block tile). Template uses both names; JS uses `developer || dev`.
- **Outer 30-tile cap** — `homePageBlocksMaxCount = 30` (Go const) + JS `box.removeChild(box.lastChild)`. Template does *not* enforce the outer cap.
- **Per-tile internals cap** — template `clipSlice 30` when `> 50` (tickets, txs) + JS `splice(30)` mirrors it.
- **Lock map** — three locks (`pageData`, `invsMtx`, `MempoolInfo.RWMutex`); only `Store` nests two (`pageData.Lock` then `invsMtx.Lock`). PR #284 unwound the legacy `MempoolInfo.RLock ⊃ pageData.RLock` overlap in `getmempooltrimmed` and `pubsub.getmempooltxs` (snapshot pageData first, release, then Trim). `MempoolInfo.Trim` now defers its RUnlock — RLock held throughout, including fee summation.
- **Contract test as enforcement** — `TestVisualBlocksDataContract` asserts HTTP and WS produce identical JSON for `regular_coin_counts`, `coin_fills`, `active_ska_count`, `max_block_size`; new fields need new assertions.
- **Frontend rewrite staged** — `visualblocks.tmpl` and `visualBlocks_controller.js` do NOT yet consume the new fields (`coin_fills`, `active_ska_count`, `max_block_size`, `regular_coin_counts`, `voted`). The page renders identically pre/post-PR.

Critical Constraints:

- All amount bars are still **float64 VAR** (`flex-grow: {{.Total}}`); SKA atoms lossy through `dcrutil.Amount.ToCoin()` — PR #284 does NOT fix this. New contract fields are size-domain (bytes), so safe.
- `MiningFee`/`TotalSent` sum across all coins via `ToCoin()` — VAR-precision only.
- SKA SSFee distribution lives in `FeesByCoin`/`SSFeeTotalsByCoin` on `BlockInfo` (still `json:"-"`) — not surfaced.
- Treasury and StakeFees slices are dropped by `(*BlockInfo).Trim`.
- Empty-slot counts (5 votes, 20 tickets+revs) and `DCR` label are hardcoded.
- `TrimmedTxInfo` fields are now snake_case on the wire (`fees`, `vote_valid`, `vin_count`, `vout_count`, `voted`, ...) — wire-format break for external consumers.

Mutation Checklist:

- update `explorerroutes.go:VisualBlocks` (snapshot pageData; loop `block.Trim`) AND `views/visualblocks.tmpl` AND `visualBlocks_controller.js` together
- if adding a contract field to `TrimmedBlockInfo`: also add it to `BlockInfo` JSON, patch it onto `blockCopy` in `websockethandlers.go:sigNewBlock`, AND add a new assertion in `visualblocks_contract_test.go`
- if `/ps` (pubsub) clients consume the new field: also patch `pubsub/pubsubhub.go:sigNewBlock` (currently not patched)
- if changing `(*BlockInfo).Trim` or `(*MempoolInfo).Trim` signatures: every caller (handler, ws, pubsubhub, viewmodel tests, dev_indicators) must update
- if changing `BlockInfo` JSON: also touch `home_latest_blocks_controller.js`, `status_controller.js`, `blocks_controller.js`, `time_controller.js`, `address_controller.js`
- if changing `HomeInfo.NBlockSubsidy`: mirror in `pubsub/pubsubhub.go`
- if changing the outer 30-tile cap: update Go const (`homePageBlocksMaxCount`) AND JS `removeChild` trim
- if changing the per-tile `> 50` truncation threshold: update template `clipSlice 30` AND JS `splice(30)`
- never mutate the pointer returned by `GetExplorerBlock` — use the shallow-copy + patch pattern
- never invert: holding `MempoolInfo.RLock` while waiting on `pageData.RLock` (PR #284 unwound this; don't reintroduce)

Silent Risks:

- SKA tx amount through float64 → wrong `flex-grow`, dominant tile (unchanged)
- Removing the WS shallow-copy → memoized `*BlockInfo` mutation corrupts all cross-page consumers
- New `TrimmedBlockInfo` field not patched onto WS shallow-copy → newer WS-pushed tiles miss the field (contract test catches only the 4 asserted fields)
- `/ps` consumer reading `coin_fills`/`active_ska_count`/`max_block_size` from pubsub `sigNewBlock` → zero/nil (pubsub not patched)
- Subsidy field rename one-sided → "fund" bar collapses to 0
- Non-JSON `title` attribute → tooltip silently disabled
- External JSON consumers of `TrimmedTxInfo` → wire-format break from new snake_case JSON tags

Loud Failures:

- Remove `block.Tx` from `BlockInfo` → `(*BlockInfo).Trim` nil deref + JS runtime error
- Remove `HomeInfo.NBlockSubsidy` or `MempoolInfo.Trim`/`BlockInfo.Trim` → compile failure across 4-5 sites
- Change `Trim` signatures → fan-out compile error (the safe-by-default property)
